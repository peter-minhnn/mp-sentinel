/**
 * Tests for scripts/release-check.mjs release validation guardrails.
 *
 * Each test builds a minimal fixture directory containing only the files
 * the script reads, then shells out via child_process so we test the
 * actual CLI contract (exit codes, stdout, stderr).
 */

import { describe, it, expect } from "@jest/globals";
import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";

const SCRIPT = resolve("scripts/release-check.mjs");

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "mp-sentinel-relcheck-"));
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf-8");
  }
  return dir;
}

function run(dir) {
  try {
    const out = execSync(`node "${SCRIPT}"`, {
      cwd: dir,
      encoding: "utf-8",
      timeout: 10000,
    });
    return { code: 0, stdout: out, stderr: "" };
  } catch (e) {
    return {
      code: e.status ?? 1,
      stdout: e.stdout?.toString() ?? "",
      stderr: e.stderr?.toString() ?? "",
    };
  }
}

// ---- helpers to build minimal fixture content -----------------------

const README_BADGE = (v) =>
  `[![NPM Version](https://img.shields.io/badge/npm-v${v}-blue?style=flat-square)](https://www.npmjs.com/package/mp-sentinel)`;

const README_WHATS_NEW = (v) =>
  `## What's New\n\nSee [WHATS_NEW.md](./WHATS_NEW.md) for the latest features in **v${v}**:`;

const WHATS_NEW = (v) => `# What's New in v${v}\n\n## Some Feature\n\nDescription.`;

const CHANGELOG = (v) => `# Changelog\n\n## [${v}] - 2026-04-28\n\n### Fixed\n- Something.`;

function validFiles(version, opts) {
  const scripts = opts?.scripts ?? { "release:check": "node scripts/release-check.mjs" };
  const files = opts?.files ?? [
    "dist",
    "README.md",
    "docs",
    "WHATS_NEW.md",
    "examples",
    "scripts/release-check.mjs",
  ];
  return {
    "package.json": JSON.stringify({
      name: "mp-sentinel",
      version,
      scripts,
      files,
    }),
    "package-lock.json": JSON.stringify({
      name: "mp-sentinel",
      version,
      lockfileVersion: 3,
      packages: {
        "": {
          name: "mp-sentinel",
          version,
        },
        "node_modules/test-pkg": {
          version: "1.0.0",
          resolved: "https://registry.npmjs.org/test-pkg/-/test-pkg-1.0.0.tgz",
        },
      },
    }),
    "README.md": `${README_BADGE(version)}\n\n${README_WHATS_NEW(version)}`,
    "WHATS_NEW.md": WHATS_NEW(version),
    "docs/CHANGELOG.md": CHANGELOG(version),
  };
}

// ---- tests -----------------------------------------------------------

