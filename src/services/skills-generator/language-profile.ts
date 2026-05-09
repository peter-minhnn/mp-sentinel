/**
 * LanguageProfile detection — identifies the language mix of a codebase.
 *
 * Walks the same file list the source index walks and groups by extension,
 * producing a LanguageProfile that covers both indexable (TS/JS) and
 * non-indexable (Svelte, Vue, Python, Go, etc.) files.
 *
 * Pure deterministic, no AI calls. No tree-sitter required.
 */

import { relative, resolve } from "node:path";
import type { LanguageProfile, SourceIndex } from "../../types/index.js";
export type { LanguageProfile };

// ── Extension-to-language mapping ───────────────────────────────────────────

/**
 * Map a file extension to a human-readable language name.
 * Covers all extensions from the file-handler allowlist plus common ones.
 */
export function extensionToLanguageName(ext: string): string | null {
  const mapping: Record<string, string> = {
    // JavaScript / TypeScript
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    mjs: "javascript",
    cjs: "javascript",
    mts: "typescript",
    cts: "typescript",
    // Config / data
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    // Python
    py: "python",
    pyi: "python",
    // Go
    go: "go",
    // Rust
    rs: "rust",
    // C / C++
    c: "c",
    h: "c",
    cpp: "cpp",
    hpp: "cpp",
    cc: "cpp",
    hh: "cpp",
    cxx: "cpp",
    // Java / Kotlin
    java: "java",
    kt: "kotlin",
    kts: "kotlin",
    // C#
    cs: "csharp",
    // Ruby
    rb: "ruby",
    // PHP
    php: "php",
    // Swift
    swift: "swift",
    // Shell
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    // Dart / Flutter
    dart: "dart",
    // Elixir / Erlang
    ex: "elixir",
    exs: "elixir",
    erl: "erlang",
    // Scala
    scala: "scala",
    // Lua
    lua: "lua",
    // SQL
    sql: "sql",
    // Markdown / documentation
    md: "markdown",
    mdx: "markdown",
    // HTML / CSS
    html: "html",
    htm: "html",
    css: "css",
    scss: "scss",
    sass: "scss",
    less: "less",
    // Vue / Svelte
    vue: "vue",
    svelte: "svelte",
    // GraphQL / Protobuf
    graphql: "graphql",
    gql: "graphql",
    proto: "protobuf",
    // Terraform / HCL
    tf: "terraform",
    hcl: "terraform",
  };

  const normalized = ext.toLowerCase().replace(/^\./, "");
  return mapping[normalized] ?? null;
}

// ── Indexable-language check ────────────────────────────────────────────────

const INDEXABLE_LANGUAGES = new Set(["typescript", "tsx", "javascript", "jsx"]);

function isIndexable(lang: string): boolean {
  return INDEXABLE_LANGUAGES.has(lang);
}

// ── Detect language from a file path ────────────────────────────────────────

function detectLanguage(filePath: string): string | null {
  // Handle dotfiles: .env, .gitignore — these have no traditional extension
  const basename = filePath.split("/").pop() ?? "";
  const dotIndex = basename.lastIndexOf(".");
  if (dotIndex <= 0) return null;

  // Get the last extension (handles .spec.ts, .test.tsx, etc.)
  const parts = basename.split(".");
  if (parts.length < 2) return null;

  // Try the last part first (e.g. "ts" from "foo.test.ts")
  const lastExt = parts[parts.length - 1]!;
  const langFromLast = extensionToLanguageName(lastExt);
  if (langFromLast) return langFromLast;

  // Try the second-to-last (e.g. "svelte" from "foo.svelte" — but svelte is already covered above)
  if (parts.length >= 2) {
    const secondLast = parts[parts.length - 2]!;
    const langFromSecond = extensionToLanguageName(secondLast);
    if (langFromSecond) return langFromSecond;
  }

  return null;
}

// ── Non-indexable hotspots ──────────────────────────────────────────────────

