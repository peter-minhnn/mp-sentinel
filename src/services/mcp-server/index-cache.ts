/**
 * Process-local source-index cache for MCP handlers.
 * Repeat searches in the same MCP session skip disk + parse after the first load.
 */

import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { SourceIndex } from "../../types/index.js";
import { loadProjectConfig } from "../../utils/config.js";
import { readIndex, type IndexHydration } from "../source-index/storage.js";

export async function resolveCachePath(projectRoot: string): Promise<string> {
  const config = await loadProjectConfig(projectRoot);
  const relPath = config.indexing?.cachePath ?? ".mp-sentinel-cache/source-index.json";
  return resolve(projectRoot, relPath);
}

interface CachedIndex {
  cachePath: string;
  mtimeMs: number;
  hydration: IndexHydration;
  index: SourceIndex;
}

let cached: CachedIndex | null = null;

function hydrationCovers(have: IndexHydration, need: IndexHydration): boolean {
  if (have === need) return true;
  if (have === "full") return true;
  if (have === "calls" && need === "none") return true;
  if (have === "code" && need === "none") return true;
  return false;
}

export function clearMcpIndexCache(): void {
  cached = null;
}

export interface LoadedIndex {
  index: SourceIndex;
  cachePath: string;
}

export async function loadCachedIndex(
  projectRoot: string,
  hydration: IndexHydration = "none",
): Promise<LoadedIndex | null> {
  const cachePath = await resolveCachePath(projectRoot);
  let mtimeMs = 0;
  try {
    mtimeMs = (await stat(cachePath)).mtimeMs;
  } catch {
    cached = null;
    return null;
  }

  if (
    cached &&
    cached.cachePath === cachePath &&
    cached.mtimeMs === mtimeMs &&
    hydrationCovers(cached.hydration, hydration)
  ) {
    return { index: cached.index, cachePath };
  }

  const index = await readIndex(cachePath, { hydrate: hydration });
  if (!index) {
    cached = null;
    return null;
  }

  cached = { cachePath, mtimeMs, hydration, index };
  return { index, cachePath };
}
