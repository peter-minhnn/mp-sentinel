/**
 * Source Index Query Service
 *
 * Read-only queries against a SourceIndex: symbol search, import search,
 * and agent context packs. These functions return structured data — they
 * never write to stdout/stderr.
 */

import type { SourceIndex, SourceIndexFile, CodeSearchResult } from "../../types/index.js";

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
function tokenVariants(query: string): string[] {
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
 * Results are sorted by score descending, then by file path, and capped at 20.
 */
export function querySymbols(index: SourceIndex | null, query: string): SymbolResult[] {
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
  return results.slice(0, MAX_SYMBOL_RESULTS);
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
 * Results are sorted by score descending, then by file path, and capped at 20.
 */
export function queryImports(index: SourceIndex | null, query: string): ImportResult[] {
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
  return results.slice(0, MAX_IMPORT_RESULTS);
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
 * Results are sorted by score descending, then by file path, and capped at 20.
 */
export function queryCode(index: SourceIndex | null, query: string): CodeSearchResult[] {
  if (!index) return [];

  const lowerQuery = query.toLowerCase().trim();
  const normalizedQuery = lowerQuery.replace(/\s+/g, " ");
  const variants = tokenVariants(query);
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
  return results.slice(0, MAX_CODE_RESULTS);
}

// ── Agent Context Query ───────────────────────────────────────────────────────

const MAX_SYMBOLS = 30;
const MAX_IMPORTS = 20;
const MAX_EXPORTS = 20;
const MAX_DIRECT_IMPORTS = 10;
const MAX_DIRECT_DEPENDENTS = 10;
const MAX_HUB_FILES = 5;

interface FileInfo {
  path: string;
  language: string;
  role?: string;
  symbols: Array<{
    name: string;
    type: string;
    line: number;
    column: number;
    parent?: string;
  }>;
  symbolsTruncated: number;
  imports: Array<{
    source: string;
    kind: string;
    names: string[];
    line: number;
    typeOnly?: boolean;
  }>;
  importsTruncated: number;
  exports: Array<{
    kind: string;
    names: string[];
    line: number;
    source?: string;
    typeOnly?: boolean;
    isDefault?: boolean;
  }>;
  exportsTruncated: number;
  parseErrors?: number;
  parseErrorMessages?: string[];
  parserMode?: string;
  parseWarnings?: string[];
  chunkCount?: number;
  chunkSize?: number;
  chunkWarningCount?: number;
  chunkBoundaryWarningCount?: number;
  chunkActionableWarningCount?: number;
}

interface HubFileEntry {
  path: string;
  importedByCount: number;
}

export interface AgentContextResult {
  file: FileInfo | null;
  directImports: string[];
  directImportsTruncated: number;
  directDependents: string[];
  directDependentsTruncated: number;
  hubFiles: HubFileEntry[];
  hubFilesTruncated: number;
  suggestedCommands: string[];
  error?: string;
}

/**
 * Normalize a user-supplied file path for index lookup.
 *
 * - Converts backslashes to forward slashes (Windows tolerance)
 * - If projectRoot is provided and filePath is absolute, strips the
 *   projectRoot prefix to derive the relative path
 * - Strips leading slashes
 *
 * Returns a forward-slash relative path suitable for matching against
 * SourceIndexFile.path entries.
 */
function normalizePath(filePath: string, projectRoot?: string): string {
  let normalized = filePath.replace(/\\/g, "/");

  if (projectRoot) {
    const rootNorm = projectRoot.replace(/\\/g, "/");
    // Absolute Unix (/home/...) or Windows (C:/...)
    if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
      if (normalized.toLowerCase().startsWith(rootNorm.toLowerCase())) {
        normalized = normalized.slice(rootNorm.length);
      }
    }
  }

  return normalized.replace(/^\/+/, "");
}

/**
 * Build an AI-agent-friendly context pack for a given source file.
 *
 * Includes:
 * - File metadata (symbols, imports, exports — each capped)
 * - Direct imports/dependents (capped)
 * - Hub files among related files
 * - Suggested next diagnostic commands
 *
 * Returns an error string via `error` when the index is null or the file is not found.
 */
export function queryAgentContext(
  index: SourceIndex | null,
  filePath: string,
  projectRoot?: string,
): AgentContextResult {
  const emptyError = (msg: string): AgentContextResult => ({
    file: null,
    directImports: [],
    directImportsTruncated: 0,
    directDependents: [],
    directDependentsTruncated: 0,
    hubFiles: [],
    hubFilesTruncated: 0,
    suggestedCommands: [],
    error: msg,
  });

  if (!index) return emptyError("No index available");

  const normalizedPath = normalizePath(filePath, projectRoot);

  const file =
    index.files.find((f) => f.path === normalizedPath) ??
    index.files.find((f) => f.path === filePath);

  if (!file) return emptyError(`File not found in index: ${filePath}`);

  const fileInfo: FileInfo = {
    path: file.path,
    language: file.language,
    ...(file.role && { role: file.role }),
    symbols: file.symbols.slice(0, MAX_SYMBOLS).map((s) => ({
      name: s.name,
      type: s.type,
      line: s.line,
      column: s.column,
      ...(s.parent && { parent: s.parent }),
    })),
    symbolsTruncated: file.symbols.length > MAX_SYMBOLS ? file.symbols.length - MAX_SYMBOLS : 0,
    imports: file.imports.slice(0, MAX_IMPORTS).map((imp) => ({
      source: imp.source,
      kind: imp.kind,
      names: imp.names,
      line: imp.line,
      ...(imp.typeOnly && { typeOnly: imp.typeOnly }),
    })),
    importsTruncated: file.imports.length > MAX_IMPORTS ? file.imports.length - MAX_IMPORTS : 0,
    exports: file.exports.slice(0, MAX_EXPORTS).map((exp) => ({
      kind: exp.kind,
      names: exp.names,
      line: exp.line,
      ...(exp.source && { source: exp.source }),
      ...(exp.typeOnly && { typeOnly: exp.typeOnly }),
      ...(exp.isDefault && { isDefault: exp.isDefault }),
    })),
    exportsTruncated: file.exports.length > MAX_EXPORTS ? file.exports.length - MAX_EXPORTS : 0,
    ...getParserTelemetry(file, { agentContext: true }),
  };

  const importsFrom = file.importsFrom ?? [];
  const importedBy = file.importedBy ?? [];

  const directImports = importsFrom.slice(0, MAX_DIRECT_IMPORTS);
  const directImportsTruncated =
    importsFrom.length > MAX_DIRECT_IMPORTS ? importsFrom.length - MAX_DIRECT_IMPORTS : 0;

  const directDependents = importedBy.slice(0, MAX_DIRECT_DEPENDENTS);
  const directDependentsTruncated =
    importedBy.length > MAX_DIRECT_DEPENDENTS ? importedBy.length - MAX_DIRECT_DEPENDENTS : 0;

  // Hub files among related paths
  const relatedPaths = new Set([...importsFrom, ...importedBy]);
  const hubCandidates: HubFileEntry[] = [];
  for (const relatedPath of relatedPaths) {
    const relatedFile = index.files.find((f) => f.path === relatedPath);
    if (relatedFile && (relatedFile.importedBy?.length ?? 0) > 1) {
      hubCandidates.push({
        path: relatedPath,
        importedByCount: relatedFile.importedBy!.length,
      });
    }
  }
  hubCandidates.sort((a, b) => b.importedByCount - a.importedByCount);
  const hubFiles = hubCandidates.slice(0, MAX_HUB_FILES);
  const hubFilesTruncated =
    hubCandidates.length > MAX_HUB_FILES ? hubCandidates.length - MAX_HUB_FILES : 0;

  // Suggested diagnostic commands
  const suggestedCommands: string[] = [];

  const prioritySymbols = file.symbols
    .filter((s) => ["function", "class", "interface", "type"].includes(s.type))
    .slice(0, 3);
  for (const sym of prioritySymbols) {
    suggestedCommands.push(
      `mp-sentinel indexing --find-symbol ${quoteCliArg(sym.name)} --index-format json`,
    );
  }

  const externalImportSources = [
    ...new Set(
      file.imports
        .filter(
          (imp) =>
            !imp.source.startsWith(".") &&
            !imp.source.startsWith("/") &&
            !imp.source.startsWith("node:"),
        )
        .map((imp) => imp.source),
    ),
  ].slice(0, 3);
  for (const pkg of externalImportSources) {
    suggestedCommands.push(
      `mp-sentinel indexing --find-import ${quoteCliArg(pkg)} --index-format json`,
    );
  }

  for (const relatedPath of directImports.slice(0, 3)) {
    suggestedCommands.push(
      `mp-sentinel indexing --agent-context ${quoteCliArg(relatedPath)} --index-format json`,
    );
  }

  for (const relatedPath of directDependents.slice(0, 3)) {
    suggestedCommands.push(
      `mp-sentinel indexing --agent-context ${quoteCliArg(relatedPath)} --index-format json`,
    );
  }

  const uniqueCommands = [...new Set(suggestedCommands)];

  return {
    file: fileInfo,
    directImports,
    directImportsTruncated,
    directDependents,
    directDependentsTruncated,
    hubFiles,
    hubFilesTruncated,
    suggestedCommands: uniqueCommands,
  };
}
