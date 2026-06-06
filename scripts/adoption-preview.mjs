#!/usr/bin/env node

/**
 * Adoption preview - validate create-skills output against ANY repo without
 * touching it.
 *
 * Copies the target repo to a temp directory (node_modules/.git excluded),
 * runs the real create-skills pipeline there, and prints either a readable
 * summary or machine-readable JSON: detected profile, package manager,
 * frameworks, conventions, generated file count, and quality
 * errors/warnings. The target repo is never written to - not even the index
 * cache.
 *
 * Usage:
 *   node scripts/adoption-preview.mjs <path-to-repo> [--json] [--strict] [--keep-temp]
 *
 * Flags:
 *   --json       Emit a single JSON object instead of the text report.
 *   --strict     Exit 1 on quality warnings as well as errors.
 *   --keep-temp  Do not delete the temp sandbox (for debugging).
 *
 * Exit codes:
 *   0 - preview generated, clean (no errors; no warnings under --strict)
 *   1 - quality errors (always), or quality warnings under --strict
 *   2 - runtime error (bad target, pipeline crash)
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(SCRIPT_DIR, "..", "dist", "index.js");

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".mp-sentinel-cache",
  ".next",
  "build",
  "coverage",
]);

// --- args ---------------------------------------------------------------

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const strict = args.includes("--strict");
const keepTemp = args.includes("--keep-temp");
const target = args.find((a) => !a.startsWith("--"));

function die(msg) {
  if (jsonMode) {
    process.stdout.write(JSON.stringify({ status: "error", error: msg }, null, 2) + "\n");
  } else {
    process.stderr.write(`ERROR: ${msg}\n`);
  }
  process.exit(2);
}

function section(title) {
  process.stdout.write(`\n${title}\n${"-".repeat(title.length)}\n`);
}

if (!target)
  die("usage: node scripts/adoption-preview.mjs <path-to-repo> [--json] [--strict] [--keep-temp]");

const targetRoot = resolve(target);
if (!existsSync(join(targetRoot, "package.json"))) {
  die(`no package.json found at ${targetRoot}`);
}
if (!existsSync(CLI)) {
  die(`dist/index.js not found - run "npm run build" first`);
}

// --- copy target to temp (target stays untouched) -----------------------

const tempRoot = mkdtempSync(join(tmpdir(), "mp-sentinel-adopt-"));
let tempCleaned = false;
const cleanup = () => {
  if (!keepTemp && !tempCleaned) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempCleaned = true;
  }
};

cpSync(targetRoot, tempRoot, {
  recursive: true,
  filter: (src) => {
    const rel = src.slice(targetRoot.length).replace(/\\/g, "/");
    return !rel.split("/").some((seg) => SKIP_DIRS.has(seg));
  },
});

// --- run the real pipeline in the temp copy ------------------------------

const run = spawnSync(
  "node",
  [CLI, "create-skills", "--agent", "claude", "--force", "--format", "json", "--no-ai-enrich"],
  { cwd: tempRoot, encoding: "utf-8", timeout: 180000, stdio: "pipe" },
);

let parsed;
try {
  parsed = JSON.parse(run.stdout || "{}");
} catch {
  cleanup();
  die(`create-skills did not return JSON.\nstderr: ${(run.stderr || "").slice(0, 800)}`);
}
if (!Array.isArray(parsed.results)) {
  cleanup();
  die(parsed.error ?? "create-skills returned no results");
}

// --- extract the summary from the generated SKILL.md ----------------------

const result = parsed.results[0] ?? {};
const outputPaths = result.outputPaths ?? [];
const skillPath = outputPaths.find((p) => p.endsWith("SKILL.md"));
const skill = skillPath && existsSync(skillPath) ? readFileSync(skillPath, "utf-8") : "";

const pick = (re) => skill.match(re)?.[1] ?? "(unknown)";
const profile = pick(/\*\*Profile:\*\* (.+)/);
const packageManager = pick(/\*\*Package Manager:\*\* (.+)/);
const frameworks = pick(/\*\*Frameworks:\*\* (.+)/);

const conventions = [];
const convSection = skill.match(/## Detected Conventions\n[\s\S]*?(?=\n## )/)?.[0] ?? "";
for (const line of convSection.split("\n")) {
  if (line.startsWith("- ")) conventions.push(line.slice(2));
}

const quality = result.quality ?? { errors: 0, warnings: 0, checks: [] };
const qualityChecks = quality.checks ?? [];
const offenders = qualityChecks
  .filter((c) => c.severity === "error" || c.severity === "warning")
  .map((c) => ({ severity: c.severity, type: c.type, file: c.file, message: c.message }));

// Cleanup before emitting so JSON can report the real status
cleanup();

const hasErrors = quality.errors > 0;
const hasWarnings = quality.warnings > 0;
const exitCode = hasErrors || (strict && hasWarnings) ? 1 : 0;

// --- report ---------------------------------------------------------------

if (jsonMode) {
  const out = {
    status: exitCode === 0 ? "ok" : "failed",
    strict,
    target: targetRoot,
    sandbox: { path: tempRoot, cleaned: tempCleaned },
    detection: { profile, packageManager, frameworks },
    generated: {
      adapter: result.agent ?? "claude",
      fileCount: outputPaths.length,
      qualityErrors: quality.errors,
      qualityWarnings: quality.warnings,
    },
    conventions,
    offenders: offenders.slice(0, 10),
  };
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  process.exit(exitCode);
}

process.stdout.write(`mp-sentinel adoption preview\n`);
process.stdout.write(`Target:   ${targetRoot}\n`);
process.stdout.write(`Sandbox:  ${tempRoot}${tempCleaned ? " (removed)" : " (kept)"}\n`);

section("Detection");
process.stdout.write(`Profile:          ${profile}\n`);
process.stdout.write(`Package manager:  ${packageManager}\n`);
process.stdout.write(`Frameworks:       ${frameworks}\n`);

section("Generated output");
process.stdout.write(`Files (claude adapter): ${outputPaths.length}\n`);
process.stdout.write(`Quality errors:         ${quality.errors}\n`);
process.stdout.write(`Quality warnings:       ${quality.warnings}\n`);

if (offenders.length > 0) {
  section(`Top offenders (${offenders.length})`);
  for (const o of offenders.slice(0, 10)) {
    process.stdout.write(`  [${o.severity}] ${o.type} (${o.file}): ${o.message}\n`);
  }
}

section(`Top conventions (${conventions.length})`);
if (conventions.length === 0) {
  process.stdout.write(`(none detected)\n`);
}
for (const conv of conventions.slice(0, 5)) {
  process.stdout.write(`- ${conv}\n`);
}

if (exitCode === 1 && !hasErrors) {
  process.stdout.write(`\nStrict mode: failing on ${quality.warnings} warning(s).\n`);
}

process.exit(exitCode);
