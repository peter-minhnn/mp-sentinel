/**
 * Persistent cache for AI audit responses.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AuditResult } from "../../types/index.js";

const CACHE_DIR = ".mp-sentinel-cache";
const CACHE_VERSION = "1";

const getCachePath = (key: string, cwd: string = process.cwd()): string =>
  resolve(cwd, CACHE_DIR, `${key}.json`);

export const buildAuditCacheKey = (input: {
  provider: string;
  model: string;
  promptVersion: string;
  systemPrompt: string;
  filePath: string;
  payload: string;
  toolVersion: string;
}): string => {
  const source = [
    CACHE_VERSION,
    input.provider,
    input.model,
    input.promptVersion,
    input.toolVersion,
    input.filePath,
    input.systemPrompt,
    input.payload,
  ].join("::");

  return createHash("sha256").update(source).digest("hex");
};

export const readCachedAuditResult = async (
  key: string,
  cwd: string = process.cwd(),
): Promise<AuditResult | null> => {
  try {
    const fullPath = getCachePath(key, cwd);
    const content = await readFile(fullPath, "utf-8");
    const parsed = JSON.parse(content) as AuditResult;
    return parsed;
  } catch {
    return null;
  }
};

export const writeCachedAuditResult = async (
  key: string,
  result: AuditResult,
  cwd: string = process.cwd(),
): Promise<void> => {
  const fullPath = getCachePath(key, cwd);
  const dir = resolve(cwd, CACHE_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(fullPath, JSON.stringify(result), "utf-8");
};
