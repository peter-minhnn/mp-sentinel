/**
 * CodeStyleProfile detection — detects coding style from real source files.
 *
 * Samples up to 20 files from the source index, reads them from disk,
 * and detects indent style, quote usage, semicolons, file-size distribution,
 * and project formatter configs.
 *
 * Pure deterministic — no AI calls.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CodeStyleProfile, SourceIndex } from "../../types/index.js";
export type { CodeStyleProfile };

// ── Config ──────────────────────────────────────────────────────────────────

const MAX_SAMPLE_FILES = 20;

// ── Formatter config file detection ─────────────────────────────────────────

const FORMATTER_CONFIG_FILES = [
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.yaml",
  ".prettierrc.yml",
  ".prettierrc.toml",
  ".prettierrc.js",
  ".prettierrc.cjs",
  ".prettierrc.mjs",
  "prettier.config.js",
  "prettier.config.cjs",
  "prettier.config.mjs",
  ".editorconfig",
  "biome.json",
  "biome.jsonc",
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  "eslint.config.mts",
  "eslint.config.cts",
  ".eslintrc.json",
  ".eslintrc.js",
  ".eslintrc.yaml",
  ".eslintrc.yml",
  ".eslintrc.cjs",
  "pyproject.toml",
  "rustfmt.toml",
  ".gofmt",
  ".gofmt.yaml",
  "clang-format",
  ".clang-format",
  "_clang-format",
];

// ── Sampling strategy ──────────────────────────────────────────────────────

interface SampleFile {
  path: string;
  lines: number;
}

/**
 * Select up to MAX_SAMPLE_FILES from the source index for style detection.
 * Uses a heuristic: largest file, median file, a test file, import-heavy files.
 */
function selectSampleFiles(index: SourceIndex): SampleFile[] {
  const files = index.files;
  if (files.length === 0) return [];

  const candidates: SampleFile[] = files.map((f) => {
    // Estimate lines from import/export/symbol counts + content if available
    return {
      path: f.path,
      lines: f.symbols.length + f.imports.length + f.exports.length,
    };
  });

  // Sort by estimated line count (proxy for file size)
  candidates.sort((a, b) => a.lines - b.lines);

  // Strategy: pick diverse files
  const selected = new Set<string>();
  const result: SampleFile[] = [];

  // 1. Largest file (most symbols/imports)
  const largest = candidates[candidates.length - 1];
  if (largest && !selected.has(largest.path)) {
    result.push(largest);
    selected.add(largest.path);
  }

  // 2. Median file
  const median = candidates[Math.floor(candidates.length / 2)];
  if (median && !selected.has(median.path)) {
    result.push(median);
    selected.add(median.path);
  }

  // 3. A test file
  const testFile = files.find(
    (f) =>
      !selected.has(f.path) &&
      (f.path.includes(".test.") || f.path.includes(".spec.") || f.path.includes("__tests__")),
  );
  if (testFile) {
    result.push({ path: testFile.path, lines: testFile.symbols.length });
    selected.add(testFile.path);
  }

  // 4. Import-heavy files (hub files — entrypoints)
  const importHeavy = [...files]
    .sort((a, b) => (b.imports?.length ?? 0) - (a.imports?.length ?? 0))
    .filter((f) => !selected.has(f.path));
  for (const f of importHeavy.slice(0, 3)) {
    if (selected.has(f.path)) continue;
    result.push({ path: f.path, lines: f.symbols.length });
    selected.add(f.path);
  }

  // 5. A .svelte or .vue file if present
  const svelteFile = files.find(
    (f) => !selected.has(f.path) && (f.path.endsWith(".svelte") || f.path.endsWith(".vue")),
  );
  if (svelteFile) {
    result.push({
      path: svelteFile.path,
      lines: svelteFile.symbols.length,
    });
    selected.add(svelteFile.path);
  }

  // 6. Fill up to MAX_SAMPLE_FILES with random-ish files (deterministic sort)
  const remaining = candidates.filter((c) => !selected.has(c.path));
  for (const c of remaining.slice(0, MAX_SAMPLE_FILES - result.length)) {
    result.push(c);
  }

  return result;
}

// ── Style detection helpers ────────────────────────────────────────────────

/**
 * Detect indent style from file content.
 * Returns the mode across all sampled lines.
 */
