/**
 * Compact agent-search CLI handlers for the indexing command.
 */

import { SystemError, UserError } from "../utils/errors.js";
import { log } from "../utils/logger.js";
import type { SourceIndex } from "../types/index.js";
import { emitIndexJson } from "../services/source-index/json-output.js";
import {
  queryFilesLimited,
  queryUnifiedSearch,
  clampSearchLimit,
  isSearchHitKind,
  DEFAULT_FIND_LIMIT,
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
  type SearchHitKind,
  type CompactSearchHit,
  type CompactSearchResult,
} from "../services/source-index/agent-search.js";

export function parseLimitFlag(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  // Reject parseInt prefixes ("1.5", "5garbage", "+3"). Whole string must be a
  // base-10 integer >= 1.
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new UserError(`--limit must be an integer >= 1 (got ${JSON.stringify(raw)})`);
  }
  // Digit strings longer than MAX_SEARCH_LIMIT (50) would overflow Number
  // (parseInt → Infinity) and previously fell back to 10/20. Cap instead.
  if (trimmed.length > String(MAX_SEARCH_LIMIT).length) {
    return MAX_SEARCH_LIMIT;
  }
  const n = Number.parseInt(trimmed, 10);
  return clampSearchLimit(n, fallback);
}

export function parseSearchKinds(raw: string | undefined): SearchHitKind[] | undefined {
  if (raw === undefined) return undefined;
  const parts = raw
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
  if (parts.length === 0) {
    throw new UserError("--kind must list one or more of: symbol, file, import, code");
  }
  const kinds: SearchHitKind[] = [];
  for (const part of parts) {
    if (!isSearchHitKind(part)) {
      throw new UserError(
        `Unknown --kind "${part}". Use comma-separated: symbol, file, import, code`,
      );
    }
    if (!kinds.includes(part)) kinds.push(part);
  }
  return kinds;
}

function formatHit(hit: CompactSearchHit): string {
  const loc = hit.line !== undefined ? `${hit.file}:${hit.line}` : hit.file;
  const detail = [hit.type, hit.name, hit.text]
    .filter((v) => v !== undefined && v !== "")
    .join(" ");
  return `  ${hit.kind.padEnd(7)} ${loc}  ${detail}  [${hit.score}]`;
}

/**
 * Handle --search: unified compact hits across symbols, files, and imports.
 */
export async function handleSearch(
  query: string,
  index: SourceIndex | null,
  format: "console" | "json",
  cachePath: string,
  limit?: number,
  kinds?: SearchHitKind[],
): Promise<number> {
  const cap = clampSearchLimit(limit, DEFAULT_SEARCH_LIMIT);
  let result: CompactSearchResult;
  try {
    result = await queryUnifiedSearch(
      index,
      query,
      { limit: cap, ...(kinds && kinds.length > 0 ? { kinds } : {}) },
      cachePath,
    );
  } catch (error) {
    if (error instanceof SystemError) {
      if (format === "json") {
        emitIndexJson({ status: "ERROR", error: error.message });
      } else {
        log.critical(error.message);
      }
      return 2;
    }
    throw error;
  }

  if (!index) {
    if (format === "json") {
      emitIndexJson({ query, hits: [], count: 0, truncated: false, kinds: result.kinds });
    } else {
      console.log("No index available. Run 'mp-sentinel indexing' first.");
    }
    return 0;
  }

  if (format === "json") {
    emitIndexJson(result);
  } else {
    console.log();
    if (result.hits.length === 0) {
      console.log(`No index hits matching "${query}".`);
    } else {
      const more = result.truncated ? ", truncated" : "";
      console.log(`Index search "${query}" (${result.count} hits${more}):`);
      for (const hit of result.hits) {
        console.log(formatHit(hit));
      }
    }
    console.log();
  }

  return 0;
}

/**
 * Handle --find-file: locate indexed files by path or basename.
 */
export function handleFindFile(
  query: string,
  index: SourceIndex | null,
  format: "console" | "json",
  limit?: number,
): number {
  const { results, truncated } = queryFilesLimited(index, query, limit);

  if (!index) {
    if (format === "json") {
      emitIndexJson({ query, results: [] });
    } else {
      console.log("No index available. Run 'mp-sentinel indexing' first.");
    }
    return 0;
  }

  if (format === "json") {
    emitIndexJson({
      query,
      count: results.length,
      truncated,
      results: results.map((r) => ({ file: r.file, score: r.score })),
    });
  } else {
    console.log();
    if (results.length === 0) {
      console.log(`No indexed files matching "${query}".`);
    } else {
      console.log(`Indexed files matching "${query}" (${results.length} results):`);
      for (const r of results) {
        console.log(`  ${r.file}  [score=${r.score}, ${r.reason}]`);
      }
    }
    console.log();
  }

  return 0;
}

export { DEFAULT_FIND_LIMIT, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT };
