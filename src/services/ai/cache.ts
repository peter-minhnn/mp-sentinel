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

/**
 * The configured backend (set by `configureCacheBackend()` during the
 * review run). Legacy shims that take an explicit `cwd` BYPASS this
 * singleton because their callers (tests, programmatic API users) rely
 * on every call being independently scoped to that cwd -- without
 * bypassing, the first cwd would stick across calls.
 */
let configuredBackend: CacheBackend | null = null;

/**
 * Configure the cache backend from a `ProjectConfig.cache` block. Pass
 * `undefined` to reset to the default `fs` backend.
 */
export const configureCacheBackend = (
  settings: ProjectConfig["cache"] | undefined,
  cwd: string = process.cwd(),
): void => {
  if (!settings || !settings.backend || settings.backend === "fs") {
    configuredBackend = createFsCacheBackend({
      cwd,
      ...(settings?.fs?.cacheDir && { cacheDir: settings.fs.cacheDir }),
    });
    return;
  }
  if (settings.backend === "http") {
    if (!settings.http?.baseUrl) {
      throw new Error(`cache.http.baseUrl is required when cache.backend = "http"`);
    }
    configuredBackend = createHttpCacheBackend({
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
  configuredBackend = backend;
};

/** Reset to defaults (for tests). */
export const resetCacheBackend = (): void => {
  configuredBackend = null;
};

// ── Public read/write API (backwards compatible) ────────────────────────

/**
 * Read an entry. When `cwd` is explicitly provided (legacy programmatic
 * use, tests), we create a fresh fs backend scoped to that cwd. Otherwise
 * we use the configured backend (or a default fs one rooted at
 * `process.cwd()`).
 */
export const readCachedAuditResult = async (
  key: string,
  cwd?: string,
): Promise<AuditResult | null> => {
  if (cwd !== undefined) {
    return createFsCacheBackend({ cwd }).read(key);
  }
  if (configuredBackend) return configuredBackend.read(key);
  return createFsCacheBackend({ cwd: process.cwd() }).read(key);
};

export const writeCachedAuditResult = async (
  key: string,
  result: AuditResult,
  cwd?: string,
): Promise<void> => {
  if (cwd !== undefined) {
    return createFsCacheBackend({ cwd }).write(key, result);
  }
  if (configuredBackend) return configuredBackend.write(key, result);
  return createFsCacheBackend({ cwd: process.cwd() }).write(key, result);
};

// Re-exports so callers can construct backends directly if they want.
export { createFsCacheBackend } from "./cache-backends/fs.js";
export { createHttpCacheBackend } from "./cache-backends/http.js";
export type { CacheBackend } from "./cache-backends/types.js";
