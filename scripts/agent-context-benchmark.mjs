#!/usr/bin/env node

/**
 * Compact agent-context gate against the local source-index cache.
 *
 * For every row in scripts/agent-context-golden.json it runs the legacy
 * `--agent-context` payload and the compact one (`--token-budget 1200`
 * plus the row's `--focus` anchors) and checks that compaction keeps what
 * the task needs while actually shrinking the payload.
 *
 * Gates (exit 1 on miss):
 *   - file identity kept for every row (path + language)
 *   - parser health kept for every row (parserMode / warnings / errors / chunks)
 *   - every row keeps 100% of its own focus anchors
 *   - required-evidence retention >= 0.85 across rows, and >= 0.6 per row
 *     (an aggregate alone can hide a row that lost everything)
 *   - every compact capsule <= 1200 tokens, measured on the emitted JSON
 *   - aggregate payload of rows whose legacy output exceeds 1200 tokens
 *     drops by at least 30%
 *
 * Usage:
 *   npm run agentctx:bench
 *   node scripts/agent-context-benchmark.mjs
 *
 * Exit: 0 = gates pass, 1 = gate miss, 2 = missing dist/index/golden file,
 * an unusable row, or a failed query.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCorpus, GOLDEN_CORPORA } from "./lib/golden-lock.mjs";

const ROOT = process.cwd();
const CLI = resolve(ROOT, "dist/index.js");
const CACHE = resolve(ROOT, ".mp-sentinel-cache/source-index.json");
const GOLDEN_PATH = join(dirname(fileURLToPath(import.meta.url)), "agent-context-golden.json");

const TOKEN_BUDGET = 1200;
const RETENTION_MIN = 0.85;
const ROW_RETENTION_MIN = 0.6;
const REDUCTION_MIN = 0.3;
const MAX_FOCUS = 6;

function die(message) {
  process.stderr.write(`FAIL  ${message}\n`);
  process.exit(2);
}

// tiktoken is a runtime dependency of the CLI, so the gate measures tokens the
// same way `usedTokens` does instead of approximating bytes/4.
const { get_encoding } = await import("tiktoken");
const encoder = get_encoding("cl100k_base");
const tokens = (text) => encoder.encode(text).length;

/**
 * Verify the corpus lock so a measurement can be traced to a corpus version.
 * A changed corpus without a version bump is a setup error, not a gate miss.
 */
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

