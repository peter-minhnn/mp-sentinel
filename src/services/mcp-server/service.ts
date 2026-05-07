/**
 * MCP Server tool handlers — read-only project introspection.
 * These functions are transport-agnostic and directly testable.
 * They never spawn processes, make AI calls, or write to the index.
 */

import { resolve } from "node:path";
import { readIndex } from "../source-index/storage.js";
import { queryAgentContext } from "../source-index/query.js";
import { buildReviewContext } from "../source-index/context-builder.js";
import { loadProjectConfig } from "../../utils/config.js";
import { generateMCPDiagnostics } from "../mcp/diagnostics.js";

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
