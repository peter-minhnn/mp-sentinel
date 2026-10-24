/**
 * Agent-context evidence for a single source file.
 *
 * Builds the per-file pack that `--agent-context` and MCP return: capped
 * symbols/imports/exports/calls, direct imports/dependents, hub files, and
 * textual incoming-call candidates. `queryAgentContext()` is the legacy
 * payload (fixed caps + suggested commands); the collectors and mappers are
 * shared with the compact packer in `agent-context-pack.ts`.
 */

import type { SourceIndex, SourceIndexFile } from "../../types/index.js";
import { getParserTelemetry, quoteCliArg } from "./query.js";

/**
 * Per-kind caps for agent context. Shared with the compact packer so a
 * budgeted capsule never exceeds the legacy list sizes either.
 */
export const AGENT_CONTEXT_CAPS = {
  symbols: 30,
  imports: 20,
  exports: 20,
  directImports: 10,
  directDependents: 10,
  hubFiles: 5,
  calls: 30,
  incomingCalls: 20,
} as const;

const MAX_SYMBOLS = AGENT_CONTEXT_CAPS.symbols;
const MAX_IMPORTS = AGENT_CONTEXT_CAPS.imports;
const MAX_EXPORTS = AGENT_CONTEXT_CAPS.exports;
const MAX_DIRECT_IMPORTS = AGENT_CONTEXT_CAPS.directImports;
const MAX_DIRECT_DEPENDENTS = AGENT_CONTEXT_CAPS.directDependents;
const MAX_HUB_FILES = AGENT_CONTEXT_CAPS.hubFiles;
const MAX_CALLS = AGENT_CONTEXT_CAPS.calls;
const MAX_INCOMING_CALLS = AGENT_CONTEXT_CAPS.incomingCalls;

export interface FileInfo {
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
  /** Outbound call edges (schema 1.4+; absent on older caches). */
  calls?: Array<{
    callee: string;
    line: number;
    column: number;
    inSymbol?: string;
  }>;
  callsTruncated?: number;
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

export interface HubFileEntry {
  path: string;
  importedByCount: number;
}

/**
 * An incoming call candidate -- a call site in another indexed file whose
 * textual callee matches a symbol defined in the requested file.
 *
 * "Candidate" because matching is textual (schema 1.4 records callee text,
 * not resolved symbol ids): a same-named function in an unrelated file
 * will also match. Agents should treat these as leads, not proof.
 */
export interface IncomingCallEntry {
  fromFile: string;
  callee: string;
  line: number;
  inSymbol?: string;
}

export interface AgentContextResult {
  file: FileInfo | null;
  directImports: string[];
  directImportsTruncated: number;
  directDependents: string[];
  directDependentsTruncated: number;
  hubFiles: HubFileEntry[];
  hubFilesTruncated: number;
  /** Call sites in other files that textually match this file's symbols (schema 1.4+). */
  incomingCalls: IncomingCallEntry[];
  incomingCallsTruncated: number;
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
export function normalizePath(filePath: string, projectRoot?: string): string {
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

/** Resolve a user-supplied path against the index (Windows/absolute tolerant). */
export function findIndexedFile(
  index: SourceIndex,
  filePath: string,
  projectRoot?: string,
): SourceIndexFile | undefined {
  const normalizedPath = normalizePath(filePath, projectRoot);
  return (
    index.files.find((f) => f.path === normalizedPath) ??
    index.files.find((f) => f.path === filePath)
  );
}

export function mapSymbolRecord(
  s: SourceIndexFile["symbols"][number],
): FileInfo["symbols"][number] {
  return {
    name: s.name,
    type: s.type,
    line: s.line,
    column: s.column,
    ...(s.parent && { parent: s.parent }),
  };
}

export function mapImportRecord(
  imp: SourceIndexFile["imports"][number],
): FileInfo["imports"][number] {
  return {
    source: imp.source,
    kind: imp.kind,
    names: imp.names,
    line: imp.line,
    ...(imp.typeOnly && { typeOnly: imp.typeOnly }),
  };
}

export function mapExportRecord(
  exp: SourceIndexFile["exports"][number],
): FileInfo["exports"][number] {
  return {
    kind: exp.kind,
    names: exp.names,
    line: exp.line,
    ...(exp.source && { source: exp.source }),
    ...(exp.typeOnly && { typeOnly: exp.typeOnly }),
    ...(exp.isDefault && { isDefault: exp.isDefault }),
  };
}

export function mapCallRecord(
  c: NonNullable<SourceIndexFile["calls"]>[number],
): NonNullable<FileInfo["calls"]>[number] {
  return {
    callee: c.callee,
    line: c.line,
    column: c.column,
    ...(c.inSymbol && { inSymbol: c.inSymbol }),
  };
}

/**
 * Hub candidates among a file's related paths (imports + dependents),
 * most-imported first. Uncapped -- callers slice.
 */
export function collectHubCandidates(index: SourceIndex, file: SourceIndexFile): HubFileEntry[] {
  const relatedPaths = new Set([...(file.importsFrom ?? []), ...(file.importedBy ?? [])]);
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
  return hubCandidates;
}

/**
 * Incoming call candidates (schema 1.4+): call sites elsewhere whose textual
 * callee matches a symbol defined in this file. Plain calls match `name`;
 * member calls match a trailing `.name` (e.g. `svc.start` matches symbol
 * `start`). Deterministic order: path, then line. Uncapped -- callers slice.
 */
export function collectIncomingCalls(
  index: SourceIndex,
  file: SourceIndexFile,
): IncomingCallEntry[] {
  const callableNames = new Set(
    file.symbols
      .filter((s) => ["function", "class", "method", "variable"].includes(s.type))
      .map((s) => s.name),
  );
  const incomingCandidates: IncomingCallEntry[] = [];
  if (callableNames.size === 0) return incomingCandidates;

  for (const other of index.files) {
    if (other.path === file.path || !other.calls) continue;
    for (const call of other.calls) {
      const dotIndex = call.callee.lastIndexOf(".");
      const tail = dotIndex === -1 ? call.callee : call.callee.slice(dotIndex + 1);
      if (callableNames.has(tail)) {
        incomingCandidates.push({
          fromFile: other.path,
          callee: call.callee,
          line: call.line,
          ...(call.inSymbol && { inSymbol: call.inSymbol }),
        });
      }
    }
  }
  incomingCandidates.sort((a, b) => a.fromFile.localeCompare(b.fromFile) || a.line - b.line);
  return incomingCandidates;
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
    incomingCalls: [],
    incomingCallsTruncated: 0,
    suggestedCommands: [],
    error: msg,
  });

