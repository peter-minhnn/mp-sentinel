/**
 * Persistent cache for AI audit responses.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AuditResult } from "../../types/index.js";
import { parseAuditResponse } from "../../utils/parser.js";
import { log } from "../../utils/logger.js";

const CACHE_DIR = ".mp-sentinel-cache";
// v3 — invalidates cache entries produced before the OpenAI Responses API
// migration, Gemini @google/genai SDK migration, and refreshed model tier
// catalog (removed gemini-3-pro-preview, gpt-5.3-codex).
const CACHE_VERSION = "3";

const getCachePath = (key: string, cwd: string = process.cwd()): string =>
  resolve(cwd, CACHE_DIR, `${key}.json`);

export const buildAuditCacheKey = (input: {
  provider: string;
  model: string;
  baseUrl?: string;
  promptVersion: string;
  systemPrompt: string;
  filePath: string;
  payload: string;
  toolVersion: string;
}): string => {
  const parts = [
    CACHE_VERSION,
    input.provider,
    input.model,
    ...(input.baseUrl ? [input.baseUrl] : []),
    input.promptVersion,
    input.toolVersion,
    input.filePath,
    input.systemPrompt,
    input.payload,
  ];
  const source = parts.join("::");

  return createHash("sha256").update(source).digest("hex");
};

export const readCachedAuditResult = async (
  key: string,
  cwd: string = process.cwd(),
): Promise<AuditResult | null> => {
  try {
    const fullPath = getCachePath(key, cwd);
    const content = await readFile(fullPath, "utf-8");
    // Validate cached data through the same normalizer used for live responses
    // to prevent tampered/corrupted cache files from injecting bad data.
    const result = parseAuditResponse(content);
    // Cached ERROR results are always invalid — the runtime never writes
    // ERROR to cache (see auditFilesWithConcurrency), so a cached ERROR
    // means the cache file was tampered or the schema has drifted.
    if (result.status === "ERROR") {
      return null; // treat as a cache miss
    }
    return result;
  } catch {
    return null;
  }
};

export const writeCachedAuditResult = async (
  key: string,
  result: AuditResult,
  cwd: string = process.cwd(),
): Promise<void> => {
  try {
    const fullPath = getCachePath(key, cwd);
    const dir = resolve(cwd, CACHE_DIR);
    await mkdir(dir, { recursive: true });
    // Atomic write: write to a temp file first, then rename to final path.
    // This prevents readers from seeing a partially-written cache file.
    const tmpPath = fullPath + ".tmp." + Date.now();
    await writeFile(tmpPath, JSON.stringify(result), "utf-8");
    await rename(tmpPath, fullPath);
  } catch (err) {
    log.warning(`Failed to write audit cache: ${(err as Error).message}`);
    // Cache writes are best-effort; a write failure must not propagate.
  }
};
