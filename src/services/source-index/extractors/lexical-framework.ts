/**
 * Universal Lexical Extractor Framework
 *
 * A small framework where each language registers regex patterns for
 * imports, exports, and top-level declarations. A new language gets
 * parsing support in ~50 lines without adding a tree-sitter grammar.
 *
 * Each extractor reports parserMode: "lexical-fallback" so --health
 * surfaces them. They are lossy (no nested scopes, no type info) but
 * enough to populate the import graph, hub-files, and module ownership.
 */

import type { ImportInfo, ExportInfo, SymbolInfo } from "../../../types/index.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface LexicalExtractor {
  /** Language identifier (e.g. "python", "go", "rust") */
  language: string;
  /** File extensions handled (e.g. ["py", "pyi"]) */
  extensions: string[];
  /**
   * Extract imports, exports, and symbols from file content.
   * Implementations should be pure functions — no side effects.
   */
  extract(content: string): {
    imports: ImportInfo[];
    exports: ExportInfo[];
    symbols: SymbolInfo[];
  };
}

// ── Registry ────────────────────────────────────────────────────────────────

const extractors = new Map<string, LexicalExtractor>();

/** Register an extractor. Called at module import time. */
export function registerExtractor(extractor: LexicalExtractor): void {
  for (const ext of extractor.extensions) {
    extractors.set(ext, extractor);
  }
}

/**
 * Get the language ID for a file extension, or null if not handled.
 * Used by isLexicallyExtractableLanguage.
 */
export function getLanguageForExtension(ext: string): string | null {
  return extractors.get(ext)?.language ?? null;
}

/**
 * Parse file content using the registered extractor for the given extension.
 * Returns empty results if no extractor matches.
 */
export function parseWithExtractor(
  ext: string,
  content: string,
): {
  imports: ImportInfo[];
  exports: ExportInfo[];
  symbols: SymbolInfo[];
} {
  const extractor = extractors.get(ext);
  if (!extractor) {
    return { imports: [], exports: [], symbols: [] };
  }
  return extractor.extract(content);
}

/**
 * Check if an extension is handled by any registered extractor.
 */
export function isLexicallyExtractable(ext: string): boolean {
  return extractors.has(ext);
}

/**
 * Get all registered extensions across all extractors.
 */
export function getAllLexicalExtensions(): string[] {
  return [...extractors.keys()];
}