function detectIndent(lines: string[]): CodeStyleProfile["indent"] {
  const indentCounts = { tab: 0, "2-spaces": 0, "4-spaces": 0 };

  for (const line of lines) {
    if (line.length === 0) continue;
    const firstChar = line[0]!;
    if (firstChar === "\t") {
      indentCounts.tab++;
    } else if (firstChar === " ") {
      // Count leading spaces
      let spaceCount = 0;
      for (const ch of line) {
        if (ch === " ") spaceCount++;
        else break;
      }
      if (spaceCount % 4 === 0 && spaceCount > 0) {
        indentCounts["4-spaces"]++;
      } else if (spaceCount % 2 === 0 && spaceCount > 0) {
        indentCounts["2-spaces"]++;
      }
    }
  }

  const total = indentCounts.tab + indentCounts["2-spaces"] + indentCounts["4-spaces"];
  if (total === 0) return "unknown";

  // If one style dominates (>60%), return it
  const dom = (Object.entries(indentCounts) as [CodeStyleProfile["indent"], number][]).sort(
    (a, b) => b[1] - a[1],
  )[0]!;

  if (dom[1] / total > 0.6) return dom[0];
  return "mixed";
}

/**
 * Detect quote style: ratio of single quotes vs double quotes.
 * Returns 0-1 where 1 = all single quotes, 0 = all double quotes.
 */
function detectQuoteRatio(content: string): number {
  const singleMatches = content.match(/'/g);
  const doubleMatches = content.match(/"/g);
  const singles = singleMatches?.length ?? 0;
  const doubles = doubleMatches?.length ?? 0;
  const total = singles + doubles;
  if (total === 0) return 0.5; // Default neutral
  return singles / total;
}

/**
 * Detect semicolon ratio: ratio of lines ending with semicolons vs not.
 * Operates on lines that are likely statements (not empty, not comments).
 */
function detectSemicolonRatio(lines: string[]): number {
  const statementLines = lines.filter(
    (l) =>
      l.trim().length > 0 &&
      !l.trim().startsWith("//") &&
      !l.trim().startsWith("/*") &&
      !l.trim().startsWith("*") &&
      !l.trim().startsWith("import ") &&
      !l.trim().startsWith("export ") &&
      !l.trim().startsWith("}") &&
      !l.trim().startsWith("{") &&
      !l.trim().endsWith("{") &&
      !l.trim().endsWith(",") &&
      !l.trim().endsWith("(") &&
      !l.trim().endsWith("[") &&
      !l.trim().startsWith("#"),
  );

  if (statementLines.length === 0) return 0.5;

  const withSemicolons = statementLines.filter((l) => l.trim().endsWith(";"));
  return withSemicolons.length / statementLines.length;
}

/**
 * Detect trailing newline ratio.
 */
function detectTrailingNewline(content: string): number {
  return content.endsWith("\n") ? 1 : 0;
}

/**
 * Detect import placement in .svelte / .vue files.
 * Counts imports found outside the <script> block.
 */
function detectSvelteImportOutsideScript(filePath: string, content: string): number {
  if (!filePath.endsWith(".svelte") && !filePath.endsWith(".vue")) return 0;

  // Find all import statements
  const importRegex = /^\s*import\s+/gm;
  const allImports: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(content)) !== null) {
    allImports.push(match.index);
  }

  if (allImports.length === 0) return 0;

  // Find <script> blocks
  const scriptOpenRegex = /<script[^>]*>/g;
  let scriptMatch: RegExpExecArray | null;
  const scriptRanges: Array<[number, number]> = [];
  while ((scriptMatch = scriptOpenRegex.exec(content)) !== null) {
    const openIndex = scriptMatch.index;
    // Find matching closing tag
    const closeTag = "</script>";
    const closeIndex = content.indexOf(closeTag, openIndex);
    if (closeIndex !== -1) {
      scriptRanges.push([openIndex, closeIndex + closeTag.length]);
    }
  }

  if (scriptRanges.length === 0) return 1; // All imports are outside

  // Count imports outside any script block
  const outsideCount = allImports.filter((importIndex) => {
    return !scriptRanges.some(([start, end]) => importIndex >= start && importIndex < end);
  }).length;

  return outsideCount / allImports.length;
}

