/**
 * Index Storage - Read/write source index cache.
 *
 * Schema 1.5 introduces a zero-dependency "light" cache layout: the core
 * `source-index.json` stays small and compact (project, files, graph,
 * insights, stats) while the heavy payloads move to JSONL sidecars next
 * to it:
 *
 *   source-index.<id>.code.jsonl   — codeSearch snippets, one row per file
 *   source-index.<id>.calls.jsonl  — call edges, one row per file
 *   source-index.<id>.lookup.json  — per-path byte offsets into both
 *
 * Sidecars are written before the core file; the core references the
 * exact generation via `sidecars.storageId`, so readers never observe a
 * torn pair. Old-generation sidecars are cleaned up best-effort.
 *
 * Readers choose a hydration level: "none" (core only — symbol/import
 * queries), "calls" (review call-impact, agent context), "code"
 * (code search), or "full". Legacy 1.0–1.4 monolithic caches and
 * `cacheMode: "full"` caches hydrate trivially (payloads are inline).
 */

import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, basename, join } from "node:path";
import { log } from "../../utils/logger.js";
import { CURRENT_SOURCE_INDEX_SCHEMA } from "../../types/index.js";
import type {
  CacheValidity,
  CallEdge,
  CodeSearchEntry,
  SidecarFileMeta,
  SourceIndex,
  SourceIndexFile,
} from "../../types/index.js";

const DEFAULT_CACHE_PATH = ".mp-sentinel-cache/source-index.json";

const VALID_SCHEMAS = ["1.0", "1.1", "1.2", "1.3", "1.4", "1.5"] as const;

/** How much sidecar payload to attach when reading a light cache. */
export type IndexHydration = "none" | "calls" | "code" | "full";

/** One row in a sidecar JSONL file: [path, packedEntries]. */
type CodeRow = [string, Array<[number, number, string, string?, string?]>];
type CallsRow = [string, Array<[string, number, number, string?]>];

// ── Basic helpers ────────────────────────────────────────────────────────────

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

const sidecarPath = (cachePath: string, file: string): string => join(dirname(cachePath), file);

// ── Packing / unpacking sidecar rows ────────────────────────────────────────

const packCodeRow = (file: SourceIndexFile): CodeRow => [
  file.path,
  (file.codeSearch ?? []).map((e) => {
    const packed: [number, number, string, string?, string?] = [e.line, e.column, e.text];
    if (e.nearestSymbol !== undefined) packed[3] = e.nearestSymbol;
    if (e.nearestSymbolType !== undefined) packed[4] = e.nearestSymbolType;
    return packed;
  }),
];

const unpackCodeRow = (row: CodeRow): { path: string; entries: CodeSearchEntry[] } => ({
  path: row[0],
  entries: row[1].map((packed) => {
    const entry: CodeSearchEntry = { line: packed[0], column: packed[1], text: packed[2] };
    if (packed[3] !== undefined) entry.nearestSymbol = packed[3];
    if (packed[4] !== undefined) {
      entry.nearestSymbolType = packed[4] as NonNullable<CodeSearchEntry["nearestSymbolType"]>;
    }
    return entry;
  }),
});

const packCallsRow = (file: SourceIndexFile): CallsRow => [
  file.path,
  (file.calls ?? []).map((c) => {
    const packed: [string, number, number, string?] = [c.callee, c.line, c.column];
    if (c.inSymbol !== undefined) packed[3] = c.inSymbol;
    return packed;
  }),
];

const unpackCallsRow = (row: CallsRow): { path: string; calls: CallEdge[] } => ({
  path: row[0],
  calls: row[1].map((packed) => {
    const edge: CallEdge = { callee: packed[0], line: packed[1], column: packed[2] };
    if (packed[3] !== undefined) edge.inSymbol = packed[3];
    return edge;
  }),
});

// ── Read path ────────────────────────────────────────────────────────────────

/**
 * Read source index from cache file.
 *
 * Legacy 1.0–1.4 caches are returned as-is (payloads inline). Schema 1.5
 * light caches are hydrated from sidecars according to `hydrate`
 * (default "full" so existing consumers keep complete data). Missing or
 * corrupt sidecars degrade gracefully: the core index is still returned,
 * just without the affected payload.
 */
