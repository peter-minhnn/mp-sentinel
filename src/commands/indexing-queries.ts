/**
 * Indexing Query Handlers
 *
 * Read-only query handlers for the indexing command. These are extracted
 * from the main indexing.ts to keep it manageable.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { log } from "../utils/logger.js";
import type {
  FileRole,
  IndexingConfig,
  ParserMode,
  SourceIndex,
  SourceIndexFile,
} from "../types/index.js";
import {
  querySymbols,
  queryImports,
  queryCode,
  queryCodeStream,
  queryAgentContext,
  quoteCliArg,
  getParserTelemetry,
} from "../services/source-index/query.js";
import { getSidecarStatus } from "../services/source-index/storage.js";
import {
  getRecoveredFileCount,
  getParserModeBreakdown,
  getChunkTelemetry,
} from "../services/source-index/diagnostics.js";

/**
 * Shared read-only cache loader for drilldown commands.
 * Returns the parsed index and the cache path, or writes error JSON and returns null.
 */
export async function loadReadOnlyIndex(
  projectRoot: string,
  indexingConfig: Required<
    Pick<IndexingConfig, "enabled" | "languages" | "cachePath" | "maxFileSize">
  >,
  format: "console" | "json",
): Promise<{ index: SourceIndex; cachePath: string } | null> {
  const cachePath = resolve(projectRoot, indexingConfig.cachePath);

  if (!existsSync(cachePath)) {
    if (format === "json") {
      console.log(JSON.stringify({ status: "missing" }, null, 2));
    }
    return null;
  }

  let raw: string;
  try {
    raw = await readFile(cachePath, "utf-8");
  } catch {
    if (format === "json") {
      console.log(JSON.stringify({ status: "unreadable" }, null, 2));
    }
    return null;
  }

  let index: SourceIndex;
  try {
    index = JSON.parse(raw) as SourceIndex;
  } catch {
    if (format === "json") {
      console.log(JSON.stringify({ status: "unreadable" }, null, 2));
    }
    return null;
  }

  return { index, cachePath };
}

interface DrilldownFileEntry {
  path: string;
  parserMode: ParserMode | "tree-sitter";
  parseWarnings?: string[];
  parseErrors?: string[];
  symbolCount: number;
  importCount: number;
  exportCount: number;
  role?: FileRole;
  suggestedCommands: string[];
  chunkCount?: number;
  chunkSize?: number;
  chunkWarningCount?: number;
  chunkBoundaryWarningCount?: number;
  chunkActionableWarningCount?: number;
}

const MAX_DRILLDOWN_FILES = 50;

/**
 * Handle --recovered option: list files recovered via fallback parser.
 */
export function handleRecovered(
  projectRoot: string,
  format: "console" | "json",
  indexingConfig: Required<
    Pick<IndexingConfig, "enabled" | "languages" | "cachePath" | "maxFileSize">
  >,
): Promise<number> {
  return handleDrilldown(projectRoot, format, indexingConfig, "recovered");
}

/**
 * Handle --parse-errors option: list files with hard parse errors.
 */
export function handleParseErrors(
  projectRoot: string,
  format: "console" | "json",
  indexingConfig: Required<
    Pick<IndexingConfig, "enabled" | "languages" | "cachePath" | "maxFileSize">
  >,
): Promise<number> {
  return handleDrilldown(projectRoot, format, indexingConfig, "parse-errors");
}

