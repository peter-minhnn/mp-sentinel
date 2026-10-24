/**
 * Source Index Query Service
 *
 * Read-only queries against a SourceIndex: symbol search, import search,
 * and agent context packs. These functions return structured data — they
 * never write to stdout/stderr.
 */

import type { SourceIndex, SourceIndexFile, CodeSearchResult } from "../../types/index.js";
import { SystemError } from "../../utils/errors.js";

// ── Shared Serializer ─────────────────────────────────────────────────────────

export interface ParserTelemetryOptions {
  /**
   * When true, emit parseErrors as a count and parseErrorMessages as the full
   * string array (used by --agent-context). When false/omitted, emit parseErrors
   * as the string array directly (used by all other command outputs).
   */
  agentContext?: boolean;
}

/**
 * Build a compact parser-telemetry object for a single source file.
 *
 * - Omits parserMode when it is "tree-sitter" or absent (default parser).
 * - Omits parseWarnings / parseErrors when empty.
 * - Includes chunk fields only for chunked-tree-sitter files that have them.
 * - In agentContext mode, parseErrors is a count and parseErrorMessages carries
 *   the full array.
 *
 * Returns an empty object when there is nothing to report beyond normal tree-sitter.
 */
export function getParserTelemetry(
  file: Pick<
    SourceIndexFile,
    | "parserMode"
    | "parseWarnings"
    | "parseErrors"
    | "chunkCount"
    | "chunkSize"
    | "chunkWarningCount"
    | "chunkBoundaryWarningCount"
    | "chunkActionableWarningCount"
  >,
  options?: ParserTelemetryOptions,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (file.parserMode && file.parserMode !== "tree-sitter") {
    result.parserMode = file.parserMode;
  }

  if (file.parseWarnings && file.parseWarnings.length > 0) {
    result.parseWarnings = file.parseWarnings;
  }

  if (file.parseErrors && file.parseErrors.length > 0) {
    if (options?.agentContext) {
      result.parseErrors = file.parseErrors.length;
      result.parseErrorMessages = file.parseErrors;
    } else {
      result.parseErrors = file.parseErrors;
    }
  }

  if (
    file.parserMode === "chunked-tree-sitter" &&
    file.chunkCount !== undefined &&
    file.chunkSize !== undefined &&
    file.chunkWarningCount !== undefined
  ) {
    result.chunkCount = file.chunkCount;
    result.chunkSize = file.chunkSize;
    result.chunkWarningCount = file.chunkWarningCount;
    if (file.chunkBoundaryWarningCount !== undefined) {
      result.chunkBoundaryWarningCount = file.chunkBoundaryWarningCount;
    }
    if (file.chunkActionableWarningCount !== undefined) {
      result.chunkActionableWarningCount = file.chunkActionableWarningCount;
    }
  }

  return result;
}

// ── Shared CLI Formatting ──────────────────────────────────────────────────────

/**
 * Format a string value for safe CLI double-quoted argument usage.
 *
 * - Normalizes backslashes to forward slashes
 * - Escapes embedded double quotes
 * - Wraps in double quotes
 */
export function quoteCliArg(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const escaped = normalized.replace(/"/g, '\\"');
  return `"${escaped}"`;
}

// ── Token Normalization Helpers ───────────────────────────────────────────────

/**
 * Normalize a query for fuzzy code/symbol matching.
 *
 * Turns space-separated tokens into common code naming conventions:
 * - "build source index" → "buildSourceIndex" (camelCase)
 * - "build source index" → "BuildSourceIndex" (PascalCase)
 * - "build source index" → "build_source_index" (snake_case)
 * - "build source index" → "buildsourceindex" (concatenated lowercase)
 */
export function tokenVariants(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed.includes(" ")) return [];

  const parts = trimmed.split(/\s+/);
  const camel =
    parts[0]!.toLowerCase() +
    parts
      .slice(1)
      .map((p) => p[0]!.toUpperCase() + p.slice(1).toLowerCase())
      .join("");
  const pascal = parts.map((p) => p[0]!.toUpperCase() + p.slice(1).toLowerCase()).join("");
  const snake = parts.map((p) => p.toLowerCase()).join("_");
  const concat = parts.map((p) => p.toLowerCase()).join("");

  return [...new Set([camel, pascal, snake, concat])];
}

// ── Symbol Query ──────────────────────────────────────────────────────────────

const MAX_SYMBOL_RESULTS = 20;

export interface SymbolResult {
  file: string;
  language: string;
  symbol: {
    name: string;
    type: string;
    line: number;
    column: number;
    parent?: string;
  };
  score: number;
  reason: string;
}

