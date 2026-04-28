#!/usr/bin/env node

/**
 * Dogfood validation - runs the core local workflow end-to-end without network calls.
 *
 * Steps:
 *   1. release:check        - version consistency + lockfile integrity
 *   2. build                - tsup compile
 *   3. indexing --stats     - source index build + stats (JSON)
 *   4. create-skills --dry-run - all adapters, no writes (JSON)
 *   5. --explain-agents     - agent detection diagnostics (JSON)
 *   6. --explain-context    - context diagnostics (JSON)
 *
 * Each JSON step is parsed, not just visually inspected.
 * explain-context "unavailable" due to indexing.enabled=false is expected.
 *
 * Usage:
 *   node scripts/dogfood.mjs
 *   npm run dogfood
 *
 * Exit: 0 = all steps passed, 1 = one or more steps failed, 2 = script error.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

// --- helpers -----------------------------------------------------------

const STEP_INDENT = "  ";

function fail(step, detail) {
  process.stderr.write(`\n${STEP_INDENT}FAIL  ${step}`);
  if (detail) process.stderr.write(` - ${detail}`);
  process.stderr.write("\n");
  process.exitCode = 1;
}

function ok(step, detail) {
  process.stdout.write(`${STEP_INDENT}PASS  ${step}`);
  if (detail) process.stdout.write(` - ${detail}`);
  process.stdout.write("\n");
}

function run(cmd, label) {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 120000, stdio: "pipe" });
  } catch (e) {
    fail(label, e.stderr?.trim() || e.message);
    return null;
  }
}

function parseJson(raw, label) {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    fail(label, "output is not valid JSON");
    return null;
  }
}

// --- steps -------------------------------------------------------------

function stepReleaseCheck() {
  process.stdout.write("\n[1/6] release:check\n");
  const out = run("npm run release:check --silent", "release:check");
  if (out === null) return false;

  // release:check writes PASS/FAIL lines to stdout; a trailing newline
  // means the last check printed something.  Exit code tells us the result.
  ok("release:check", "all version + lockfile checks passed");
  return true;
}

function stepBuild() {
  process.stdout.write("\n[2/6] build\n");
  const out = run("npm run build --silent", "build");
  if (out === null) return false;

  if (!existsSync("dist/index.js")) {
    fail("build", "dist/index.js missing after build");
    return false;
  }
  if (!existsSync("dist/lib.js")) {
    fail("build", "dist/lib.js missing after build");
    return false;
  }
  ok("build", "dist/index.js + dist/lib.js produced");
  return true;
}

function stepIndexing() {
  process.stdout.write("\n[3/6] indexing --stats\n");
  const out = run(
    "node dist/index.js indexing --stats --index-format json",
    "indexing --stats",
  );
  if (out === null) return false;

  const json = parseJson(out, "indexing --stats");
  if (!json) return false;
  if (typeof json.totalFiles !== "number") {
    fail("indexing --stats", "JSON output missing 'totalFiles' field");
    return false;
  }

  ok(
    "indexing --stats",
    `${json.totalFiles} files, ${json.indexedFiles} indexed, ${json.schemaVersion} schema, ${json.durationMs}ms`,
  );
  return true;
}

function stepCreateSkills() {
  process.stdout.write("\n[4/6] create-skills --dry-run\n");
  const out = run(
    "node dist/index.js create-skills --all-agents --dry-run --format json",
    "create-skills --dry-run",
  );
  if (out === null) return false;

  const json = parseJson(out, "create-skills --dry-run");
  if (!json) return false;
  if (!Array.isArray(json.dryRun)) {
    fail("create-skills --dry-run", "JSON output missing 'dryRun' array");
    return false;
  }

  let fileCount = 0;
  const actions = {};
  for (const entry of json.dryRun) {
    for (const f of entry.files) {
      fileCount++;
      actions[f.action] = (actions[f.action] || 0) + 1;
    }
  }
  const summary = Object.entries(actions)
    .map(([a, c]) => `${a}=${c}`)
    .join(", ");
  ok("create-skills --dry-run", `${json.dryRun.length} agents, ${fileCount} files: ${summary}`);
  return true;
}

function stepExplainAgents() {
  process.stdout.write("\n[5/6] explain-agents\n");
  const out = run(
    "node dist/index.js create-skills --explain-agents --format json",
    "explain-agents",
  );
  if (out === null) return false;

  const json = parseJson(out, "explain-agents");
  if (!json) return false;

  // Assert top-level fields
  if (typeof json.projectName !== "string") {
    fail("explain-agents", "JSON output missing 'projectName' field");
    return false;
  }
  if (!Array.isArray(json.defaultSelection)) {
    fail("explain-agents", "JSON output missing or invalid 'defaultSelection' field");
    return false;
  }
  if (!Array.isArray(json.agents)) {
    fail("explain-agents", "JSON output missing 'agents' array");
    return false;
  }

  // Assert each agent has required fields
  const requiredFields = [
    "id",
    "detected",
    "selected",
    "detectionSignals",
    "resolvedOutput",
    "officialDocsUrl",
  ];
  for (const agent of json.agents) {
    for (const field of requiredFields) {
      if (!(field in agent)) {
        fail("explain-agents", `agent '${agent.id ?? "?"}' missing field '${field}'`);
        return false;
      }
    }
    if (typeof agent.detected !== "boolean") {
      fail("explain-agents", `agent '${agent.id}' 'detected' is not boolean`);
      return false;
    }
    if (typeof agent.selected !== "boolean") {
      fail("explain-agents", `agent '${agent.id}' 'selected' is not boolean`);
      return false;
    }
    if (!Array.isArray(agent.detectionSignals)) {
      fail("explain-agents", `agent '${agent.id}' 'detectionSignals' is not array`);
      return false;
    }
  }

  const detected = json.agents.filter((a) => a.detected).map((a) => a.id).join(", ") || "none";
  ok("explain-agents", `${json.agents.length} agents, project=${json.projectName}, default=${json.defaultSelection}, detected=[${detected}]`);
  return true;
}

function stepExplainContext() {
  process.stdout.write("\n[6/6] explain-context\n");
  const out = run(
    "node dist/index.js --explain-context --format json --files src/commands/create-skills.ts",
    "explain-context",
  );
  if (out === null) return false;

  const json = parseJson(out, "explain-context");
  if (!json) return false;

  if (json.status === "ok") {
    ok("explain-context", `profile=${json.profile}, relatedFiles=${json.relatedFiles?.length ?? 0}`);
    return true;
  }

  if (json.status === "unavailable") {
    if (json.reason && json.reason.includes("indexing.enabled = false")) {
      ok("explain-context", "unavailable (indexing disabled) - expected with default config");
      return true;
    }
    fail("explain-context", `unexpected unavailable reason: ${json.reason}`);
    return false;
  }

  fail("explain-context", `unexpected status: ${json.status}`);
  return false;
}

// --- main --------------------------------------------------------------

process.stdout.write("\nDogfood validation - mp-sentinel local workflow\n");

const steps = [
  stepReleaseCheck,
  stepBuild,
  stepIndexing,
  stepCreateSkills,
  stepExplainAgents,
  stepExplainContext,
];

let passed = 0;
let failed = 0;
for (const step of steps) {
  if (step()) passed++;
  else failed++;
}

process.stdout.write(`\n${passed} passed, ${failed} failed\n\n`);

if (failed > 0) process.exit(1);
