/**
 * Persistent cache for MCP tool call results.
 * Separate from AI audit cache — caches raw MCP output rather than AI responses.
 * Cache key includes server config, tool input, head identity, and changed files.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { log } from "../../utils/logger.js";

const CACHE_DIR = ".mp-sentinel-cache/mcp-cache";
const MCP_CACHE_VERSION = "1";

interface CacheEntry {
  result: string;
  timestamp: number;
  ttlMs: number;
}

const getCachePath = (key: string, cwd: string = process.cwd()): string =>
  resolve(cwd, CACHE_DIR, `${key}.json`);

/**
 * Recursive stable JSON serialization.
 * Sorts object keys at every nesting level so that equivalent objects
 * always produce identical strings regardless of key insertion order.
 */
export const stableJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableJson).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const pairs = keys.map((k) => stableJson(k) + ":" + stableJson(obj[k]));
  return "{" + pairs.join(",") + "}";
};

export const buildMCPCacheKey = (params: {
  serverId: string;
  command: string;
  args: string[];
  toolName: string;
  resolvedInput: Record<string, unknown>;
  headSha: string;
  changedFiles: string[];
  toolVersion: string;
  /** Server env mapping (childKey=parentKey pairs, never secret values) */
  envMapping: Record<string, string>;
}): string => {
  const changedFilesSorted = [...params.changedFiles].sort();
  const parts = [
    MCP_CACHE_VERSION,
    params.serverId,
    params.command,
    params.args.join("::"),
    params.toolName,
    stableJson(params.resolvedInput),
    params.headSha,
    changedFilesSorted.join("::"),
    params.toolVersion,
    stableJson(params.envMapping),
  ];
  const source = parts.join("::");
  return createHash("sha256").update(source).digest("hex");
};

export const readMCPCacheEntry = async (
  key: string,
  ttlMs: number,
  cwd: string = process.cwd(),
): Promise<string | null> => {
  try {
    const fullPath = getCachePath(key, cwd);
    const content = await readFile(fullPath, "utf-8");
    const entry = JSON.parse(content) as CacheEntry;
    if (typeof entry.result !== "string" || typeof entry.timestamp !== "number") {
      return null;
    }
    if (Date.now() - entry.timestamp > (entry.ttlMs || ttlMs)) {
      return null;
    }
    return entry.result;
  } catch {
    return null;
  }
};

export const writeMCPCacheEntry = async (
  key: string,
  result: string,
  ttlMs: number,
  cwd: string = process.cwd(),
): Promise<void> => {
  try {
    const fullPath = getCachePath(key, cwd);
    const dir = resolve(cwd, CACHE_DIR);
    await mkdir(dir, { recursive: true });
    const entry: CacheEntry = { result, timestamp: Date.now(), ttlMs };
    const tmpPath = fullPath + ".tmp." + Date.now();
    await writeFile(tmpPath, JSON.stringify(entry), "utf-8");
    await rename(tmpPath, fullPath);
  } catch (err) {
    log.warning(`Failed to write MCP cache: ${(err as Error).message}`);
  }
};
