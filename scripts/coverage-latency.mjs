#!/usr/bin/env node
/** Warm paired prototype timing; no model/network/CLI-spawn timings or source writes. */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { get_encoding } from "tiktoken";
import { compileFusion } from "./lib/compile-fusion.mjs";
import { preserveCoherentSeeds } from "./lib/coherent-seed.mjs";
import { guardAnchorCoverage } from "./lib/anchor-coverage-guard.mjs";
import { checkCorpus } from "./lib/golden-lock.mjs";
import { validateRows } from "./lib/allocation-bench.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const encoder = get_encoding("cl100k_base");
const summary = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    samples,
  };
};
async function guarded(base, proposal, index, prompt) {
  const baseline = await base.rankTaskCandidates(index, prompt);
  const baselineCapsule = await base.packExperimentCapsule(baseline.records, {
    maxFiles: 3,
    tokenBudget: 800,
    anchors: baseline.anchors,
    warnings: baseline.warnings,
  });
  const trace = await base.traceFusion(index, prompt);
  const alternate = await proposal.rankTaskCandidates(index, prompt);
  const policy = preserveCoherentSeeds(
    baseline.records,
    alternate.records,
    trace,
    new Map(index.files.map((file) => [file.path, file])),
    baseline.anchors,
  );
  const candidate = await proposal.packExperimentCapsule(policy.records, {
    maxFiles: 3,
    tokenBudget: 800,
    anchors: alternate.anchors,
    warnings: alternate.warnings,
  });
  return guardAnchorCoverage({
    baseline: baselineCapsule,
    proposal: candidate,
    trace,
    anchors: baseline.anchors,
  }).capsule;
}
async function time(fn) {
  const start = performance.now();
  const capsule = await fn();
  const ms = performance.now() - start;
  if (
    capsule.usedTokens > 800 ||
    encoder.encode(JSON.stringify(capsule)).length !== capsule.usedTokens
  )
    throw new Error("latency capsule budget/accounting violation");
  return ms;
}
try {
  const manifestPath = resolve(process.argv[2]);
  const manifest = JSON.parse(readFileSync(manifestPath));
  const sourcePath = resolve("src/services/source-index/task-context.ts"),
    source = readFileSync(sourcePath, "utf8");
  const policyPaths = [
    "scripts/coverage-latency.mjs",
    "scripts/lib/compile-fusion.mjs",
    "scripts/lib/anchor-experiment.mjs",
    "scripts/lib/fusion-trace.mjs",
    "scripts/lib/coherent-seed.mjs",
    "scripts/lib/identifier-evidence.mjs",
    "scripts/lib/seed-preserve.mjs",
    "scripts/lib/anchor-coverage-guard.mjs",
  ];
  const policyHashes = Object.fromEntries(
    policyPaths.map((path) => [path, hash(readFileSync(path))]),
  );
  const cache = resolve(".mp-sentinel-cache/benchmarks/fusion-bundles");
  mkdirSync(cache, { recursive: true });
  const directory = mkdtempSync(join(cache, "latency-"));
  const base = await compileFusion({ variant: "current", source, sourcePath, directory });
  const proposal = await compileFusion({ variant: "anchor-select", source, sourcePath, directory });
  const rows = [];
  for (const repo of manifest.repos) {
    const corpus = resolve(dirname(manifestPath), repo.corpus);
    const checked = checkCorpus({
      id: repo.id,
      goldenPath: corpus,
      lockPath: corpus.replace(/\.json$/, ".lock.json"),
    });
    if (!checked.ok) throw new Error(checked.reason);
    const indexPath = join(repo.root, ".mp-sentinel-cache/source-index.json"),
      bytes = readFileSync(indexPath),
      index = JSON.parse(bytes);
    const tasks = JSON.parse(readFileSync(corpus));
    validateRows(tasks, new Map(index.files.map((file) => [file.path, file])));
    const prompt = tasks[0].query;
    const functions = {
      current: () => base.module.buildTaskContext(index, prompt, { maxFiles: 3, tokenBudget: 800 }),
      guarded: () => guarded(base.module, proposal.module, index, prompt),
    };
    for (let i = 0; i < 2; i++) for (const fn of Object.values(functions)) await time(fn);
    const samples = { current: [], guarded: [] };
    for (let i = 0; i < 9; i++)
      for (const arm of i % 2 ? ["guarded", "current"] : ["current", "guarded"])
        samples[arm].push(await time(functions[arm]));
    if (hash(readFileSync(indexPath)) !== hash(bytes))
      throw new Error("index changed during paired timing");
    rows.push({
      repo: repo.id,
      corpus: checked.lock,
      indexSha256: hash(bytes),
      current: summary(samples.current),
      guarded: summary(samples.guarded),
    });
  }
  for (const [path, expected] of Object.entries(policyHashes))
    if (hash(readFileSync(path)) !== expected) throw new Error("timing policy changed");
  if (readFileSync(sourcePath, "utf8") !== source) throw new Error("timing source changed");
  process.stdout.write(
    JSON.stringify(
      {
        scope:
          "warm in-process prototype including guard diagnostics, excludes disk load, compile, CLI startup, model/protocol; two warmups, nine alternating pairs on first locked query per repo",
        sourceSha256: hash(source),
        policyHashes,
        bundles: { current: base.sha256, proposal: proposal.sha256 },
        rows,
      },
      null,
      2,
    ) + "\n",
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 2;
}