export async function readIndex(
  cachePath: string = DEFAULT_CACHE_PATH,
  options: { hydrate?: IndexHydration } = {},
): Promise<SourceIndex | null> {
  try {
    if (!existsSync(cachePath)) {
      return null;
    }

    const content = await readFile(cachePath, "utf-8");
    const index = JSON.parse(content) as SourceIndex;

    if (
      !index.schemaVersion ||
      !VALID_SCHEMAS.includes(index.schemaVersion as (typeof VALID_SCHEMAS)[number])
    ) {
      log.warning(`Invalid or unsupported index schema version: ${index.schemaVersion}`);
      return null;
    }

    const hydrate = options.hydrate ?? "full";
    if (hydrate !== "none") {
      await hydrateIndex(index, cachePath, hydrate);
    }

    return index;
  } catch {
    // readIndex must never write to stdout — JSON mode depends on stdout isolation.
    // Use stderr for diagnostics so the JSON parse contract is not broken.
    return null;
  }
}

/**
 * Attach sidecar payloads to a light-core index in place. No-op for legacy
 * or full-mode caches (payloads already inline) and for absent sidecars.
 * Returns false when a requested sidecar was present in metadata but could
 * not be read (the index stays usable without that payload).
 */
export async function hydrateIndex(
  index: SourceIndex,
  cachePath: string = DEFAULT_CACHE_PATH,
  level: IndexHydration = "full",
): Promise<boolean> {
  if (!index.sidecars || level === "none") return true;

  let ok = true;
  const wantCalls = level === "calls" || level === "full";
  const wantCode = level === "code" || level === "full";

  if (wantCalls && index.sidecars.calls) {
    ok = (await hydratePayload(index, cachePath, "calls")) && ok;
  }
  if (wantCode && index.sidecars.code) {
    ok = (await hydratePayload(index, cachePath, "code")) && ok;
  }
  return ok;
}

async function hydratePayload(
  index: SourceIndex,
  cachePath: string,
  kind: "calls" | "code",
): Promise<boolean> {
  const meta = kind === "calls" ? index.sidecars?.calls : index.sidecars?.code;
  if (!meta) return true;

  try {
    const raw = await readFile(sidecarPath(cachePath, meta.file), "utf-8");
    const byPath = new Map(index.files.map((f) => [f.path, f]));
    for (const line of raw.split("\n")) {
      if (!line) continue;
      const row = JSON.parse(line) as CodeRow | CallsRow;
      const file = byPath.get(row[0]);
      if (!file) continue;
      if (kind === "calls") {
        const { calls } = unpackCallsRow(row as CallsRow);
        if (calls.length > 0) file.calls = calls;
      } else {
        const { entries } = unpackCodeRow(row as CodeRow);
        if (entries.length > 0) file.codeSearch = entries;
      }
    }
    return true;
  } catch {
    log.debug(`Sidecar ${meta.file} missing or unreadable — continuing with core index`);
    return false;
  }
}

/**
 * Stream code-search entries without holding the whole payload in memory.
 * Visits inline payloads for legacy/full caches; streams the code sidecar
 * line-by-line for light caches. Returns false when a light cache's code
 * sidecar is missing/corrupt (visitor may have seen a partial stream).
 */
