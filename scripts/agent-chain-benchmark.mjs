#!/usr/bin/env node

/**
 * End-to-end chain measurement: task_context -> agent_context.
 *
 * The per-tool budgets are already gated (retrieval:bench, agentctx:bench).
 * What was never measured is the chain an agent actually walks: one
 * `--task-context` call to pick files, then one `--agent-context` call per
 * opened file.
 *
 * Two arms open the same files:
 *   anchored - `--focus` = the anchors task_context produced for that file
 *   plain    - no `--focus`
 *
 * Two things are scored:
 *   1. Anchor retention -- does the capsule still answer the anchors the
 *      task capsule produced? Anchors are query tokens, so this is matched
 *      the way the packer ranks (exact, then case-insensitive substring).
 *      It says nothing about *which* symbol survived.
 *   2. Evidence retention -- named labels from scripts/chain-golden.json
 *      (`symbol` / `import` with an exact name, per file). Loss splits into
 *      ranking loss (the file was never opened) and packing loss (the file
 *      was opened but the item is not in the capsule), which is the only way
 *      to tell those two failures apart.
 *
 * Gates live in scripts/lib/chain-metrics.mjs (pure, regression-tested).
 *
 * Usage:
 *   npm run chain:bench
 *
 * Exit: 0 = gates pass, 1 = gate miss or an unmeasurable run, 2 = missing
 * dist/index/corpus or a failed query.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCorpus, GOLDEN_CORPORA } from "./lib/golden-lock.mjs";
import {
  CHAIN_DEFAULTS,
  classifyMissingFile,
  hasRankingData,
  sliceSummary,
  summarizeChain,
} from "./lib/chain-metrics.mjs";

const ROOT = process.cwd();
const CLI = resolve(ROOT, "dist/index.js");
const CACHE = resolve(ROOT, ".mp-sentinel-cache/source-index.json");
const GOLDEN_PATH = resolve(ROOT, "scripts/chain-golden.json");

const {
  taskBudget: TASK_BUDGET,
  agentBudget: AGENT_BUDGET,
  openFiles: OPEN_FILES,
} = CHAIN_DEFAULTS;
const MAX_FOCUS = 6;
const EVIDENCE_KINDS = new Set(["symbol", "import"]);

const { get_encoding } = await import("tiktoken");
const encoder = get_encoding("cl100k_base");
const tokens = (text) => encoder.encode(text).length;

function die(message) {
  process.stderr.write(`FAIL  ${message}\n`);
  process.exit(2);
}

function requireCorpusLock(id) {
  const corpus = GOLDEN_CORPORA.find((c) => c.id === id);
  if (!corpus) die(`unknown golden corpus ${id}`);
  const result = checkCorpus(corpus);
  if (result.fatal) die(result.reason);
  if (!result.ok) {
    die(
      `${id} golden corpus ${result.reason}. ` +
        "Run `npm run golden:lock -- --write` to accept it and bump the version.",
    );
  }
  return { version: result.lock.version, rows: result.actual.rows, sha256: result.actual.sha256 };
}

function runJson(args) {
  let stdout;
  try {
    stdout = execFileSync(
      process.execPath,
      [CLI, "indexing", ...args, "--index-format", "json", "--compact"],
      { cwd: ROOT, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (err) {
    die(`indexing ${args.join(" ")}: ${err.stderr || err.message}`);
  }
  try {
    return { payload: JSON.parse(stdout), raw: stdout.trim() };
  } catch {
    die(`indexing ${args.join(" ")}: output is not valid JSON`);
  }
}

/** Every string the emitted capsule offers as evidence. */
export function evidenceStrings(payload) {
  const out = new Set();
  const file = payload.file || {};
  for (const s of file.symbols || []) {
    out.add(s.name);
    if (s.parent) out.add(s.parent);
  }
  for (const i of file.imports || []) {
    out.add(i.source);
    for (const n of i.names || []) out.add(n);
  }
  for (const e of file.exports || []) {
    if (e.source) out.add(e.source);
    for (const n of e.names || []) out.add(n);
  }
  for (const c of file.calls || []) {
    out.add(c.callee);
    if (c.inSymbol) out.add(c.inSymbol);
  }
  for (const c of payload.incomingCalls || []) {
    out.add(c.fromFile);
    out.add(c.callee);
    if (c.inSymbol) out.add(c.inSymbol);
  }
  for (const p of payload.directImports || []) out.add(p);
  for (const p of payload.directDependents || []) out.add(p);
  for (const h of payload.hubFiles || []) out.add(h.path);
  return out;
}

