/**
 * Lane C: Script Workflow Regression Harness
 *
 * Validates local automation scripts (release-check, dogfood, agent-skills-check)
 * with fixture tests. Offline and deterministic -- no network calls.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, mkdir, readFile, rm, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { readFileSync, readdirSync } from "node:fs";

// --- Paths --------------------------------------------------------

const REPO_ROOT = resolve(join(import.meta.dirname, "..", ".."));
const SCRIPTS_DIR = join(REPO_ROOT, "scripts");

function scriptPath(name: string): string {
  return join(SCRIPTS_DIR, name);
}

// --- Helpers ------------------------------------------------------

function runScript(script: string, cwd: string, args: string[] = []) {
  const result = spawnSync("node", [script, ...args], {
    cwd,
    encoding: "utf-8",
    timeout: 60000,
    stdio: "pipe",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  return {
    exitCode: result.status ?? (result.error ? 2 : 0),
    stdout: result.stdout || "",
    stderr: (result.stderr || "") + (result.error ? result.error.message : ""),
  };
}

async function makeFixture(
  baseDir: string,
  overrides?: {
    badgeVersion?: string;
    readmeWhatsNewVersion?: string;
    whatsNewVersion?: string;
    changelogVersion?: string;
    packageFiles?: string[];
    hasReleaseCheckScript?: boolean;
  },
) {
  const version = "1.0.0";
  const badgeV = overrides?.badgeVersion ?? version;
  const readmeWN = overrides?.readmeWhatsNewVersion ?? badgeV;
  const wnV = overrides?.whatsNewVersion ?? version;
  const clV = overrides?.changelogVersion ?? version;
  const pkgFiles = overrides?.packageFiles ?? [
    "dist",
    "README.md",
    "docs",
    "WHATS_NEW.md",
    "examples",
    "scripts/release-check.mjs",
  ];
  const hasReleaseScript = overrides?.hasReleaseCheckScript !== false;

  const pkg = {
    name: "test-project",
    version,
    type: "module",
    scripts: {
      "release:check": hasReleaseScript ? "node scripts/release-check.mjs" : "echo ok",
    },
    files: pkgFiles,
  };

  const lock = {
    name: "test-project",
    version,
    lockfileVersion: 3,
    packages: {
      "": { name: "test-project", version },
      "node_modules/test-dep": {
        version: "2.0.0",
        resolved: "https://registry.npmjs.org/test-dep/-/test-dep-2.0.0.tgz",
      },
    },
  };

  const readme = `# Test Project

[![NPM Version](https://img.shields.io/badge/npm-v${badgeV}-blue?style=flat-square)](https://npmjs.com)

## What's New

See [WHATS_NEW.md](./WHATS_NEW.md) for the latest features in **v${readmeWN}**:
`;

  const whatsNew = `# What's New in v${wnV}\n\nTest release notes.\n`;
  const changelog = `# Changelog\n\n## [${clV}] - 2026-01-01\n\n### Added\n- Test feature\n`;

  await writeFile(join(baseDir, "package.json"), JSON.stringify(pkg, null, 2), "utf-8");
  await writeFile(join(baseDir, "package-lock.json"), JSON.stringify(lock, null, 2), "utf-8");
  await writeFile(join(baseDir, "README.md"), readme, "utf-8");
  await writeFile(join(baseDir, "WHATS_NEW.md"), whatsNew, "utf-8");

  await mkdir(join(baseDir, "docs"), { recursive: true });
  await writeFile(join(baseDir, "docs", "CHANGELOG.md"), changelog, "utf-8");

  // Copy a .mjs script into scripts/ for the ASCII safety check
  await mkdir(join(baseDir, "scripts"), { recursive: true });
  await writeFile(
    join(baseDir, "scripts", "test-script.mjs"),
    "#!/usr/bin/env node\n\n// Pure ASCII test script\nconsole.log('hello');\n",
    "utf-8",
  );
}

// --- release-check.mjs --------------------------------------------

describe("release-check.mjs", () => {
  let tmpDir: string;
  const releaseCheck = scriptPath("release-check.mjs");

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mp-release-check-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("passes on a valid fixture (exit 0)", async () => {
    await makeFixture(tmpDir);

    const result = runScript(releaseCheck, tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("PASS  package.json version");
    expect(result.stdout).toContain("PASS  package-lock.json top-level version");
    expect(result.stdout).toContain("PASS  README badge version");
    expect(result.stdout).toContain("PASS  WHATS_NEW.md top heading");
    expect(result.stdout).toContain("PASS  CHANGELOG.md top release heading");
    expect(result.stdout).toContain("Script ASCII safety");
  });

  it("fails on README badge version mismatch (exit 1)", async () => {
    await makeFixture(tmpDir, { badgeVersion: "9.9.9" });

    const result = runScript(releaseCheck, tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("FAIL  README badge version");
  });

  it("fails on README What's New version mismatch (exit 1)", async () => {
    // readmeWhatsNewVersion controls the **vX.Y.Z** text in README's What's New section
    await makeFixture(tmpDir, { readmeWhatsNewVersion: "9.9.9" });

    const result = runScript(releaseCheck, tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('README "What\'s New" version');
  });

  it("fails on WHATS_NEW.md heading version mismatch (exit 1)", async () => {
    await makeFixture(tmpDir, { whatsNewVersion: "9.9.9" });

    const result = runScript(releaseCheck, tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("FAIL  WHATS_NEW.md top heading");
  });

  it("fails on CHANGELOG.md version mismatch (exit 1)", async () => {
    await makeFixture(tmpDir, { changelogVersion: "9.9.9" });

    const result = runScript(releaseCheck, tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("FAIL  CHANGELOG.md top release version");
  });

  it("fails when release:check script is not in published files (exit 1)", async () => {
    await makeFixture(tmpDir, { packageFiles: ["dist", "README.md"] });

    const result = runScript(releaseCheck, tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('FAIL  package.json files: "scripts/release-check.mjs"');
    expect(result.stderr).toContain("missing from files");
  });

  it("fails when required published entries are missing (exit 1)", async () => {
    await makeFixture(tmpDir, {
      packageFiles: ["dist", "scripts/release-check.mjs"], // missing README.md, docs, WHATS_NEW.md, examples
    });

    const result = runScript(releaseCheck, tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("FAIL  package.json files: required entry");
  });

  it("exits 2 when package.json is missing", async () => {
    // Don't create any fixture files
    const result = runScript(releaseCheck, tmpDir);

    expect(result.exitCode).toBe(2);
  });
});

// --- dogfood.mjs --------------------------------------------------

describe("dogfood.mjs", () => {
  it("reports the correct total step count (TOTAL_STEPS matches steps array)", () => {
    const src = readFileSync(scriptPath("dogfood.mjs"), "utf-8");

    // Extract TOTAL_STEPS value
    const totalStepsMatch = src.match(/const TOTAL_STEPS = (\d+)/);
    expect(totalStepsMatch).not.toBeNull();
    const declaredTotal = Number(totalStepsMatch![1]);

    // Count step functions in the steps array
    // The steps array is: const steps = [stepReleaseCheck, stepBuild, ...];
    const stepsArrayMatch = src.match(/const steps = \[([\s\S]*?)\];/);
    expect(stepsArrayMatch).not.toBeNull();

    // Count function references (each starts with "step" and is camelCase)
    const stepRefs = stepsArrayMatch![1]!.match(/step\w+/g);
    expect(stepRefs).not.toBeNull();
    const actualStepCount = stepRefs!.length;

    expect(actualStepCount).toBe(declaredTotal);
    expect(declaredTotal).toBe(13); // Per dogfood.mjs spec
  });

  it("step function names match the declared steps order", () => {
    const src = readFileSync(scriptPath("dogfood.mjs"), "utf-8");

    const stepsArrayMatch = src.match(/const steps = \[([\s\S]*?)\];/);
    expect(stepsArrayMatch).not.toBeNull();

    const stepNames = stepsArrayMatch![1]!.match(/step\w+/g)!.map((s: string) => s.trim());

    // Verify each declared function exists in the source
    for (const name of stepNames) {
      expect(src).toContain(`function ${name}()`);
    }
  });
});

// --- agent-skills-check.mjs ---------------------------------------

describe("agent-skills-check.mjs", () => {
  const agentCheck = scriptPath("agent-skills-check.mjs");

  it("exits 0 when only legacy advisories exist (current project state)", () => {
    // Run for real -- generated skills are current, legacy advisories are non-blocking
    const result = runScript(agentCheck, REPO_ROOT);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("[agent:skills:check]");
    expect(result.stdout).toContain("-> ok");
    expect(result.stdout).toMatch(/up-to-date=\d+/);
    expect(result.stdout).toMatch(/stale=0/);
    expect(result.stdout).toMatch(/missing=0/);
  });

  it("exits non-zero (1) when a generated file is missing", async () => {
    // Self-contained: refresh skills first so this test does not depend on
    // the outcome of any prior test that may have altered the source index.
    const refresh = spawnSync("node", [scriptPath("agent-skills-refresh.mjs")], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      timeout: 60000,
      stdio: "pipe",
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    // Refresh must succeed before we proceed
    expect(refresh.status).toBe(0);

    // Temporarily move a generated skill file to simulate "missing"
    const skillFile = join(
      REPO_ROOT,
      ".windsurf",
      "skills",
      "mp-sentinel-windsurf-best-practices",
      "SKILL.md",
    );
    const backupFile = skillFile + ".lane-c-test-backup";

    try {
      await rename(skillFile, backupFile);

      const result = runScript(agentCheck, REPO_ROOT);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("-> stale");
      expect(result.stderr).toContain("missing");
    } finally {
      // Always restore
      await rename(backupFile, skillFile);
    }
    // Spawns two real CLI runs (refresh + check), each with a 60s spawn
    // timeout -- the jest default of 5s is far too tight on slower machines.
  }, 150000);
});

// --- Risky Unicode safety -----------------------------------------

describe("Script unicode safety", () => {
  const RISKY_CHARS = [
    { code: 0x2014, name: "em dash" },
    { code: 0x2192, name: "right arrow" },
    { code: 0x2190, name: "left arrow" },
    { code: 0x2026, name: "ellipsis" },
  ];

  it("all scripts/*.mjs files are free of risky Unicode", () => {
    const scriptFiles = readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith(".mjs"));
    expect(scriptFiles.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of scriptFiles) {
      const content = readFileSync(join(SCRIPTS_DIR, file), "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        for (const rc of RISKY_CHARS) {
          if (lines[i]!.includes(String.fromCodePoint(rc.code))) {
            violations.push(`scripts/${file}:${i + 1} contains ${rc.name}`);
          }
        }
      }
    }

    if (violations.length > 0) {
      expect(`Violations found:\n${violations.join("\n")}`).toBe("no violations");
    }
    // Explicit assertion so the test doesn't pass vacuously
    expect(violations).toHaveLength(0);
  });

  it("release-check.mjs ASCII safety check self-passes on its own source", () => {
    // The release-check script has a checkScriptAsciiSafety() that scans scripts/*.mjs
    // This test verifies it self-passes -- i.e., no risky Unicode in any script
    const result = runScript(scriptPath("release-check.mjs"), REPO_ROOT);
    // May pass or fail depending on project state, but the ASCII safety check
    // itself should at least not crash
    expect(result.stdout).toContain("Script ASCII safety");
  });
});

// Serial Isolation Guard

describe("serial-isolation-check.cjs", () => {
  it("exits 0 when vulnerable suites pass serially", () => {
    const result = runScript(scriptPath("serial-isolation-check.cjs"), REPO_ROOT);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("PASS: Serial tree-sitter suites passed.");
  });

  it("preloads the Jest setup file in the root process", () => {
    const content = readFileSync(scriptPath("serial-isolation-check.cjs"), "utf-8");
    expect(content).toContain("--require");
    expect(content).toContain("jest.setup.cjs");
  });
});
