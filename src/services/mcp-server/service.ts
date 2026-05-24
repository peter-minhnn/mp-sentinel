/**
 * MCP Server tool handlers — read-only project introspection.
 * These functions are transport-agnostic and directly testable.
 * They never spawn processes, make AI calls, or write to the index.
 */

import { resolve } from "node:path";
import type { SourceIndex } from "../../types/index.js";
import { readIndex } from "../source-index/storage.js";
import {
  queryAgentContext,
  querySymbols,
  queryImports,
  queryCode,
  getParserTelemetry,
} from "../source-index/query.js";
import { buildReviewContext } from "../source-index/context-builder.js";
import { loadProjectConfig } from "../../utils/config.js";
import { generateMCPDiagnostics } from "../mcp/diagnostics.js";
import {
  getExplainAgents,
  getSkillsDoctor,
  getSkillsCheck,
} from "../skills-generator/mcp-diagnostics.js";
import { getReviewScope, getReviewDeterministic, getReviewFilterFiles } from "./review-preview.js";
import {
  getRecoveredFileCount,
  getParserModeBreakdown,
  getChunkTelemetry,
} from "../source-index/diagnostics.js";

export interface IndexHealthResult {
  status: "ok" | "missing";
  schemaVersion?: string;
  totalFiles?: number;
  generatedAt?: string;
  message?: string;
}

export interface ExplainContextResult {
  status: "available" | "unavailable";
  reason?: string;
  indexUsed: boolean;
  contextPreview?: string;
  relatedFileCount?: number;
  suggestedCommands?: string[];
  mcp?: unknown;
}

/**
 * Resolve the source-index cache path from project config, falling back
 * to the default relative path resolved against projectRoot.
 */
async function resolveCachePath(projectRoot: string): Promise<string> {
  const config = await loadProjectConfig(projectRoot);
  const relPath = config.indexing?.cachePath ?? ".mp-sentinel-cache/source-index.json";
  return resolve(projectRoot, relPath);
}

/**
 * Read-only index health check.
 * Only reads the cached index — never builds or refreshes it.
 */
export async function getIndexHealth(projectRoot: string): Promise<IndexHealthResult> {
  const cachePath = await resolveCachePath(projectRoot);
  const index = await readIndex(cachePath);

  if (!index) {
    return {
      status: "missing",
      message:
        "No source index found. Run 'mp-sentinel indexing' first, or configure indexing.cachePath in .mp-sentinelrc.json.",
    };
  }

  return {
    status: "ok",
    schemaVersion: index.schemaVersion,
    totalFiles: index.files.length,
    generatedAt: index.generatedAt,
  };
}

/**
 * Agent context for a specific file.
 * Missing index → returns an error string for the caller to convert to an MCP error.
 */
export async function getAgentContext(
  projectRoot: string,
  file: string,
): Promise<Record<string, unknown>> {
  const cachePath = await resolveCachePath(projectRoot);
  const index = await readIndex(cachePath);

  if (!index) {
    return { error: "No source index found" };
  }

  return queryAgentContext(index, file, projectRoot) as unknown as Record<string, unknown>;
}

/**
 * Explain-context preview for a set of files.
 * No AI calls, no git target branch resolution, no network.
 */
export async function getExplainContext(
  projectRoot: string,
  files: string[],
): Promise<ExplainContextResult> {
  const cachePath = await resolveCachePath(projectRoot);
  const index = await readIndex(cachePath);

  if (!index) {
    return {
      status: "unavailable",
      reason: "No source index found",
      indexUsed: false,
    };
  }

  const { context, metadata } = await buildReviewContext(
    index,
    files.map((f) => ({ path: f })),
    { maxRelatedFiles: 10, budgetChars: 4000 },
  );

  // Include MCP diagnostics if MCP config exists
  let mcp: unknown;
  try {
    const config = await loadProjectConfig(projectRoot);
    if (config.mcp?.enabled) {
      mcp = generateMCPDiagnostics(config.mcp);
    }
  } catch {
    // Diagnostics are best-effort
  }

  return {
    status: "available",
    indexUsed: true,
    contextPreview: context,
    relatedFileCount: metadata.relatedFileCount,
    ...(metadata.suggestedCommands ? { suggestedCommands: metadata.suggestedCommands } : {}),
    mcp,
  };
}