async function handleDrilldown(
  projectRoot: string,
  format: "console" | "json",
  indexingConfig: Required<
    Pick<IndexingConfig, "enabled" | "languages" | "cachePath" | "maxFileSize">
  >,
  mode: "recovered" | "parse-errors",
): Promise<number> {
  const loaded = await loadReadOnlyIndex(projectRoot, indexingConfig, format);
  if (!loaded) return 1;

  const { index } = loaded;

  const matches: SourceIndexFile[] =
    mode === "recovered"
      ? index.files.filter(
          (f) =>
            f.parserMode === "chunked-tree-sitter" ||
            f.parserMode === "ascii-fallback" ||
            f.parserMode === "lexical-fallback",
        )
      : index.files.filter((f) => f.parseErrors && f.parseErrors.length > 0);

  // Sort by path
  matches.sort((a, b) => a.path.localeCompare(b.path));

  const truncated = matches.length > MAX_DRILLDOWN_FILES;
  const capped = matches.slice(0, MAX_DRILLDOWN_FILES);

  const files: DrilldownFileEntry[] = capped.map((f) => ({
    path: f.path,
    parserMode: f.parserMode ?? "tree-sitter",
    symbolCount: f.symbols.length,
    importCount: f.imports.length,
    exportCount: f.exports.length,
    ...(f.role && { role: f.role }),
    ...getParserTelemetry(f),
    suggestedCommands: [
      `mp-sentinel indexing --explain-index ${quoteCliArg(f.path)} --index-format json`,
      `mp-sentinel indexing --agent-context ${quoteCliArg(f.path)} --index-format json`,
    ],
  }));

  if (mode === "recovered") {
    const recoveredFiles = getRecoveredFileCount(index);
    const parserModeBreakdown = getParserModeBreakdown(index);
    console.log(
      JSON.stringify(
        {
          status: "ok",
          totalFiles: index.files.length,
          recoveredFiles,
          parserModeBreakdown,
          files,
          truncated,
        },
        null,
        2,
      ),
    );
  } else {
    const parseErrorCount = index.files.filter(
      (f) => f.parseErrors && f.parseErrors.length > 0,
    ).length;
    console.log(
      JSON.stringify(
        {
          status: "ok",
          totalFiles: index.files.length,
          parseErrorCount,
          files,
          truncated,
        },
        null,
        2,
      ),
    );
  }

  return 0;
}

/**
 * Handle --explain-index option with import classification.
 */