/**
 * Search the source index for symbols matching the query.
 *
 * Scoring:
 * - Exact name match: 100
 * - Case-insensitive exact: 90
 * - Name starts with query: 70
 * - Name contains query: 50
 *
 * Results are sorted by score descending, then by file path, and capped at
 * `limit` (default 20).
 */
export function querySymbols(
  index: SourceIndex | null,
  query: string,
  limit: number = MAX_SYMBOL_RESULTS,
): SymbolResult[] {
  if (!index) return [];

  const lowerQuery = query.toLowerCase();
  const variants = tokenVariants(query);
  const results: SymbolResult[] = [];

  for (const file of index.files) {
    for (const sym of file.symbols) {
      const lowerName = sym.name.toLowerCase();
      let score = 0;
      let reason = "";

      if (sym.name === query) {
        score = 100;
        reason = "exact name match";
      } else if (lowerName === lowerQuery) {
        score = 90;
        reason = "case-insensitive name match";
      } else if (lowerName.startsWith(lowerQuery)) {
        score = 70;
        reason = "name starts with query";
      } else if (lowerName.includes(lowerQuery)) {
        score = 50;
        reason = "name contains query";
      } else if (variants.some((v) => sym.name === v)) {
        score = 60;
        reason = "token-normalized name match";
      } else if (variants.some((v) => lowerName === v.toLowerCase())) {
        score = 55;
        reason = "case-insensitive token-normalized name match";
      }

      if (score > 0) {
        results.push({
          file: file.path,
          language: file.language,
          symbol: {
            name: sym.name,
            type: sym.type,
            line: sym.line,
            column: sym.column,
            ...(sym.parent && { parent: sym.parent }),
          },
          score,
          reason,
        });
      }
    }
  }

  results.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  return results.slice(0, Math.max(1, limit));
}

// ── Import Query ──────────────────────────────────────────────────────────────

const MAX_IMPORT_RESULTS = 20;

export interface ImportResult {
  file: string;
  language: string;
  importInfo: {
    source: string;
    kind: string;
    names: string[];
    line: number;
    typeOnly?: boolean;
  };
  score: number;
  reason: string;
}

/**
 * Search the source index for files importing a package or path.
 *
 * Scoring:
 * - Exact package/path match: 100
 * - Case-insensitive source match: 90
 * - Source contains query: 70
 * - Imported name matches query: 60
 *
 * Results are sorted by score descending, then by file path, and capped at
 * `limit` (default 20).
 */
export function queryImports(
  index: SourceIndex | null,
  query: string,
  limit: number = MAX_IMPORT_RESULTS,
): ImportResult[] {
  if (!index) return [];

  const lowerQuery = query.toLowerCase();
  const results: ImportResult[] = [];

  for (const file of index.files) {
    for (const imp of file.imports) {
      const lowerSource = imp.source.toLowerCase();
      let score = 0;
      let reason = "";

      if (imp.source === query) {
        score = 100;
        reason = "exact source match";
      } else if (lowerSource === lowerQuery) {
        score = 90;
        reason = "case-insensitive source match";
      } else if (lowerSource.includes(lowerQuery)) {
        score = 70;
        reason = "source contains query";
      } else if (imp.names.some((n) => n.toLowerCase().includes(lowerQuery))) {
        score = 60;
        reason = "imported name matches query";
      }

      if (score > 0) {
        results.push({
          file: file.path,
          language: file.language,
          importInfo: {
            source: imp.source,
            kind: imp.kind,
            names: imp.names,
            line: imp.line,
            ...(imp.typeOnly && { typeOnly: imp.typeOnly }),
          },
          score,
          reason,
        });
      }
    }
  }

  results.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  return results.slice(0, Math.max(1, limit));
}

// ── Code Search Query ───────────────────────────────────────────────────────────

const MAX_CODE_RESULTS = 20;

/**
 * Search indexed code snippets for text matching the query.
 *
 * Scoring:
 * - Exact snippet text match: 100
 * - Case-insensitive exact: 90
 * - Snippet contains query: 70
 * - Token-normalized match (e.g., "build source index" → "buildSourceIndex"): 60
 * - Whitespace-normalized match: 50
 *
 * Declaration identifier matches are boosted to at least 95 when the declared
 * identifier (extracted from declaration keywords) matches the query or a
 * token-normalized variant.
 *
 * Results are sorted by score descending, then by file path, and capped at
 * `limit` (default 20).
 */
interface PreparedCodeQuery {
  query: string;
  lowerQuery: string;
  normalizedQuery: string;
  variants: string[];
}

