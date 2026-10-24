#!/usr/bin/env node
/** Private local cohorts. This runner never changes indexing/ranking policies. */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { checkCorpus, corpusHash } from "./lib/golden-lock.mjs";
import { validateRows } from "./lib/allocation-bench.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function validateManifest(input, base) {
  if (!Array.isArray(input?.repos) || !input.repos.length) throw new Error("manifest needs repos");
  const ids = new Set();
  const roots = new Set();
  return input.repos.map((entry) => {
    if (!/^[A-Za-z0-9_-]+$/.test(entry.id ?? "") || ids.has(entry.id))
      throw new Error("invalid/duplicate repo id");
    if (
      typeof entry.root !== "string" ||
      !entry.root ||
      typeof entry.corpus !== "string" ||
      !entry.corpus.endsWith(".json")
    )
      throw new Error("repo needs root and JSON corpus");
    const root = resolve(base, entry.root);
    if (roots.has(root)) throw new Error("duplicate repo root");
    roots.add(root);
    ids.add(entry.id);
    return { id: entry.id, root, corpus: resolve(base, entry.corpus) };
  });
}

function prepare(repo, freeze) {
  const rows = JSON.parse(readFileSync(repo.corpus, "utf8"));
  const core = JSON.parse(
    readFileSync(join(repo.root, ".mp-sentinel-cache/source-index.json"), "utf8"),
  );
  validateRows(rows, new Map(core.files.map((file) => [file.path, file])));
  if (rows.some((row) => !row.heldOut || row.validation))
    throw new Error("transfer corpus must contain held-out rows only");
  const descriptor = {
    id: repo.id,
    goldenPath: repo.corpus,
    lockPath: repo.corpus.replace(/\.json$/, ".lock.json"),
  };
  const checked = checkCorpus(descriptor);
  if (!checked.ok && !freeze) throw new Error(checked.reason);
  if (freeze && !checked.ok) {
    if (checked.fatal) throw new Error(checked.reason);
    writeFileSync(
      descriptor.lockPath,
      `${JSON.stringify({ version: (checked.lock?.version ?? 0) + 1, rows: rows.length, sha256: corpusHash(rows), frozenAt: new Date().toISOString().slice(0, 10) }, null, 2)}\n`,
    );
  }
  return {
    indexedFiles: core.files.length,
    filesWithSymbols: core.files.filter((file) => file.symbols?.length > 0).length,
    filesWithImports: core.files.filter((file) => file.imports?.length > 0).length,
    parseErrorFiles: core.files.filter((file) => file.parseErrors?.length > 0).length,
    symbolLabels: rows.flatMap((row) => row.evidence).filter((label) => label.kind === "symbol")
      .length,
    importLabels: rows.flatMap((row) => row.evidence).filter((label) => label.kind === "import")
      .length,
  };
}

/** A failed repository stays in the denominator; the full-cohort score is null. */
export function aggregateReports(entries) {
  const measured = entries.filter((entry) => entry.status === "measured");
  const complete = measured.length === entries.length && entries.length > 0;
  const result = {
    complete,
    repositories: entries.length,
    measured: measured.length,
    failed: entries.length - measured.length,
    arms: {},
  };
  for (const arm of ["anchored", "plain"]) {
    const labels = measured.reduce((n, entry) => n + entry.summary.labels, 0);
    const kept = measured.reduce((n, entry) => n + entry.summary.arms[arm].kept, 0);
    result.arms[arm] = {
      macroRetention: complete
        ? measured.reduce((n, entry) => n + entry.summary.arms[arm].retention, 0) / entries.length
        : null,
      microRetention: complete && labels > 0 ? kept / labels : null,
      observedLabels: labels,
      observedKept: kept,
      observedPackingLost: measured.reduce(
        (n, entry) => n + entry.summary.arms[arm].packingLost,
        0,
      ),
      observedRankingLost: measured.reduce(
        (n, entry) => n + entry.summary.arms[arm].rankingLost,
        0,
      ),
    };
  }
  return result;
}

export function runCohort(repos, run) {
  const entries = repos.map((repo) => {
    try {
      return { id: repo.id, status: "measured", ...run(repo) };
    } catch (error) {
      return { id: repo.id, status: "failed", error: error.message };
    }
  });
  return { summary: aggregateReports(entries), entries };
}

function measureRepo(repo, selection, output, replay) {
  const coverage = prepare(repo, false);
  const reportPath = join(output, `${repo.id}.json`);
  const measured = spawnSync(
    process.execPath,
    [
      join(ROOT, "scripts/agent-allocation-benchmark.mjs"),
      "--phase",
      replay ? "replay" : "transfer",
      "--repo",
      repo.root,
      "--corpus",
      repo.corpus,
      "--selection",
      selection,
      "--output",
      reportPath,
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 600000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  if (measured.status !== 0)
    throw new Error(
      `measurement exit ${measured.status}: ${measured.stderr || measured.error?.message}`,
    );
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const selected = report.runs.find((run) => run.config.id === report.selected);
  if (!selected?.summary.rows || !selected.summary.labels) throw new Error("unmeasurable report");
  process.stderr.write(`${repo.id}: ${selected.summary.rows} queries measured\n`);
  return {
    coverage,
    corpus: report.corpus,
    index: report.index,
    tool: report.tool,
    config: selected.config,
    summary: selected.summary,
    reportPath,
  };
}

function main() {
  const { values } = parseArgs({
    options: {
      manifest: { type: "string" },
      selection: {
        type: "string",
        default: join(ROOT, ".mp-sentinel-cache/benchmarks/allocation-tuning.json"),
      },
      output: { type: "string" },
      freeze: { type: "boolean", default: false },
      replay: { type: "boolean", default: false },
    },
  });
  if (!values.manifest) throw new Error("--manifest is required");
  const path = resolve(values.manifest);
  const repos = validateManifest(JSON.parse(readFileSync(path, "utf8")), dirname(path));
  if (values.freeze) {
    for (const repo of repos) {
      prepare(repo, true);
      process.stderr.write(`${repo.id}: corpus frozen and labels validated\n`);
    }
    return;
  }
  if (!values.output) throw new Error("--output directory is required");
  const output = resolve(values.output);
  mkdirSync(output, { recursive: true });
  const report = runCohort(repos, (repo) =>
    measureRepo(repo, resolve(values.selection), output, values.replay),
  );
  writeFileSync(join(output, "summary.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report.summary, null, 2)}\n`);
  if (!report.summary.complete) process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`FAIL cohort: ${error.message}\n`);
    process.exitCode = 2;
  }
}