export async function handleExplain(
  filePath: string,
  index: SourceIndex | null,
  format: "console" | "json",
  _projectRoot: string,
): Promise<number> {
  if (!index) {
    if (format === "json") {
      console.log(JSON.stringify({ error: "No index available" }, null, 2));
    } else {
      console.log("No index available. Run 'mp-sentinel indexing' first.");
    }
    return 1;
  }

  const normalizedPath =
    filePath.startsWith("/") || filePath.startsWith("\\")
      ? filePath.replace(/^[/\\]+/, "")
      : filePath;

  const file = index.files.find((f) => f.path === normalizedPath || f.path === filePath);

  if (!file) {
    if (format === "json") {
      console.log(JSON.stringify({ error: `File not found in index: ${filePath}` }, null, 2));
    } else {
      console.log(`File not found in index: ${filePath}`);
      console.log("\nIndexed files:");
      index.files.forEach((f) => console.log(`  ${f.path}`));
    }
    return 1;
  }

  const stripExt = (p: string): string => p.replace(/\.(ts|tsx|js|jsx|mjs|mts|cjs|cts)$/, "");

  const resolvedPaths = file.importsFrom ?? [];
  const resolvedNormSet = new Set(resolvedPaths.map((p) => stripExt(p)));

  const resolvedImports: string[] = [];
  const unresolvedImports: string[] = [];
  const externalImports: string[] = [];

  for (const imp of file.imports) {
    const source = imp.source;
    const isNodeBuiltin = source.startsWith("node:");
    const isUrl = source.startsWith("http://") || source.startsWith("https://");
    const isLocalLike = source.startsWith(".") || source.startsWith("/");

    if (!isLocalLike || isNodeBuiltin || isUrl) {
      externalImports.push(source);
      continue;
    }

    const fileDir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
    const joined = fileDir ? `${fileDir}/${source}` : source;
    const parts = joined.split("/");
    const resolved: string[] = [];
    for (const seg of parts) {
      if (seg === "..") {
        resolved.pop();
      } else if (seg !== "." && seg !== "") {
        resolved.push(seg);
      }
    }
    const normalized = stripExt(resolved.join("/"));

    if (resolvedNormSet.has(normalized)) {
      resolvedImports.push(source);
    } else {
      unresolvedImports.push(source);
    }
  }

  const info = {
    path: file.path,
    language: file.language,
    symbols: file.symbols,
    imports: file.imports,
    exports: file.exports,
    resolvedImports,
    unresolvedImports,
    externalImports,
    importsFrom: file.importsFrom,
    importedBy: file.importedBy,
    importedByCount: file.importedBy?.length ?? 0,
    exportedSymbols: file.exportedSymbols,
    role: file.role,
    ...getParserTelemetry(file),
  };

  if (format === "json") {
    console.log(JSON.stringify(info, null, 2));
  } else {
    console.log();
    log.header(`Dependency Info: ${file.path}`);
    console.log(`  Language: ${file.language}`);
    if (file.role) {
      console.log(`  Role: ${file.role}`);
    }
    if (file.parserMode && file.parserMode !== "tree-sitter") {
      console.log(`  Parser mode: ${file.parserMode}`);
    }
    if (file.parseWarnings && file.parseWarnings.length > 0) {
      console.log(`  Parse warnings (${file.parseWarnings.length}):`);
      file.parseWarnings.slice(0, 5).forEach((w) => console.log(`    - ${w}`));
      if (file.parseWarnings.length > 5) {
        console.log(`    ... and ${file.parseWarnings.length - 5} more`);
      }
    }
    if (file.parserMode === "chunked-tree-sitter" && file.chunkCount !== undefined) {
      console.log(
        `  Chunked: ${file.chunkCount} chunks @ ${file.chunkSize} bytes/chunk, ${file.chunkWarningCount ?? 0} warnings (${file.chunkBoundaryWarningCount ?? 0} boundary, ${file.chunkActionableWarningCount ?? 0} actionable)`,
      );
    }

    if (resolvedImports.length > 0) {
      console.log(`\n  Resolved internal imports (${resolvedImports.length}):`);
      resolvedImports.forEach((p) => console.log(`    - ${p}`));
    }

    if (unresolvedImports.length > 0) {
      console.log(`\n  Unresolved local imports (${unresolvedImports.length}):`);
      unresolvedImports.forEach((p) => console.log(`    - ${p}`));
    }

    if (externalImports.length > 0) {
      console.log(`\n  External imports (${externalImports.length}):`);
      externalImports.forEach((p) => console.log(`    - ${p}`));
    }

    if (file.importedBy && file.importedBy.length > 0) {
      console.log(`\n  Imported by (${file.importedBy.length}):`);
      file.importedBy.forEach((p) => console.log(`    - ${p}`));
    }

    if (file.symbols.length > 0) {
      console.log(`\n  Symbols (${file.symbols.length}):`);
      file.symbols.slice(0, 20).forEach((s) => {
        console.log(`    ${s.type} ${s.name}${s.parent ? ` (in ${s.parent})` : ""}`);
      });
      if (file.symbols.length > 20) {
        console.log(`    ... and ${file.symbols.length - 20} more`);
      }
    }

    if (file.exportedSymbols && file.exportedSymbols.length > 0) {
      console.log(`\n  Exported symbols:`);
      file.exportedSymbols.slice(0, 20).forEach((e) => console.log(`    - ${e}`));
      if (file.exportedSymbols.length > 20) {
        console.log(`    ... and ${file.exportedSymbols.length - 20} more`);
      }
    }

    if (file.parseErrors && file.parseErrors.length > 0) {
      console.log(`\n  Parse errors (${file.parseErrors.length}):`);
      file.parseErrors.slice(0, 10).forEach((e) => console.log(`    - ${e}`));
      if (file.parseErrors.length > 10) {
        console.log(`    ... and ${file.parseErrors.length - 10} more`);
      }
    }

    console.log();
  }

  return 0;
}

/**
 * Handle --stats option
 */