// ── Private parser-summary helpers (pure, same logic as commands/indexing.ts) ──

// ── Index Query Handlers ──────────────────────────────────────────────

export async function getFindSymbol(
  projectRoot: string,
  query: string,
): Promise<Record<string, unknown>> {
  const cachePath = await resolveCachePath(projectRoot);
  const index = await readIndex(cachePath);
  if (!index) return { status: "error", message: "No source index found" };

  const results = querySymbols(index, query);
  return {
    status: "ok",
    query,
    resultCount: results.length,
    results,
  };
}

export async function getFindImport(
  projectRoot: string,
  query: string,
): Promise<Record<string, unknown>> {
  const cachePath = await resolveCachePath(projectRoot);
  const index = await readIndex(cachePath);
  if (!index) return { status: "error", message: "No source index found" };

  const results = queryImports(index, query);
  return {
    status: "ok",
    query,
    resultCount: results.length,
    results,
  };
}

export async function getFindCode(
  projectRoot: string,
  query: string,
): Promise<Record<string, unknown>> {
  const cachePath = await resolveCachePath(projectRoot);
  const index = await readIndex(cachePath);
  if (!index) return { status: "error", message: "No source index found" };

  const results = queryCode(index, query);
  return {
    status: "ok",
    query,
    resultCount: results.length,
    results,
  };
}

export async function getExplainFile(
  projectRoot: string,
  file: string,
): Promise<Record<string, unknown>> {
  const cachePath = await resolveCachePath(projectRoot);
  const index = await readIndex(cachePath);
  if (!index) return { error: "No source index found" };

  const sourceFile = index.files.find((f) => f.path === file);
  if (!sourceFile) return { error: "File not found in index" };

  // Classify imports matching CLI --explain-index behavior:
  // normalize local specifiers relative to file directory, strip extensions,
  // and compare against extension-stripped importsFrom values.
  const resolvedImports: string[] = [];
  const unresolvedImports: string[] = [];
  const externalImports: string[] = [];
  const stripExt = (p: string): string => p.replace(/\.(ts|tsx|js|jsx|mjs|mts|cjs|cts)$/, "");
  const resolvedPaths = sourceFile.importsFrom ?? [];
  const resolvedNormSet = new Set(resolvedPaths.map((p) => stripExt(p)));
  const fileDir = sourceFile.path.includes("/")
    ? sourceFile.path.slice(0, sourceFile.path.lastIndexOf("/"))
    : "";

  for (const imp of sourceFile.imports) {
    const src = imp.source;
    const isNodeBuiltin = src.startsWith("node:");
    const isUrl = src.startsWith("http://") || src.startsWith("https://");
    const isLocalLike = src.startsWith(".") || src.startsWith("/");

    // Bare specifiers, node: builtins, and URLs are external packages
    if (!isLocalLike || isNodeBuiltin || isUrl) {
      externalImports.push(src);
      continue;
    }

    // Normalize local import relative to file directory
    const joined = fileDir ? `${fileDir}/${src}` : src;
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
      resolvedImports.push(src);
    } else {
      unresolvedImports.push(src);
    }
  }

  return {
    path: sourceFile.path,
    language: sourceFile.language,
    symbols: sourceFile.symbols,
    imports: sourceFile.imports,
    exports: sourceFile.exports,
    resolvedImports,
    unresolvedImports,
    externalImports,
    importedBy: sourceFile.importedBy,
    importedByCount: sourceFile.importedBy?.length ?? 0,
    role: sourceFile.role,
    ...getParserTelemetry(sourceFile),
  };
}

