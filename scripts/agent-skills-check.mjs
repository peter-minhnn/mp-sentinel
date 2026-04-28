#!/usr/bin/env node

/**
 * Agent skills check - validate generated agent skills are up-to-date.
 *
 * Runs `create-skills --all-agents --check --format json --no-ai-enrich` and
 * parses the JSON output to report missing, stale, wrong-agent, and quality
 * errors with clear exit codes.
 *
 * Exit codes (match create-skills check semantics):
 *   0 - all generated files up-to-date
 *   1 - one or more files missing, stale, wrong-agent, or quality errors
 *   2 - script/runtime error (JSON parse failure, create-skills crash)
 *
 * Usage:
 *   node scripts/agent-skills-check.mjs
 *   npm run agent:skills:check
 */

import { execSync } from "node:child_process";

// --- helpers -----------------------------------------------------------

function fail(msg) {
  process.stderr.write(`FAIL: ${msg}\n`);
  process.exitCode = 1;
}

function die(msg) {
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(2);
}

// --- main --------------------------------------------------------------

let raw;
try {
  raw = execSync(
    "node dist/index.js create-skills --all-agents --check --format json --no-ai-enrich",
    { encoding: "utf-8", timeout: 120000, stdio: "pipe" },
  );
} catch (e) {
  // If exit code is 1 (stale), that's expected - still parse the JSON.
  if (e.stdout) {
    raw = e.stdout;
  } else {
    die(e.stderr?.trim() || e.message);
  }
}

let data;
try {
  data = JSON.parse(raw);
} catch {
  die("create-skills --check output is not valid JSON");
}

if (!Array.isArray(data?.check)) {
  die("JSON output missing 'check' array");
}

// --- analyze results ---------------------------------------------------

let hasIssues = false;
let totalFiles = 0;
const statusCounts = { "up-to-date": 0, stale: 0, missing: 0, "wrong-agent": 0 };

for (const agent of data.check) {
  for (const file of agent.files) {
    totalFiles++;
    const status = file.status;
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    if (status !== "up-to-date") {
      hasIssues = true;
      fail(`${status.padEnd(11)} ${file.outputPath} (agent: ${agent.agent})`);
    }
  }

  // Check quality errors
  if (agent.quality) {
    const errors = agent.quality.checks?.filter(
      (c) => c.severity === "error",
    );
    if (errors && errors.length > 0) {
      hasIssues = true;
      for (const err of errors) {
        fail(`quality      ${err.file}: ${err.message} (agent: ${agent.agent})`);
      }
    }
    // Report warnings as info (not blocking)
    const warnings = agent.quality.checks?.filter(
      (c) => c.severity === "warning",
    );
    if (warnings && warnings.length > 0) {
      for (const w of warnings) {
        process.stderr.write(`WARN: ${w.file}: ${w.message} (agent: ${agent.agent})\n`);
      }
    }
  }
}

// --- legacy advisory ---------------------------------------------------

if (data.legacyFiles && data.legacyFiles.length > 0) {
  process.stderr.write(
    `ADVISORY: ${data.legacyFiles.length} legacy generated file(s) detected:\n`,
  );
  for (const lf of data.legacyFiles) {
    process.stderr.write(`  - ${lf.path} (agent: ${lf.agent}) -> ${lf.suggestion}\n`);
  }
}

// --- summary -----------------------------------------------------------

const status = data.status === "ok" && !hasIssues ? "ok" : "stale";
process.stdout.write(
  `[agent:skills:check] ${totalFiles} files: ` +
    `up-to-date=${statusCounts["up-to-date"]}, stale=${statusCounts.stale}, ` +
    `missing=${statusCounts.missing}, wrong-agent=${statusCounts["wrong-agent"]} -> ${status}\n`,
);

if (hasIssues) process.exit(1);
process.exit(0);
