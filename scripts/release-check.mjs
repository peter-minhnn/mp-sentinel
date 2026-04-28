#!/usr/bin/env node

/**
 * Release consistency guardrails.
 *
 * Validates:
 *   - Package version consistency across package.json, package-lock.json,
 *     README badge / "What's New" pointer, WHATS_NEW.md, CHANGELOG.md
 *   - Lockfile dependency integrity (resolved tarball versions match entry versions)
 *   - Package files coverage (release scripts are published, required entries present)
 *
 * Usage:
 *   node scripts/release-check.mjs
 *   npm run release:check
 *
 * Exit: 0 = clean, 1 = one or more checks failed.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// --- helpers -----------------------------------------------------------

function fail(reason) {
  process.stderr.write(`FAIL  ${reason}\n`);
  process.exitCode = 1;
}

function ok(label) {
  process.stdout.write(`PASS  ${label}\n`);
}

function readJson(path) {
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    fail(`Cannot read ${path}: ${e.message}`);
    return null;
  }
}

function readText(path) {
  try {
    return readFileSync(path, "utf-8");
  } catch (e) {
    fail(`Cannot read ${path}: ${e.message}`);
    return null;
  }
}

// --- version extraction ------------------------------------------------

function extractVersion(str, regex, label) {
  const m = str.match(regex);
  if (!m || !m[1]) {
    fail(`${label}: could not extract version`);
    return null;
  }
  return m[1];
}

// --- checks ------------------------------------------------------------

function checkPackageVersion(expected) {
  const pkg = readJson("package.json");
  if (!pkg) return;
  if (pkg.version !== expected) {
    fail(`package.json version "${pkg.version}" does not match expected "${expected}"`);
  } else {
    ok("package.json version");
  }
}

function checkLockfileRoot(expected) {
  const lock = readJson("package-lock.json");
  if (!lock) return;

  if (lock.version !== expected) {
    fail(
      `package-lock.json top-level version "${lock.version}" does not match expected "${expected}"`,
    );
  } else {
    ok("package-lock.json top-level version");
  }

  const rootPkg = lock.packages?.[""];
  if (!rootPkg) {
    fail('package-lock.json packages[""] missing');
    return;
  }
  if (rootPkg.version !== expected) {
    fail(
      `package-lock.json packages[""].version "${rootPkg.version}" does not match expected "${expected}"`,
    );
  } else {
    ok('package-lock.json packages[""].version');
  }
}

function checkReadmeBadge(expected) {
  const text = readText("README.md");
  if (!text) return;
  const v = extractVersion(text, /npm-v(\d+\.\d+\.\d+)/, "README badge");
  if (v && v !== expected) {
    fail(`README badge version "${v}" does not match expected "${expected}"`);
  } else if (v === expected) {
    ok("README badge version");
  }
}

function checkReadmeWhatsNew(expected) {
  const text = readText("README.md");
  if (!text) return;
  // The "What's New" pointer: "for the latest features in **vX.Y.Z**:"
  // Find the line containing both "What's New" and the version bold
  const v = extractVersion(text, /What's New[\s\S]*?\*\*v(\d+\.\d+\.\d+)\*\*/, 'README "What\'s New"');
  if (!v) {
    fail('README "What\'s New" version pointer not found');
    return;
  }
  if (v !== expected) {
    fail(`README "What's New" version "${v}" does not match expected "${expected}"`);
  } else {
    ok('README "What\'s New" pointer');
  }
}

function checkWhatsNew(expected) {
  const text = readText("WHATS_NEW.md");
  if (!text) return;
  const v = extractVersion(text, /^# What's New in v(\d+\.\d+\.\d+)/m, "WHATS_NEW.md");
  if (v && v !== expected) {
    fail(`WHATS_NEW.md top heading version "${v}" does not match expected "${expected}"`);
  } else if (v === expected) {
    ok("WHATS_NEW.md top heading");
  }
}

function checkChangelog(expected) {
  const text = readText("docs/CHANGELOG.md");
  if (!text) return;
  const v = extractVersion(text, /^## \[(\d+\.\d+\.\d+)\]/m, "CHANGELOG.md");
  if (v && v !== expected) {
    fail(`CHANGELOG.md top release version "${v}" does not match expected "${expected}"`);
  } else if (v === expected) {
    ok("CHANGELOG.md top release heading");
  }
}

function checkLockfileIntegrity() {
  const lock = readJson("package-lock.json");
  if (!lock || !lock.packages) return;

  const errors = [];
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (!key.startsWith("node_modules/")) continue;
    if (!entry.resolved) continue; // git / file / link / workspace dep

    // resolved URL ends with /-/<unscoped-name>-<version>.tgz
    // So it must end with -<version>.tgz
    const expectedSuffix = `-${entry.version}.tgz`;
    if (!entry.resolved.endsWith(expectedSuffix)) {
      errors.push(`${key}: resolved URL version mismatch (expected *${expectedSuffix})`);
    }
  }

  if (errors.length > 0) {
    for (const err of errors) {
      fail(`Lockfile integrity: ${err}`);
    }
  } else {
    ok(`Lockfile dependency integrity (${Object.keys(lock.packages).filter((k) => k.startsWith("node_modules/") && lock.packages[k].resolved).length} resolved entries)`);
  }
}

function checkPackageFiles() {
  const pkg = readJson("package.json");
  if (!pkg) return;

  const files = pkg.files;
  if (!Array.isArray(files)) {
    fail('package.json "files" field is missing or not an array');
    return;
  }

  // If release:check points to scripts/release-check.mjs, it must be in files
  const releaseCheckCmd = pkg.scripts?.["release:check"];
  if (releaseCheckCmd && releaseCheckCmd.includes("scripts/release-check.mjs")) {
    if (!files.includes("scripts/release-check.mjs")) {
      fail(
        'package.json files: "scripts/release-check.mjs" is referenced by release:check but missing from files',
      );
    } else {
      ok("package.json files: release-check script is published");
    }
  }

  // Required published entries
  const required = ["dist", "README.md", "docs", "WHATS_NEW.md", "examples"];
  const missing = required.filter((e) => !files.includes(e));
  if (missing.length > 0) {
    for (const entry of missing) {
      fail(`package.json files: required entry "${entry}" is missing`);
    }
  } else {
    ok("package.json files: required published entries present");
  }
}

// --- main --------------------------------------------------------------

const pkg = readJson("package.json");
if (!pkg) {
  process.exit(2);
}

const expected = pkg.version;

process.stdout.write(`\nRelease check for mp-sentinel v${expected}\n\n`);

checkPackageVersion(expected);
checkLockfileRoot(expected);
checkReadmeBadge(expected);
checkReadmeWhatsNew(expected);
checkWhatsNew(expected);
checkChangelog(expected);
checkLockfileIntegrity();
checkPackageFiles();

process.stdout.write("\n");

if (process.exitCode === 1) {
  process.exit(1);
}
