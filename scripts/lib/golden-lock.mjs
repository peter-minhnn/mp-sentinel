#!/usr/bin/env node

/**
 * Freeze the measurement corpora so later runs stay comparable.
 *
 * Each golden file has a lock next to it holding a version, the row count,
 * and a sha256 over the corpus content (canonical JSON: object keys sorted,
 * no whitespace), so reformatting is not a change but editing a query,
 * a label, or a shape is. Both benches verify the lock before measuring, so
 * a number can always be traced back to the corpus version that produced it.
 *
 * Usage:
 *   node scripts/lib/golden-lock.mjs           # verify (exit 1 on mismatch)
 *   node scripts/lib/golden-lock.mjs --write   # accept the change, bump version
 *
 * Exit: 0 = locks match, 1 = corpus changed without a version bump,
 * 2 = a corpus or lock file is missing or unreadable.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
// Private external-repository labels are local-only. If either file is
// provided, still validate the pair strictly; clean public checkouts skip it.
const LOCAL_LISTENING = {
  id: "listening-chain",
  goldenPath: join(SCRIPTS_DIR, "listening-chain-golden.json"),
  lockPath: join(SCRIPTS_DIR, "listening-chain-golden.lock.json"),
};

export const GOLDEN_CORPORA = [
  ...(existsSync(LOCAL_LISTENING.goldenPath) || existsSync(LOCAL_LISTENING.lockPath)
    ? [LOCAL_LISTENING]
    : []),
  {
    id: "retrieval",
    goldenPath: join(SCRIPTS_DIR, "retrieval-golden.json"),
    lockPath: join(SCRIPTS_DIR, "retrieval-golden.lock.json"),
  },
  {
    id: "agent-context",
    goldenPath: join(SCRIPTS_DIR, "agent-context-golden.json"),
    lockPath: join(SCRIPTS_DIR, "agent-context-golden.lock.json"),
  },
  {
    id: "chain",
    goldenPath: join(SCRIPTS_DIR, "chain-golden.json"),
    lockPath: join(SCRIPTS_DIR, "chain-golden.lock.json"),
  },
];

/** Stable JSON: object keys sorted, arrays kept in order, no whitespace. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function corpusHash(rows) {
  return createHash("sha256").update(canonicalJson(rows)).digest("hex");
}

function readJson(path) {
  if (!existsSync(path)) return { error: `missing ${path}` };
  try {
    return { value: JSON.parse(readFileSync(path, "utf-8")) };
  } catch (err) {
    return { error: `cannot parse ${path}: ${err.message}` };
  }
}

/**
 * Compare one corpus against its lock.
 * Returns { id, ok, reason?, actual, lock } -- never throws.
 */
export function checkCorpus(corpus) {
  const golden = readJson(corpus.goldenPath);
  if (golden.error) return { id: corpus.id, fatal: true, reason: golden.error };
  if (!Array.isArray(golden.value) || golden.value.length === 0) {
    return { id: corpus.id, fatal: true, reason: `${corpus.goldenPath} must be a non-empty array` };
  }

  const actual = { rows: golden.value.length, sha256: corpusHash(golden.value) };
  const lock = readJson(corpus.lockPath);
  if (lock.error) return { id: corpus.id, ok: false, reason: lock.error, actual, lock: null };

  const { version, rows, sha256 } = lock.value;
  if (typeof version !== "number" || typeof rows !== "number" || typeof sha256 !== "string") {
    return {
      id: corpus.id,
      fatal: true,
      reason: `${corpus.lockPath} needs numeric version/rows and a sha256 string`,
    };
  }
  if (sha256 === actual.sha256 && rows === actual.rows) {
    return { id: corpus.id, ok: true, actual, lock: lock.value };
  }
  return {
    id: corpus.id,
    ok: false,
    reason: `corpus changed (rows ${rows} -> ${actual.rows}, sha256 ${sha256.slice(0, 12)} -> ${actual.sha256.slice(0, 12)})`,
    actual,
    lock: lock.value,
  };
}

/**
 * Verify every corpus lock, or just one by id. `die` is called with a message
 * when a corpus/lock is unusable; a mismatch returns false instead.
 */
export function verifyLocks(ids, onFatal) {
  const wanted = ids ? GOLDEN_CORPORA.filter((c) => ids.includes(c.id)) : GOLDEN_CORPORA;
  const results = wanted.map(checkCorpus);
  for (const result of results) {
    if (result.fatal) onFatal(result.reason);
  }
  return results;
}

function writeLocks() {
  const lines = [];
  for (const corpus of GOLDEN_CORPORA) {
    const result = checkCorpus(corpus);
    if (result.fatal) {
      process.stderr.write(`FAIL  ${result.reason}\n`);
      process.exit(2);
    }
    if (result.ok) {
      lines.push(`  ${corpus.id}: unchanged (v${result.lock.version})`);
      continue;
    }
    const nextVersion = (result.lock?.version ?? 0) + 1;
    const next = {
      version: nextVersion,
      rows: result.actual.rows,
      sha256: result.actual.sha256,
      frozenAt: new Date().toISOString().slice(0, 10),
    };
    writeFileSync(corpus.lockPath, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
    lines.push(
      `  ${corpus.id}: v${result.lock?.version ?? 0} -> v${nextVersion} (${next.rows} rows)`,
    );
  }
  process.stdout.write(`[golden:lock] locks written\n${lines.join("\n")}\n`);
}

function main() {
  if (process.argv.includes("--write")) {
    writeLocks();
    return;
  }
  const results = verifyLocks(null, (reason) => {
    process.stderr.write(`FAIL  ${reason}\n`);
    process.exit(2);
  });
  const stale = results.filter((r) => !r.ok);
  for (const result of results) {
    if (result.ok) {
      process.stdout.write(
        `[golden:lock] ${result.id}: v${result.lock.version}, ${result.actual.rows} rows, ${result.actual.sha256.slice(0, 12)}\n`,
      );
    }
  }
  if (stale.length === 0) return;
  process.stderr.write(
    `FAIL  golden corpus locks:\n${stale.map((r) => `  - ${r.id}: ${r.reason}`).join("\n")}\n` +
      `Run \`npm run golden:lock -- --write\` to accept the change and bump the version.\n`,
  );
  process.exit(1);
}

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  main();
}