export async function getIndexStats(projectRoot: string): Promise<Record<string, unknown>> {
  const cachePath = await resolveCachePath(projectRoot);
  const index = await readIndex(cachePath);
  if (!index) return { status: "error", message: "No source index found" };

  const chunkTelemetry = getChunkTelemetry(index);
  const insights = index.insights
    ? {
        fileRoleCount: Object.keys(index.insights.fileRoles ?? {}).length,
        publicApiFileCount: index.insights.publicApiFiles?.length ?? 0,
        testMapEntries: Object.keys(index.insights.testMap ?? {}).length,
        commandMapEntries: Object.keys(index.insights.commandMap ?? {}).length,
        defaultExportFiles: index.insights.defaultExportFiles?.length ?? 0,
        reExportFiles: index.insights.reExportFiles?.length ?? 0,
        typeOnlyImportFiles: index.insights.typeOnlyImportFiles?.length ?? 0,
        dynamicImportFiles: index.insights.dynamicImportFiles?.length ?? 0,
      }
    : undefined;

  return {
    schemaVersion: index.schemaVersion,
    totalFiles: index.stats.totalFiles,
    indexedFiles: index.stats.indexedFiles,
    skippedFiles: index.stats.skippedFiles,
    parseErrors: index.stats.parseErrors,
    recoveredFiles: getRecoveredFileCount(index),
    parserModeBreakdown: getParserModeBreakdown(index),
    ...(chunkTelemetry ? { ...chunkTelemetry } : {}),
    ...(index.stats.importEdges !== undefined ? { importEdges: index.stats.importEdges } : {}),
    ...(index.stats.durationMs !== undefined ? { durationMs: index.stats.durationMs } : {}),
    insights,
  };
}

export async function getRecoveredFiles(
  projectRoot: string,
  limit?: number,
): Promise<Record<string, unknown>> {
  const cachePath = await resolveCachePath(projectRoot);
  const index = await readIndex(cachePath);
  if (!index) return { status: "error", message: "No source index found" };

  const recovered = index.files.filter(
    (f) =>
      (f.parserMode === "chunked-tree-sitter" ||
        f.parserMode === "ascii-fallback" ||
        f.parserMode === "lexical-fallback") &&
      (!f.parseErrors || f.parseErrors.length === 0),
  );
  const cap = Math.min(limit ?? 50, 100);
  const truncated = recovered.length > cap;
  const files = recovered
    .sort((a, b) => a.path.localeCompare(b.path))
    .slice(0, cap)
    .map((f) => ({
      path: f.path,
      parserMode: f.parserMode ?? "tree-sitter",
      symbolCount: f.symbols.length,
      importCount: f.imports.length,
      exportCount: f.exports.length,
      role: f.role,
      ...getParserTelemetry(f),
    }));

  return {
    status: "ok",
    totalFiles: index.files.length,
    recoveredFiles: recovered.length,
    parserModeBreakdown: getParserModeBreakdown(index),
    files,
    truncated,
  };
}

export async function getParseErrors(
  projectRoot: string,
  limit?: number,
): Promise<Record<string, unknown>> {
  const cachePath = await resolveCachePath(projectRoot);
  const index = await readIndex(cachePath);
  if (!index) return { status: "error", message: "No source index found" };

  const withErrors = index.files.filter((f) => (f.parseErrors?.length ?? 0) > 0);
  const cap = Math.min(limit ?? 50, 100);
  const truncated = withErrors.length > cap;
  const files = withErrors
    .sort((a, b) => a.path.localeCompare(b.path))
    .slice(0, cap)
    .map((f) => ({
      path: f.path,
      parserMode: f.parserMode ?? "tree-sitter",
      parseErrors: f.parseErrors,
      symbolCount: f.symbols.length,
      importCount: f.imports.length,
      exportCount: f.exports.length,
      role: f.role,
      ...getParserTelemetry(f),
    }));

  return {
    status: "ok",
    totalFiles: index.files.length,
    parseErrorCount: withErrors.length,
    files,
    truncated,
  };
}