/** Uncapped evidence from the index core -- the denominator for anchors. */
export function indexEvidence(record) {
  const out = new Set();
  for (const s of record.symbols || []) {
    out.add(s.name);
    if (s.parent) out.add(s.parent);
  }
  for (const i of record.imports || []) {
    out.add(i.source);
    for (const n of i.names || []) out.add(n);
  }
  for (const e of record.exports || []) {
    if (e.source) out.add(e.source);
    for (const n of e.names || []) out.add(n);
  }
  for (const p of record.importsFrom || []) out.add(p);
  for (const p of record.importedBy || []) out.add(p);
  return out;
}

/**
 * Does this evidence set answer the anchor? Same matching the packer ranks
 * with: exact first, then case-insensitive substring. Task anchors are query
 * tokens ("hydrate", "sidecar"), so exact-only would measure almost nothing --
 * and a substring hit proves a related string survived, not the right symbol.
 * That is what the named evidence labels are for.
 */
export function answersAnchor(evidence, anchor) {
  if (evidence.has(anchor)) return true;
  const needle = anchor.toLowerCase();
  for (const value of evidence) {
    if (value.toLowerCase().includes(needle)) return true;
  }
  return false;
}

/** Exact presence of a named evidence label in an emitted capsule. */
export function capsuleHasLabel(payload, label) {
  const file = payload.file || {};
  if (label.kind === "symbol") {
    return (file.symbols || []).some((s) => s.name === label.name);
  }
  return (file.imports || []).some((i) => i.source === label.name);
}

function loadIndexRecords() {
  let core;
  try {
    core = JSON.parse(readFileSync(CACHE, "utf-8"));
  } catch (err) {
    die(`cannot parse the source index: ${err.message}`);
  }
  return new Map((core.files || []).map((f) => [f.path, f]));
}

/** Labels must name real index entries, or the measurement is meaningless. */
function validateCorpus(rows, records) {
  const staleLines = [];
  for (const row of rows) {
    if (typeof row.query !== "string" || row.query.trim() === "") die("every row needs a query");
    if (!Array.isArray(row.relevant) || row.relevant.length === 0) {
      die(`row ${JSON.stringify(row.query)} needs relevant paths`);
    }
    if (!Array.isArray(row.evidence) || row.evidence.length === 0) {
      die(`row ${JSON.stringify(row.query)} needs evidence labels`);
    }
    if (row.validation && row.heldOut) {
      die(`row ${JSON.stringify(row.query)} cannot be both validation and held-out`);
    }
    for (const label of row.evidence) {
      if (!EVIDENCE_KINDS.has(label.kind)) {
        die(`row ${JSON.stringify(row.query)}: unsupported evidence kind ${label.kind}`);
      }
      const record = records.get(label.file);
      if (!record) die(`row ${JSON.stringify(row.query)}: ${label.file} is not in the index`);
      if (label.kind === "symbol") {
        const symbol = (record.symbols || []).find((s) => s.name === label.name);
        if (!symbol) {
          die(`row ${JSON.stringify(row.query)}: symbol ${label.name} not in ${label.file}`);
        }
        if (label.line !== undefined && symbol.line !== label.line) {
          staleLines.push(
            `${label.file}:${label.name} labeled ${label.line}, index ${symbol.line}`,
          );
        }
      } else if (!(record.imports || []).some((i) => i.source === label.name)) {
        die(`row ${JSON.stringify(row.query)}: import ${label.name} not in ${label.file}`);
      }
    }
  }
  return staleLines;
}

