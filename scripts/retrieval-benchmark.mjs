#!/usr/bin/env node

/**
 * Retrieval baseline against the local source-index cache.
 *
 * Compares compact `indexing --search` with the older find-* commands on
 * scripts/retrieval-golden.json (exact / ambiguous / fuzzy / task / multi).
 * Prints Recall@5, MRR, Top-1, payload bytes/tokens, and paired latency
 * p50/p95 for unified AND old finders, split by kind and shape.
 *
 * The fixture test in src/__tests__/retrieval-benchmark.test.ts is the CI
 * smoke gate. This script is the this-repo measurement used before
 * designing mp_sentinel_task_context.
 *
 * Usage:
 *   npm run retrieval:bench
 *   node scripts/retrieval-benchmark.mjs
 *
 * Exit: 0 = ran, 2 = missing dist/index, source-index, or golden file,
 * or a query failed.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { checkCorpus, GOLDEN_CORPORA } from "./lib/golden-lock.mjs";

const ROOT = process.cwd();
const CLI = resolve(ROOT, "dist/index.js");
const CACHE = resolve(ROOT, ".mp-sentinel-cache/source-index.json");
const GOLDEN_PATH = join(dirname(fileURLToPath(import.meta.url)), "retrieval-golden.json");
const K = 5;
const LATENCY_RUNS = 9;
const TASK_RECALL_MIN = 0.6;
const TASK_MRR_MIN = 0.4;
const EXACT_RECALL_MIN = 0.99;
const TASK_TOKEN_BUDGET = 800;

/**
 * Verify the corpus lock so a measurement can be traced to a corpus version.
 * A changed corpus without a version bump is a setup error, not a gate miss.
 */
function requireCorpusLock(id) {
  const corpus = GOLDEN_CORPORA.find((c) => c.id === id);
  if (!corpus) {
    process.stderr.write(`FAIL  unknown golden corpus ${id}\n`);
    process.exit(2);
  }
  const result = checkCorpus(corpus);
  if (result.fatal) {
    process.stderr.write(`FAIL  ${result.reason}\n`);
    process.exit(2);
  }
  if (!result.ok) {
    process.stderr.write(
      `FAIL  ${id} golden corpus ${result.reason}. ` +
        "Run `npm run golden:lock -- --write` to accept it and bump the version.\n",
    );
    process.exit(2);
  }
  return { version: result.lock.version, rows: result.actual.rows, sha256: result.actual.sha256 };
}

function loadGolden() {
  if (!existsSync(GOLDEN_PATH)) {
    process.stderr.write(`FAIL  missing ${GOLDEN_PATH}\n`);
    process.exit(2);
  }
  try {
    const parsed = JSON.parse(readFileSync(GOLDEN_PATH, "utf-8"));
    if (!Array.isArray(parsed) || parsed.length === 0) {
      process.stderr.write("FAIL  retrieval-golden.json must be a non-empty array\n");
      process.exit(2);
    }
    return parsed;
  } catch (err) {
    process.stderr.write(`FAIL  cannot parse retrieval-golden.json: ${err.message}\n`);
    process.exit(2);
  }
}

function uniqueRanked(files) {
  const seen = new Set();
  const out = [];
  for (const file of files) {
    if (!file || seen.has(file)) continue;
    seen.add(file);
    out.push(file);
  }
  return out;
}

function recallAtK(ranked, relevant, k) {
  if (!relevant.length) return 0;
  const top = new Set(uniqueRanked(ranked).slice(0, k));
  let hit = 0;
  for (const file of relevant) if (top.has(file)) hit += 1;
  return hit / relevant.length;
}

function mrr(ranked, relevant) {
  if (!relevant.length) return 0;
  const want = new Set(relevant);
  const files = uniqueRanked(ranked);
  for (let i = 0; i < files.length; i++) {
    if (want.has(files[i])) return 1 / (i + 1);
  }
  return 0;
}

