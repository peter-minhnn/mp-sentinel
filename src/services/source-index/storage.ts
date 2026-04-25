/**
 * Index Storage - Read/write source index cache
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { log } from "../../utils/logger.js";
import type { SourceIndex, CacheValidity, SourceIndexFile } from "../../types/index.js";

const DEFAULT_CACHE_PATH = ".mp-sentinel-cache/source-index.json";

/**
 * Calculate SHA256 hash of content
 */
export async function calculateSHA256(content: string): Promise<string> {
  const crypto = await import("node:crypto");
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Ensure cache directory exists
 */
export async function ensureCacheDir(cachePath: string): Promise<void> {
  const dir = dirname(cachePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

/**
 * Read source index from cache file
 */
export async function readIndex(
  cachePath: string = DEFAULT_CACHE_PATH,
): Promise<SourceIndex | null> {
  try {
    if (!existsSync(cachePath)) {
      return null;
    }

    const content = await readFile(cachePath, "utf-8");
    const index = JSON.parse(content) as SourceIndex;

    // Validate schema version (accept 1.0 and 1.1)
    if (!index.schemaVersion || (index.schemaVersion !== "1.0" && index.schemaVersion !== "1.1")) {
      log.warning(`Invalid or unsupported index schema version: ${index.schemaVersion}`);
      return null;
    }

    return index;
  } catch (error) {
    log.debug(
      `Failed to read source index: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/**
 * Write source index to cache file
 */
export async function writeIndex(
  index: SourceIndex,
  cachePath: string = DEFAULT_CACHE_PATH,
): Promise<void> {
  try {
    await ensureCacheDir(cachePath);
    const content = JSON.stringify(index, null, 2);
    await writeFile(cachePath, content, "utf-8");
    log.info(`Source index written to ${cachePath}`);
  } catch (error) {
    log.error(
      `Failed to write source index: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  }
}

/**
 * Check if cache is valid by comparing file hashes and mtimes
 */
export async function validateCache(
  cachePath: string,
  projectRoot: string,
  files: string[],
  getFileContent: (path: string) => Promise<string>,
  getFileMtime: (path: string) => Promise<number>,
): Promise<CacheValidity> {
  const index = await readIndex(cachePath);

  if (!index) {
    return { valid: false };
  }

  const staleFiles: string[] = [];
  const missingFiles: string[] = [];
  const modifiedFiles: string[] = [];

  // Build map of indexed files by path
  const indexedFiles = new Map(index.files.map((f) => [f.path, f]));

  for (const filePath of files) {
    const absolutePath = resolve(projectRoot, filePath);
    const indexed = indexedFiles.get(filePath);

    if (!indexed) {
      missingFiles.push(filePath);
      continue;
    }

    try {
      const content = await getFileContent(absolutePath);
      const mtime = await getFileMtime(absolutePath);
      const currentHash = await calculateSHA256(content);

      if (currentHash !== indexed.sha256) {
        modifiedFiles.push(filePath);
      } else if (mtime > indexed.mtimeMs) {
        staleFiles.push(filePath);
      }
    } catch {
      // File might have been deleted
      missingFiles.push(filePath);
    }
  }

  return {
    valid: staleFiles.length === 0 && missingFiles.length === 0 && modifiedFiles.length === 0,
    ...(staleFiles.length > 0 && { staleFiles }),
    ...(missingFiles.length > 0 && { missingFiles }),
    ...(modifiedFiles.length > 0 && { modifiedFiles }),
  } as CacheValidity;
}

/**
 * Filter files that need re-indexing based on cache validity
 */
export async function getFilesToIndex(
  cachePath: string,
  projectRoot: string,
  allFiles: string[],
  getFileContent: (path: string) => Promise<string>,
  getFileMtime: (path: string) => Promise<number>,
): Promise<{
  toIndex: string[];
  fromCache: SourceIndexFile[];
  validity: CacheValidity;
}> {
  const validity = await validateCache(
    cachePath,
    projectRoot,
    allFiles,
    getFileContent,
    getFileMtime,
  );
  const existingIndex = await readIndex(cachePath);

  if (!existingIndex) {
    return {
      toIndex: allFiles,
      fromCache: [],
      validity,
    };
  }

  if (validity.valid) {
    return {
      toIndex: [],
      fromCache: existingIndex.files,
      validity,
    };
  }

  // Determine which files need re-indexing
  const needsReindex = new Set<string>();

  if (validity.modifiedFiles) {
    for (const f of validity.modifiedFiles) needsReindex.add(f);
  }
  if (validity.staleFiles) {
    for (const f of validity.staleFiles) needsReindex.add(f);
  }
  if (validity.missingFiles) {
    for (const f of validity.missingFiles) needsReindex.add(f);
  }

  // All files need re-indexing if no specific changes detected
  if (!validity.modifiedFiles && !validity.staleFiles && !validity.missingFiles) {
    for (const f of allFiles) needsReindex.add(f);
  }

  return {
    toIndex: allFiles.filter((f) => needsReindex.has(f)),
    fromCache: existingIndex.files.filter((f) => !needsReindex.has(f.path)),
    validity,
  };
}