/** Precompute query variants shared across all scored entries. */
export function prepareCodeQuery(query: string): PreparedCodeQuery {
  const lowerQuery = query.toLowerCase().trim();
  return {
    query,
    lowerQuery,
    normalizedQuery: lowerQuery.replace(/\s+/g, " "),
    variants: tokenVariants(query),
  };
}

export function queryCode(
  index: SourceIndex | null,
  query: string,
  limit: number = MAX_CODE_RESULTS,
): CodeSearchResult[] {
  if (!index) return [];

  const { lowerQuery, normalizedQuery, variants } = prepareCodeQuery(query);
  const results: CodeSearchResult[] = [];

  for (const file of index.files) {
    if (!file.codeSearch) continue;
    for (const entry of file.codeSearch) {
      const lowerText = entry.text.toLowerCase();
      let score = 0;
      let reason = "";

      if (entry.text === query) {
        score = 100;
        reason = "exact text match";
      } else if (lowerText === lowerQuery) {
        score = 90;
        reason = "case-insensitive text match";
      } else if (lowerText.includes(lowerQuery)) {
        score = 70;
        reason = "text contains query";
      } else if (variants.some((v) => entry.text.includes(v))) {
        score = 60;
        reason = "token-normalized text match";
      } else if (lowerText.replace(/\s+/g, " ") === normalizedQuery) {
        score = 50;
        reason = "whitespace-normalized text match";
      }

      if (score > 0) {
        // Identifier-aware declaration detection: only boost when the declared
        // identifier (extracted from declaration keywords) matches the query or a
        // token-normalized variant. Also handle queries like "function buildSourceIndex"
        // by extracting the identifier from the query itself.
        const declRegex =
          /^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/;
        const declMatch = declRegex.exec(entry.text);
        const declaredId = declMatch && declMatch[1] ? declMatch[1].toLowerCase() : "";
        const queryDeclMatch = declRegex.exec(query.trim());
        const queryDeclaredId =
          queryDeclMatch && queryDeclMatch[1] ? queryDeclMatch[1].toLowerCase() : "";
        const isIdentifierDeclarationMatch =
          declaredId === lowerQuery ||
          (queryDeclaredId && declaredId === queryDeclaredId) ||
          variants.some((v) => declaredId === v.toLowerCase());

        if (isIdentifierDeclarationMatch) {
          score = Math.max(score, 95);
          reason += " (declaration match)";
        }

        results.push({
          file: file.path,
          language: file.language,
          entry,
          score,
          reason,
        });
      }
    }
  }

  results.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  return results.slice(0, Math.max(1, limit));
}

/**
 * Streaming code search for schema 1.5 light caches: scores entries as the
 * code sidecar is read line-by-line and keeps only a bounded top set in
 * memory (no full-index hydration). Falls back to inline payloads for
 * legacy/full caches via streamCodeEntries. Output shape and ranking are
 * identical to queryCode.
 */
export async function queryCodeStream(
  index: SourceIndex | null,
  cachePath: string,
  query: string,
  limit: number = MAX_CODE_RESULTS,
): Promise<CodeSearchResult[]> {
  if (!index) return [];

  const cap = Math.max(1, limit);

  // Inline payloads present (legacy cache, full mode, or already hydrated)
  if (!index.sidecars?.code || index.files.some((f) => f.codeSearch)) {
    return queryCode(index, query, cap);
  }

  const { streamCodeEntries } = await import("./storage.js");
  const languageByPath = new Map(index.files.map((f) => [f.path, f.language]));
  const scratch: SourceIndex = { ...index, files: [] };

  let results: CodeSearchResult[] = [];
  const BOUND = cap * 10;

  const streamed = await streamCodeEntries(index, cachePath, (path, entries) => {
    const language = languageByPath.get(path) ?? "unknown";
    scratch.files = [
      { path, language, codeSearch: entries } as unknown as SourceIndex["files"][number],
    ];
    for (const scored of queryCode(scratch, query, cap)) {
      results.push(scored);
    }
    // Bounded memory: periodically compact to the global top set
    if (results.length > BOUND) {
      results.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
      results = results.slice(0, cap);
    }
  });

  if (!streamed) {
    // streamCodeEntries may have visited rows before the failure. Discard
    // them — a partial hit list must not be reported as a successful query.
    throw new SystemError(
      "Code sidecar is missing or corrupt; refusing to return a partial code-search result. Re-run `mp-sentinel indexing` to rebuild.",
    );
  }

  results.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  return results.slice(0, cap);
}
