#!/usr/bin/env node
/** Same-index file-selection ablation. JSON on stdout; no index/source writes. */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { checkCorpus } from "./lib/golden-lock.mjs";
import { ANCHOR_EXPERIMENTS } from "./lib/anchor-experiment.mjs";
import { compileFusion } from "./lib/compile-fusion.mjs";
import { validateRows, createQuery, summarize } from "./lib/allocation-bench.mjs";
import { get_encoding } from "tiktoken";
import { preserveSeeds } from "./lib/seed-preserve.mjs";
import { preserveCoherentSeeds } from "./lib/coherent-seed.mjs";
import { measureSelectedChain } from "./lib/selected-chain.mjs";
import { guardAnchorCoverage } from "./lib/anchor-coverage-guard.mjs";
import { coverageDecision } from "./lib/coverage-decision.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const root = process.cwd();
const sourcePath = resolve(root, "src/services/source-index/task-context.ts");
const encoder = get_encoding("cl100k_base");

async function compile(variant, source, directory) {
  return compileFusion({ variant, source, sourcePath, directory });
}

async function measureRow(compiled, index, row, context) {
  const { prior, coherent, chainQuery, guarded } = context;
  const ranking = await compiled.module.rankTaskCandidates(index, row.query);
  const trace = await compiled.module.traceFusion(index, row.query);
  if (
    JSON.stringify(trace.map((item) => item.file)) !==
    JSON.stringify(ranking.records.map((item) => item.file))
  ) {
    throw new Error("diagnostic trace changed ranking");
  }
  const recordsByPath = new Map(index.files.map((file) => [file.path, file]));
  let policy = prior
    ? coherent
      ? preserveCoherentSeeds(
          prior.records,
          ranking.records,
          prior.trace,
          recordsByPath,
          prior.anchors,
        )
      : preserveSeeds(prior.records, ranking.records, prior.trace)
    : undefined;
  let capsule = policy
    ? await compiled.module.packExperimentCapsule(policy.records, {
        maxFiles: 3,
        tokenBudget: 800,
        anchors: ranking.anchors,
        warnings: ranking.warnings,
      })
    : await compiled.module.buildTaskContext(index, row.query, {
        maxFiles: 3,
        tokenBudget: 800,
      });
  const coverage = guarded
    ? guardAnchorCoverage({
        baseline: prior.capsule,
        proposal: capsule,
        trace: prior.trace,
        anchors: prior.anchors,
      })
    : undefined;
  if (coverage) {
    capsule = coverage.capsule;
    if (coverage.diagnostic.fallback) policy = { ...policy, records: prior.records };
  }
  if (
    capsule.usedTokens > 800 ||
    capsule.files.length > 3 ||
    encoder.encode(JSON.stringify(capsule)).length !== capsule.usedTokens
  ) {
    throw new Error("experimental capsule violates budget or token accounting");
  }
  return rowResult({
    row,
    ranking,
    trace,
    policy,
    capsule,
    compiled,
    recordsByPath,
    chainQuery,
    index,
    coverage: coverage?.diagnostic,
    selectionAnchors: coverage?.diagnostic.fallback ? prior.anchors : ranking.anchors,
  });
}

function rowResult({
  row,
  ranking,
  trace,
  policy,
  capsule,
  compiled,
  recordsByPath,
  chainQuery,
  index,
  coverage,
  selectionAnchors,
}) {
  const opened = new Set(capsule.files.map((file) => file.file));
  const selectedRecords = policy?.records ?? ranking.records;
  const ranks = new Map(selectedRecords.map((file) => [file.file, file.rank]));
  return {
    query: row.query,
    anchors: selectionAnchors,
    capsule,
    ...(coverage ? { coverageGuard: coverage } : {}),
    opened: [...opened],
    labels: row.evidence.length,
    labelsInOpenedFiles: row.evidence.filter((label) => opened.has(label.file)).length,
    labelRanks: row.evidence.map((label) => ({ ...label, rank: ranks.get(label.file) ?? null })),
    candidateCount: selectedRecords.length,
    trace,
    records: selectedRecords,
    ...(chainQuery
      ? {
          chain: measureSelectedChain({
            row,
            capsule,
            candidates: selectedRecords,
            records: recordsByPath,
            query: chainQuery,
          }),
        }
      : {}),
    ...(policy?.partialEvidence ? { partialEvidence: policy.partialEvidence } : {}),
    ...(policy
      ? {
          fusionCandidateCount: ranking.records.length,
          protectedFiles: policy.protectedFiles,
          protectedDropped: policy.protectedFiles.filter((file) => !opened.has(file)),
        }
      : {}),
    capsuleUsedTokens: capsule.usedTokens,
    ...(compiled.module.experimentAnchorStats
      ? {
          anchorStats: selectionAnchors.map((anchor) =>
            compiled.module.experimentAnchorStats(index, anchor),
          ),
        }
      : {}),
  };
}

