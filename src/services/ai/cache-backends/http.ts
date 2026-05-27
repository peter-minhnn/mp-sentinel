/**
 * HTTP cache backend (Phase 3.3).
 *
 * Treats any HTTP server that supports `GET /<key>` and `PUT /<key>` as a
 * shared cache for AI audit results. Designed for:
 *   - A small in-org KV service (Varnish, nginx + file backend, Redis-HTTP)
 *   - Cloudflare Workers KV via its REST API
 *   - Any internal cache shim with a `${base}/${key}` URL convention
 *
 * Uses `fetch` from Node 24 — no new dependencies.
 *
 * Config shape:
 *   {
 *     "cache": {
 *       "backend": "http",
 *       "http": {
 *         "baseUrl": "https://cache.internal.example.com/mp-sentinel",
 *         "headers": { "Authorization": "Bearer ..." },
 *         "timeoutMs": 5000
 *       }
 *     }
 *   }
 *
 * Misses (404, any non-2xx, network error) silently return null. Writes
 * are best-effort and never throw.
 */

import type { AuditResult } from "../../../types/index.js";
import { parseAuditResponse } from "../../../utils/parser.js";
import { log } from "../../../utils/logger.js";
import type { CacheBackend } from "./types.js";

export interface HttpCacheOptions {
  /** Base URL, joined with `/<key>` to form the per-entry URL. */
  baseUrl: string;
  /** Extra headers (e.g. Authorization). */
  headers?: Record<string, string>;
  /** Per-request timeout in milliseconds (default 5000). */
  timeoutMs?: number;
}

const trimSlash = (s: string): string => s.replace(/\/+$/, "");

const withTimeout = (ms: number): { signal: AbortSignal; cancel: () => void } => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
};

export const createHttpCacheBackend = (options: HttpCacheOptions): CacheBackend => {
  if (!options.baseUrl) {
    throw new Error("HTTP cache backend requires `baseUrl`.");
  }
  const base = trimSlash(options.baseUrl);
  const baseHeaders = options.headers ?? {};
  const timeoutMs = options.timeoutMs ?? 5_000;

  return {
    id: "http",
    async read(key: string): Promise<AuditResult | null> {
      const { signal, cancel } = withTimeout(timeoutMs);
      try {
        const res = await fetch(`${base}/${encodeURIComponent(key)}`, {
          method: "GET",
          headers: baseHeaders,
          signal,
        });
        if (!res.ok) return null;
        const text = await res.text();
        const result = parseAuditResponse(text);
        if (result.status === "ERROR") return null;
        return result;
      } catch {
        return null;
      } finally {
        cancel();
      }
    },
    async write(key: string, value: AuditResult): Promise<void> {
      const { signal, cancel } = withTimeout(timeoutMs);
      try {
        const res = await fetch(`${base}/${encodeURIComponent(key)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...baseHeaders },
          body: JSON.stringify(value),
          signal,
        });
        if (!res.ok) {
          log.warning(
            `HTTP cache write returned ${res.status} ${res.statusText} — entry not stored`,
          );
        }
      } catch (err) {
        log.warning(`HTTP cache write failed: ${(err as Error).message}`);
      } finally {
        cancel();
      }
    },
  };
};