describe("release-check", () => {
  it("passes on a valid fixture", () => {
    const dir = fixture(validFiles("1.2.3"));
    const result = run(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(result.code).toBe(0);
  });

  it("fails when README badge version does not match", () => {
    const dir = fixture({
      ...validFiles("1.2.3"),
      "README.md": `${README_BADGE("1.2.4")}\n\n${README_WHATS_NEW("1.2.3")}`,
    });
    const result = run(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("README badge");
  });

  it("fails when README What's New pointer does not match", () => {
    const dir = fixture({
      ...validFiles("1.2.3"),
      "README.md": `${README_BADGE("1.2.3")}\n\n${README_WHATS_NEW("1.2.4")}`,
    });
    const result = run(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("What's New");
  });

  it("fails when WHATS_NEW.md top heading does not match", () => {
    const dir = fixture({
      ...validFiles("1.2.3"),
      "WHATS_NEW.md": WHATS_NEW("1.2.4"),
    });
    const result = run(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("WHATS_NEW");
  });

  it("fails when CHANGELOG.md top release does not match", () => {
    const dir = fixture({
      ...validFiles("1.2.3"),
      "docs/CHANGELOG.md": CHANGELOG("1.2.4"),
    });
    const result = run(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("CHANGELOG");
  });

  it("fails when lockfile root version does not match", () => {
    const dir = fixture({
      ...validFiles("1.2.3"),
      "package-lock.json": JSON.stringify({
        name: "mp-sentinel",
        version: "1.2.4",
        lockfileVersion: 3,
        packages: {
          "": { name: "mp-sentinel", version: "1.2.3" },
        },
      }),
    });
    const result = run(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("top-level version");
  });

  it("fails when lockfile dependency resolved version does not match entry version", () => {
    const dir = fixture({
      ...validFiles("1.2.3"),
      "package-lock.json": JSON.stringify({
        name: "mp-sentinel",
        version: "1.2.3",
        lockfileVersion: 3,
        packages: {
          "": { name: "mp-sentinel", version: "1.2.3" },
          "node_modules/test-pkg": {
            version: "1.0.0",
            resolved: "https://registry.npmjs.org/test-pkg/-/test-pkg-2.0.0.tgz",
          },
        },
      }),
    });
    const result = run(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Lockfile integrity");
  });

  it("skips lockfile entries without resolved (git/link/file deps)", () => {
    const dir = fixture({
      ...validFiles("1.2.3"),
      "package-lock.json": JSON.stringify({
        name: "mp-sentinel",
        version: "1.2.3",
        lockfileVersion: 3,
        packages: {
          "": { name: "mp-sentinel", version: "1.2.3" },
          "node_modules/test-pkg": {
            version: "1.0.0",
            resolved: "https://registry.npmjs.org/test-pkg/-/test-pkg-1.0.0.tgz",
          },
          "node_modules/git-dep": {
            version: "2.0.0",
            // no resolved field \u2014 git dep
          },
        },
      }),
    });
    const result = run(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(result.code).toBe(0);
  });

  it("fails when package.json is missing", () => {
    const dir = fixture({
      "README.md": README_BADGE("1.2.3"),
    });
    const result = run(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(result.code).toBe(2);
  });

  it("fails when release-check script is missing from files", () => {
    const dir = fixture(
      validFiles("1.2.3", {
        scripts: { "release:check": "node scripts/release-check.mjs" },
        files: ["dist", "README.md", "docs", "WHATS_NEW.md", "examples"],
      }),
    );
    const result = run(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("release:check but missing from files");
  });

  it("does not require release-check in files when script is absent", () => {
    const dir = fixture(
      validFiles("1.2.3", {
        scripts: { test: "jest" },
        files: ["dist", "README.md", "docs", "WHATS_NEW.md", "examples"],
      }),
    );
    const result = run(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(result.code).toBe(0);
  });

  it("fails when a required published entry is missing from files", () => {
    const dir = fixture(
      validFiles("1.2.3", {
        files: [
          "dist",
          "README.md",
          "docs",
          // WHATS_NEW.md intentionally missing
          "examples",
          "scripts/release-check.mjs",
        ],
      }),
    );
    const result = run(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('required entry "WHATS_NEW.md"');
  });

  it("fails when package.json files field is absent", () => {
    const dir = fixture({
      ...validFiles("1.2.3"),
      "package.json": JSON.stringify({
        name: "mp-sentinel",
        version: "1.2.3",
        scripts: { "release:check": "node scripts/release-check.mjs" },
      }),
    });
    const result = run(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('"files" field');
  });

  // ── Dist CLI freshness ──────────────────────────────────────────────

  function distFixture(version, opts) {
    const helpFlags = opts?.helpFlags ?? [
      "--health",
      "--agent-context",
      "--find-symbol",
      "--find-import",
      "--stats",
      "--explain-index",
      "--recovered",
      "--parse-errors",
    ];
    const distVersion = opts?.distVersion ?? version;
    const distContent = [
      "#!/usr/bin/env node",
      "const arg = process.argv[2] || '';",
      `if (arg === '--version') { console.log('${distVersion}'); process.exit(0); }`,
      `if (arg === 'indexing' && process.argv.includes('--help')) {`,
      `  console.log('${helpFlags.join(" ")}');`,
      "  process.exit(0);",
      "}",
      "console.log('unknown');",
      "process.exit(1);",
    ].join("\n");

    const files = validFiles(version, opts);
    files["dist/index.js"] = distContent;
    return files;
  }

  it("passes dist freshness when dist CLI matches package version and help flags", () => {
    const dir = fixture(distFixture("1.2.3"));
    const result = run(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("dist/index.js --version");
    expect(result.stdout).toContain("dist/index.js indexing --help");
  });

  it("fails when dist/index.js --version does not match package.json", () => {
    const dir = fixture(distFixture("1.2.3", { distVersion: "1.2.4" }));
    const result = run(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('--version "1.2.4" does not match expected');
  });

  // ── WHATS_NEW symbol hygiene ────────────────────────────────────────

  const WHATS_NEW_WITH_SYMBOLS = (v) =>
    `# What's New in v${v}\n\n## Feature\n\nUses \`realFunc()\` helper.\n\n---\n\n# What's New in v0.0.0\n\nOld.`;

  function validFilesWithSrc(version, whatsNew, opts) {
    const base = validFiles(version, opts);
    base["WHATS_NEW.md"] = whatsNew;
    base["src/exists.ts"] = "export function realFunc() {}";
    return base;
  }

  it("passes when WHATS_NEW.md function references exist in src/", () => {
    const dir = fixture(validFilesWithSrc("1.2.3", WHATS_NEW_WITH_SYMBOLS("1.2.3")));
    const result = run(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("WHATS_NEW.md symbol hygiene (1 function ref)");
  });

  it("passes when WHATS_NEW.md function reference exists in nested src/ path", () => {
    const v = "1.2.3";
    const w = `# What's New in v${v}\n\n## Feature\n\nUses \`nestedFunc()\` helper.\n\n---`;
    const files = validFiles(v);
    files["WHATS_NEW.md"] = w;
    files["src/services/deep/nested.ts"] = "export function nestedFunc() {}";
    const dir = fixture(files);
    const result = run(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("WHATS_NEW.md symbol hygiene (1 function ref)");
  });

  it("fails when WHATS_NEW.md function reference does not exist in src/", () => {
    const w = `# What's New in v1.2.3\n\n## Feature\n\nUses \`missingFunc()\` helper.\n\n---`;
    const dir = fixture(validFilesWithSrc("1.2.3", w));
    const result = run(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("missingFunc");
    expect(result.stderr).toContain("not found in src/");
  });

  it("fails when dist/index.js indexing --help is missing a required flag", () => {
    const dir = fixture(distFixture("1.2.3", { helpFlags: ["--health", "--agent-context"] }));
    const result = run(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("missing flag");
  });
});
