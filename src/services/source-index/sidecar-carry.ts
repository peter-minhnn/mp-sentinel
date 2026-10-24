/**
 * Carry light-cache sidecar payloads across incremental rebuilds.
 *
 * Copy-forward is gated by an explicit cacheHitPaths set — never by
 * "codeSearch/calls is undefined". Fresh parses (including lexical and
 * hard-error fallbacks that omit payloads) must not resurrect old JSONL
 * rows. Unreadable or size-mismatched sidecars force a full reindex
 * instead of a partial generation.
 */

import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { log } from "../../utils/logger.js";
import type {
  CallEdge,
  CodeSearchEntry,
  SidecarFileMeta,
  SourceIndex,
  SourceIndexFile,
} from "../../types/index.js";

type CodeRow = [string, Array<[number, number, string, string?, string?]>];
type CallsRow = [string, Array<[string, number, number, string?]>];

export class SidecarCarryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SidecarCarryError";
  }
}

const SPARSE_MIN_FILES = 8;
const SPARSE_COVERAGE_FACTOR = 4;

export type SidecarAuditDepth = "stat" | "parse";

/**
 * True when a light cache claims a code sidecar but the entry count is
 * far below the indexed file count — the signature of a dropped-payload
 * incremental write (e.g. 3 sidecar rows for 451 files).
 */
export function isSparseCodeSidecar(index: SourceIndex): boolean {
  const files = index.files.length;
  const entries = index.sidecars?.code?.entryCount ?? 0;
  if (!index.sidecars?.code || files < SPARSE_MIN_FILES) return false;
  return entries * SPARSE_COVERAGE_FACTOR < files;
}

const sidecarPath = (cachePath: string, file: string): string => join(dirname(cachePath), file);

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

const unpackCallsRow = (row: CallsRow): { path: string; calls: CallEdge[] } => ({
  path: row[0],
  calls: row[1].map((packed) => {
    const edge: CallEdge = { callee: packed[0], line: packed[1], column: packed[2] };
    if (packed[3] !== undefined) edge.inSymbol = packed[3];
    return edge;
  }),
});

/**
 * Read and JSON-parse every sidecar line. Returns [] when the core does
 * not claim this sidecar, null when the file is missing, the on-disk
 * size does not match meta.bytes, a line is corrupt JSON, or
 * rows.length !== meta.entryCount.
 */
async function readSidecarRows(
  cachePath: string,
  meta: SidecarFileMeta | undefined,
): Promise<unknown[] | null> {
  if (!meta) return [];
  const file = sidecarPath(cachePath, meta.file);
  try {
    const info = await stat(file);
    if (info.size !== meta.bytes) return null;
    const raw = await readFile(file, "utf-8");
    const rows: unknown[] = [];
    for (const line of raw.split("\n")) {
      if (line.length === 0) continue;
      rows.push(JSON.parse(line));
    }
    if (rows.length !== meta.entryCount) return null;
    return rows;
  } catch {
    return null;
  }
}

async function sidecarStatMismatch(
  cachePath: string,
  meta: SidecarFileMeta,
): Promise<string | null> {
  const file = sidecarPath(cachePath, meta.file);
  try {
    const info = await stat(file);
    if (info.size !== meta.bytes) return "size does not match core metadata";
    return null;
  } catch {
    return "unreadable";
  }
}

function asCodeRow(row: unknown): CodeRow | null {
  if (!Array.isArray(row) || typeof row[0] !== "string" || !Array.isArray(row[1])) return null;
  return row as CodeRow;
}

function asCallsRow(row: unknown): CallsRow | null {
  if (!Array.isArray(row) || typeof row[0] !== "string" || !Array.isArray(row[1])) return null;
  return row as CallsRow;
}

/**
 * Every sidecar row must be a `[path, payload[]]` pair, map to a known
 * core-index path, and appear at most once. Unknown or duplicate paths
 * are not skipped — the whole sidecar is invalid.
 */
export function collectValidSidecarRows(
  rows: unknown[],
  knownPaths: ReadonlySet<string>,
): Array<{ path: string; row: unknown[] }> | null {
  const seen = new Set<string>();
  const out: Array<{ path: string; row: unknown[] }> = [];
  for (const raw of rows) {
    if (!Array.isArray(raw) || typeof raw[0] !== "string" || !Array.isArray(raw[1])) {
      return null;
    }
    const path = raw[0];
    if (!knownPaths.has(path) || seen.has(path)) return null;
    seen.add(path);
    out.push({ path, row: raw });
  }
  return out;
}

function attachCode(file: SourceIndexFile, row: CodeRow, cacheHitPaths: ReadonlySet<string>): void {
  if (!cacheHitPaths.has(file.path)) return;
  if (file.codeSearch !== undefined) return;
  const { entries } = unpackCodeRow(row);
  if (entries.length > 0) file.codeSearch = entries;
}