function top1(ranked, relevant) {
  if (!relevant.length) return false;
  const first = uniqueRanked(ranked)[0];
  return Boolean(first && relevant.includes(first));
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[idx];
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

function latencyStats(samples) {
  return {
    p50: percentile(samples, 0.5),
    p95: percentile(samples, 0.95),
    samples: samples.length,
  };
}

function runJson(args) {
  let stdout;
  try {
    stdout = execFileSync(
      process.execPath,
      [CLI, "indexing", ...args, "--index-format", "json", "--compact"],
      {
        cwd: ROOT,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch (err) {
    const detail = err.stderr || err.message;
    process.stderr.write(`FAIL  indexing ${args.join(" ")}: ${detail}\n`);
    process.exit(2);
  }
  try {
    return JSON.parse(stdout);
  } catch {
    process.stderr.write(`FAIL  indexing ${args.join(" ")}: output is not valid JSON\n`);
    process.exit(2);
  }
}

function filesFromSearch(payload) {
  const hits = payload.files || payload.hits || payload.results || [];
  return hits.map((h) => h.file).filter(Boolean);
}

function oldFinderCalls(kind, query) {
  const limit = ["--limit", String(K)];
  switch (kind) {
    case "symbol":
      return [["--find-symbol", query, ...limit]];
    case "path":
      return [["--find-file", query, ...limit]];
    case "import":
      return [["--find-import", query, ...limit]];
    case "code":
      return [["--find-code", query, ...limit]];
    case "fuzzy":
    case "task":
      return [
        ["--find-symbol", query, ...limit],
        ["--find-file", query, ...limit],
        ["--find-import", query, ...limit],
      ];
    default:
      return [["--find-symbol", query, ...limit]];
  }
}

function unifiedArgs(kind, query) {
  const limit = ["--limit", String(K)];
  if (kind === "path") return ["--search", query, "--kind", "file", ...limit];
  if (kind === "fuzzy") return ["--search", query, ...limit];
  if (kind === "task") return ["--task-context", query, ...limit];
  if (kind === "code") return ["--search", query, "--kind", "code", ...limit];
  return ["--search", query, "--kind", kind, ...limit];
}

function timeCalls(argLists) {
  const start = performance.now();
  const payloads = argLists.map((args) => runJson(args));
  return { payloads, ms: performance.now() - start };
}

function pairedLatency(unifiedArgLists, oldArgLists, runs) {
  timeCalls(unifiedArgLists);
  timeCalls(oldArgLists);
  const unified = [];
  const old = [];
  for (let i = 0; i < runs; i++) {
    if (i % 2 === 0) {
      unified.push(timeCalls(unifiedArgLists).ms);
      old.push(timeCalls(oldArgLists).ms);
    } else {
      old.push(timeCalls(oldArgLists).ms);
      unified.push(timeCalls(unifiedArgLists).ms);
    }
  }
  return { unified: latencyStats(unified), old: latencyStats(old) };
}

function assertLabels(core, queries) {
  const indexed = new Set((core.files || []).map((f) => f.path));
  for (const item of queries) {
    if (!Array.isArray(item.relevant) || item.relevant.length === 0) {
      process.stderr.write(
        `FAIL  empty relevant set for ${item.kind} ${JSON.stringify(item.query)} -- pin labels in retrieval-golden.json\n`,
      );
      process.exit(2);
    }
    for (const file of item.relevant) {
      if (!indexed.has(file)) {
        process.stderr.write(
          `FAIL  relevant path not in index: ${file} (${item.kind} ${JSON.stringify(item.query)})\n`,
        );
        process.exit(2);
      }
    }
  }
}

function groupAverage(rows, keys) {
  const out = { queries: rows.length };
  for (const key of keys) {
    out[key] = average(rows.map((r) => r[key]));
  }
  return out;
}

const RANK_KEYS = [
  "unifiedRecall5",
  "oldRecall5",
  "unifiedMrr",
  "oldMrr",
  "unifiedBytes",
  "oldBytes",
];

function summarize(rows, groupKey) {
  const groups = [...new Set(rows.map((r) => r[groupKey]))];
  const out = {};
  for (const group of groups) {
    const subset = rows.filter((r) => r[groupKey] === group);
    out[group] = groupAverage(subset, RANK_KEYS);
  }
  return out;
}

function representativeByKind(queries) {
  const seen = new Set();
  const out = [];
  for (const item of queries) {
    if (seen.has(item.kind)) continue;
    seen.add(item.kind);
    out.push(item);
  }
  return out;
}

function main() {
  if (!existsSync(CLI)) {
    process.stderr.write("FAIL  dist/index.js missing -- run npm run build\n");
    process.exit(2);
  }
  if (!existsSync(CACHE)) {
    process.stderr.write("FAIL  source index missing -- run npm run sentinel:index\n");
    process.exit(2);
  }

  let core;
  try {
    core = JSON.parse(readFileSync(CACHE, "utf-8"));
  } catch (err) {
    process.stderr.write(`FAIL  cannot read source index: ${err.message}\n`);
    process.exit(2);
  }

  const corpus = requireCorpusLock("retrieval");
  const queries = loadGolden();
  assertLabels(core, queries);

  const first = queries[0];
  if (first) {
    timeCalls([unifiedArgs(first.kind, first.query)]);
    timeCalls(oldFinderCalls(first.kind, first.query));
  }

  const rows = [];
  for (let i = 0; i < queries.length; i++) {
    const item = queries[i];
    const unifiedArgLists = [unifiedArgs(item.kind, item.query)];
    const oldArgLists = oldFinderCalls(item.kind, item.query);
    let unifiedPayloads;
    let oldPayloads;
    if (i % 2 === 0) {
      unifiedPayloads = timeCalls(unifiedArgLists).payloads;
      oldPayloads = timeCalls(oldArgLists).payloads;
    } else {
      oldPayloads = timeCalls(oldArgLists).payloads;
      unifiedPayloads = timeCalls(unifiedArgLists).payloads;
    }

    const unifiedFiles = filesFromSearch(unifiedPayloads[0]);
    const oldFiles = uniqueRanked(oldPayloads.flatMap(filesFromSearch));
    const unifiedBytes = Buffer.byteLength(JSON.stringify(unifiedPayloads[0]), "utf-8");
    const oldBytes = oldPayloads.reduce(
      (sum, payload) => sum + Buffer.byteLength(JSON.stringify(payload), "utf-8"),
      0,
    );

    rows.push({
      kind: item.kind,
      shape: item.shape || "exact",
      query: item.query,
      relevant: item.relevant.length,
      unifiedRecall5: recallAtK(unifiedFiles, item.relevant, K),
      oldRecall5: recallAtK(oldFiles, item.relevant, K),
      unifiedMrr: mrr(unifiedFiles, item.relevant),
      oldMrr: mrr(oldFiles, item.relevant),
      unifiedTop1: top1(unifiedFiles, item.relevant),
      oldTop1: top1(oldFiles, item.relevant),
      unifiedBytes,
      oldBytes,
      unifiedTokens: Math.ceil(unifiedBytes / 4),
      oldTokens: Math.ceil(oldBytes / 4),
      ...(item.kind === "task"
        ? { capsuleUsedTokens: unifiedPayloads[0]?.usedTokens ?? null }
        : {}),
    });
  }

  const latencyByKind = {};
  for (const item of representativeByKind(queries)) {
    latencyByKind[item.kind] = pairedLatency(
      [unifiedArgs(item.kind, item.query)],
      oldFinderCalls(item.kind, item.query),
      LATENCY_RUNS,
    );
  }

  const byKind = summarize(rows, "kind");
  for (const kind of Object.keys(byKind)) {
    if (latencyByKind[kind]) {
      byKind[kind].latencyMs = latencyByKind[kind];
    }
  }

  const byShape = summarize(rows, "shape");
  const report = {
    corpus,
    k: K,
    queryCount: rows.length,
    queries: rows,
    byKind,
    byShape,
    latencyMs: {
      runsPerKind: LATENCY_RUNS,
      paired: true,
      byKind: latencyByKind,
    },
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  enforceGates(rows, byKind, byShape);
}

function enforceGates(rows, byKind, byShape) {
  const failures = [];
  const task = byShape.task || byKind.task;
  if (!task) {
    failures.push("missing task-shaped queries");
  } else {
    if (task.unifiedRecall5 < TASK_RECALL_MIN) {
      failures.push(`task Recall@5 ${task.unifiedRecall5} < ${TASK_RECALL_MIN}`);
    }
    if (task.unifiedMrr < TASK_MRR_MIN) {
      failures.push(`task MRR ${task.unifiedMrr} < ${TASK_MRR_MIN}`);
    }
  }

  const exact = byShape.exact;
  if (!exact) {
    failures.push("missing exact-shaped queries");
  } else {
    if (exact.unifiedRecall5 < EXACT_RECALL_MIN) {
      failures.push(`exact Recall@5 ${exact.unifiedRecall5} < ${EXACT_RECALL_MIN}`);
    }
    if (exact.unifiedMrr + 1e-9 < exact.oldMrr) {
      failures.push(`exact MRR ${exact.unifiedMrr} regressed vs old ${exact.oldMrr}`);
    }
  }

  // "multi" rows have more correct answers than K on purpose (e.g. `zod` has
  // 7 real importers), so Recall@5 is capped below 1 by construction. They are
  // scored for no-regression against the old finders, never an absolute floor.
  const multi = byShape.multi;
  if (multi) {
    if (multi.unifiedRecall5 + 1e-9 < multi.oldRecall5) {
      failures.push(`multi Recall@5 ${multi.unifiedRecall5} regressed vs old ${multi.oldRecall5}`);
    }
    if (multi.unifiedMrr + 1e-9 < multi.oldMrr) {
      failures.push(`multi MRR ${multi.unifiedMrr} regressed vs old ${multi.oldMrr}`);
    }
  }

  const exactRows = rows.filter((r) => r.shape === "exact");
  const unifiedTop1 = average(exactRows.map((r) => (r.unifiedTop1 ? 1 : 0)));
  const oldTop1 = average(exactRows.map((r) => (r.oldTop1 ? 1 : 0)));
  if (unifiedTop1 + 1e-9 < oldTop1) {
    failures.push(`exact Top-1 ${unifiedTop1} regressed vs old ${oldTop1}`);
  }

  for (const row of rows.filter((r) => r.kind === "task")) {
    const used = row.capsuleUsedTokens;
    if (typeof used !== "number" || used > TASK_TOKEN_BUDGET) {
      failures.push(`task ${JSON.stringify(row.query)} usedTokens ${used} > ${TASK_TOKEN_BUDGET}`);
    }
  }

  if (failures.length === 0) return;
  process.stderr.write(`FAIL  retrieval gates:\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}

main();
