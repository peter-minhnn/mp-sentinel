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

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { execSync } from "node:child_process";

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

function checkLockfileEngine() {
  const pkg = readJson("package.json");
  const lock = readJson("package-lock.json");
  if (!pkg || !lock) return;

  const expectedEngine = pkg.engines?.node;
  const lockRoot = lock.packages?.[""];
  if (!lockRoot) return;

  if (lockRoot.engines?.node !== expectedEngine) {
    fail(
      `package-lock.json packages[""].engines.node "${lockRoot.engines?.node}" does not match package.json "${expectedEngine}"`,
    );
  } else {
    ok('package-lock.json packages[""].engines.node matches package.json');
  }
}

function checkLockfileDeps() {
  const pkg = readJson("package.json");
  const lock = readJson("package-lock.json");
  if (!pkg || !lock) return;

  // Lockfile v3 stores root specs in packages[""].dependencies / .devDependencies
  const lockPkg = lock.packages?.[""];
  if (!lockPkg) return;

  const lockDeps = lockPkg.dependencies || {};
  const lockDevDeps = lockPkg.devDependencies || {};

  const pkgDeps = pkg.dependencies || {};
  const pkgDevDeps = pkg.devDependencies || {};

  let clean = true;
  for (const [name, version] of Object.entries(pkgDeps)) {
    if (lockDeps[name] !== version) {
      fail(
        `package-lock.json root dependency "${name}" spec "${lockDeps[name]}" does not match package.json "${version}"`,
      );
      clean = false;
    }
  }
  for (const [name, version] of Object.entries(pkgDevDeps)) {
    if (lockDevDeps[name] !== version) {
      fail(
        `package-lock.json root devDependency "${name}" spec "${lockDevDeps[name]}" does not match package.json "${version}"`,
      );
      clean = false;
    }
  }
  if (clean) {
    ok("package-lock.json root dependency specs match package.json");
  }
}

function checkDirectDepEngines() {
  const pkg = readJson("package.json");
  const lock = readJson("package-lock.json");
  if (!pkg || !lock || !lock.packages) return;

  const expected = pkg.engines?.node || "";
  const majorMatch = expected.match(/(\d+)/);
  if (!majorMatch) return;
  const engineMajor = parseInt(majorMatch[1], 10);

  const directDeps = {
    ...pkg.dependencies,
  };

  let clean = true;
  for (const depName of Object.keys(directDeps)) {
    const depPkg = lock.packages[`node_modules/${depName}`];
    if (!depPkg || !depPkg.engines?.node) continue;
    const depMajor = parseInt((depPkg.engines.node.match(/(\d+)/) || [])[1], 10);
    if (depMajor > engineMajor) {
      fail(
        `Direct dep "${depName}" requires Node >=${depMajor} (lockfile), but package.json allows >=${engineMajor}`,
      );
      clean = false;
    }
  }
  if (clean) {
    ok("Direct runtime dep engines match package.json baseline");
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

  // Only published npm dependencies carry a tarball `resolved`. Workspace
  // symlinks (`link: true`), and git/file/workspace deps (no version or a
  // non-tarball `resolved`) have no tarball version to validate, so skip them.
  const isTarballEntry = (entry) =>
    Boolean(entry) &&
    entry.link !== true &&
    typeof entry.version === "string" &&
    typeof entry.resolved === "string" &&
    entry.resolved.endsWith(".tgz");

  const errors = [];
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (!key.startsWith("node_modules/")) continue;
    if (!isTarballEntry(entry)) continue;

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
    const validated = Object.entries(lock.packages).filter(
      ([k, e]) => k.startsWith("node_modules/") && isTarballEntry(e),
    ).length;
    ok(`Lockfile dependency integrity (${validated} resolved entries)`);
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

function checkScriptAsciiSafety() {
  const RISKY_CHARS = [
    { code: 0x2014, name: "em dash (--)" },
    { code: 0x2192, name: "right arrow (->)" },
    { code: 0x2190, name: "left arrow (<-)" },
    { code: 0x2026, name: "ellipsis (...)" },
  ];

  let clean = true;
  let totalFiles = 0;

  let scriptFiles;
  try {
    scriptFiles = readdirSync("scripts").filter((f) => f.endsWith(".mjs"));
  } catch {
    // scripts/ directory does not exist - skip check (packaged installs may not ship scripts/ for non-repo usage)
    return;
  }

  for (const file of scriptFiles) {
    totalFiles++;
    const content = readText(join("scripts", file));
    if (!content) continue;

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const rc of RISKY_CHARS) {
        if (lines[i].includes(String.fromCodePoint(rc.code))) {
          fail(`scripts/${file}:${i + 1} contains ${rc.name}`);
          clean = false;
        }
      }
    }
  }

  if (clean) {
    ok(`Script ASCII safety (${totalFiles} files)`);
  }
}

function checkDistFreshness(expected) {
  if (!existsSync("dist/index.js")) return;

  // Verify --version matches package.json
  try {
    const versionOut = execSync("node dist/index.js --version", {
      encoding: "utf-8",
      timeout: 30000,
      stdio: "pipe",
    }).trim();
    if (versionOut !== expected) {
      fail(`dist/index.js --version "${versionOut}" does not match expected "${expected}"`);
    } else {
      ok("dist/index.js --version matches package.json");
    }
  } catch (e) {
    fail(`dist/index.js --version failed: ${e.stderr?.trim() || e.message}`);
  }

  // Verify indexing --help contains required flags
  try {
    const helpOut = execSync("node dist/index.js indexing --help", {
      encoding: "utf-8",
      timeout: 30000,
      stdio: "pipe",
    });
    const requiredFlags = ["--health", "--agent-context", "--find-symbol", "--find-import", "--find-code", "--stats", "--explain-index", "--recovered", "--parse-errors"];
    const missing = requiredFlags.filter((f) => !helpOut.includes(f));
    if (missing.length > 0) {
      for (const flag of missing) {
        fail(`dist/index.js indexing --help missing flag: ${flag}`);
      }
    } else {
      ok("dist/index.js indexing --help contains all required flags");
    }
  } catch (e) {
    fail(`dist/index.js indexing --help failed: ${e.stderr?.trim() || e.message}`);
  }
}

