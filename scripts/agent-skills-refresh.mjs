#!/usr/bin/env node

/**
 * Agent skills refresh — generate fresh agent skills then verify.
 *
 * Steps:
 *   1. Runs `create-skills --all-agents --force --format json --no-ai-enrich`
 *      to regenerate all agent skill files from the current source index.
 *   2. Runs `agent:skills:check` to verify generated files pass all checks.
 *
 * Exit codes:
 *   0 — generated and verified successfully
 *   1 — generation succeeded but check found issues
 *   2 — script/runtime error (create-skills or check crash)
 *
 * Usage:
 *   node scripts/agent-skills-refresh.mjs
 *   npm run agent:skills:refresh
 */

import { execSync } from "node:child_process";

function die(msg) {
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(2);
}

// --- step 1: generate --------------------------------------------------

process.stdout.write("[agent:skills:refresh] Generating skills...\n");

try {
  const out = execSync(
    "node dist/index.js create-skills --all-agents --force --format json --no-ai-enrich",
    { encoding: "utf-8", timeout: 120000, stdio: "pipe" },
  );

  let data;
  try {
    data = JSON.parse(out);
  } catch {
    die("create-skills output is not valid JSON");
  }

  if (!Array.isArray(data?.results)) {
    die("JSON output missing 'results' array");
  }

  let totalFiles = 0;
  let skipped = 0;
  for (const agent of data.results) {
    totalFiles += agent.outputPaths.length;
    if (agent.skipped) skipped++;
  }
  process.stdout.write(
    `[agent:skills:refresh] ${data.results.length} agents, ${totalFiles} files generated` +
      (skipped > 0 ? ` (${skipped} skipped)` : "") +
      "\n",
  );
} catch (e) {
  if (e.code === 2) process.exit(2);
  die(e.stderr?.trim() || e.message);
}

// --- step 2: verify ----------------------------------------------------

process.stdout.write("[agent:skills:refresh] Verifying with check...\n");

try {
  execSync("node scripts/agent-skills-check.mjs", {
    encoding: "utf-8",
    timeout: 120000,
    stdio: "inherit",
  });
  process.stdout.write("[agent:skills:refresh] All checks passed.\n");
  process.exit(0);
} catch (e) {
  // agent-skills-check exits 1 on stale — that means refresh didn't fix everything
  process.exit(e.status ?? 1);
}
