/**
 * Compact, token-cheap search over a SourceIndex for AI agents.
 *
 * `--search` unions symbol / file / import hits (code snippets opt-in via
 * `--kind code`). Hits are flat, capped, and omit verbose reason/language
 * fields that agents do not need to pick the next file to open.
 */

import type { SourceIndex, CodeSearchResult } from "../../types/index.js";
import {
  querySymbols,
  queryImports,
  queryCodeStream,
  tokenVariants,
  type SymbolResult,
  type ImportResult,
} from "./query.js";

export const DEFAULT_FIND_LIMIT = 20;
export const DEFAULT_SEARCH_LIMIT = 10;
export const MAX_SEARCH_LIMIT = 50;
export const MAX_SNIPPET_CHARS = 80;

export const SEARCH_HIT_KINDS = ["symbol", "file", "import", "code"] as const;
export type SearchHitKind = (typeof SEARCH_HIT_KINDS)[number];

/** Default `--search` kinds: structured hits only. Code snippets are opt-in. */
export const DEFAULT_SEARCH_KINDS: readonly SearchHitKind[] = ["symbol", "file", "import"];

export interface CompactSearchHit {
  kind: SearchHitKind;
  file: string;
  score: number;
  name?: string;
  type?: string;
  line?: number;
  text?: string;
}

export interface CompactSearchResult {
  query: string;
  count: number;
  truncated: boolean;
  kinds: SearchHitKind[];
  hits: CompactSearchHit[];
}

export interface FileSearchResult {
  file: string;
  language: string;
  score: number;
  reason: string;
}

export interface AgentSearchOptions {
  limit?: number;
  kinds?: SearchHitKind[];
}

export function clampSearchLimit(limit: number | undefined, fallback: number): number {
  if (limit === undefined) return fallback;
  if (typeof limit !== "number" || Number.isNaN(limit) || limit < 1) return fallback;
  // Infinity / overflow must cap at MAX, not fall back to the default.
  if (!Number.isFinite(limit)) return MAX_SEARCH_LIMIT;
  return Math.min(Math.floor(limit), MAX_SEARCH_LIMIT);
}

/**
 * Slice to `limit` and report whether more items existed.
 * Callers should pass `limit + 1` collected items so an exact-limit result
 * is not marked truncated.
 */
export function takeLimit<T>(
  items: readonly T[],
  limit: number,
): { items: T[]; truncated: boolean } {
  const cap = clampSearchLimit(limit, DEFAULT_SEARCH_LIMIT);
  return {
    items: items.slice(0, cap),
    truncated: items.length > cap,
  };
}

export function isSearchHitKind(value: string): value is SearchHitKind {
  return (SEARCH_HIT_KINDS as readonly string[]).includes(value);
}

function normalizePathQuery(query: string): string {
  return query.replace(/\\/g, "/");
}

function basenameOf(path: string): string {
  const normalized = normalizePathQuery(path);
  const slash = normalized.lastIndexOf("/");
  return slash === -1 ? normalized : normalized.slice(slash + 1);
}

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

function clipSnippet(text: string): string {
  if (text.length <= MAX_SNIPPET_CHARS) return text;
  return `${text.slice(0, MAX_SNIPPET_CHARS - 3)}...`;
}

function compactSymbol(result: SymbolResult): CompactSearchHit {
  const hit: CompactSearchHit = {
    kind: "symbol",
    file: result.file,
    name: result.symbol.name,
    type: result.symbol.type,
    line: result.symbol.line,
    score: result.score,
  };
  return hit;
}

function compactImport(result: ImportResult): CompactSearchHit {
  const hit: CompactSearchHit = {
    kind: "import",
    file: result.file,
    name: result.importInfo.source,
    type: result.importInfo.kind,
    line: result.importInfo.line,
    score: result.score,
  };
  return hit;
}

function compactCode(result: CodeSearchResult): CompactSearchHit {
  const hit: CompactSearchHit = {
    kind: "code",
    file: result.file,
    line: result.entry.line,
    text: clipSnippet(result.entry.text),
    score: result.score,
  };
  if (result.entry.nearestSymbol) {
    hit.name = result.entry.nearestSymbol;
  }
  if (result.entry.nearestSymbolType) {
    hit.type = result.entry.nearestSymbolType;
  }
  return hit;
}

function compactFile(result: FileSearchResult): CompactSearchHit {
  return {
    kind: "file",
    file: result.file,
    name: basenameOf(result.file),
    score: result.score,
  };
}

/**
 * Search indexed file paths by relative path, basename, or basename without extension.
 *
 * Scoring:
 * - Exact path: 100
 * - Exact basename: 95
 * - Case-insensitive path: 90
 * - Case-insensitive basename: 85
 * - Basename without extension: 80
 * - Path/basename prefix: 75 / 70
 * - Token-normalized basename: 60
 * - Path/basename contains: 50 / 45
 */
