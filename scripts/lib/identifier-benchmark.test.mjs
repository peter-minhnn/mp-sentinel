import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { corpusHash } from "./golden-lock.mjs";

test("identifier experiment emits all variants and anchor diagnostics end to end", () => {
  const repo = mkdtempSync(join(tmpdir(), "identifier-bench-"));
  try {
    mkdirSync(join(repo, ".mp-sentinel-cache"));
    const file = {
      path: "src/invoice.ts",
      language: "typescript",
      symbols: [{ name: "loadInvoiceCustomer", type: "function", line: 1, column: 0 }],
      imports: [],
      exports: [],
      importsFrom: [],
      importedBy: [],
    };
    writeFileSync(
      join(repo, ".mp-sentinel-cache/source-index.json"),
      JSON.stringify({ files: [file] }),
    );
    const corpus = [
      {
        query: "invoice customer",
        relevant: [file.path],
        evidence: [{ file: file.path, kind: "symbol", name: "loadInvoiceCustomer" }],
      },
    ];
    writeFileSync(join(repo, "golden.json"), JSON.stringify(corpus));
    writeFileSync(
      join(repo, "golden.lock.json"),
      JSON.stringify({ version: 1, rows: 1, sha256: corpusHash(corpus) }),
    );
    const result = spawnSync(
      process.execPath,
      [
        resolve("scripts/fusion-ablation.mjs"),
        repo,
        join(repo, "golden.json"),
        "--identifier-evidence",
      ],
      { encoding: "utf8", timeout: 30000, maxBuffer: 4e6 },
    );
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(report.variants), [
      "current",
      "anchor-select",
      "seed-preserve",
      "coherent-seed",
    ]);
    assert.equal(report.variants["coherent-seed"].labelsInOpenedFiles, 1);
    assert.ok(report.variants["coherent-seed"].rows[0].anchorStats.length > 0);
    assert.equal(report.variants["coherent-seed"].rows[0].partialEvidence[0].file, file.path);
    const guarded = spawnSync(
      process.execPath,
      [resolve("scripts/fusion-ablation.mjs"), repo, join(repo, "golden.json"), "--coverage-guard"],
      { encoding: "utf8", timeout: 30000, maxBuffer: 4e6 },
    );
    assert.equal(guarded.status, 0, guarded.stderr);
    const candidate = JSON.parse(guarded.stdout).variants["coverage-guard"].rows[0];
    assert.equal(candidate.coverageGuard.fallback, false);
    assert.deepEqual(
      candidate.capsule.files.map((item) => item.file),
      [file.path],
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
