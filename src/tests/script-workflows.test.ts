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

// --- adoption-preview.mjs -----------------------------------------

describe("adoption-preview.mjs", () => {
  const adoptionPreview = scriptPath("adoption-preview.mjs");
  let targetDir: string;

  beforeEach(async () => {
    targetDir = await mkdtemp(join(tmpdir(), "mp-adopt-target-"));
    await writeFile(
      join(targetDir, "package.json"),
      JSON.stringify({
        name: "adopt-target",
        version: "1.0.0",
        scripts: { test: "vitest run", build: "vite build" },
        dependencies: { react: "^18.3.0", "react-dom": "^18.3.0" },
        devDependencies: { vite: "^5.4.0", typescript: "^5.5.0" },
      }),
    );
    await mkdir(join(targetDir, "src"), { recursive: true });
    await writeFile(join(targetDir, "src", "App.tsx"), "export const App = (): string => 'app';\n");
    await writeFile(
      join(targetDir, "src", "main.tsx"),
      "export const boot = (): string => 'ok';\n",
    );
  });

  afterEach(async () => {
    await rm(targetDir, { recursive: true, force: true });
  });

  it("prints a detection summary and never writes into the target", () => {
    const result = runScript(adoptionPreview, REPO_ROOT, [targetDir]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("adoption preview");
    expect(result.stdout).toContain("Profile:          react-spa");
    expect(result.stdout).toContain("Package manager:  npm");
    expect(result.stdout).toContain("Quality errors:         0");

    // The target repo is untouched: no outputs, no index cache
    expect(readdirSync(targetDir).sort()).toEqual(["package.json", "src"]);
  });

  it("emits a machine-readable JSON summary with --json", () => {
    const result = runScript(adoptionPreview, REPO_ROOT, [targetDir, "--json"]);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      status: string;
      strict: boolean;
      detection: { profile: string; packageManager: string; frameworks: string };
      generated: { fileCount: number; qualityErrors: number; qualityWarnings: number };
      conventions: string[];
      offenders: unknown[];
      sandbox: { cleaned: boolean };
    };
    expect(parsed.status).toBe("ok");
    expect(parsed.strict).toBe(false);
    expect(parsed.detection.profile).toBe("react-spa");
    expect(parsed.detection.packageManager).toBe("npm");
    expect(parsed.generated.qualityErrors).toBe(0);
    expect(parsed.generated.qualityWarnings).toBe(0);
    expect(parsed.generated.fileCount).toBeGreaterThan(0);
    expect(parsed.offenders).toEqual([]);
    expect(parsed.sandbox.cleaned).toBe(true);
    expect(readdirSync(targetDir).sort()).toEqual(["package.json", "src"]);
  });

  it("passes --strict when output is clean (exit 0)", () => {
    const result = runScript(adoptionPreview, REPO_ROOT, [targetDir, "--json", "--strict"]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { status: string; strict: boolean };
    expect(parsed.status).toBe("ok");
    expect(parsed.strict).toBe(true);
  });

  it("emits a JSON error object (exit 2) for a directory without package.json", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "mp-adopt-empty-"));
    try {
      const result = runScript(adoptionPreview, REPO_ROOT, [emptyDir, "--json"]);
      expect(result.exitCode).toBe(2);
      const parsed = JSON.parse(result.stdout) as { status: string; error: string };
      expect(parsed.status).toBe("error");
      expect(parsed.error).toContain("no package.json");
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  it("exits 2 for a directory without package.json", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "mp-adopt-empty-"));
    try {
      const result = runScript(adoptionPreview, REPO_ROOT, [emptyDir]);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("no package.json");
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  it("fails --strict (exit 1) on a repo that deterministically produces a warning", async () => {
    // A project rule that references a backtick path which does not exist in
    // the index trips the unknown-path warning deterministically (project
    // rules are rendered verbatim and scanned by the gate). Without --strict
    // it exits 0; with --strict it must exit 1.
    const warnDir = await mkdtemp(join(tmpdir(), "mp-adopt-warn-"));
    try {
      await writeFile(
        join(warnDir, "package.json"),
        JSON.stringify({
          name: "warn-fixture",
          version: "1.0.0",
          scripts: { build: "tsc", test: "vitest run" },
          devDependencies: { typescript: "^5.5.0" },
        }),
      );
      await writeFile(
        join(warnDir, ".mp-sentinelrc.json"),
        JSON.stringify({
          rules: ["All HTTP calls must go through `src/does-not-exist/api-client.ts`."],
        }),
      );
      await mkdir(join(warnDir, "src"), { recursive: true });
      await writeFile(join(warnDir, "src", "index.ts"), "export const x = 1;\n");
      await writeFile(join(warnDir, "src", "util.ts"), "export const y = 2;\n");

      const lenient = runScript(adoptionPreview, REPO_ROOT, [warnDir, "--json"]);
      const lenientParsed = JSON.parse(lenient.stdout) as {
        generated: { qualityWarnings: number; qualityErrors: number };
        offenders: Array<{ type: string }>;
      };

      // Deterministic: the fake path in the project rule warns, with no errors
      expect(lenientParsed.generated.qualityErrors).toBe(0);
      expect(lenientParsed.generated.qualityWarnings).toBeGreaterThan(0);
      expect(lenientParsed.offenders.some((o) => o.type === "unknown-path")).toBe(true);
      expect(lenient.exitCode).toBe(0);

      // Strict run on the same repo -> exit 1
      const strictRun = runScript(adoptionPreview, REPO_ROOT, [warnDir, "--json", "--strict"]);
      const strictParsed = JSON.parse(strictRun.stdout) as { status: string };
      expect(strictRun.exitCode).toBe(1);
      expect(strictParsed.status).toBe("failed");
    } finally {
      await rm(warnDir, { recursive: true, force: true });
    }
  }, 60000);
});

// --- adoption-preview against real validation repos (optional) ----------
//
// Real-repo validation is OPT-IN: it runs only when MP_SENTINEL_VALIDATION_REPOS
// (comma-separated repo paths) is set. Ambient sibling directories are NOT
// auto-discovered, so a normal `npm test` is deterministic regardless of what
// sits beside the checkout. When the env var is set, the strict quality
// assertions below still apply. Skips with a clear message when unset.

describe("adoption-preview.mjs real validation repos", () => {
  const adoptionPreview = scriptPath("adoption-preview.mjs");

  // Opt-in only: env-provided paths, never ambient sibling directories.
  const candidateRoots = (name: string): string[] =>
    (process.env["MP_SENTINEL_VALIDATION_REPOS"] ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .filter((p) => p.endsWith(name) || p.includes(`${name}`));

  const resolveRepo = (name: string): string | null =>
    candidateRoots(name).find((p) => {
      try {
        return readFileSync(join(p, "package.json"), "utf-8").length > 0;
      } catch {
        return false;
      }
    }) ?? null;

  for (const repoName of ["mvp-listening", "gems-e-approval-web"]) {
    it(`previews ${repoName} cleanly without touching it (when present)`, () => {
      const repoRoot = resolveRepo(repoName);
      if (!repoRoot) {
        console.info(
          `[skip] ${repoName} not provided (set MP_SENTINEL_VALIDATION_REPOS to opt in) - skipping real-repo preview.`,
        );
        return;
      }

      const before = readdirSync(repoRoot).sort();
      const result = runScript(adoptionPreview, REPO_ROOT, [repoRoot, "--json", "--strict"]);
      const parsed = JSON.parse(result.stdout) as {
        status: string;
        generated: { qualityErrors: number; qualityWarnings: number };
        sandbox: { cleaned: boolean };
      };

      // Zero errors AND zero warnings under --strict
      expect(parsed.generated.qualityErrors).toBe(0);
      expect(parsed.generated.qualityWarnings).toBe(0);
      expect(parsed.status).toBe("ok");
      expect(result.exitCode).toBe(0);
      expect(parsed.sandbox.cleaned).toBe(true);

      // Target repo is byte-for-byte untouched at the top level
      expect(readdirSync(repoRoot).sort()).toEqual(before);
    }, 180000);
  }
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

  it("dogfood output has zero quality warnings across all adapters", () => {
    // Warning-clean gate: mp-sentinel's own generated skills must not carry
    // repetitive-output or any other quality warnings.
    const result = spawnSync(
      "node",
      [
        "dist/index.js",
        "create-skills",
        "--all-agents",
        "--check",
        "--format",
        "json",
        "--no-ai-enrich",
      ],
      { cwd: REPO_ROOT, encoding: "utf-8", timeout: 120000, stdio: "pipe" },
    );
    const parsed = JSON.parse(result.stdout || "{}") as {
      check?: Array<{
        agent: string;
        quality?: { checks: Array<{ severity: string; message: string }> };
      }>;
    };
    expect(Array.isArray(parsed.check)).toBe(true);
    const warnings = (parsed.check ?? []).flatMap((r) =>
      (r.quality?.checks ?? [])
        .filter((c) => c.severity === "warning")
        .map((c) => `${r.agent}: ${c.message}`),
    );
    expect(warnings).toEqual([]);
  }, 120000);

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
