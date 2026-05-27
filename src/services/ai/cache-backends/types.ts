/**
 * Cache backend interface (Phase 3.3).
 *
 * The default `fs` backend stores cache entries in `.mp-sentinel-cache/`.
 * Teams running parallel CI shards can swap in a shared backend (`http`
 * for a generic KV store) to deduplicate AI calls across workers.
 *
 * All backends share the same key-derivation (`buildAuditCacheKey` in
 * cache.ts) so a v4 entry written by the `fs` backend can be read by
 * the `http` backend and vice-versa.
 */

import type { AuditResult } from "../../../types/index.js";

export interface CacheBackend {
  /** Backend identifier used in config + logs. */
  readonly id: string;
  /**
   * Read a cached entry by key. Returns null on miss, parse failure, or
   * any I/O error — backends never throw on a read.
   */
  read(key: string): Promise<AuditResult | null>;
  /**
   * Write a cache entry. Best-effort: failures are logged but never
   * propagate (a cache write failure must not break the review pipeline).
   */
  write(key: string, value: AuditResult): Promise<void>;
}
