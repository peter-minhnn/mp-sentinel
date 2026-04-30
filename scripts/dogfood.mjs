#!/usr/bin/env node

/**
 * Dogfood validation - runs the core local workflow end-to-end without network calls.
 *
 * Steps:
 *   1. release:check        - version consistency + lockfile integrity
 *   2. build                - tsup compile
 *   3. indexing --stats     - source index build + stats (JSON)
 *   4. indexing --health    - positive health check (status=ok, version fields) (JSON)
 *   5. index queries        - agent-context, find-symbol, find-import (JSON)
 *   6. create-skills --dry-run - all adapters, no writes (JSON)
 *   7. --explain-agents     - agent detection diagnostics (JSON)
 *   8. --explain-context    - context diagnostics (JSON, unavailable path)
 *   9. --explain-context    - context diagnostics (JSON, available path w/ temp fixture)
 *  10. create-skills --doctor - doctor diagnostics (JSON)
 *  11. agent:skills:check   - generated skills freshness gate
 *
 * Each JSON step is parsed, not just visually inspected.
 * Step 8 validates "unavailable" (indexing.enabled=false repo default).
 * Step 9 validates "available" with indexUsed + suggestedCommands using a temp fixture.
 *
 * Usage:
 *   node scripts/dogfood.mjs
 *   npm run dogfood
 *
 * Exit: 0 = all steps passed, 1 = one or more steps failed, 2 = script error.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// --- helpers -----------------------------------------------------------

const TOTAL_STEPS = 11;
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

function run(cmd, label, opts) {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 120000, stdio: "pipe", ...opts });
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

function stepHeader(n, label) {
  process.stdout.write(`\n[${n}/${TOTAL_STEPS}] ${label}\n`);
}

// --- steps -------------------------------------------------------------

function stepReleaseCheck() {
  stepHeader(1, "release:check");
  const out = run("npm run release:check --silent", "release:check");
  if (out === null) return false;

  // release:check writes PASS/FAIL lines to stdout; a trailing newline
  // means the last check printed something.  Exit code tells us the result.
  ok("release:check", "all version + lockfile checks passed");
  return true;
}

function stepBuild() {
  stepHeader(2, "build");
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
  stepHeader(3, "indexing --stats");
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

function stepHealthCheck() {
  stepHeader(4, "indexing --health (positive check)");
  const out = run(
    "node dist/index.js indexing --health --index-format json",
    "indexing --health",
  );
  if (out === null) return false;

  const json = parseJson(out, "indexing --health");
  if (!json) return false;

  if (json.status !== "ok") {
    fail("indexing --health", `expected status "ok", got "${json.status}"`);
    return false;
  }
  if (typeof json.toolVersion !== "string" || json.toolVersion === "") {
    fail("indexing --health", "toolVersion missing or empty");
    return false;
  }
  if (typeof json.currentToolVersion !== "string" || json.currentToolVersion === "") {
    fail("indexing --health", "currentToolVersion missing or empty");
    return false;
  }
  if (json.toolVersion !== json.currentToolVersion) {
    fail(
      "indexing --health",
      `toolVersion "${json.toolVersion}" !== currentToolVersion "${json.currentToolVersion}"`,
    );
    return false;
  }
  if (typeof json.schemaVersion !== "string" || json.schemaVersion === "") {
    fail("indexing --health", "schemaVersion missing or empty");
    return false;
  }
  if (typeof json.parseErrorRate !== "number") {
    fail("indexing --health", "parseErrorRate is not a number");
    return false;
  }
  if (typeof json.recoveredFiles !== "number") {
    fail("indexing --health", "recoveredFiles missing or not a number");
    return false;
  }
  if (typeof json.parserModeBreakdown !== "object" || json.parserModeBreakdown === null) {
    fail("indexing --health", "parserModeBreakdown missing or not an object");
    return false;
  }
  const requiredModes = ["tree-sitter", "ascii-fallback", "lexical-fallback"];
  for (const mode of requiredModes) {
    if (typeof json.parserModeBreakdown[mode] !== "number") {
      fail("indexing --health", `parserModeBreakdown.${mode} missing or not a number`);
      return false;
    }
  }

  const parts = [
    `status=ok`,
    `toolVersion=${json.toolVersion}`,
    `schemaVersion=${json.schemaVersion}`,
    `parseErrorRate=${json.parseErrorRate}`,
  ];
  if (typeof json.recoveredFiles === "number") {
    parts.push(`recoveredFiles=${json.recoveredFiles}`);
  }
  if (json.parserModeBreakdown && typeof json.parserModeBreakdown === "object") {
    const bd = Object.entries(json.parserModeBreakdown)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    parts.push(`parserModes: ${bd}`);
  }

  ok("indexing --health", parts.join(", "));
  return true;
}

function stepIndexQuery() {
  stepHeader(5, "index queries");

  // --agent-context
  const acOut = run(
    "node dist/index.js indexing --agent-context src/types/index.ts --index-format json",
    "indexing --agent-context",
  );
  if (acOut === null) return false;

  const acJson = parseJson(acOut, "indexing --agent-context");
  if (!acJson) return false;

  if (!acJson.file || typeof acJson.file !== "object") {
    fail("indexing --agent-context", "JSON output missing 'file' object");
    return false;
  }
  if (typeof acJson.file.path !== "string") {
    fail("indexing --agent-context", "file.path missing or not a string");
    return false;
  }
  if (typeof acJson.file.language !== "string") {
    fail("indexing --agent-context", "file.language missing or not a string");
    return false;
  }
  if (!Array.isArray(acJson.file.symbols)) {
    fail("indexing --agent-context", "file.symbols is not an array");
    return false;
  }
  if (!Array.isArray(acJson.file.imports)) {
    fail("indexing --agent-context", "file.imports is not an array");
    return false;
  }
  if (!Array.isArray(acJson.directImports)) {
    fail("indexing --agent-context", "directImports is not an array");
    return false;
  }
  if (!Array.isArray(acJson.directDependents)) {
    fail("indexing --agent-context", "directDependents is not an array");
    return false;
  }
  if (!Array.isArray(acJson.hubFiles)) {
    fail("indexing --agent-context", "hubFiles is not an array");
    return false;
  }
  if (!Array.isArray(acJson.suggestedCommands)) {
    fail("indexing --agent-context", "suggestedCommands is not an array");
    return false;
  }
  const acSymbols = acJson.file.symbolsTruncated ? `${acJson.file.symbols.length}+` : acJson.file.symbols.length;

  // --find-symbol
  const fsOut = run(
    "node dist/index.js indexing --find-symbol buildSourceIndex --index-format json",
    "indexing --find-symbol",
  );
  if (fsOut === null) return false;

  const fsJson = parseJson(fsOut, "indexing --find-symbol");
  if (!fsJson) return false;

  if (typeof fsJson.query !== "string") {
    fail("indexing --find-symbol", "JSON output missing 'query' field");
    return false;
  }
  if (!Array.isArray(fsJson.results)) {
    fail("indexing --find-symbol", "results is not an array");
    return false;
  }
  if (fsJson.results.length === 0) {
    fail("indexing --find-symbol", "expected results for 'buildSourceIndex', got 0");
    return false;
  }

  // --find-import
  const fiOut = run(
    "node dist/index.js indexing --find-import zod --index-format json",
    "indexing --find-import",
  );
  if (fiOut === null) return false;

  const fiJson = parseJson(fiOut, "indexing --find-import");
  if (!fiJson) return false;

  if (typeof fiJson.query !== "string") {
    fail("indexing --find-import", "JSON output missing 'query' field");
    return false;
  }
  if (!Array.isArray(fiJson.results)) {
    fail("indexing --find-import", "results is not an array");
    return false;
  }
  if (fiJson.results.length === 0) {
    fail("indexing --find-import", "expected results for 'zod', got 0");
    return false;
  }

  ok(
    "index queries",
    `agent-context ${acSymbols} symbols, find-symbol ${fsJson.results.length} hits, find-import ${fiJson.results.length} hits`,
  );
  return true;
}

function stepCreateSkills() {
  stepHeader(6, "create-skills --dry-run");
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
  stepHeader(7, "explain-agents");
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
  stepHeader(8, "explain-context");
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

function stepPositiveExplainContext() {
  stepHeader(9, "explain-context (positive path)");

  const repoRoot = process.cwd();
  const tempDir = mkdtempSync(join(tmpdir(), "dogfood-positive-ec-"));

  try {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "dogfood-positive-test", type: "module", version: "1.0.0" }, null, 2),
      "utf-8",
    );
    writeFileSync(
      join(tempDir, ".sentinelrc.json"),
      JSON.stringify({ indexing: { enabled: true } }, null, 2),
      "utf-8",
    );
    mkdirSync(join(tempDir, "src"), { recursive: true });
    writeFileSync(
      join(tempDir, "src", "api.ts"),
      [
        "export function fetchData(url: string): Promise<Response> {",
        "  return fetch(url);",
        "}",
        "",
        "export class ApiClient {",
        "  constructor(private baseUrl: string) {}",
        "  async get(path: string): Promise<Response> {",
        "    return fetch(this.baseUrl + path);",
        "  }",
        "}",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(tempDir, "src", "lib.ts"),
      [
        "export function formatDate(date: Date): string {",
        "  return date.toISOString();",
        "}",
        "",
        "export function parseQuery(q: string): Record<string, string> {",
        "  const params = new URLSearchParams(q);",
        "  const result: Record<string, string> = {};",
        "  params.forEach((v, k) => {",
        "    result[k] = v;",
        "  });",
        "  return result;",
        "}",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      join(tempDir, "src", "consumer.ts"),
      [
        'import { fetchData, ApiClient } from "./api";',
        'import { formatDate } from "./lib";',
        "",
        "export async function main(): Promise<unknown> {",
        '  const data = await fetchData("https://example.com");',
        '  const client = new ApiClient("https://api.example.com");',
        '  const result = await client.get("/users");',
        "  const formatted = formatDate(new Date());",
        "  return { data, result, formatted };",
        "}",
      ].join("\n"),
      "utf-8",
    );
    execSync("git init", { encoding: "utf-8", timeout: 30000, stdio: "pipe", cwd: tempDir });

    const indexOut = run(
      `node "${repoRoot}/dist/index.js" indexing --force --index-format json`,
      "positive-explain-context indexing",
      { cwd: tempDir },
    );
    if (indexOut === null) return false;

    const indexJson = parseJson(indexOut, "positive-explain-context indexing");
    if (!indexJson) return false;

    const ecOut = run(
      `node "${repoRoot}/dist/index.js" --explain-context --format json --files src/api.ts`,
      "positive-explain-context",
      { cwd: tempDir },
    );
    if (ecOut === null) return false;

    const ecJson = parseJson(ecOut, "positive-explain-context");
    if (!ecJson) return false;

    if (ecJson.status !== "available") {
      fail(
        "positive-explain-context",
        `expected status "available", got "${ecJson.status}"${ecJson.reason ? `: ${ecJson.reason}` : ""}`,
      );
      return false;
    }
    if (ecJson.indexUsed !== true) {
      fail("positive-explain-context", "indexUsed is not true");
      return false;
    }
    if (!Array.isArray(ecJson.includedFiles) || ecJson.includedFiles.length === 0) {
      fail("positive-explain-context", "includedFiles empty or not an array");
      return false;
    }
    if (!Array.isArray(ecJson.suggestedCommands) || ecJson.suggestedCommands.length === 0) {
      fail("positive-explain-context", "suggestedCommands empty or not an array");
      return false;
    }

    ok(
      "positive-explain-context",
      `status=${ecJson.status}, profile=${ecJson.profile}, ` +
        `includedFiles=${ecJson.includedFiles.length}, suggestedCommands=${ecJson.suggestedCommands.length}`,
    );
    return true;
  } catch (e) {
    fail("positive-explain-context", e.stderr || e.message);
    return false;
  } finally {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  }
}

function stepDoctor() {
  stepHeader(10, "create-skills --doctor");
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

  // Parser telemetry fields required when index is ok or stale
  if (json.index.status === "ok" || json.index.status === "stale") {
    if (typeof json.index.recoveredFiles !== "number") {
      fail("create-skills --doctor", "index.recoveredFiles missing or not a number");
      return false;
    }
    if (typeof json.index.parserModeBreakdown !== "object" || json.index.parserModeBreakdown === null) {
      fail("create-skills --doctor", "index.parserModeBreakdown missing or not an object");
      return false;
    }
    if (typeof json.index.parseErrorCount !== "number") {
      fail("create-skills --doctor", "index.parseErrorCount missing or not a number");
      return false;
    }
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

  let parserSummary = "";
  if (typeof json.index.recoveredFiles === "number" && typeof json.index.parseErrorCount === "number") {
    parserSummary = `, parser: ${json.index.recoveredFiles} recovered, ${json.index.parseErrorCount} hard errors`;
  }

  ok(
    "create-skills --doctor",
    `status=${json.status}, index=${json.index.status}, ` +
    `skills=${json.skills.length} agents, ${json.legacyFiles?.length ?? 0} legacy, ` +
    `${json.scripts?.length ?? 0} scripts, ${json.recommendedActions?.length ?? 0} actions, ` +
    `${json.recommendedCommands?.length ?? 0} commands${parserSummary}`,
  );
  return true;
}

function stepAgentSkillsCheck() {
  stepHeader(11, "agent:skills:check");
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
  stepHealthCheck,
  stepIndexQuery,
  stepCreateSkills,
  stepExplainAgents,
  stepExplainContext,
  stepPositiveExplainContext,
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