/**
 * Why a labeled file never reached packing.
 *
 * `--explain-ranking` returns the ranked candidate list *before* capping and
 * packing, so absence there is real absence rather than an artifact of a cut
 * list, and a file ranked inside the opened window that is still missing from
 * the capsule was dropped by the task capsule's own token budget. When the
 * listing is truncated, or there is no ranking data at all, the answer is
 * `unknown` -- never `not-candidate`.
 */
function classifyRankingLoss(query, missingFiles) {
  if (missingFiles.length === 0) return { causes: {}, ranks: {} };
  const explained = runJson(["--task-context", query, "--explain-ranking"]);
  const candidates = explained.payload.candidates || [];
  const truncated = Boolean(explained.payload.truncated);
  const causes = {};
  const ranks = {};
  for (const { file, labels } of missingFiles) {
    const hit = candidates.find((c) => c.file === file);
    const rank = hit ? hit.rank : 0;
    ranks[file] = rank || null;
    const cause = classifyMissingFile({
      rank,
      truncated,
      hasRanking: hasRankingData(explained.payload),
      openFiles: OPEN_FILES,
    });
    causes[cause] = (causes[cause] ?? 0) + labels;
  }
  return { causes, ranks };
}

function openFile(file, focus, failures, label) {
  const focusArgs = focus.flatMap((f) => ["--focus", f]);
  const { payload, raw } = runJson([
    "--agent-context",
    file,
    "--token-budget",
    String(AGENT_BUDGET),
    ...focusArgs,
  ]);
  const emitted = tokens(raw);
  if (emitted > AGENT_BUDGET) {
    failures.push(`${label} ${file}: emitted ${emitted} tokens > ${AGENT_BUDGET}`);
  }
  if (payload.usedTokens !== emitted) {
    failures.push(`${label} ${file}: usedTokens ${payload.usedTokens} != emitted ${emitted}`);
  }
  return { payload, emitted };
}