export async function streamCodeEntries(
  index: SourceIndex,
  cachePath: string,
  visit: (path: string, entries: CodeSearchEntry[]) => void,
): Promise<boolean> {
  // Inline payloads (legacy schema or cacheMode: "full")
  if (!index.sidecars?.code) {
    for (const file of index.files) {
      if (file.codeSearch && file.codeSearch.length > 0) {
        visit(file.path, file.codeSearch);
      }
    }
    return true;
  }

  const file = sidecarPath(cachePath, index.sidecars.code.file);
  if (!existsSync(file)) return false;

  try {
    // Lazy imports: streaming is a cold path for library consumers — keep
    // these out of the static import graph so dist/lib.js tree-shakes clean.
    const { createReadStream } = await import("node:fs");
    const { createInterface } = await import("node:readline");
    const rl = createInterface({
      input: createReadStream(file, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line) continue;
      const { path, entries } = unpackCodeRow(JSON.parse(line) as CodeRow);
      if (entries.length > 0) visit(path, entries);
    }
    return true;
  } catch {
    return false;
  }
}

/** Sidecar presence/validity + size report for --stats and --health. */
export interface SidecarStatus {
  cacheMode: "light" | "full" | "legacy";
  sidecarsPresent: boolean;
  sidecarsValid: boolean;
  missing: string[];
  coreBytes: number;
  sidecarBytes: number;
}

/**
 * Inspect the on-disk cache layout. Never throws; missing files are
 * reported, not fatal.
 */
export async function getSidecarStatus(
  index: SourceIndex,
  cachePath: string = DEFAULT_CACHE_PATH,
): Promise<SidecarStatus> {
  let coreBytes = 0;
  try {
    coreBytes = (await stat(cachePath)).size;
  } catch {
    // Core missing — leave 0
  }

  if (!index.sidecars) {
    return {
      cacheMode: index.schemaVersion === CURRENT_SOURCE_INDEX_SCHEMA ? "full" : "legacy",
      sidecarsPresent: false,
      sidecarsValid: true,
      missing: [],
      coreBytes,
      sidecarBytes: 0,
    };
  }

  const metas = [index.sidecars.code, index.sidecars.calls].filter(
    (m): m is SidecarFileMeta => m !== undefined,
  );
  const missing: string[] = [];
  let sidecarBytes = 0;
  for (const meta of metas) {
    try {
      sidecarBytes += (await stat(sidecarPath(cachePath, meta.file))).size;
    } catch {
      missing.push(meta.file);
    }
  }

  return {
    cacheMode: "light",
    sidecarsPresent: metas.length > 0,
    sidecarsValid: missing.length === 0,
    missing,
    coreBytes,
    sidecarBytes,
  };
}

// ── Write path ───────────────────────────────────────────────────────────────

/**
 * Write source index to cache file.
 *
 * Light mode (default): writes JSONL sidecars first, then a compact core
 * that references them; cleans up sidecars from previous generations
 * best-effort. Full mode inlines everything (compact JSON, no sidecars).
 */
export async function writeIndex(
  index: SourceIndex,
  cachePath: string = DEFAULT_CACHE_PATH,
  options: { cacheMode?: "light" | "full" } = {},
): Promise<void> {
  const cacheMode = options.cacheMode ?? "light";
  try {
    await ensureCacheDir(cachePath);

    if (cacheMode === "full") {
      const { sidecars: _drop, ...rest } = index;
      await writeFile(cachePath, JSON.stringify(rest), "utf-8");
      await cleanupStaleSidecars(cachePath, null);
      delete index.sidecars;
      log.info(`Source index written to ${cachePath}`);
      return;
    }

    const { randomBytes } = await import("node:crypto");
    const storageId = randomBytes(4).toString("hex");
    const base = basename(cachePath).replace(/\.json$/, "");
    const lookup: {
      code: Record<string, [number, number]>;
      calls: Record<string, [number, number]>;
    } = { code: {}, calls: {} };

    const codeMeta = await writeSidecar(
      cachePath,
      `${base}.${storageId}.code.jsonl`,
      index.files.filter((f) => f.codeSearch && f.codeSearch.length > 0),
      packCodeRow,
      lookup.code,
    );
    const callsMeta = await writeSidecar(
      cachePath,
      `${base}.${storageId}.calls.jsonl`,
      index.files.filter((f) => f.calls && f.calls.length > 0),
      packCallsRow,
      lookup.calls,
    );

    let lookupMeta: { file: string } | undefined;
    if (codeMeta || callsMeta) {
      const lookupFile = `${base}.${storageId}.lookup.json`;
      await writeFile(sidecarPath(cachePath, lookupFile), JSON.stringify(lookup), "utf-8");
      lookupMeta = { file: lookupFile };
    }

    // Compact core: strip heavy payloads, reference the sidecar generation
    const coreFiles = index.files.map((f) => {
      const { codeSearch: _code, calls: _calls, ...core } = f;
      return core as SourceIndexFile;
    });
    const core: SourceIndex = {
      ...index,
      files: coreFiles,
      ...(codeMeta || callsMeta
        ? {
            sidecars: {
              storageId,
              ...(codeMeta && { code: codeMeta }),
              ...(callsMeta && { calls: callsMeta }),
              ...(lookupMeta && { lookup: lookupMeta }),
            },
          }
        : {}),
    };
    if (!codeMeta && !callsMeta) {
      delete core.sidecars;
    }

    await writeFile(cachePath, JSON.stringify(core), "utf-8");
    await cleanupStaleSidecars(cachePath, storageId);
    // Mirror the written layout on the in-memory index (payloads stay
    // attached) so --stats/--health right after a build see the real mode.
    if (core.sidecars) {
      index.sidecars = core.sidecars;
    } else {
      delete index.sidecars;
    }
    log.info(`Source index written to ${cachePath}`);
  } catch (error) {
    log.error(
      `Failed to write source index: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  }
}

async function writeSidecar(
  cachePath: string,
  fileName: string,
  files: SourceIndexFile[],
  pack: (file: SourceIndexFile) => CodeRow | CallsRow,
  offsets: Record<string, [number, number]>,
): Promise<SidecarFileMeta | undefined> {
  if (files.length === 0) return undefined;

  const lines: string[] = [];
  let position = 0;
  for (const file of files) {
    const line = JSON.stringify(pack(file));
    const byteLength = Buffer.byteLength(line, "utf-8");
    offsets[file.path] = [position, byteLength];
    position += byteLength + 1; // +1 for the trailing newline
    lines.push(line);
  }

  const content = lines.join("\n") + "\n";
  await writeFile(sidecarPath(cachePath, fileName), content, "utf-8");
  return { file: fileName, bytes: Buffer.byteLength(content, "utf-8"), entryCount: files.length };
}

/**
 * Remove sidecars from previous generations (different storageId).
 * Best-effort: failures are ignored.
 */
async function cleanupStaleSidecars(cachePath: string, keepId: string | null): Promise<void> {
  try {
    const dir = dirname(cachePath);
    const base = basename(cachePath).replace(/\.json$/, "");
    const pattern = new RegExp(
      `^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.([0-9a-f]{8})\\.(code\\.jsonl|calls\\.jsonl|lookup\\.json)$`,
    );
    const { readdir, unlink } = await import("node:fs/promises");
    for (const entry of await readdir(dir)) {
      const match = pattern.exec(entry);
      if (match && match[1] !== keepId) {
        await unlink(join(dir, entry)).catch(() => {});
      }
    }
  } catch {
    // Best-effort only
  }
}

// ── Cache validation ─────────────────────────────────────────────────────────

/**
 * Check if cache is valid by comparing file hashes and mtimes.
 *
 * "fast" mode (default) compares size+mtime first and hashes only files
 * whose stat changed; "strict" hashes every file (legacy behavior).
 */
export async function validateCache(
  cachePath: string,
  projectRoot: string,
  files: string[],
  getFileContent: (path: string) => Promise<string>,
  getFileMtime: (path: string) => Promise<number>,
  options: {
    index?: SourceIndex | null;
    mode?: "fast" | "strict";
    getFileSize?: (path: string) => Promise<number>;
  } = {},
): Promise<CacheValidity> {
  const index =
    options.index !== undefined ? options.index : await readIndex(cachePath, { hydrate: "none" });

  if (!index) {
    return { valid: false };
  }

  const mode = options.mode ?? "fast";
  const staleFiles: string[] = [];
  const missingFiles: string[] = [];
  const modifiedFiles: string[] = [];

  // Build map of indexed files by path
  const indexedFiles = new Map(index.files.map((f) => [f.path, f]));
  const currentFiles = new Set(files);

  for (const filePath of files) {
    const absolutePath = resolve(projectRoot, filePath);
    const indexed = indexedFiles.get(filePath);

    if (!indexed) {
      missingFiles.push(filePath);
      continue;
    }

    try {
      const mtime = await getFileMtime(absolutePath);

      // Fast path: identical mtime + size means unchanged — skip the hash.
      if (mode === "fast" && options.getFileSize && typeof indexed.sizeBytes === "number") {
        const size = await options.getFileSize(absolutePath);
        if (mtime === indexed.mtimeMs && size === indexed.sizeBytes) {
          continue;
        }
      }

      const content = await getFileContent(absolutePath);
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

  for (const indexedPath of indexedFiles.keys()) {
    if (!currentFiles.has(indexedPath)) {
      missingFiles.push(indexedPath);
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
  options: {
    mode?: "fast" | "strict";
    getFileSize?: (path: string) => Promise<number>;
    /** Pre-read core index (hydrate "none") to avoid a duplicate read. */
    index?: SourceIndex | null;
  } = {},
): Promise<{
  toIndex: string[];
  fromCache: SourceIndexFile[];
  validity: CacheValidity;
}> {
  // Single core read shared between validation and reuse decisions.
  const existingIndex =
    options.index !== undefined ? options.index : await readIndex(cachePath, { hydrate: "none" });
  const validity = await validateCache(
    cachePath,
    projectRoot,
    allFiles,
    getFileContent,
    getFileMtime,
    { index: existingIndex, ...options },
  );

  if (!existingIndex) {
    return {
      toIndex: allFiles,
      fromCache: [],
      validity,
    };
  }

  // Old schemas are readable for diagnostics, but force a FULL rebuild for
  // lookup correctness — never reuse parsed entries from an outdated schema,
  // even when only some files changed (partial reuse would smuggle stale
  // payload semantics into the new layout).
  if (existingIndex.schemaVersion !== CURRENT_SOURCE_INDEX_SCHEMA) {
    return {
      toIndex: allFiles,
      fromCache: [],
      validity: { valid: false, schemaOutdated: true },
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

  // Carried-over files keep their heavy payloads: hydrate before reuse so an
  // incremental rebuild never silently drops codeSearch/calls data.
  await hydrateIndex(existingIndex, cachePath, "full");

  return {
    toIndex: allFiles.filter((f) => needsReindex.has(f)),
    fromCache: existingIndex.files.filter((f) => !needsReindex.has(f.path)),
    validity,
  };
}