export function queryFiles(
  index: SourceIndex | null,
  query: string,
  limit: number = DEFAULT_SEARCH_LIMIT,
): FileSearchResult[] {
  if (!index) return [];

  const trimmed = normalizePathQuery(query.trim());
  if (!trimmed) return [];

  const lowerQuery = trimmed.toLowerCase();
  const variants = tokenVariants(trimmed).map((v) => v.toLowerCase());
  // Do not clamp to MAX_SEARCH_LIMIT here: callers pass `limit + 1` to detect truncation.
  const cap = Number.isInteger(limit) && limit >= 1 ? limit : DEFAULT_SEARCH_LIMIT;
  const results: FileSearchResult[] = [];

  for (const file of index.files) {
    const path = file.path;
    const lowerPath = path.toLowerCase();
    const base = basenameOf(path);
    const lowerBase = base.toLowerCase();
    const baseNoExt = stripExtension(base);
    const lowerBaseNoExt = baseNoExt.toLowerCase();

    let score = 0;
    let reason = "";

    if (path === trimmed) {
      score = 100;
      reason = "exact path match";
    } else if (base === trimmed) {
      score = 95;
      reason = "exact basename match";
    } else if (lowerPath === lowerQuery) {
      score = 90;
      reason = "case-insensitive path match";
    } else if (lowerBase === lowerQuery) {
      score = 85;
      reason = "case-insensitive basename match";
    } else if (lowerBaseNoExt === lowerQuery) {
      score = 80;
      reason = "basename without extension";
    } else if (lowerPath.startsWith(lowerQuery)) {
      score = 75;
      reason = "path starts with query";
    } else if (lowerBase.startsWith(lowerQuery)) {
      score = 70;
      reason = "basename starts with query";
    } else if (variants.some((v) => lowerBase === v || lowerBaseNoExt === v)) {
      score = 60;
      reason = "token-normalized basename match";
    } else if (lowerPath.includes(lowerQuery)) {
      score = 50;
      reason = "path contains query";
    } else if (lowerBase.includes(lowerQuery)) {
      score = 45;
      reason = "basename contains query";
    }

    if (score > 0) {
      results.push({
        file: path,
        language: file.language,
        score,
        reason,
      });
    }
  }

  results.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  return results.slice(0, cap);
}

/** Path search with an honest `truncated` flag (probe `limit + 1`, then slice). */
export function queryFilesLimited(
  index: SourceIndex | null,
  query: string,
  limit: number = DEFAULT_SEARCH_LIMIT,
): { results: FileSearchResult[]; truncated: boolean } {
  const cap = clampSearchLimit(limit, DEFAULT_SEARCH_LIMIT);
  const probed = queryFiles(index, query, cap + 1);
  const { items, truncated } = takeLimit(probed, cap);
  return { results: items, truncated };
}

function mergeHits(groups: CompactSearchHit[][], cap: number): CompactSearchHit[] {
  const merged = groups.flat();
  merged.sort(
    (a, b) => b.score - a.score || a.kind.localeCompare(b.kind) || a.file.localeCompare(b.file),
  );
  return merged.slice(0, cap);
}

/**
 * Unified agent search. Default kinds are symbol/file/import (no code snippets)
 * so a typical lookup stays small. Pass `kinds: ["code"]` (or include "code")
 * to add snippet hits.
 */
export async function queryUnifiedSearch(
  index: SourceIndex | null,
  query: string,
  options: AgentSearchOptions = {},
  cachePath?: string,
): Promise<CompactSearchResult> {
  const trimmed = query.trim();
  const kinds =
    options.kinds && options.kinds.length > 0 ? options.kinds : [...DEFAULT_SEARCH_KINDS];
  const cap = clampSearchLimit(options.limit, DEFAULT_SEARCH_LIMIT);
  const probe = cap + 1;

  if (!index || !trimmed) {
    return { query, count: 0, truncated: false, kinds, hits: [] };
  }

  const want = new Set(kinds);
  const groups: CompactSearchHit[][] = [];

  if (want.has("symbol")) {
    groups.push(querySymbols(index, trimmed, probe).map(compactSymbol));
  }
  if (want.has("file")) {
    groups.push(queryFiles(index, trimmed, probe).map(compactFile));
  }
  if (want.has("import")) {
    groups.push(queryImports(index, trimmed, probe).map(compactImport));
  }

  // Code snippets are token-heavy and opt-in (`--kind code`). Default kinds
  // skip them so a typical agent lookup stays a short structured hit list.
  if (want.has("code") && cachePath !== undefined) {
    const codeHits = (await queryCodeStream(index, cachePath, trimmed, probe)).map(compactCode);
    groups.push(codeHits);
  }

  const probed = mergeHits(groups, probe);
  const { items: hits, truncated } = takeLimit(probed, cap);

  return {
    query,
    count: hits.length,
    truncated,
    kinds,
    hits,
  };
}
