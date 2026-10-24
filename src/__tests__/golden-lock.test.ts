/**
 * Measurement corpora are frozen: every golden file has a lock holding a
 * version, a row count, and a content hash. Editing a corpus without running
 * `npm run golden:lock -- --write` fails here, so a recorded number can always
 * be traced back to the corpus version that produced it.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "@jest/globals";

const LOCK_TOOL = resolve("scripts/lib/golden-lock.mjs");
const LOCKS = [
  { golden: "scripts/retrieval-golden.json", lock: "scripts/retrieval-golden.lock.json" },
  { golden: "scripts/agent-context-golden.json", lock: "scripts/agent-context-golden.lock.json" },
];

describe("golden corpus locks", () => {
  it("checks public corpora without private labels, but rejects a partial local pair", () => {
    const directory = mkdtempSync(join(tmpdir(), "golden-public-"));
    try {
      mkdirSync(join(directory, "lib"));
      const tool = join(directory, "lib/golden-lock.mjs");
      writeFileSync(tool, readFileSync(LOCK_TOOL));
      for (const name of ["retrieval-golden", "agent-context-golden", "chain-golden"]) {
        for (const suffix of [".json", ".lock.json"]) {
          writeFileSync(
            join(directory, name + suffix),
            readFileSync(resolve("scripts", name + suffix)),
          );
        }
      }
      const run = (): string =>
        execFileSync(process.execPath, [tool], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      const output = run();
      expect(output).toContain("[golden:lock] retrieval:");
      expect(output).not.toContain("listening-chain");
      writeFileSync(
        join(directory, "listening-chain-golden.json"),
        readFileSync(resolve("scripts/retrieval-golden.json")),
      );
      expect(() => run()).toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("ships a lock next to every golden corpus", () => {
    for (const entry of LOCKS) {
      expect(existsSync(resolve(entry.golden))).toBe(true);
      expect(existsSync(resolve(entry.lock))).toBe(true);

      const lock = JSON.parse(readFileSync(resolve(entry.lock), "utf-8")) as {
        version: number;
        rows: number;
        sha256: string;
        frozenAt: string;
      };
      expect(Number.isInteger(lock.version)).toBe(true);
      expect(lock.version).toBeGreaterThanOrEqual(1);
      expect(lock.rows).toBeGreaterThan(0);
      expect(lock.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(lock.frozenAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      const rows = JSON.parse(readFileSync(resolve(entry.golden), "utf-8")) as unknown[];
      expect(rows.length).toBe(lock.rows);
    }
  });

  it("matches the frozen corpus hashes", () => {
    // Single source of truth: the same checker both benches run.
    const stdout = execFileSync(process.execPath, [LOCK_TOOL], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(stdout).toContain("[golden:lock] retrieval:");
    expect(stdout).toContain("[golden:lock] agent-context:");
  });
});