function main() {
  if (!existsSync(CLI)) die("dist/index.js missing -- run `npm run build` first");
  if (!existsSync(CACHE)) die("source index missing -- run `npm run sentinel:index` first");
  if (!existsSync(GOLDEN_PATH)) die(`missing ${GOLDEN_PATH}`);

  const corpus = requireCorpusLock("chain");
  let golden;
  try {
    golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf-8"));
  } catch (err) {
    die(`cannot parse chain-golden.json: ${err.message}`);
  }
  if (!Array.isArray(golden) || golden.length === 0)
    die("chain-golden.json must be a non-empty array");

  const records = loadIndexRecords();
  const staleLines = validateCorpus(golden, records);
  const failures = [];
  const rows = [];

  for (const row of golden) {
    const task = runJson(["--task-context", row.query, "--token-budget", String(TASK_BUDGET)]);
    const taskTokens = tokens(task.raw);
    if (taskTokens > TASK_BUDGET) {
      failures.push(`task ${JSON.stringify(row.query)}: capsule ${taskTokens} > ${TASK_BUDGET}`);
    }
    if (task.payload.usedTokens !== taskTokens) {
      failures.push(
        `task ${JSON.stringify(row.query)}: usedTokens ${task.payload.usedTokens} != emitted ${taskTokens}`,
      );
    }

    const capsuleAnchors = (task.payload.anchors || []).slice(0, MAX_FOCUS);
    const opened = (task.payload.files || []).slice(0, OPEN_FILES);
    const openedPaths = opened.map((f) => f.file);
    const relevantOpened = openedPaths.filter((f) => row.relevant.includes(f)).length;

    let anchoredTokens = taskTokens;
    let plainTokens = taskTokens;
    let answerableAnchors = 0;
    let anchoredKept = 0;
    let plainKept = 0;
    const anchoredCapsules = new Map();
    const plainCapsules = new Map();

    for (const entry of opened) {
      const file = entry.file;
      const record = records.get(file);
      const known = record ? indexEvidence(record) : new Set();
      // The anchors task_context attached to this file are what an agent would
      // carry over; only anchors the file can answer count in the denominator.
      const fileAnchors = (entry.anchors || []).slice(0, MAX_FOCUS);
      const focus = fileAnchors.length > 0 ? fileAnchors : capsuleAnchors;
      const answerable = focus.filter((a) => answersAnchor(known, a));

      const anchored = openFile(file, focus, failures, "anchored");
      const plain = openFile(file, [], failures, "plain");
      anchoredTokens += anchored.emitted;
      plainTokens += plain.emitted;
      anchoredCapsules.set(file, anchored.payload);
      plainCapsules.set(file, plain.payload);

      const anchoredEvidence = evidenceStrings(anchored.payload);
      const plainEvidence = evidenceStrings(plain.payload);
      answerableAnchors += answerable.length;
      anchoredKept += answerable.filter((a) => answersAnchor(anchoredEvidence, a)).length;
      plainKept += answerable.filter((a) => answersAnchor(plainEvidence, a)).length;
    }

    // Named labels split the loss: never opened (ranking) vs opened but
    // dropped from the capsule (packing).
    let evidenceRankingMiss = 0;
    let evidenceAnchoredPackingMiss = 0;
    let evidencePlainPackingMiss = 0;
    for (const label of row.evidence) {
      if (!openedPaths.includes(label.file)) {
        evidenceRankingMiss += 1;
        continue;
      }
      if (!capsuleHasLabel(anchoredCapsules.get(label.file), label)) {
        evidenceAnchoredPackingMiss += 1;
      }
      if (!capsuleHasLabel(plainCapsules.get(label.file), label)) {
        evidencePlainPackingMiss += 1;
      }
    }

    const missingFiles = [...new Set(row.evidence.map((e) => e.file))]
      .filter((file) => !openedPaths.includes(file))
      .map((file) => ({ file, labels: row.evidence.filter((e) => e.file === file).length }));

    const { causes, ranks } = classifyRankingLoss(row.query, missingFiles);

    rows.push({
      query: row.query,
      slice: row.validation ? "validation" : row.heldOut ? "held-out" : "tuning",
      rankingCauses: causes,
      missingFileRanks: ranks,
      capsuleAnchors,
      opened: openedPaths,
      calls: 1 + openedPaths.length,
      relevantLabels: row.relevant.length,
      relevantOpened,
      taskTokens,
      anchoredTokens,
      plainTokens,
      answerableAnchors,
      anchoredKept,
      plainKept,
      evidenceTotal: row.evidence.length,
      evidenceRankingMiss,
      evidenceAnchoredPackingMiss,
      evidencePlainPackingMiss,
    });
  }

  // Three slices. `tuning` picked the weights. `validation` was measured while
  // those weights were being chosen, so it is not an independent check any
  // more -- it is named for what it actually did. `held-out` was written after
  // the weights were frozen and has never been used to pick anything.
  const bySlice = (name) => rows.filter((r) => r.slice === name);
  const tuning = bySlice("tuning");
  const validationRows = bySlice("validation");
  const heldRows = bySlice("held-out");
  const { summary, failures: scoreFailures } = summarizeChain(tuning);
  const validationScored = validationRows.length > 0 ? summarizeChain(validationRows) : null;
  const heldScored = heldRows.length > 0 ? summarizeChain(heldRows) : null;
  // Outside the tuning slice only validity and budget failures are gated.
  const nonTuningValidity = [
    ...(validationScored?.failures ?? []),
    ...(heldScored?.failures ?? []),
  ].filter((f) => /opened no files|not measurable|no evidence labels|tokens >/.test(f));
  const allFailures = [...failures, ...scoreFailures, ...nonTuningValidity];
  const report = {
    summary: {
      corpus,
      staleLines,
      ...sliceSummary(rows),
      slices: {
        tuning: summary,
        validation: validationScored?.summary ?? null,
        heldOut: heldScored?.summary ?? null,
      },
    },
    rows,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  if (allFailures.length > 0) {
    process.stderr.write(`FAIL  chain gates:\n${allFailures.map((f) => `  - ${f}`).join("\n")}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