async function measure(compiled, index, rows, context = {}) {
  const measured = [];
  for (const row of rows) {
    measured.push(
      await measureRow(compiled, index, row, {
        ...context,
        prior: context.baseline?.find((item) => item.query === row.query),
      }),
    );
  }
  return {
    sha256: compiled.sha256,
    rows: measured,
    labels: measured.reduce((n, row) => n + row.labels, 0),
    labelsInOpenedFiles: measured.reduce((n, row) => n + row.labelsInOpenedFiles, 0),
    ...(context.chainQuery ? { chainSummary: summarize(measured.map((row) => row.chain)) } : {}),
  };
}

try {
  const [repoArg, corpusArg, experiment, chainFlag] = process.argv.slice(2);
  if (chainFlag && chainFlag !== "--chain") throw new Error("unknown chain argument");
  if (
    experiment &&
    !["--specificity", "--seed-preserve", "--identifier-evidence", "--coverage-guard"].includes(
      experiment,
    )
  )
    throw new Error("unknown experiment argument");
  if (!repoArg || !corpusArg) throw new Error("usage: fusion-ablation.mjs REPO CORPUS.json");
  const repo = resolve(repoArg);
  const corpusPath = resolve(corpusArg);
  const checked = checkCorpus({
    id: "ablation",
    goldenPath: corpusPath,
    lockPath: corpusPath.replace(/\.json$/, ".lock.json"),
  });
  if (!checked.ok) throw new Error(checked.reason);
  const rows = JSON.parse(readFileSync(corpusPath, "utf8"));
  const indexPath = join(repo, ".mp-sentinel-cache/source-index.json");
  const bytes = readFileSync(indexPath);
  const index = JSON.parse(bytes);
  validateRows(rows, new Map(index.files.map((file) => [file.path, file])));
  const source = readFileSync(sourcePath, "utf8");
  const policyFiles = [
    "scripts/fusion-ablation.mjs",
    "scripts/lib/fusion-ablation.mjs",
    "scripts/lib/fusion-trace.mjs",
    "scripts/lib/anchor-experiment.mjs",
    "scripts/lib/seed-preserve.mjs",
    "scripts/lib/identifier-evidence.mjs",
    "scripts/lib/coherent-seed.mjs",
    "scripts/lib/selected-chain.mjs",
    "scripts/lib/allocation-bench.mjs",
    "scripts/agent-chain-benchmark.mjs",
    "scripts/lib/chain-metrics.mjs",
    "scripts/lib/anchor-coverage-guard.mjs",
    "scripts/lib/coverage-decision.mjs",
    "scripts/lib/compile-fusion.mjs",
  ];
  const policyHashes = Object.fromEntries(
    policyFiles.map((path) => [path, hash(readFileSync(resolve(root, path)))]),
  );
  const base = resolve(root, ".mp-sentinel-cache/benchmarks/fusion-bundles");
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(join(base, "run-"));
  const variants = {};
  const chainQuery = chainFlag ? createQuery(resolve(root, "dist/index.js"), repo) : undefined;
  for (const variant of experiment
    ? ["--seed-preserve", "--identifier-evidence", "--coverage-guard"].includes(experiment)
      ? ["current", "anchor-select"]
      : ANCHOR_EXPERIMENTS
    : ["legacy-votes", "distinct-capped", "current"]) {
    variants[variant] = await measure(
      await compile(variant, source, directory),
      index,
      rows,
      variant === "current" && chainQuery ? { chainQuery } : {},
    );
  }
  if (["--seed-preserve", "--identifier-evidence", "--coverage-guard"].includes(experiment)) {
    variants["seed-preserve"] = await measure(
      await compile("anchor-select", source, directory),
      index,
      rows,
      { baseline: variants.current.rows },
    );
  }
  if (["--identifier-evidence", "--coverage-guard"].includes(experiment)) {
    variants["coherent-seed"] = await measure(
      await compile("anchor-select", source, directory),
      index,
      rows,
      {
        baseline: variants.current.rows,
        coherent: true,
        ...(chainQuery && experiment === "--identifier-evidence" ? { chainQuery } : {}),
      },
    );
  }
  if (experiment === "--coverage-guard") {
    variants["coverage-guard"] = await measure(
      await compile("anchor-select", source, directory),
      index,
      rows,
      {
        baseline: variants.current.rows,
        coherent: true,
        guarded: true,
        ...(chainQuery ? { chainQuery } : {}),
      },
    );
  }
  if (hash(readFileSync(indexPath)) !== hash(bytes))
    throw new Error("index changed during ablation");
  if (readFileSync(sourcePath, "utf8") !== source)
    throw new Error("source changed during ablation");
  for (const [path, expected] of Object.entries(policyHashes)) {
    if (hash(readFileSync(resolve(root, path))) !== expected)
      throw new Error("benchmark policy changed during ablation");
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        corpus: checked.lock,
        indexSha256: hash(bytes),
        sourceSha256: hash(source),
        policyHashes,
        ...(variants["coverage-guard"]
          ? { decision: coverageDecision(variants.current.rows, variants["coverage-guard"].rows) }
          : {}),
        ...(chainFlag
          ? {
              chainScope:
                "real CLI agent-context calls, task capsule injected from isolated selection; no latency comparison",
            }
          : {}),
        scope:
          "file selection only, not per-file evidence packing; structured search without code fallback",
        variants,
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 2;
}