export async function handleStats(
  index: SourceIndex | null,
  format: "console" | "json",
  cachePath: string,
): Promise<number> {
  if (!index) {
    if (format === "json") {
      console.log(JSON.stringify({ error: "No index available" }, null, 2));
    } else {
      console.log("No index available");
    }
    return 1;
  }

  const recoveredFiles = getRecoveredFileCount(index);
  const parserModeBreakdown = getParserModeBreakdown(index);
  const chunkTelemetry = getChunkTelemetry(index);
  const sidecarStatus = await getSidecarStatus(index, cachePath);

  const stats = {
    totalFiles: index.stats.totalFiles,
    indexedFiles: index.stats.indexedFiles,
    skippedFiles: index.stats.skippedFiles,
    parseErrors: index.stats.parseErrors,
    recoveredFiles,
    parserModeBreakdown,
    ...(chunkTelemetry && chunkTelemetry),
    durationMs: index.stats.durationMs,
    importEdges: index.stats.importEdges,
    graphEnabled: index.files.some((f) => f.importsFrom || f.importedBy),
    schemaVersion: index.schemaVersion,
    cacheMode: sidecarStatus.cacheMode,
    sidecarsPresent: sidecarStatus.sidecarsPresent,
    sidecarsValid: sidecarStatus.sidecarsValid,
    coreBytes: sidecarStatus.coreBytes,
    sidecarBytes: sidecarStatus.sidecarBytes,
    insights: index.insights
      ? {
          fileRoles: Object.keys(index.insights.fileRoles).length,
          publicApiFiles: index.insights.publicApiFiles.length,
          testAssociations: Object.keys(index.insights.testMap).length,
          commandMap: Object.keys(index.insights.commandMap).length,
          dependencyUsage: Object.keys(index.insights.dependencyUsage).length,
          defaultExportFiles: index.insights.defaultExportFiles.length,
          reExportFiles: index.insights.reExportFiles.length,
          typeOnlyImportFiles: index.insights.typeOnlyImportFiles.length,
          dynamicImportFiles: index.insights.dynamicImportFiles.length,
          hubFileCount: index.files.filter((f) => (f.importedBy?.length ?? 0) > 1).length,
        }
      : undefined,
  };

  if (format === "json") {
    console.log(JSON.stringify(stats, null, 2));
  } else {
    console.log();
    log.header("Index Statistics");
    console.log(`  Total files:      ${stats.totalFiles}`);
    console.log(`  Indexed files:    ${stats.indexedFiles}`);
    console.log(`  Skipped files:    ${stats.skippedFiles}`);
    console.log(`  Parse errors:     ${stats.parseErrors}`);
    console.log(`  Recovered files:   ${recoveredFiles}`);
    if (
      parserModeBreakdown["chunked-tree-sitter"] ||
      parserModeBreakdown["ascii-fallback"] ||
      parserModeBreakdown["lexical-fallback"]
    ) {
      console.log(
        `  Parser breakdown:  tree-sitter=${parserModeBreakdown["tree-sitter"]}, chunked-tree-sitter=${parserModeBreakdown["chunked-tree-sitter"]}, ascii-fallback=${parserModeBreakdown["ascii-fallback"]}, lexical-fallback=${parserModeBreakdown["lexical-fallback"]}`,
      );
    }
    if (chunkTelemetry) {
      console.log(
        `  Chunks:           ${chunkTelemetry.chunkedFiles} files, ${chunkTelemetry.totalChunks} chunks @ ${chunkTelemetry.chunkSize} bytes/chunk, ${chunkTelemetry.totalChunkWarnings} warnings (${chunkTelemetry.totalChunkBoundaryWarnings} boundary, ${chunkTelemetry.totalChunkActionableWarnings} actionable)`,
      );
    }
    console.log(`  Import edges:     ${stats.importEdges ?? "N/A"}`);
    console.log(`  Graph enabled:    ${stats.graphEnabled ? "yes" : "no"}`);
    console.log(`  Schema version:   ${stats.schemaVersion}`);
    if (stats.insights) {
      console.log(`  File roles:        ${stats.insights.fileRoles}`);
      console.log(`  Public APIs:       ${stats.insights.publicApiFiles}`);
      console.log(`  Test associations:  ${stats.insights.testAssociations}`);
      console.log(`  Script categories:  ${stats.insights.commandMap}`);
      console.log(`  Dependencies used:  ${stats.insights.dependencyUsage}`);
      console.log(`  Default exports:    ${stats.insights.defaultExportFiles}`);
      console.log(`  Re-exports:         ${stats.insights.reExportFiles}`);
      console.log(`  Type-only imports:  ${stats.insights.typeOnlyImportFiles}`);
      console.log(`  Dynamic imports:    ${stats.insights.dynamicImportFiles}`);
      console.log(`  Hub files:          ${stats.insights.hubFileCount}`);
    }
    console.log(`  Duration:         ${(stats.durationMs ?? 0).toFixed(0)}ms`);
    console.log();
  }

  return 0;
}

/**
 * Handle --find-symbol query
 */
