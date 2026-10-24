/**
 * MCP handlers for compact agent search and file-path lookup.
 */

import {
  queryFilesLimited,
  queryUnifiedSearch,
  clampSearchLimit,
  DEFAULT_SEARCH_LIMIT,
  type SearchHitKind,
} from "../source-index/agent-search.js";
import { loadCachedIndex } from "./index-cache.js";

export async function getIndexSearch(
  projectRoot: string,
  query: string,
  options: { limit?: number; kinds?: SearchHitKind[] } = {},
): Promise<Record<string, unknown>> {
  const loaded = await loadCachedIndex(projectRoot, "none");
  if (!loaded) return { status: "error", message: "No source index found" };

  const limit = clampSearchLimit(options.limit, DEFAULT_SEARCH_LIMIT);
  try {
    const result = await queryUnifiedSearch(
      loaded.index,
      query,
      { limit, ...(options.kinds && options.kinds.length > 0 ? { kinds: options.kinds } : {}) },
      loaded.cachePath,
    );
    return { status: "ok", ...result };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getFindFile(
  projectRoot: string,
  query: string,
  limit?: number,
): Promise<Record<string, unknown>> {
  const loaded = await loadCachedIndex(projectRoot, "none");
  if (!loaded) return { status: "error", message: "No source index found" };

  const { results, truncated } = queryFilesLimited(loaded.index, query, limit);
  return {
    status: "ok",
    query,
    count: results.length,
    truncated,
    results: results.map((r) => ({ file: r.file, score: r.score })),
  };
}