// ── Agent/Skill Diagnostics Handlers ─────────────────────────────────

export async function getAgentsExplain(projectRoot: string): Promise<Record<string, unknown>> {
  try {
    return (await getExplainAgents(projectRoot)) as unknown as Record<string, unknown>;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getSkillsDoctorHandler(
  projectRoot: string,
  options?: { agents?: string[]; allAgents?: boolean },
): Promise<Record<string, unknown>> {
  try {
    return await getSkillsDoctor(projectRoot, {
      ...(options?.agents
        ? { agents: options.agents as import("../../types/index.js").AgentAdapterId[] }
        : {}),
      ...(options?.allAgents !== undefined ? { allAgents: options.allAgents } : {}),
    });
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

export async function getSkillsCheckHandler(
  projectRoot: string,
  options?: { agents?: string[]; allAgents?: boolean },
): Promise<Record<string, unknown>> {
  try {
    const result = await getSkillsCheck(projectRoot, {
      ...(options?.agents
        ? { agents: options.agents as import("../../types/index.js").AgentAdapterId[] }
        : {}),
      ...(options?.allAgents !== undefined ? { allAgents: options.allAgents } : {}),
    });
    if (result.error) return result;
    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Review Preview Handlers ─────────────────────────────────────────

export async function getReviewScopeHandler(
  projectRoot: string,
  target?: Record<string, unknown>,
  guardrails?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    const targetInput = target
      ? ({
          mode: target.mode as "staged" | "range" | "commit" | "files",
          ...(target.value !== undefined ? { value: target.value as string } : {}),
          ...(target.files !== undefined ? { files: target.files as string[] } : {}),
        } as import("./review-preview.js").ReviewTargetInput)
      : undefined;
    const guardrailInput = guardrails
      ? {
          ...(guardrails.maxFiles !== undefined ? { maxFiles: guardrails.maxFiles as number } : {}),
          ...(guardrails.maxDiffLines !== undefined
            ? { maxDiffLines: guardrails.maxDiffLines as number }
            : {}),
          ...(guardrails.maxCharsPerFile !== undefined
            ? { maxCharsPerFile: guardrails.maxCharsPerFile as number }
            : {}),
          ...(guardrails.contextLines !== undefined
            ? { contextLines: guardrails.contextLines as number }
            : {}),
          ...(guardrails.tokenLimit !== undefined
            ? { tokenLimit: guardrails.tokenLimit as number }
            : {}),
        }
      : undefined;
    return await getReviewScope(projectRoot, targetInput, guardrailInput);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getReviewDeterministicHandler(
  projectRoot: string,
  target?: Record<string, unknown>,
  guardrails?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    const targetInput = target
      ? ({
          mode: target.mode as "staged" | "range" | "commit" | "files",
          ...(target.value !== undefined ? { value: target.value as string } : {}),
          ...(target.files !== undefined ? { files: target.files as string[] } : {}),
        } as import("./review-preview.js").ReviewTargetInput)
      : undefined;
    const guardrailInput = guardrails
      ? {
          ...(guardrails.maxFiles !== undefined ? { maxFiles: guardrails.maxFiles as number } : {}),
          ...(guardrails.maxDiffLines !== undefined
            ? { maxDiffLines: guardrails.maxDiffLines as number }
            : {}),
          ...(guardrails.maxCharsPerFile !== undefined
            ? { maxCharsPerFile: guardrails.maxCharsPerFile as number }
            : {}),
          ...(guardrails.contextLines !== undefined
            ? { contextLines: guardrails.contextLines as number }
            : {}),
          ...(guardrails.tokenLimit !== undefined
            ? { tokenLimit: guardrails.tokenLimit as number }
            : {}),
        }
      : undefined;
    return await getReviewDeterministic(projectRoot, targetInput, guardrailInput);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function getReviewFilterFilesHandler(
  projectRoot: string,
  files: string[],
): Promise<Record<string, unknown>> {
  try {
    return await getReviewFilterFiles(projectRoot, files);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