export function handleFindSymbol(
  query: string,
  index: SourceIndex | null,
  format: "console" | "json",
): number {
  const results = querySymbols(index, query);

  if (!index) {
    if (format === "json") {
      console.log(JSON.stringify({ query, results: [] }));
    } else {
      console.log(`No index available. Run 'mp-sentinel indexing' first.`);
    }
    return 0;
  }

  if (format === "json") {
    console.log(JSON.stringify({ query, results }, null, 2));
  } else {
    console.log();
    if (results.length === 0) {
      console.log(`No symbols found matching "${query}".`);
    } else {
      console.log(`Symbols matching "${query}" (${results.length} results):`);
      for (const r of results) {
        const detail =
          `${r.symbol.type} ${r.symbol.name}` + (r.symbol.parent ? ` (in ${r.symbol.parent})` : "");
        console.log(`  ${r.file}:${r.symbol.line}  ${detail}  [score=${r.score}, ${r.reason}]`);
      }
    }
    console.log();
  }

  return 0;
}

/**
 * Handle --find-import query
 */
export function handleFindImport(
  query: string,
  index: SourceIndex | null,
  format: "console" | "json",
): number {
  const results = queryImports(index, query);

  if (!index) {
    if (format === "json") {
      console.log(JSON.stringify({ query, results: [] }));
    } else {
      console.log(`No index available. Run 'mp-sentinel indexing' first.`);
    }
    return 0;
  }

  if (format === "json") {
    console.log(JSON.stringify({ query, results }, null, 2));
  } else {
    console.log();
    if (results.length === 0) {
      console.log(`No imports found matching "${query}".`);
    } else {
      console.log(`Imports matching "${query}" (${results.length} results):`);
      for (const r of results) {
        const kindTag = r.importInfo.kind !== "named" ? `[${r.importInfo.kind}] ` : "";
        const nameStr = r.importInfo.names.length > 0 ? ` (${r.importInfo.names.join(", ")})` : "";
        console.log(
          `  ${r.file}:${r.importInfo.line}  ${kindTag}"${r.importInfo.source}"${nameStr}  [score=${r.score}, ${r.reason}]`,
        );
      }
    }
    console.log();
  }

  return 0;
}

/**
 * Handle --find-code query
 */
export async function handleFindCode(
  query: string,
  index: SourceIndex | null,
  format: "console" | "json",
  cachePath: string,
): Promise<number> {
  // Streams the code sidecar for light caches (bounded memory); legacy and
  // full-mode caches score inline payloads. Same ranking either way.
  const results = await queryCodeStream(index, cachePath, query);

  if (!index) {
    if (format === "json") {
      console.log(JSON.stringify({ query, results: [] }));
    } else {
      console.log(`No index available. Run 'mp-sentinel indexing' first.`);
    }
    return 0;
  }

  if (format === "json") {
    console.log(JSON.stringify({ query, results }, null, 2));
  } else {
    console.log();
    if (results.length === 0) {
      console.log(`No code snippets found matching "${query}".`);
    } else {
      console.log(`Code snippets matching "${query}" (${results.length} results):`);
      for (const r of results) {
        const symTag = r.entry.nearestSymbol ? ` (near ${r.entry.nearestSymbol})` : "";
        console.log(
          `  ${r.file}:${r.entry.line}  ${r.entry.text}${symTag}  [score=${r.score}, ${r.reason}]`,
        );
      }
    }
    console.log();
  }

  return 0;
}

/**
 * Handle --agent-context query
 */
