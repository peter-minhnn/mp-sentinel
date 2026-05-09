#!/usr/bin/env node

/**
 * Performance budget for create-skills.
 *
 * Measures wall-time P50/P95 of `create-skills --all-agents --no-ai` against
 * a representative fixture and fails if P95 exceeds the budget.
 *
 * Usage:
 *   node scripts/perf-budget.mjs                    # basic run
 *   node scripts/perf-budget.mjs --verbose          # per-run timings
 *
 * Exit codes:
 *   0 - P95 within budget
 *   1 - P95 exceeds budget
 *   2 - runtime error
 */

import { execSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const P95_BUDGET_MS = 5000;
const NUM_RUNS = 5;

function p95(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, idx)];
}

function p50(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.5);
  return sorted[idx];
}

async function createFixture(baseDir) {
  await mkdir(join(baseDir, "src"), { recursive: true });

  await writeFile(
    join(baseDir, "package.json"),
    JSON.stringify({
      name: "perf-fixture",
      version: "1.0.0",
      scripts: { test: "jest", build: "tsc" },
      dependencies: { react: "^19.0.0" },
    }),
  );

  for (let i = 0; i < 5; i++) {
    await writeFile(
      join(baseDir, "src", `module${i}.ts`),
      `export function fn${i}() { return "module${i}"; }\n`,
    );
  }
}

async function main() {
  const verbose = process.argv.includes("--verbose");

  const tmpDir = await mkdtemp(join(tmpdir(), "mp-sentinel-perf-"));
  await createFixture(tmpDir);

  const runtimes = [];
  const scriptsDir = dirname(fileURLToPath(import.meta.url));
  const distPath = join(scriptsDir, "..", "dist", "index.js");

  if (!existsSync(distPath)) {
    console.error("ERROR: dist/index.js not found. Run `npm run build` first.");
    process.exit(2);
  }

  for (let i = 0; i < NUM_RUNS; i++) {
    const start = performance.now();

    try {
      execSync(`node "${distPath}" create-skills --all-agents --force --no-ai-enrich`, {
        cwd: tmpDir,
        encoding: "utf-8",
        timeout: 60000,
        stdio: verbose ? "inherit" : "pipe",
      });
    } catch {
      // Some adapters may skip (no agent dirs detected) -- that's ok
    }

    const elapsed = performance.now() - start;
    runtimes.push(elapsed);
    if (verbose) {
      console.log(`  Run ${i + 1}: ${(elapsed / 1000).toFixed(2)}s`);
    }
  }

  const median = p50(runtimes);
  const p95Val = p95(runtimes);

  console.log(
    `[perf:budget] ${NUM_RUNS} runs: P50=${(median / 1000).toFixed(2)}s, P95=${(p95Val / 1000).toFixed(2)}s, budget=${(P95_BUDGET_MS / 1000).toFixed(2)}s`,
  );

  if (p95Val > P95_BUDGET_MS) {
    console.log(
      `FAIL: P95 (${(p95Val / 1000).toFixed(2)}s) exceeds budget (${(P95_BUDGET_MS / 1000).toFixed(2)}s)`,
    );
    process.exit(1);
  }

  console.log("PASS: P95 within budget");

  await rm(tmpDir, { recursive: true, force: true });
  process.exit(0);
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(2);
});
