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
 *   7. create-skills --doctor - doctor diagnostics (JSON)
 *   8. agent:skills:check   - generated skills freshness gate
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

const TOTAL_STEPS = 8;
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
  process.stdout.write(`\n[1/8] release:check\n`);
  const out = run("npm run release:check --silent", "release:check");
  if (out === null) return false;

  // release:check writes PASS/FAIL lines to stdout; a trailing newline
  // means the last check printed something.  Exit code tells us the result.
  ok("release:check", "all version + lockfile checks passed");
  return true;
}

function stepBuild() {
  process.stdout.write(`\n[2/8] build\n`);
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
  process.stdout.write(`\n[3/8] indexing --stats\n`);
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
  process.stdout.write(`\n[4/8] create-skills --dry-run\n`);
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
  process.stdout.write(`\n[5/8] explain-agents\n`);
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
  process.stdout.write(`\n[6/8] explain-context\n`);
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

function stepDoctor() {
  process.stdout.write(`\n[7/8] create-skills --doctor\n`);
  let raw;
  try {
    raw = execSync(
      "node dist/index.js create-skills --doctor --format json",
      { encoding: "utf-8", timeout: 120000, stdio: "pipe" },
    );
  } catch (e) {
    // Doctor exits 1 for action-required (e.g. stale skills in dogfood).
    // That's expected; capture its stdout and validate the JSON regardless.
    raw = e.stdout || "";
  }
  if (!raw.trim()) {
    fail("create-skills --doctor", "no output from command");
    return false;
  }

  const json = parseJson(raw, "create-skills --doctor");
  if (!json) return false;

  // Assert top-level fields
  const requiredFields = [
    "status", "projectName", "agents", "index",
    "skills", "legacyFiles", "scripts", "recommendedActions",
    "recommendedCommands",
  ];
  for (const field of requiredFields) {
    if (!(field in json)) {
      fail("create-skills --doctor", `JSON output missing field '${field}'`);
      return false;
    }
  }

  // index should be present since we built it in step 3
  if (!json.index || typeof json.index.status !== "string") {
    fail("create-skills --doctor", "index.status missing or not a string");
    return false;
  }

  // skills should include entries for detected adapters
  if (!Array.isArray(json.skills)) {
    fail("create-skills --doctor", "skills is not an array");
    return false;
  }

  // recommendedCommands must be an array of non-empty trimmed strings
  if (!Array.isArray(json.recommendedCommands)) {
    fail("create-skills --doctor", "recommendedCommands is not an array");
    return false;
  }
  for (const cmd of json.recommendedCommands) {
    if (typeof cmd !== "string" || cmd.trim() === "") {
      fail("create-skills --doctor", "recommendedCommands contains non-string or empty entry");
      return false;
    }
  }

  ok(
    "create-skills --doctor",
    `status=${json.status}, index=${json.index.status}, ` +
    `skills=${json.skills.length} agents, ${json.legacyFiles?.length ?? 0} legacy, ` +
    `${json.scripts?.length ?? 0} scripts, ${json.recommendedActions?.length ?? 0} actions, ` +
    `${json.recommendedCommands?.length ?? 0} commands`,
  );
  return true;
}

function stepAgentSkillsCheck() {
  process.stdout.write(`\n[8/8] agent:skills:check\n`);
  let raw;
  try {
    raw = execSync(
      "npm run agent:skills:check --silent",
      { encoding: "utf-8", timeout: 120000, stdio: "pipe" },
    );
  } catch (e) {
    // Exit 1 = stale/missing/wrong-agent, exit 2 = runtime error. Both fail dogfood.
    const detail =
      e.stdout?.match(/\[agent:skills:check\] (.+)$/m)?.[1]?.trim() ||
      e.stderr?.trim() ||
      `exit code ${e.status}`;
    fail("agent:skills:check", detail);
    return false;
  }

  const detail = raw.match(/\[agent:skills:check\] (.+)$/m)?.[1]?.trim() || "all files up-to-date";
  ok("agent:skills:check", detail);
  return true;
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
  stepDoctor,
  stepAgentSkillsCheck,
];

let passed = 0;
let failed = 0;
for (const step of steps) {
  if (step()) passed++;
  else failed++;
}

process.stdout.write(`\n${passed} passed, ${failed} failed\n\n`);

if (failed > 0) process.exit(1);
