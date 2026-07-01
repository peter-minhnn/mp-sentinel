#!/usr/bin/env node

/**
 * check-review-guardrails.mjs -- Deterministic non-AI guardrail checks.
 *
 * Scans tracked/staged/diff files for repo-specific forbidden patterns that
 * Sentinel AI might miss.  Uses tree-sitter for TS/JS AST-level checks and
 * simple file-system / regex checks for lockfile/config violations.
 *
 * Modes:
 *   (default)          Gate mode -- exit 1 if any NEW violation is found
 *   --update-baseline  Accept current violations as baseline and exit 0
 *   --all              Scan entire repo (not just diff/staged)
 *
 * Usage:
 *   node scripts/check-review-guardrails.mjs
 *   node scripts/check-review-guardrails.mjs --staged
 *   node scripts/check-review-guardrails.mjs --update-baseline
 *   node scripts/check-review-guardrails.mjs --all
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const BASELINE_PATH = join(PROJECT_ROOT, '.mp-sentinel-guardrails-baseline.json');

// ── CLI args ──────────────────────────────────────────────────────────────────
const ARGS = process.argv.slice(2);
const UPDATE_BASELINE = ARGS.includes('--update-baseline');
const SCAN_ALL = ARGS.includes('--all');
const STAGED_ONLY = ARGS.includes('--staged');
const QUIET = ARGS.includes('--quiet');
const JSON_OUT = ARGS.includes('--json');

// ── Severity ──────────────────────────────────────────────────────────────────
const CRITICAL = 'CRITICAL';
const WARNING = 'WARNING';
const INFO = 'INFO';

// ── Helpers ───────────────────────────────────────────────────────────────────
function getDiffFiles() {
  try {
    // Staged + unstaged changes vs HEAD
    const staged = execSync('git diff --cached --name-only --diff-filter=ACMR', {
      cwd: PROJECT_ROOT, encoding: 'utf8',
    }).trim().split('\n').filter(Boolean);
    const unstaged = execSync('git diff --name-only --diff-filter=ACMR', {
      cwd: PROJECT_ROOT, encoding: 'utf8',
    }).trim().split('\n').filter(Boolean);
    return [...new Set([...staged, ...unstaged])];
  } catch {
    return [];
  }
}

function getStagedFiles() {
  try {
    return execSync('git diff --cached --name-only --diff-filter=ACMR', {
      cwd: PROJECT_ROOT, encoding: 'utf8',
    }).trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function getAllTrackedFiles() {
  try {
    return execSync('git ls-files', {
      cwd: PROJECT_ROOT, encoding: 'utf8',
    }).trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function getBranchDiffFiles(compareBranch = 'origin/main') {
  try {
    execSync(`git fetch origin ${compareBranch.replace('origin/', '')}`, {
      cwd: PROJECT_ROOT, stdio: 'ignore',
    });
  } catch { /* remote may already exist */ }
  try {
    return execSync(
      `git diff --name-only --diff-filter=ACMR ${compareBranch}...HEAD`,
      { cwd: PROJECT_ROOT, encoding: 'utf8' },
    ).trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function loadBaseline() {
  if (existsSync(BASELINE_PATH)) {
    try {
      return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    } catch { /* corrupted -- start fresh */ }
  }
  return {};
}

function saveBaseline(baseline) {
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n', 'utf8');
}

function makeViolationKey(violation) {
  return `${violation.rule}::${violation.file}::${violation.line ?? 0}`;
}

// ── Tree-sitter setup ────────────────────────────────────────────────────────
const tsParser = new Parser();
tsParser.setLanguage(TypeScript.typescript);

function parseFile(filePath) {
  try {
    const content = readFileSync(filePath, 'utf8');
    return { tree: tsParser.parse(content), content };
  } catch {
    return null;
  }
}

function nodeText(node, source) {
  return source.slice(node.startIndex, node.endIndex);
}

// ── Rule registry ─────────────────────────────────────────────────────────────
// Each rule returns violations: { file, line, severity, rule, detail }[]
const RULES = {};

function registerRule(name, severity, check) {
  RULES[name] = { name, severity, check };
}

// ── AST helper: find imports ─────────────────────────────────────────────────
function* findImports(tree, source, importPath) {
  const rootNode = tree.rootNode;
  const stack = [rootNode];
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;

    // import statements: import ... from 'path'
    if (node.type === 'import_statement') {
      const sourceNode = node.childForFieldName('source');
      if (sourceNode) {
        const path = sourceNode.text.slice(1, -1); // strip quotes
        if (path === importPath || path.startsWith(importPath + '/')) {
          yield { node, path };
        }
      }
    }

    // require() calls: const x = require('path')
    if (node.type === 'call_expression') {
      const fn = node.child(0);
      if (fn && fn.type === 'identifier' && nodeText(fn, source) === 'require') {
        const args = node.childForFieldName?.('arguments');
        if (args && args.childCount > 0) {
          const arg = args.child(0);
          if (arg && (arg.type === 'string' || arg.type === 'template_string')) {
            const path = arg.text.slice(1, -1);
            if (path === importPath || path.startsWith(importPath + '/')) {
              yield { node, path };
            }
          }
        }
      }
    }

    // dynamic import(): import('path')
    if (node.type === 'import') {
      const sourceNode = node.childForFieldName?.('source');
      if (sourceNode) {
        const path = sourceNode.text.slice(1, -1);
        if (path === importPath || path.startsWith(importPath + '/')) {
          yield { node, path };
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      stack.push(node.child(i));
    }
  }
}

// ── Rule: forbidden lockfiles / package managers ─────────────────────────────
const FORBIDDEN_LOCKFILES = [
  { file: 'pnpm-lock.yaml', detail: 'pnpm lockfile detected -- project uses npm' },
  { file: 'yarn.lock', detail: 'yarn lockfile detected -- project uses npm' },
  { file: 'bun.lockb', detail: 'bun lockfile detected -- project uses npm' },
  { file: 'pnpm-workspace.yaml', detail: 'pnpm workspace config detected' },
];

registerRule('forbidden-lockfiles', CRITICAL, (allFiles) => {
  const violations = [];
  const seen = new Set(allFiles);
  for (const { file, detail } of FORBIDDEN_LOCKFILES) {
    if (seen.has(file)) {
      violations.push({
        file,
        line: 0,
        severity: CRITICAL,
        rule: 'forbidden-lockfiles',
        detail,
      });
    }
  }
  return violations;
});

// ── Rule: forbidden imports ──────────────────────────────────────────────────
const FORBIDDEN_IMPORTS = [
  { path: 'axios', detail: 'Direct axios import -- use the shared HTTP client wrapper' },
  { path: 'react-router-dom', detail: 'Direct react-router-dom import -- use framework routing abstractions' },
  { path: 'next/navigation', detail: 'Direct next/navigation import -- review framework coupling' },
  { path: 'next/router', detail: 'Direct next/router import -- review framework coupling' },
  { path: 'next/link', detail: 'Direct next/link import -- review framework coupling' },
  { path: 'next/image', detail: 'Direct next/image import -- review framework coupling' },
];

registerRule('forbidden-imports', WARNING, (allFiles, { parseFileFn }) => {
  const violations = [];
  const tsFiles = allFiles.filter(f => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f));

  for (const file of tsFiles) {
    const parsed = parseFileFn(file);
    if (!parsed) continue;

    for (const { path } of FORBIDDEN_IMPORTS) {
      for (const match of findImports(parsed.tree, parsed.content, path)) {
        violations.push({
          file,
          line: match.node.startPosition.row + 1,
          severity: WARNING,
          rule: 'forbidden-imports',
          detail: `Forbidden import: "${match.path}" -- use the shared wrapper`,
        });
      }
    }
  }
  return violations;
});

// ── Rule: Next.js directives ─────────────────────────────────────────────────
registerRule('nextjs-directives', WARNING, (allFiles, { parseFileFn }) => {
  const violations = [];
  const tsFiles = allFiles.filter(f => /\.(ts|tsx|js|jsx|mjs)$/.test(f));

  for (const file of tsFiles) {
    const parsed = parseFileFn(file);
    if (!parsed) continue;

    // Check for "use client" / "use server" directives
    const firstLine = parsed.content.split('\n')[0]?.trim() || '';
    if (firstLine === '"use client"' || firstLine === "'use client'") {
      violations.push({
        file,
        line: 1,
        severity: WARNING,
        rule: 'nextjs-directives',
        detail: '"use client" directive found -- ensure this component truly needs client-side rendering',
      });
    }
    if (firstLine === '"use server"' || firstLine === "'use server'") {
      violations.push({
        file,
        line: 1,
        severity: WARNING,
        rule: 'nextjs-directives',
        detail: '"use server" directive found -- ensure this action truly needs server execution',
      });
    }
  }
  return violations;
});

// ── Rule: direct antd value imports (outside allowlist) ──────────────────────
const ANTD_IMPORT_REGEX = /import\s+\{[^}]*\}\s+from\s+['"]antd['"]/g;
// Allowlist: specific antd sub-path imports are fine
const ANTD_ALLOWLIST = [
  'antd/es/', 'antd/lib/', '@ant-design/', 'rc-',
];

registerRule('direct-antd-imports', WARNING, (allFiles, { parseFileFn }) => {
  const violations = [];
  const tsFiles = allFiles.filter(f => /\.(ts|tsx|js|jsx)$/.test(f));

  for (const file of tsFiles) {
    const parsed = parseFileFn(file);
    if (!parsed) continue;

    // Check for top-level antd imports (not from antd/es/...)
    for (const match of findImports(parsed.tree, parsed.content, 'antd')) {
      const isAllowed = ANTD_ALLOWLIST.some(prefix => match.path.startsWith(prefix));
      if (!isAllowed) {
        violations.push({
          file,
          line: match.node.startPosition.row + 1,
          severity: WARNING,
          rule: 'direct-antd-imports',
          detail: `Direct antd import -- prefer importing from antd/es/<component> for tree-shaking`,
        });
      }
    }
  }
  return violations;
});

// ── Rule: inline style={{...}} ───────────────────────────────────────────────
const INLINE_STYLE_REGEX = /\bstyle=\{\{/;
const STYLED_COMPONENT_REGEX = /styled\(|[`']&/;

registerRule('inline-style-objects', INFO, (allFiles, { parseFileFn }) => {
  const violations = [];
  const tsFiles = allFiles.filter(f => /\.(tsx|jsx)$/.test(f) && !NON_CRITICAL_ALLOWLIST.some(p => p.test(f)));

  for (const file of tsFiles) {
    const parsed = parseFileFn(file);
    if (!parsed) continue;

    const lines = parsed.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (INLINE_STYLE_REGEX.test(lines[i]) && !STYLED_COMPONENT_REGEX.test(lines[i])) {
        violations.push({
          file,
          line: i + 1,
          severity: INFO,
          rule: 'inline-style-objects',
          detail: 'Inline style={{...}} detected -- prefer CSS Modules, Tailwind, or styled-components',
        });
      }
    }
  }
  return violations;
});

// ── Rule: inline queryKey: [...] ─────────────────────────────────────────────
const QUERY_KEY_REGEX = /queryKey\s*:\s*\[/;

registerRule('inline-query-key', INFO, (allFiles, { parseFileFn }) => {
  const violations = [];
  const tsFiles = allFiles.filter(f => /\.(ts|tsx|js|jsx)$/.test(f) && !NON_CRITICAL_ALLOWLIST.some(p => p.test(f)));

  for (const file of tsFiles) {
    const parsed = parseFileFn(file);
    if (!parsed) continue;

    const lines = parsed.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (QUERY_KEY_REGEX.test(lines[i])) {
        violations.push({
          file,
          line: i + 1,
          severity: INFO,
          rule: 'inline-query-key',
          detail: 'Inline queryKey: [...] detected -- extract to a named query key factory for consistency',
        });
      }
    }
  }
  return violations;
});

// ── Rule: direct useQuery/useMutation/useInfiniteQuery outside feature hooks ──
const REACT_QUERY_HOOKS = ['useQuery', 'useMutation', 'useInfiniteQuery', 'useSuspenseQuery'];
const FEATURE_HOOK_PATTERN = /\/hooks\//; // files under */hooks/* are considered feature hooks

registerRule('direct-react-query-hooks', WARNING, (allFiles, { parseFileFn }) => {
  const violations = [];
  const tsFiles = allFiles.filter(f => /\.(ts|tsx|js|jsx)$/.test(f) && !NON_CRITICAL_ALLOWLIST.some(p => p.test(f)));

  for (const file of tsFiles) {
    // Skip files that are under a hooks/ directory (considered feature hooks)
    if (FEATURE_HOOK_PATTERN.test(file)) continue;
    // Skip test files
    if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file)) continue;

    const parsed = parseFileFn(file);
    if (!parsed) continue;

    for (const hook of REACT_QUERY_HOOKS) {
      for (const match of findImports(parsed.tree, parsed.content, '@tanstack/react-query')) {
        // Found a react-query import -- now check if hook is used directly
        const hookRegex = new RegExp(`\\b${hook}\\b`);
        const lines = parsed.content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          // Skip import lines themselves
          if (lines[i].includes('import') && lines[i].includes('@tanstack/react-query')) continue;
          if (hookRegex.test(lines[i])) {
            violations.push({
              file,
              line: i + 1,
              severity: WARNING,
              rule: 'direct-react-query-hooks',
              detail: `Direct use of ${hook} outside feature hooks -- wrap in a custom hook under features/<name>/hooks/`,
            });
          }
        }
      }
    }
  }
  return violations;
});

// ── Rule: hardcoded hex colors in styling ────────────────────────────────────
const HEX_COLOR_REGEX = /#[0-9a-fA-F]{3,8}\b/;

registerRule('hardcoded-hex-colors', INFO, (allFiles, { parseFileFn }) => {
  const violations = [];
  const tsFiles = allFiles.filter(f => /\.(ts|tsx|js|jsx|css|scss|less)$/.test(f) && !NON_CRITICAL_ALLOWLIST.some(p => p.test(f)));

  for (const file of tsFiles) {
    const parsed = parseFileFn(file);
    if (!parsed) continue;

    // Skip files that are design tokens / theme files
    if (/theme|token|palette|color/i.test(file)) continue;

    const lines = parsed.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const match = HEX_COLOR_REGEX.exec(lines[i]);
      if (match) {
        // Skip common non-color hex patterns
        const hex = match[0];
        if (hex === '#fff' || hex === '#FFF' ||
            hex === '#ffffff' || hex === '#FFFFFF' ||
            hex === '#000' || hex === '#000000') continue;

        violations.push({
          file,
          line: i + 1,
          severity: INFO,
          rule: 'hardcoded-hex-colors',
          detail: `Hardcoded hex color "${hex}" -- use design tokens or CSS variables`,
        });
      }
    }
  }
  return violations;
});

// ── Rule: console.log / console.warn in production code ──────────────────────
const CONSOLE_LOG_REGEX = /\bconsole\.(log|warn)\s*\(/;
// Allowlist: files where console is acceptable
// Common paths excluded from non-CRITICAL rules (test files, examples, scripts)
const NON_CRITICAL_ALLOWLIST = [
  /(^|\/)scripts\//, /(^|\/)tests?\//, /\.test\./, /\.spec\./,
  /(^|\/)examples\//, /(^|\/)__tests__\//, /(^|\/)cli\//, /(^|\/)debug\//,
  /(^|\/)demos?\//, /(^|\/)fixtures?\//, /\/node_modules\//, /\/dist\//,
  /(^|\/)rule-packs\//,                          // rule pack evaluators contain detection patterns
  /(^|\/)config\/prompts\./,                     // AI prompt templates (contain example patterns)
  /(^|\/)config\/defaults\./,                    // default config values
];

// CLI output files are expected to use console.* for user-facing output
const CONSOLE_ALLOWLIST = [
  ...NON_CRITICAL_ALLOWLIST,
  /(^|\/)formatters\//,                          // report formatters output to console
  /(^|\/)commands\//,                            // CLI commands output to console
  /(^|\/)utils\/logger\./,                       // the logger itself
  /(^|\/)src\/index\./,                          // CLI entry point
  /(^|\/)services\/file-handler\//,              // file handler debug output
  /(^|\/)services\/security\//,                  // security scanner debug output
  /(^|\/)services\/ai\//,                        // AI service debug output
];

registerRule('console-log', INFO, (allFiles, { parseFileFn }) => {
  const violations = [];
  const tsFiles = allFiles.filter(f => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f));

  for (const file of tsFiles) {
    if (CONSOLE_ALLOWLIST.some(p => p.test(file))) continue;

    const parsed = parseFileFn(file);
    if (!parsed) continue;

    const lines = parsed.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (CONSOLE_LOG_REGEX.test(lines[i])) {
        // Skip if it's in a comment
        const trimmed = lines[i].trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;

        violations.push({
          file,
          line: i + 1,
          severity: INFO,
          rule: 'console-log',
          detail: `console.log/warn detected -- use a proper logger or remove before production`,
        });
      }
    }
  }
  return violations;
});

// ── Rule: potential secret/credential patterns ────────────────────────────────
const SECRET_REGEXES = [
  { pattern: /(?:api[_-]?key|apikey|secret|password|token)\s*[:=]\s*['"][^'"]{8,}['"]/i, name: 'hardcoded-credentials' },
  { pattern: /-----BEGIN\s+(RSA|EC|DSA|OPENSSH)\s+PRIVATE\s+KEY-----/, name: 'private-key' },
];

const SECRETS_ALLOWLIST = [
  /(^|\/)examples\//, /(^|\/)demos?\//, /(^|\/)fixtures?\//,
  /\.(test|spec)\./, /(^|\/)__tests__\//, /(^|\/)node_modules\//,
  /(^|\/)\.git\//, /(^|\/)docs\//,
];

// Placeholder values: the value equals the env-var name (e.g. GITHUB_TOKEN: "GITHUB_TOKEN")
// Works both for simple `KEY = "VALUE"` and TS object `KEY: "VALUE"` syntax
function isPlaceholderCredential(line) {
  // Extract key (before : or =) and value (quoted string)
  const m = line.match(/[\s{]?(\w+)\s*[:=]\s*['"]([^'"]+)['"]/);
  if (m && m[1] === m[2]) return true; // KEY: "KEY" pattern -- placeholder
  return false;
}

registerRule('secrets', CRITICAL, (allFiles, { parseFileFn }) => {
  const violations = [];
  const tsFiles = allFiles.filter(f => /\.(ts|tsx|js|jsx|mjs|cjs|json|yaml|yml|env|toml|cfg|conf)$/.test(f));

  for (const file of tsFiles) {
    if (SECRETS_ALLOWLIST.some(p => p.test(file))) continue;

    const parsed = parseFileFn(file);
    if (!parsed) continue;

    for (const { pattern, name } of SECRET_REGEXES) {
      const lines = parsed.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*')) continue;

        // Skip placeholder values like TOKEN_NAME: "TOKEN_NAME"
        if (isPlaceholderCredential(trimmed)) continue;

        if (pattern.test(lines[i])) {
          violations.push({
            file,
            line: i + 1,
            severity: CRITICAL,
            rule: 'secrets',
            detail: `Potential ${name}: hardcoded secret/credential pattern detected`,
          });
        }
      }
    }
  }
  return violations;
});

// ── Main ──────────────────────────────────────────────────────────────────────
function collectFiles() {
  if (SCAN_ALL) {
    return getAllTrackedFiles().filter(f => existsSync(join(PROJECT_ROOT, f)));
  }
  if (STAGED_ONLY) {
    return getStagedFiles().filter(f => existsSync(join(PROJECT_ROOT, f)));
  }
  // Default: diff files (staged + unstaged).  In CI, use branch diff.
  const ciTarget = process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME;
  if (ciTarget || process.env.CI) {
    return getBranchDiffFiles(ciTarget ? `origin/${ciTarget}` : 'origin/main')
      .filter(f => existsSync(join(PROJECT_ROOT, f)));
  }
  return getDiffFiles().filter(f => existsSync(join(PROJECT_ROOT, f)));
}

function parseFileFn(file) {
  return parseFile(join(PROJECT_ROOT, file));
}

function getLineForViolation(file, source, node) {
  // Count newlines up to node.startIndex
  let line = 1;
  for (let i = 0; i < node.startIndex; i++) {
    if (source[i] === '\n') line++;
  }
  return line;
}

function main() {
  const files = collectFiles();
  if (!QUIET) {
    console.error(`\n==> Guardrails: scanning ${files.length} files ...\n`);
  }

  const baseline = UPDATE_BASELINE ? {} : loadBaseline();
  const allViolations = [];

  for (const [ruleName, rule] of Object.entries(RULES)) {
    const violations = rule.check(files, { parseFileFn, PROJECT_ROOT });
    allViolations.push(...violations);
  }

  // Sort by severity then file then line
  const severityOrder = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  allViolations.sort((a, b) =>
    severityOrder[a.severity] - severityOrder[b.severity] ||
    a.file.localeCompare(b.file) ||
    (a.line ?? 0) - (b.line ?? 0),
  );

  // ── Baseline tracking ────────────────────────────────────────────────────
  if (UPDATE_BASELINE) {
    const newBaseline = {};
    for (const v of allViolations) {
      newBaseline[makeViolationKey(v)] = v;
    }
    saveBaseline(newBaseline);
    if (!QUIET) {
      console.error(`Baseline saved: ${Object.keys(newBaseline).length} violations recorded.`);
      console.error('');
      for (const v of allViolations) {
        console.error(`  ${v.severity.padEnd(9)} ${v.file}:${v.line}  [${v.rule}] ${v.detail}`);
      }
    }
    process.exit(0);
  }

  // ── Filter against baseline (only new violations fail) ───────────────────
  const newViolations = allViolations.filter(v => !baseline[makeViolationKey(v)]);
  const suppressedCount = allViolations.length - newViolations.length;

  // ── Output ───────────────────────────────────────────────────────────────
  if (JSON_OUT) {
    console.log(JSON.stringify({
      total: allViolations.length,
      new: newViolations.length,
      suppressed: suppressedCount,
      violations: newViolations,
    }, null, 2));
  } else {
    // Print all violations, marking new vs suppressed
    for (const v of allViolations) {
      const isNew = !baseline[makeViolationKey(v)];
      const marker = isNew ? ' ✗' : ' ✓'; // ✗ = fails gate, ✓ = baseline-suppressed
      console.error(
        `${marker} ${v.severity.padEnd(9)} ${v.file}:${String(v.line).padStart(4)}  [${v.rule}] ${v.detail}`,
      );
    }

    console.error('');
    console.error(`Total: ${allViolations.length} violations`);
    if (suppressedCount > 0) {
      console.error(`  ${suppressedCount} suppressed by baseline`);
    }
    console.error(`  ${newViolations.length} new (gate)`);
  }

  // ── Gate ─────────────────────────────────────────────────────────────────
  if (newViolations.length > 0) {
    if (!QUIET && !JSON_OUT) {
      console.error('\n❌ Guardrails FAILED -- new violations found.');
      console.error('   Run with --update-baseline to accept current state.');
    }
    process.exit(1);
  }

  if (!QUIET && !JSON_OUT) {
    console.error('\n✅ Guardrails passed.');
  }
  process.exit(0);
}

main();
