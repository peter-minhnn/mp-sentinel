/** Fixed-budget experiment. Labels score results; they never choose files or focus. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { get_encoding } from "tiktoken";
import {
  answersAnchor,
  capsuleHasLabel,
  evidenceStrings,
  indexEvidence,
} from "../agent-chain-benchmark.mjs";
import { classifyMissingFile, hasRankingData } from "./chain-metrics.mjs";

export const ALLOCATIONS = [
  { id: "baseline", files: 3, agentBudget: 1200 },
  { id: "A", files: 4, agentBudget: 900 },
  { id: "B", files: 5, agentBudget: 720 },
  { id: "C", files: 6, agentBudget: 600 },
  { id: "D", files: 10, agentBudget: 360 },
];
export const TASK_BUDGET = 800;
export const CHAIN_BUDGET = 4400;
const encoder = get_encoding("cl100k_base");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function gateFailure(message) {
  const error = new Error(message);
  error.exitCode = 1;
  return error;
}

export function fingerprint(root) {
  const status = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
  return {
    revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    dirty: status.length > 0,
    coreSha256: hash(readFileSync(join(root, ".mp-sentinel-cache/source-index.json"))),
  };
}

export function validateRows(rows, records) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("empty corpus");
  const queries = new Set();
  for (const row of rows) {
    if (typeof row.query !== "string" || !row.query.trim() || queries.has(row.query))
      throw new Error("invalid/duplicate query");
    queries.add(row.query);
    if (row.validation && row.heldOut) throw new Error("overlapping slices");
    if (
      !Array.isArray(row.relevant) ||
      !row.relevant.length ||
      new Set(row.relevant).size !== row.relevant.length
    )
      throw new Error("invalid relevant set");
    if (row.relevant.some((path) => !records.has(path)))
      throw new Error(`missing relevant file: ${row.query}`);
    if (!Array.isArray(row.evidence) || !row.evidence.length)
      throw new Error("empty evidence labels");
    const seen = new Set();
    for (const label of row.evidence) {
      const key = JSON.stringify([label.file, label.kind, label.name]);
      const record = records.get(label.file);
      if (
        seen.has(key) ||
        !row.relevant.includes(label.file) ||
        !record ||
        !["symbol", "import"].includes(label.kind) ||
        !capsuleHasLabel({ file: record }, label)
      ) {
        throw new Error(`invalid evidence ${key} for ${row.query}`);
      }
      seen.add(key);
    }
  }
}

export function createQuery(cli, root) {
  return (args) => {
    const start = performance.now();
    const stdout = execFileSync(
      process.execPath,
      [cli, "indexing", ...args, "--index-format", "json", "--compact"],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 60000,
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    return {
      payload: JSON.parse(stdout),
      raw: stdout.trim(),
      latencyMs: performance.now() - start,
    };
  };
}

function bounded(query, args, budget) {
  const result = query(args);
  const emitted = encoder.encode(result.raw).length;
  if (result.payload.usedTokens !== emitted || emitted > budget)
    throw gateFailure(`budget/accounting violation: ${emitted}/${budget}`);
  return { ...result, emitted };
}

export function measureRow(row, config, records, query) {
  const task = bounded(
    query,
    [
      "--task-context",
      row.query,
      "--limit",
      String(config.files),
      "--token-budget",
      String(TASK_BUDGET),
    ],
    TASK_BUDGET,
  );
  const opened = (task.payload.files ?? []).slice(0, config.files);
  if (!opened.length) throw gateFailure(`no files: ${row.query}`);
  const ranking = query(["--task-context", row.query, "--explain-ranking"]).payload;
  const result = {
    query: row.query,
    slice: row.validation ? "validation" : row.heldOut ? "held-out" : "tuning",
    opened: opened.map((f) => f.file),
    calls: 1 + opened.length,
    diagnosticCalls: 1,
    taskTokens: task.emitted,
    evidenceTotal: row.evidence.length,
    arms: {},
    coverageBeforePacking: row.evidence.filter((label) =>
      (ranking.candidates ?? []).some((c) => c.file === label.file && c.rank <= config.files),
    ).length,
    rankingComplete: hasRankingData(ranking) && !ranking.truncated,
  };
  for (const arm of ["anchored", "plain"]) {
    result.arms[arm] = measureArm({ row, config, records, query, task, opened, ranking, arm });
  }
  return result;
}

function measureArm({ row, config, records, query, task, opened, ranking, arm }) {
  const result = {
    tokens: task.emitted,
    latencyMs: task.latencyMs,
    kept: 0,
    packingLost: 0,
    rankingLost: 0,
    answerableAnchors: 0,
    anchorsKept: 0,
    missing: [],
  };
  const capsules = new Map();
  for (const entry of opened) {
    const focus = (entry.anchors?.length ? entry.anchors : (task.payload.anchors ?? [])).slice(
      0,
      6,
    );
    const args = ["--agent-context", entry.file, "--token-budget", String(config.agentBudget)];
    if (arm === "anchored") args.push(...focus.flatMap((anchor) => ["--focus", anchor]));
    const capsule = bounded(query, args, config.agentBudget);
    capsules.set(entry.file, capsule.payload);
    result.tokens += capsule.emitted;
    result.latencyMs += capsule.latencyMs;
    const known = indexEvidence(records.get(entry.file) ?? {});
    const answerable = focus.filter((anchor) => answersAnchor(known, anchor));
    result.answerableAnchors += answerable.length;
    result.anchorsKept += answerable.filter((anchor) =>
      answersAnchor(evidenceStrings(capsule.payload), anchor),
    ).length;
  }
  for (const label of row.evidence) {
    const capsule = capsules.get(label.file);
    if (!capsule) {
      result.rankingLost++;
      const rank = (ranking.candidates ?? []).find((c) => c.file === label.file)?.rank ?? 0;
      result.missing.push({
        ...label,
        rank: rank || null,
        cause: classifyMissingFile({
          rank,
          truncated: ranking.truncated,
          hasRanking: hasRankingData(ranking),
          openFiles: config.files,
        }),
      });
    } else if (capsuleHasLabel(capsule, label)) result.kept++;
    else result.packingLost++;
  }
  if (result.tokens > CHAIN_BUDGET) throw gateFailure(`chain budget violation: ${result.tokens}`);
  return result;
}

export function summarize(rows) {
  const total = rows.reduce((sum, row) => sum + row.evidenceTotal, 0);
  const result = { rows: rows.length, labels: total, arms: {} };
  for (const arm of ["anchored", "plain"]) {
    const sum = (key) => rows.reduce((n, row) => n + row.arms[arm][key], 0);
    const latencies = rows.map((row) => row.arms[arm].latencyMs).sort((a, b) => a - b);
    result.arms[arm] = {
      retention: total ? sum("kept") / total : null,
      kept: sum("kept"),
      packingLost: sum("packingLost"),
      rankingLost: sum("rankingLost"),
      anchors: { kept: sum("anchorsKept"), answerable: sum("answerableAnchors") },
      tokensPerTask: rows.length ? sum("tokens") / rows.length : null,
      callsPerTask: rows.length ? rows.reduce((n, row) => n + row.calls, 0) / rows.length : null,
      latencyMs: {
        p50: latencies[Math.ceil(latencies.length * 0.5) - 1] ?? null,
        p95: latencies[Math.ceil(latencies.length * 0.95) - 1] ?? null,
        samples: latencies.length,
      },
    };
  }
  return result;
}

/** Selection uses tuning labels only, with per-query non-regression. */
export function selectAllocation(runs) {
  const baseline = runs.find((run) => run.config.id === "baseline");
  if (!baseline || !baseline.rows.length) throw new Error("missing tuning baseline");
  const kept = (run) => run.rows.reduce((sum, row) => sum + row.arms.anchored.kept, 0);
  const candidates = runs.filter(
    (run) =>
      run.rows.length === baseline.rows.length &&
      run.rows.every((row) => {
        const prior = baseline.rows.find((b) => b.query === row.query);
        return (
          prior &&
          row.evidenceTotal === prior.evidenceTotal &&
          row.arms.anchored.kept >= prior.arms.anchored.kept
        );
      }) &&
      kept(run) > kept(baseline),
  );
  candidates.sort(
    (a, b) =>
      kept(b) - kept(a) ||
      a.rows.reduce((n, r) => n + r.calls, 0) - b.rows.reduce((n, r) => n + r.calls, 0) ||
      a.rows.reduce((n, r) => n + r.arms.anchored.tokens, 0) -
        b.rows.reduce((n, r) => n + r.arms.anchored.tokens, 0),
  );
  return candidates[0]?.config.id ?? "baseline";
}

export { hash };