function attachCalls(
  file: SourceIndexFile,
  row: CallsRow,
  cacheHitPaths: ReadonlySet<string>,
): void {
  if (!cacheHitPaths.has(file.path)) return;
  if (file.calls !== undefined) return;
  const { calls } = unpackCallsRow(row);
  if (calls.length > 0) file.calls = calls;
}

function sparseReason(entryCount: number, fileCount: number): string {
  return `Code sidecar coverage is sparse (${entryCount} entries / ${fileCount} files)`;
}

/**
 * Why this light-cache generation must not be reused as-is.
 *
 * `stat` only checks existence + actualBytes === meta.bytes (cheap; used
 * on index builds so compact --find-file / non-code search can skip this
 * entirely). `parse` also JSON-parses every line and checks
 * rows.length === meta.entryCount (write/carry path).
 */
export async function sidecarUnusableReason(
  index: SourceIndex,
  cachePath: string,
  depth: SidecarAuditDepth = "parse",
): Promise<string | null> {
  if (!index.sidecars) return null;
  if (isSparseCodeSidecar(index)) {
    return sparseReason(index.sidecars.code?.entryCount ?? 0, index.files.length);
  }

  const kinds: Array<["code" | "calls", SidecarFileMeta | undefined]> = [
    ["code", index.sidecars.code],
    ["calls", index.sidecars.calls],
  ];
  for (const [kind, meta] of kinds) {
    if (!meta) continue;
    if (depth === "stat") {
      const mismatch = await sidecarStatMismatch(cachePath, meta);
      if (mismatch) return `Light-cache ${kind} sidecar ${mismatch}`;
      continue;
    }
    const rows = await readSidecarRows(cachePath, meta);
    if (rows === null) return `Light-cache ${kind} sidecar unreadable`;
  }
  return null;
}

function applyCodeRows(
  rows: unknown[],
  byPath: Map<string, SourceIndexFile>,
  cacheHitPaths: ReadonlySet<string>,
  previousPaths: ReadonlySet<string>,
): void {
  const valid = collectValidSidecarRows(rows, previousPaths);
  if (!valid) {
    throw new SidecarCarryError(
      "previous code sidecar has an invalid, unknown, or duplicate row; refusing to write a partial light-cache generation",
    );
  }
  for (const item of valid) {
    const row = asCodeRow(item.row);
    if (!row) {
      throw new SidecarCarryError(
        "previous code sidecar has an invalid row; refusing to write a partial light-cache generation",
      );
    }
    const file = byPath.get(row[0]);
    if (file) attachCode(file, row, cacheHitPaths);
  }
}

function applyCallsRows(
  rows: unknown[],
  byPath: Map<string, SourceIndexFile>,
  cacheHitPaths: ReadonlySet<string>,
  previousPaths: ReadonlySet<string>,
): void {
  const valid = collectValidSidecarRows(rows, previousPaths);
  if (!valid) {
    throw new SidecarCarryError(
      "previous calls sidecar has an invalid, unknown, or duplicate row; refusing to write a partial light-cache generation",
    );
  }
  for (const item of valid) {
    const row = asCallsRow(item.row);
    if (!row) {
      throw new SidecarCarryError(
        "previous calls sidecar has an invalid row; refusing to write a partial light-cache generation",
      );
    }
    const file = byPath.get(row[0]);
    if (file) attachCalls(file, row, cacheHitPaths);
  }
}

/**
 * Copy previous-generation sidecar rows onto cache-hit files only.
 * `cacheHitPaths` is required: an empty set skips copy-forward (full reparse).
 */
export async function carryPreviousSidecarPayloads(
  index: SourceIndex,
  cachePath: string,
  cacheHitPaths: ReadonlySet<string> = new Set(),
): Promise<void> {
  if (cacheHitPaths.size === 0 || !existsSync(cachePath)) return;

  let previous: SourceIndex;
  try {
    previous = JSON.parse(await readFile(cachePath, "utf-8")) as SourceIndex;
  } catch {
    return;
  }
  if (!previous.sidecars) return;

  const byPath = new Map(index.files.map((f) => [f.path, f]));
  const previousPaths = new Set(previous.files.map((f) => f.path));

  const codeRows = await readSidecarRows(cachePath, previous.sidecars.code);
  if (previous.sidecars.code && codeRows === null) {
    const withoutCode = index.files.filter(
      (f) => cacheHitPaths.has(f.path) && f.codeSearch === undefined,
    ).length;
    if (withoutCode * 2 >= index.files.length && index.files.length > 0) {
      throw new SidecarCarryError(
        "previous code sidecar unreadable; refusing to write a partial light-cache generation",
      );
    }
    log.warning("Previous code sidecar unreadable — writing only in-memory payloads");
  } else if (codeRows) {
    applyCodeRows(codeRows, byPath, cacheHitPaths, previousPaths);
  }

  const callsRows = await readSidecarRows(cachePath, previous.sidecars.calls);
  if (previous.sidecars.calls && callsRows === null) {
    log.warning("Previous calls sidecar unreadable — writing only in-memory call edges");
  } else if (callsRows) {
    applyCallsRows(callsRows, byPath, cacheHitPaths, previousPaths);
  }
}
