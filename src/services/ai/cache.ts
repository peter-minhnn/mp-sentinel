/**
 * Persistent cache for AI audit responses.
 *
 * Phase 3.3: the storage mechanics moved into pluggable backends under
 * `./cache-backends/`. This file keeps two stable public surfaces:
 *   - `buildAuditCacheKey` — deterministic SHA-256 over the inputs that
 *     determine the AI response. Backends share this key so an entry
 *     written by `fs` can be read by `http` and vice-versa.
 *   - `readCachedAuditResult` / `writeCachedAuditResult` — thin shims
 *     around the configured backend (defaults to `fs`).
 */

import { createHash } from "node:crypto";
import type { AuditResult, ProjectConfig } from "../../types/index.js";
import type { CacheBackend } from "./cache-backends/types.js";
import { createFsCacheBackend } from "./cache-backends/fs.js";
import { createHttpCacheBackend } from "./cache-backends/http.js";

// v4 — invalidates cache entries produced before Phase 2.5 structured-
// output rollout. The request/response shape changes when providers honor
// `responseSchema` (OpenAI json_schema, Anthropic tool_use, Gemini
// responseSchema), so cached v3 entries are stale w.r.t. the new prompt
// contract even though the parsed AuditResult shape is unchanged.
const CACHE_VERSION = "4";

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

// ── Backend management ──────────────────────────────────────────────────

let currentBackend: CacheBackend | null = null;

/**
 * Configure the cache backend from a `ProjectConfig.cache` block. Pass
 * `undefined` to reset to the default `fs` backend.
 */
export const configureCacheBackend = (
  settings: ProjectConfig["cache"] | undefined,
  cwd: string = process.cwd(),
): void => {
  if (!settings || !settings.backend || settings.backend === "fs") {
    currentBackend = createFsCacheBackend({
      cwd,
      ...(settings?.fs?.cacheDir && { cacheDir: settings.fs.cacheDir }),
    });
    return;
  }
  if (settings.backend === "http") {
    if (!settings.http?.baseUrl) {
      throw new Error(`cache.http.baseUrl is required when cache.backend = "http"`);
    }
    currentBackend = createHttpCacheBackend({
      baseUrl: settings.http.baseUrl,
      ...(settings.http.headers && { headers: settings.http.headers }),
      ...(typeof settings.http.timeoutMs === "number" && { timeoutMs: settings.http.timeoutMs }),
    });
    return;
  }
  throw new Error(`Unsupported cache.backend: "${String(settings.backend)}"`);
};

/** Test helper — replace the backend with a stub. */
export const setCacheBackendForTest = (backend: CacheBackend): void => {
  currentBackend = backend;
};

/** Reset to defaults (for tests). */
export const resetCacheBackend = (): void => {
  currentBackend = null;
};

const getBackend = (cwd: string = process.cwd()): CacheBackend => {
  if (!currentBackend) {
    currentBackend = createFsCacheBackend({ cwd });
  }
  return currentBackend;
};

// ── Public read/write API (backwards compatible) ────────────────────────

export const readCachedAuditResult = async (
  key: string,
  cwd: string = process.cwd(),
): Promise<AuditResult | null> => {
  return getBackend(cwd).read(key);
};

export const writeCachedAuditResult = async (
  key: string,
  result: AuditResult,
  cwd: string = process.cwd(),
): Promise<void> => {
  return getBackend(cwd).write(key, result);
};

// Re-exports so callers can construct backends directly if they want.
export { createFsCacheBackend } from "./cache-backends/fs.js";
export { createHttpCacheBackend } from "./cache-backends/http.js";
export type { CacheBackend } from "./cache-backends/types.js";