const NON_INDEXABLE_EXTS = new Set([
  "svelte",
  "vue",
  "py",
  "go",
  "rs",
  "java",
  "kt",
  "cs",
  "rb",
  "php",
  "swift",
  "dart",
]);

/**
 * Extract the top directory from a file path.
 */
function topDir(filePath: string): string {
  const slash = filePath.indexOf("/");
  return slash === -1 ? "(root)" : filePath.slice(0, slash);
}

/**
 * Find top directories that hold non-indexable language files.
 * Returns sorted list of "dir/lang" strings for the top hotspots.
 */
function findNonIndexableHotspots(distribution: Record<string, number>, files: string[]): string[] {
  // Only compute hotspots when non-indexable languages are present
  const hasNonIndexable = Object.keys(distribution).some(
    (lang) =>
      !isIndexable(lang) &&
      lang !== "json" &&
      lang !== "yaml" &&
      lang !== "toml" &&
      lang !== "markdown",
  );
  if (!hasNonIndexable) return [];

  // Count non-indexable files per directory
  const dirCounts = new Map<string, Map<string, number>>();

  for (const file of files) {
    const lang = detectLanguage(file);
    if (!lang || isIndexable(lang)) continue;
    // Skip data/config/doc files
    if (lang === "json" || lang === "yaml" || lang === "toml" || lang === "markdown") continue;
    if (!NON_INDEXABLE_EXTS.has(lang)) continue;

    const dir = topDir(file);
    if (!dirCounts.has(dir)) {
      dirCounts.set(dir, new Map());
    }
    const langCounts = dirCounts.get(dir)!;
    langCounts.set(lang, (langCounts.get(lang) ?? 0) + 1);
  }

  // Build sorted result: "dir/lang" strings sorted by total count descending
  const entries: Array<{ dir: string; total: number; label: string }> = [];
  for (const [dir, langCounts] of dirCounts) {
    for (const [lang, count] of langCounts) {
      entries.push({ dir, total: count, label: `${dir}/${lang}` });
    }
  }

  entries.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  return entries.slice(0, 10).map((e) => e.label);
}

// ── Main detection function ─────────────────────────────────────────────────

/**
 * Detect the LanguageProfile from a SourceIndex or a raw file list.
 *
 * Can be called with either:
 * - A SourceIndex (uses `index.files` to get file paths)
 * - A list of file paths
 *
 * Returns a complete LanguageProfile with distribution and hotspot data.
 */
export function detectLanguageProfile(indexOrFiles: SourceIndex | string[]): LanguageProfile {
  const files: string[] = Array.isArray(indexOrFiles)
    ? indexOrFiles
    : indexOrFiles.files.map((f) => f.path);

  if (files.length === 0) {
    return {
      dominant: "unknown",
      secondary: [],
      distribution: {},
      indexableShare: 0,
      nonIndexableHotspots: [],
    };
  }

  // Count languages
  const counts = new Map<string, number>();
  for (const file of files) {
    const lang = detectLanguage(file);
    if (lang) {
      counts.set(lang, (counts.get(lang) ?? 0) + 1);
    }
  }

  // Build distribution (sorted by count desc, then name asc)
  const distribution: Record<string, number> = {};
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [lang, count] of sorted) {
    distribution[lang] = count;
  }

  // Dominant
  const dominant = sorted.length > 0 ? sorted[0]![0] : "unknown";

  // Secondary (non-zero, non-dominant)
  const secondary = sorted.filter(([lang]) => lang !== dominant).map(([lang]) => lang);

  // Indexable share
  const indexableCount = sorted
    .filter(([lang]) => isIndexable(lang))
    .reduce((sum, [, count]) => sum + count, 0);
  const indexableShare = files.length > 0 ? indexableCount / files.length : 0;

  // Non-indexable hotspots
  const nonIndexableHotspots = findNonIndexableHotspots(distribution, files);

  return {
    dominant,
    secondary,
    distribution,
    indexableShare,
    nonIndexableHotspots,
  };
}
