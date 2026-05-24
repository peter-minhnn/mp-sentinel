/**
 * Shared index diagnostics helpers used by CLI commands and MCP services.
 */

import type { SourceIndex } from "../../types/index.js";

/**
 * Count files recovered via fallback parser (non-tree-sitter parserMode).
 */
export const getRecoveredFileCount = (index: SourceIndex): number => {
  return index.files.filter(
    (file) =>
      (file.parserMode === "chunked-tree-sitter" ||
        file.parserMode === "ascii-fallback" ||
        file.parserMode === "lexical-fallback") &&
      (!file.parseErrors || file.parseErrors.length === 0),
  ).length;
};

/**
 * Build a breakdown of files by parser mode.
 * Absent parserMode (older caches) is treated as tree-sitter.
 */
export const getParserModeBreakdown = (index: SourceIndex): Record<string, number> => {
  const breakdown: Record<string, number> = {
    "tree-sitter": 0,
    "chunked-tree-sitter": 0,
    "ascii-fallback": 0,
    "lexical-fallback": 0,
  };
  for (const file of index.files) {
    const mode = file.parserMode ?? "tree-sitter";
    breakdown[mode] = (breakdown[mode] ?? 0) + 1;
  }
  return breakdown;
};

/**
 * Aggregate chunk telemetry across all chunked-tree-sitter files.
 * Returns undefined when no chunked files exist.
 */
export const getChunkTelemetry = (
  index: SourceIndex,
):
  | {
      chunkedFiles: number;
      totalChunks: number;
      totalChunkWarnings: number;
      totalChunkBoundaryWarnings: number;
      totalChunkActionableWarnings: number;
      chunkSize: number;
    }
  | undefined => {
  let chunkedFiles = 0;
  let totalChunks = 0;
  let totalChunkWarnings = 0;
  let totalChunkBoundaryWarnings = 0;
  let totalChunkActionableWarnings = 0;
  let chunkSize: number | undefined;
  for (const file of index.files) {
    if (file.parserMode === "chunked-tree-sitter") {
      chunkedFiles++;
      if (file.chunkCount !== undefined) totalChunks += file.chunkCount;
      if (file.chunkWarningCount !== undefined) totalChunkWarnings += file.chunkWarningCount;
      if (file.chunkBoundaryWarningCount !== undefined)
        totalChunkBoundaryWarnings += file.chunkBoundaryWarningCount;
      if (file.chunkActionableWarningCount !== undefined)
        totalChunkActionableWarnings += file.chunkActionableWarningCount;
      if (chunkSize === undefined && file.chunkSize !== undefined) chunkSize = file.chunkSize;
    }
  }
  if (chunkedFiles === 0) return undefined;
  return {
    chunkedFiles,
    totalChunks,
    totalChunkWarnings,
    totalChunkBoundaryWarnings,
    totalChunkActionableWarnings,
    chunkSize: chunkSize ?? 0,
  };
};