function loadGolden() {
  if (!existsSync(GOLDEN_PATH)) die(`missing ${GOLDEN_PATH}`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(GOLDEN_PATH, "utf-8"));
  } catch (err) {
    die(`cannot parse agent-context-golden.json: ${err.message}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    die("agent-context-golden.json must be a non-empty array");
  }
  const seen = new Set();
  for (const row of parsed) {
    if (!row || typeof row.file !== "string" || row.file === "") {
      die("every row needs a non-empty file");
    }
    if (seen.has(row.file)) die(`duplicate row for ${row.file}`);
    seen.add(row.file);
    if (!existsSync(resolve(ROOT, row.file))) die(`row file does not exist: ${row.file}`);
    if (!Array.isArray(row.focus) || row.focus.length === 0) {
      die(`row ${row.file} needs at least one focus anchor`);
    }
    if (row.focus.length > MAX_FOCUS) {
      die(`row ${row.file} has ${row.focus.length} focus anchors (max ${MAX_FOCUS})`);
    }
    if (!Array.isArray(row.required) || row.required.length === 0) {
      die(`row ${row.file} needs a non-empty required list`);
    }
    if (new Set(row.required).size !== row.required.length) {
      die(`row ${row.file} has duplicate required evidence`);
    }
  }
  return parsed;
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
    return { payload: JSON.parse(stdout), raw: stdout };
  } catch {
    die(`indexing ${args.join(" ")}: output is not valid JSON`);
  }
}

/** Every string an agent could match a required item against. */
function evidenceStrings(payload) {
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

const PARSER_FIELDS = [
  "parserMode",
  "parseWarnings",
  "parseErrors",
  "parseErrorMessages",
  "chunkCount",
  "chunkSize",
  "chunkWarningCount",
  "chunkBoundaryWarningCount",
  "chunkActionableWarningCount",
];

function parserHealth(file) {
  const out = {};
  for (const key of PARSER_FIELDS) {
    if (file[key] !== undefined) out[key] = file[key];
  }
  return JSON.stringify(out);
}

/**
 * Uncapped evidence straight from the index core. Required items are checked
 * against this, not the capped legacy payload -- pulling an item that the
 * legacy caps drop is exactly what `focus` is for.
 */
function indexEvidence(cacheRecord) {
  const out = new Set();
  for (const s of cacheRecord.symbols || []) {
    out.add(s.name);
    if (s.parent) out.add(s.parent);
  }
  for (const i of cacheRecord.imports || []) {
    out.add(i.source);
    for (const n of i.names || []) out.add(n);
  }
  for (const e of cacheRecord.exports || []) {
    if (e.source) out.add(e.source);
    for (const n of e.names || []) out.add(n);
  }
  for (const c of cacheRecord.calls || []) {
    out.add(c.callee);
    if (c.inSymbol) out.add(c.inSymbol);
  }
  for (const p of cacheRecord.importsFrom || []) out.add(p);
  for (const p of cacheRecord.importedBy || []) out.add(p);
  return out;
}

function loadIndexRecords() {
  let core;
  try {
    core = JSON.parse(readFileSync(CACHE, "utf-8"));
  } catch (err) {
    die(`cannot parse the source index: ${err.message}`);
  }
  const byPath = new Map();
  for (const file of core.files || []) byPath.set(file.path, file);
  return byPath;
}

function main() {
  if (!existsSync(CLI)) die("dist/index.js missing -- run `npm run build` first");
  if (!existsSync(CACHE)) die("source index missing -- run `npm run sentinel:index` first");

  const corpus = requireCorpusLock("agent-context");
  const golden = loadGolden();
  const records = loadIndexRecords();
  const rows = [];
  const failures = [];

  for (const row of golden) {
    const legacy = runJson(["--agent-context", row.file]);
    const focusArgs = row.focus.flatMap((f) => ["--focus", f]);
    const compact = runJson([
      "--agent-context",
      row.file,
      "--token-budget",
      String(TOKEN_BUDGET),
      ...focusArgs,
    ]);

    const record = records.get(row.file);
    if (!record) die(`row ${row.file} is not in the source index`);
    const known = indexEvidence(record);
    for (const item of [...row.required, ...row.focus]) {
      if (!known.has(item)) {
        die(`row ${row.file}: ${JSON.stringify(item)} is not in the index`);
      }
    }

    const compactEvidence = evidenceStrings(compact.payload);
    const kept = row.required.filter((item) => compactEvidence.has(item));
    const retention = kept.length / row.required.length;

    const identityOk =
      compact.payload.file?.path === legacy.payload.file?.path &&
      compact.payload.file?.language === legacy.payload.file?.language;
    const parserOk =
      parserHealth(compact.payload.file || {}) === parserHealth(legacy.payload.file || {});

    const legacyTokens = tokens(legacy.raw.trim());
    const compactTokens = tokens(compact.raw.trim());
    const reported = compact.payload.usedTokens;

    const focusMissing = row.focus.filter((anchor) => !compactEvidence.has(anchor));

    if (!identityOk) failures.push(`${row.file}: file identity lost`);
    if (!parserOk) failures.push(`${row.file}: parser health lost`);
    if (focusMissing.length > 0) {
      failures.push(`${row.file}: focus anchors dropped (${focusMissing.join(", ")})`);
    }
    if (retention < ROW_RETENTION_MIN) {
      failures.push(`${row.file}: retention ${retention.toFixed(4)} < ${ROW_RETENTION_MIN}`);
    }
    if (compactTokens > TOKEN_BUDGET) {
      failures.push(`${row.file}: emitted ${compactTokens} tokens > ${TOKEN_BUDGET}`);
    }
    if (reported !== compactTokens) {
      failures.push(`${row.file}: usedTokens ${reported} != emitted ${compactTokens}`);
    }

    rows.push({
      file: row.file,
      focus: row.focus,
      requiredCount: row.required.length,
      missing: row.required.filter((item) => !compactEvidence.has(item)),
      focusMissing,
      retention: Number(retention.toFixed(4)),
      identityOk,
      parserOk,
      legacyTokens,
      compactTokens,
      usedTokens: reported,
    });
  }

  const retention =
    rows.reduce((sum, r) => sum + r.retention * r.requiredCount, 0) /
    rows.reduce((sum, r) => sum + r.requiredCount, 0);
  if (retention < RETENTION_MIN) {
    failures.push(`required-evidence retention ${retention.toFixed(4)} < ${RETENTION_MIN}`);
  }

  const heavy = rows.filter((r) => r.legacyTokens > TOKEN_BUDGET);
  const legacySum = heavy.reduce((sum, r) => sum + r.legacyTokens, 0);
  const compactSum = heavy.reduce((sum, r) => sum + r.compactTokens, 0);
  const reduction = legacySum === 0 ? 0 : (legacySum - compactSum) / legacySum;
  if (heavy.length === 0) {
    failures.push("no golden row exceeds the budget in legacy form -- the corpus proves nothing");
  } else if (reduction < REDUCTION_MIN) {
    failures.push(`aggregate payload reduction ${reduction.toFixed(4)} < ${REDUCTION_MIN}`);
  }

  const summary = {
    corpus,
    tokenBudget: TOKEN_BUDGET,
    rows: rows.length,
    retention: Number(retention.toFixed(4)),
    minRowRetention: Number(Math.min(...rows.map((r) => r.retention)).toFixed(4)),
    focusAnchorsKept: rows.every((r) => r.focusMissing.length === 0),
    identityKept: rows.every((r) => r.identityOk),
    parserHealthKept: rows.every((r) => r.parserOk),
    heavyRows: heavy.length,
    legacyTokens: legacySum,
    compactTokens: compactSum,
    reduction: Number(reduction.toFixed(4)),
  };

  process.stdout.write(`${JSON.stringify({ summary, rows }, null, 2)}\n`);

  if (failures.length > 0) {
    process.stderr.write(
      `FAIL  agent-context gates:\n${failures.map((f) => `  - ${f}`).join("\n")}\n`,
    );
    process.exit(1);
  }
}

main();