export function handleAgentContext(
  filePath: string,
  index: SourceIndex | null,
  format: "console" | "json",
  _projectRoot: string,
): number {
  const ctx = queryAgentContext(index, filePath, _projectRoot);

  if (!index) {
    if (format === "json") {
      console.log(JSON.stringify({ error: "No index available" }, null, 2));
    } else {
      console.log("No index available. Run 'mp-sentinel indexing' first.");
    }
    return 1;
  }

  if (ctx.error) {
    if (format === "json") {
      console.log(JSON.stringify({ error: ctx.error }, null, 2));
    } else {
      console.log(ctx.error);
    }
    return 1;
  }

  const output = {
    file: ctx.file,
    directImports: ctx.directImports,
    directImportsTruncated: ctx.directImportsTruncated,
    directDependents: ctx.directDependents,
    directDependentsTruncated: ctx.directDependentsTruncated,
    hubFiles: ctx.hubFiles,
    hubFilesTruncated: ctx.hubFilesTruncated,
    incomingCalls: ctx.incomingCalls,
    incomingCallsTruncated: ctx.incomingCallsTruncated,
    suggestedCommands: ctx.suggestedCommands,
  };

  if (format === "json") {
    console.log(JSON.stringify(output, null, 2));
  } else {
    const fileInfo = ctx.file!;
    console.log();
    log.header(`Agent Context: ${fileInfo.path}`);
    console.log(`  Language: ${fileInfo.language}`);
    if (fileInfo.role) console.log(`  Role: ${fileInfo.role}`);
    if (fileInfo.parserMode) {
      console.log(`  Parser mode: ${fileInfo.parserMode}`);
    }
    if (fileInfo.parseWarnings && fileInfo.parseWarnings.length > 0) {
      console.log(`  Parse warnings (${fileInfo.parseWarnings.length}):`);
      fileInfo.parseWarnings.slice(0, 3).forEach((w) => console.log(`    - ${w}`));
      if (fileInfo.parseWarnings.length > 3) {
        console.log(`    ... and ${fileInfo.parseWarnings.length - 3} more`);
      }
    }
    if (fileInfo.parseErrorMessages && fileInfo.parseErrorMessages.length > 0) {
      console.log(`  Parse errors (${fileInfo.parseErrorMessages.length}):`);
      fileInfo.parseErrorMessages.slice(0, 3).forEach((e) => console.log(`    - ${e}`));
      if (fileInfo.parseErrorMessages.length > 3) {
        console.log(`    ... and ${fileInfo.parseErrorMessages.length - 3} more`);
      }
    }
    if (fileInfo.chunkCount !== undefined) {
      console.log(
        `  Chunked: ${fileInfo.chunkCount} chunks @ ${fileInfo.chunkSize} bytes/chunk, ${fileInfo.chunkWarningCount ?? 0} warnings (${fileInfo.chunkBoundaryWarningCount ?? 0} boundary, ${fileInfo.chunkActionableWarningCount ?? 0} actionable)`,
      );
    }

    console.log(
      `\n  Symbols (${fileInfo.symbols.length}${fileInfo.symbolsTruncated > 0 ? `, ${fileInfo.symbolsTruncated} more not shown` : ""}):`,
    );
    for (const s of fileInfo.symbols) {
      console.log(`    ${s.type} ${s.name} @ ${s.line}${s.parent ? ` (in ${s.parent})` : ""}`);
    }

    if (ctx.directImports.length > 0) {
      console.log(
        `\n  Direct imports (${ctx.directImports.length}${ctx.directImportsTruncated > 0 ? `, ${ctx.directImportsTruncated} more not shown` : ""}):`,
      );
      for (const p of ctx.directImports) console.log(`    - ${p}`);
    }

    if (ctx.directDependents.length > 0) {
      console.log(
        `\n  Direct dependents (${ctx.directDependents.length}${ctx.directDependentsTruncated > 0 ? `, ${ctx.directDependentsTruncated} more not shown` : ""}):`,
      );
      for (const p of ctx.directDependents) console.log(`    - ${p}`);
    }

    if (ctx.hubFiles.length > 0) {
      console.log(
        `\n  Hub files (${ctx.hubFiles.length}${ctx.hubFilesTruncated > 0 ? `, ${ctx.hubFilesTruncated} more not shown` : ""}):`,
      );
      for (const h of ctx.hubFiles) {
        console.log(`    - ${h.path} (imported by ${h.importedByCount} files)`);
      }
    }

    if (fileInfo.calls && fileInfo.calls.length > 0) {
      console.log(
        `\n  Outbound calls (${fileInfo.calls.length}${(fileInfo.callsTruncated ?? 0) > 0 ? `, ${fileInfo.callsTruncated} more not shown` : ""}):`,
      );
      for (const c of fileInfo.calls) {
        console.log(`    ${c.callee} @ ${c.line}${c.inSymbol ? ` (in ${c.inSymbol})` : ""}`);
      }
    }

    if (ctx.incomingCalls.length > 0) {
      console.log(
        `\n  Incoming call candidates (${ctx.incomingCalls.length}${ctx.incomingCallsTruncated > 0 ? `, ${ctx.incomingCallsTruncated} more not shown` : ""}):`,
      );
      for (const c of ctx.incomingCalls) {
        console.log(
          `    ${c.callee} @ ${c.fromFile}:${c.line}${c.inSymbol ? ` (in ${c.inSymbol})` : ""}`,
        );
      }
    }

    if (ctx.suggestedCommands.length > 0) {
      console.log("\n  Suggested next commands:");
      for (const cmd of ctx.suggestedCommands) console.log(`    $ ${cmd}`);
    }

    console.log();
  }

  return 0;
}