// ── Formatter config detection ─────────────────────────────────────────────

function detectFormatterConfigs(projectRoot: string): string[] {
  const found: string[] = [];
  for (const configFile of FORMATTER_CONFIG_FILES) {
    if (existsSync(join(projectRoot, configFile))) {
      found.push(configFile);
    }
  }
  return found.sort();
}

// ── File line counting ─────────────────────────────────────────────────────

/**
 * Count the number of lines in the source index files.
 * Uses source index data (symbols/imports/exports as a rough proxy).
 */
function countFileLines(index: SourceIndex, filePath: string): number {
  const file = index.files.find((f) => f.path === filePath);
  if (!file) return 0;
  // Estimate from source index metadata
  return Math.max(
    file.symbols.reduce((max, s) => Math.max(max, s.line), 0),
    1,
  );
}

// ── Main detection function ─────────────────────────────────────────────────

/**
 * Detect the code style profile from a source index.
 *
 * @param projectRoot - Project root directory (to read files and detect formatter configs)
 * @param index - Source index with file metadata
 * @returns CodeStyleProfile with detected style attributes
 */
export async function detectCodeStyleProfile(
  projectRoot: string,
  index: SourceIndex,
): Promise<CodeStyleProfile> {
  const sampleFiles = selectSampleFiles(index);

  // Read all sampled files from disk
  const allLines: string[] = [];
  const allContents: string[] = [];
  const fileLineCounts: number[] = [];

  for (const sample of sampleFiles) {
    const absPath = join(projectRoot, sample.path);
    try {
      const content = await readFile(absPath, "utf-8");
      const lines = content.split("\n");
      allContents.push(content);
      allLines.push(...lines);
      fileLineCounts.push(lines.length);
    } catch {
      // File might not exist (index stale) — skip
    }
  }

  // Also count lines for ALL files in the index for percentiles
  const allLineCounts = index.files.map((f) => countFileLines(index, f.path));
  allLineCounts.sort((a, b) => a - b);

  // Detect style attributes
  const indent = detectIndent(allLines);
  const singleQuoteRatio = detectQuoteRatio(allContents.join("\n"));
  const semicolonRatio = detectSemicolonRatio(allLines);
  const formatterConfigs = detectFormatterConfigs(projectRoot);

  // Trailing newline: average across all sampled files
  let trailingNewlineSum = 0;
  for (const content of allContents) {
    trailingNewlineSum += detectTrailingNewline(content);
  }
  const trailingNewlineRatio = allContents.length > 0 ? trailingNewlineSum / allContents.length : 0;

  // Svelte/Vue import outside script ratio
  let svelteOutsideSum = 0;
  let svelteFileCount = 0;
  for (const sample of sampleFiles) {
    const absPath = join(projectRoot, sample.path);
    try {
      const content = await readFile(absPath, "utf-8");
      const ratio = detectSvelteImportOutsideScript(sample.path, content);
      svelteOutsideSum += ratio;
      svelteFileCount++;
    } catch {
      // skip
    }
  }
  const svelteImportOutsideScriptRatio =
    svelteFileCount > 0 ? svelteOutsideSum / svelteFileCount : 0;

  // File line percentiles (from sampled files + all files)
  const sortedLineCounts = [...allLineCounts].sort((a, b) => a - b);
  const p50Index = Math.floor(sortedLineCounts.length * 0.5);
  const p95Index = Math.floor(sortedLineCounts.length * 0.95);
  const p50FileLines = sortedLineCounts[p50Index] ?? 0;
  const p95FileLines = sortedLineCounts[p95Index] ?? 0;
  const maxFileLines = sortedLineCounts[sortedLineCounts.length - 1] ?? 0;

  // Oversized files: top 10 files exceeding 500 lines
  const oversizedFiles = index.files
    .map((f) => ({
      path: f.path,
      lines: countFileLines(index, f.path),
    }))
    .filter((f) => f.lines > 500)
    .sort((a, b) => b.lines - a.lines)
    .slice(0, 10);

  return {
    indent,
    singleQuoteRatio,
    semicolonRatio,
    p50FileLines,
    p95FileLines,
    maxFileLines,
    trailingNewlineRatio,
    formatterConfigs,
    svelteImportOutsideScriptRatio,
    oversizedFiles,
  };
}
