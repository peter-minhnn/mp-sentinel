/**
 * Source Index Query Service
 *
 * Read-only queries against a SourceIndex: symbol search, import search,
 * and agent context packs. These functions return structured data — they
 * never write to stdout/stderr.
 */

import type { SourceIndex, SourceIndexFile } from "../../types/index.js";

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
  parserMode?: string;
  parseWarnings?: string[];
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
    ...(file.parseErrors &&
      file.parseErrors.length > 0 && { parseErrors: file.parseErrors.length }),
    ...(file.parserMode && file.parserMode !== "tree-sitter" && { parserMode: file.parserMode }),
    ...(file.parseWarnings &&
      file.parseWarnings.length > 0 && { parseWarnings: file.parseWarnings }),
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