/**
 * Files that are allowed to contain retired model IDs and deprecated SDK refs
 * because they describe historical state or removals.
 */
const STALE_REF_ALLOWLIST = [
  "docs/CHANGELOG.md",
  "docs/PROVIDER_COMPARISON.md", // may list historical models for context
  "WHATS_NEW.md",
  "src/services/ai/cache.ts", // cache version comment describes why bump happened
];

/**
 * Patterns that should not appear in published docs/examples outside the allowlist.
 */
const RETIRED_PATTERNS = [
  { pattern: /gpt-5\.3-codex/g, label: "gpt-5.3-codex" },
  { pattern: /gemini-3-pro-preview/g, label: "gemini-3-pro-preview" },
  { pattern: /@google\/generative-ai/g, label: "@google/generative-ai" },
  { pattern: /GoogleGenerativeAI/g, label: "GoogleGenerativeAI" },
];

function checkPublishedBadgeVersions(expected) {
  const pkg = readJson("package.json");
  if (!pkg) return;

  // Scan all published doc files and example workflow files
  const targets = [
    "README.md",
    ...glob("docs/*.md"),
    ...glob("examples/workflows/github/*.yml.example"),
    ...glob("examples/workflows/gitlab/*.yml.example"),
  ];

  let clean = true;
  for (const file of targets) {
    try {
      const content = readFileSync(file, "utf-8");
      const matches = content.match(/npm-v(\d+\.\d+\.\d+)/g);
      if (matches) {
        for (const m of matches) {
          const v = m.replace("npm-v", "");
          if (v !== expected) {
            fail(`${file} npm badge version "${v}" does not match expected "${expected}"`);
            clean = false;
          }
        }
      }
    } catch {
      // skip missing files
    }
  }
  if (clean) {
    ok("Published file npm badge versions match package.json");
  }
}

function checkStaleReferences(expected) {
  const targets = [
    "README.md",
    ...glob("docs/*.md"),
    ...glob("examples/workflows/github/*.yml.example"),
    ...glob("examples/workflows/gitlab/*.yml.example"),
  ];

  let clean = true;
  for (const file of targets) {
    if (STALE_REF_ALLOWLIST.includes(file)) continue;

    try {
      const content = readFileSync(file, "utf-8");
      for (const { pattern, label } of RETIRED_PATTERNS) {
        // Reset lastIndex for global regex
        pattern.lastIndex = 0;
        if (pattern.test(content)) {
          fail(`${file} contains retired reference "${label}"`);
          clean = false;
        }
      }
    } catch {
      // skip missing files
    }
  }
  if (clean) {
    ok("Published files contain no retired model/SDK references");
  }
}

/**
 * Minimal glob: expands `docs/*.md` to matching paths.
 */
function glob(pattern) {
  const parts = pattern.split("/");
  const base = parts[0];
  const rest = parts.slice(1).join("/");

  if (!existsSync(base)) return [];

  if (rest.includes("*")) {
    const dirPath = resolve(rest.replace(/\/[^/]*$/, ""));
    const filePat = rest.split("/").pop().replace(/\*/g, ".*");
    const re = new RegExp(`^${filePat}$`);
    try {
      return readdirSync(dirPath)
        .filter((f) => re.test(f))
        .map((f) => `${dirPath}/${f}`);
    } catch {
      return [];
    }
  }

  const full = resolve(pattern);
  try {
    if (statSync(full).isFile()) return [full];
  } catch {
    // fall through
  }
  return [];
}

function checkWhatsNewSymbols() {
  const text = readText("WHATS_NEW.md");
  if (!text) return;

  // The latest section is everything from the first heading to the next "---" separator
  const lines = text.split("\n");
  const sepIdx = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  const section = lines.slice(0, sepIdx === -1 ? lines.length : sepIdx).join("\n");

  // Find backtick-quoted function/method references: `foo()`
  const funcRefs = [...section.matchAll(/`(\w+\(\))`/g)].map((m) => m[1].replace(/\(\)$/, ""));
  if (funcRefs.length === 0) return;

  // De-duplicate
  const symbols = [...new Set(funcRefs)];

  function symbolInSrc(symbol) {
    try {
      const entries = readdirSync("src", { recursive: true, withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
        const content = readFileSync(join(entry.parentPath, entry.name), "utf-8");
        if (content.includes(symbol)) return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  for (const sym of symbols) {
    if (!symbolInSrc(sym)) {
      fail(`WHATS_NEW.md: latest section references \`${sym}()\` but "${sym}" not found in src/`);
    }
  }

  if (symbols.length > 0) {
    ok(`WHATS_NEW.md symbol hygiene (${symbols.length} function ref${symbols.length === 1 ? "" : "s"})`);
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
checkLockfileEngine();
checkLockfileDeps();
checkDirectDepEngines();
checkReadmeBadge(expected);
checkReadmeWhatsNew(expected);
checkPublishedBadgeVersions(expected);
checkStaleReferences(expected);
checkWhatsNew(expected);
checkWhatsNewSymbols();
checkChangelog(expected);
checkLockfileIntegrity();
checkPackageFiles();
checkScriptAsciiSafety();
checkDistFreshness(expected);

process.stdout.write("\n");

if (process.exitCode === 1) {
  process.exit(1);
}
