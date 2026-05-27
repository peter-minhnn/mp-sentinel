/**
 * Filesystem cache backend — the default. Stores each entry as a JSON
 * file under `.mp-sentinel-cache/<key>.json` (Phase 3.3 extraction).
 *
 * Atomic writes: each entry is written to `<path>.tmp.<timestamp>` and
 * then renamed into place, so a reader never sees a partially-written
 * file even if the process is killed mid-write.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AuditResult } from "../../../types/index.js";
import { parseAuditResponse } from "../../../utils/parser.js";
import { log } from "../../../utils/logger.js";
import type { CacheBackend } from "./types.js";

export const DEFAULT_CACHE_DIR = ".mp-sentinel-cache";

export interface FsCacheOptions {
  cwd?: string;
  /** Override the default `.mp-sentinel-cache/` directory. */
  cacheDir?: string;
}

export const createFsCacheBackend = (options: FsCacheOptions = {}): CacheBackend => {
  const cwd = options.cwd ?? process.cwd();
  const cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR;
  const cachePath = (key: string): string => resolve(cwd, cacheDir, `${key}.json`);

  return {
    id: "fs",
    async read(key: string): Promise<AuditResult | null> {
      try {
        const content = await readFile(cachePath(key), "utf-8");
        const result = parseAuditResponse(content);
        // ERROR results are never written (see auditFilesWithConcurrency);
        // if we see one it's tampered/corrupted — treat as a miss.
        if (result.status === "ERROR") return null;
        return result;
      } catch {
        return null;
      }
    },
    async write(key: string, value: AuditResult): Promise<void> {
      try {
        const fullPath = cachePath(key);
        const dir = resolve(cwd, cacheDir);
        await mkdir(dir, { recursive: true });
        const tmpPath = fullPath + ".tmp." + Date.now();
        await writeFile(tmpPath, JSON.stringify(value), "utf-8");
        await rename(tmpPath, fullPath);
      } catch (err) {
        log.warning(`Failed to write fs cache: ${(err as Error).message}`);
      }
    },
  };
};