  if (!index) return emptyError("No index available");

  const file = findIndexedFile(index, filePath, projectRoot);

  if (!file) return emptyError(`File not found in index: ${filePath}`);

  const fileInfo: FileInfo = {
    path: file.path,
    language: file.language,
    ...(file.role && { role: file.role }),
    symbols: file.symbols.slice(0, MAX_SYMBOLS).map(mapSymbolRecord),
    symbolsTruncated: file.symbols.length > MAX_SYMBOLS ? file.symbols.length - MAX_SYMBOLS : 0,
    imports: file.imports.slice(0, MAX_IMPORTS).map(mapImportRecord),
    importsTruncated: file.imports.length > MAX_IMPORTS ? file.imports.length - MAX_IMPORTS : 0,
    exports: file.exports.slice(0, MAX_EXPORTS).map(mapExportRecord),
    exportsTruncated: file.exports.length > MAX_EXPORTS ? file.exports.length - MAX_EXPORTS : 0,
    ...getParserTelemetry(file, { agentContext: true }),
  };

  // Outbound call edges (schema 1.4+). Older caches have no `calls` field --
  // omit rather than emit empty arrays so agents can distinguish "no data"
  // from "no calls".
  if (file.calls) {
    fileInfo.calls = file.calls.slice(0, MAX_CALLS).map(mapCallRecord);
    fileInfo.callsTruncated = file.calls.length > MAX_CALLS ? file.calls.length - MAX_CALLS : 0;
  }

  const importsFrom = file.importsFrom ?? [];
  const importedBy = file.importedBy ?? [];

  const directImports = importsFrom.slice(0, MAX_DIRECT_IMPORTS);
  const directImportsTruncated =
    importsFrom.length > MAX_DIRECT_IMPORTS ? importsFrom.length - MAX_DIRECT_IMPORTS : 0;

  const directDependents = importedBy.slice(0, MAX_DIRECT_DEPENDENTS);
  const directDependentsTruncated =
    importedBy.length > MAX_DIRECT_DEPENDENTS ? importedBy.length - MAX_DIRECT_DEPENDENTS : 0;

  // Hub files among related paths
  const hubCandidates = collectHubCandidates(index, file);
  const hubFiles = hubCandidates.slice(0, MAX_HUB_FILES);
  const hubFilesTruncated =
    hubCandidates.length > MAX_HUB_FILES ? hubCandidates.length - MAX_HUB_FILES : 0;

  // Incoming call candidates (schema 1.4+), capped after the shared collector.
  const incomingCandidates = collectIncomingCalls(index, file);
  const incomingCalls = incomingCandidates.slice(0, MAX_INCOMING_CALLS);
  const incomingCallsTruncated =
    incomingCandidates.length > MAX_INCOMING_CALLS
      ? incomingCandidates.length - MAX_INCOMING_CALLS
      : 0;

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
    incomingCalls,
    incomingCallsTruncated,
    suggestedCommands: uniqueCommands,
  };
}
