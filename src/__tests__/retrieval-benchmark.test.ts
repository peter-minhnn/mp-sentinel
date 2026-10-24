/**
 * Retrieval baseline: compact `--search` vs older find-* APIs.
 *
 * Golden queries cover symbol, path, import, code, and fuzzy lookups.
 * Unified search must match or beat the dedicated finder on Recall@5,
 * MRR, and Top-1 for each query. Compact hits omit nested finder fields
 * so the JSON payload stays smaller than the old envelopes.
 */

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import { buildSourceIndex } from "../commands/indexing.js";
import {
  queryUnifiedSearch,
  queryFiles,
  type CompactSearchHit,
  type SearchHitKind,
} from "../services/source-index/agent-search.js";
import { querySymbols, queryImports, queryCodeStream } from "../services/source-index/query.js";
import { clearParserCache } from "../services/source-index/parser.js";
import { setLogQuietMode } from "../utils/logger.js";
import type { IndexableLanguage, SourceIndex } from "../types/index.js";
import {
  average,
  estimateTokens,
  meanReciprocalRank,
  payloadBytes,
  percentile,
  recallAtK,
  top1Hit,
  uniqueRankedFiles,
} from "./helpers/retrieval-metrics.js";

const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "mp-sentinel-retrieval-"));
  tempDirs.push(dir);
  return dir;
};

beforeEach(() => {
  clearParserCache();
});

afterEach(async () => {
  clearParserCache();
  setLogQuietMode(false);
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const CONFIG = {
  enabled: true,
  languages: ["typescript", "tsx", "javascript", "jsx"] as IndexableLanguage[],
  cachePath: ".mp-sentinel-cache/source-index.json",
  maxFileSize: 512000,
  maxRelatedFiles: 20,
};

const seedCorpus = async (cwd: string): Promise<void> => {
  await mkdir(join(cwd, "src"), { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ name: "retrieval-bench", version: "1.0.0" }),
  );
  await writeFile(
    join(cwd, "src", "index.ts"),
    `import { z } from "zod";\n` +
      `export function hello() { return "hi"; }\n` +
      `export class HelloWorld {}\n` +
      `export const parsed = z.string();\n`,
  );
  await writeFile(join(cwd, "src", "utils.ts"), `export function helper() { return true; }\n`);
  await writeFile(
    join(cwd, "src", "make-parser.ts"),
    `export function makeParser() { return { parse: () => 1 }; }\n`,
  );
};

type QueryKind = "symbol" | "path" | "import" | "code" | "fuzzy";

interface GoldenQuery {
  kind: QueryKind;
  query: string;
  relevant: string[];
}

const GOLDEN: GoldenQuery[] = [
  { kind: "symbol", query: "hello", relevant: ["src/index.ts"] },
  { kind: "symbol", query: "HelloWorld", relevant: ["src/index.ts"] },
  { kind: "path", query: "utils.ts", relevant: ["src/utils.ts"] },
  { kind: "path", query: "make-parser.ts", relevant: ["src/make-parser.ts"] },
  { kind: "import", query: "zod", relevant: ["src/index.ts"] },
  { kind: "code", query: "makeParser", relevant: ["src/make-parser.ts"] },
  { kind: "fuzzy", query: "util", relevant: ["src/utils.ts"] },
];

const VERBOSE_HIT_KEYS = ["reason", "language", "symbol", "importInfo", "entry"] as const;

function searchKindsFor(kind: QueryKind): SearchHitKind[] {
  if (kind === "fuzzy") return ["symbol", "file", "import"];
  if (kind === "path") return ["file"];
  return [kind];
}

function rankedFromHits(hits: Array<{ file: string }>): string[] {
  return uniqueRankedFiles(hits.map((h) => h.file));
}

function assertCompactHits(hits: CompactSearchHit[]): void {
  for (const hit of hits) {
    for (const key of VERBOSE_HIT_KEYS) {
      expect(key in hit).toBe(false);
    }
  }
}

async function oldFinderEnvelope(
  index: SourceIndex,
  cachePath: string,
  item: GoldenQuery,
): Promise<{ files: string[]; payload: unknown }> {
  switch (item.kind) {
    case "symbol": {
      const results = querySymbols(index, item.query, 5);
      return { files: rankedFromHits(results), payload: { query: item.query, results } };
    }
    case "path": {
      const results = queryFiles(index, item.query, 5).map((r) => ({
        file: r.file,
        score: r.score,
      }));
      return { files: rankedFromHits(results), payload: { query: item.query, results } };
    }
    case "import": {
      const results = queryImports(index, item.query, 5);
      return { files: rankedFromHits(results), payload: { query: item.query, results } };
    }
    case "code": {
      const results = await queryCodeStream(index, cachePath, item.query, 5);
      return { files: rankedFromHits(results), payload: { query: item.query, results } };
    }
    case "fuzzy": {
      const results = [
        ...querySymbols(index, item.query, 5),
        ...queryFiles(index, item.query, 5),
        ...queryImports(index, item.query, 5),
      ];
      return { files: rankedFromHits(results), payload: { query: item.query, results } };
    }
    default: {
      const _never: never = item.kind;
      return _never;
    }
  }
}

describe("retrieval baseline (unified --search vs old finders)", () => {
  it("matches or beats dedicated finders on Recall@5 / MRR / Top-1 with a smaller payload", async () => {
    const cwd = await makeTempDir();
    await seedCorpus(cwd);
    setLogQuietMode(true);
    const index = await buildSourceIndex(cwd, CONFIG, true);
    expect(index).not.toBeNull();
    if (!index) return;
    const cachePath = join(cwd, CONFIG.cachePath);

    const byKind: Record<QueryKind, { unified: number[]; old: number[] }> = {
      symbol: { unified: [], old: [] },
      path: { unified: [], old: [] },
      import: { unified: [], old: [] },
      code: { unified: [], old: [] },
      fuzzy: { unified: [], old: [] },
    };

    for (const item of GOLDEN) {
      const unified = await queryUnifiedSearch(
        index,
        item.query,
        { limit: 5, kinds: searchKindsFor(item.kind) },
        cachePath,
      );
      const old = await oldFinderEnvelope(index, cachePath, item);
      const unifiedFiles = rankedFromHits(unified.hits);

      const unifiedRecall = recallAtK(unifiedFiles, item.relevant, 5);
      const oldRecall = recallAtK(old.files, item.relevant, 5);
      const unifiedMrr = meanReciprocalRank(unifiedFiles, item.relevant);
      const oldMrr = meanReciprocalRank(old.files, item.relevant);

      expect(unifiedRecall).toBe(1);
      expect(unifiedRecall).toBeGreaterThanOrEqual(oldRecall);
      expect(unifiedMrr).toBeGreaterThanOrEqual(oldMrr);
      expect(top1Hit(unifiedFiles, item.relevant)).toBe(true);
      assertCompactHits(unified.hits);

      const unifiedBytes = payloadBytes(unified);
      const oldBytes = payloadBytes(old.payload);
      expect(unifiedBytes).toBeGreaterThan(0);
      expect(estimateTokens(unifiedBytes)).toBeGreaterThan(0);
      if (item.kind === "symbol" || item.kind === "import" || item.kind === "code") {
        expect(unifiedBytes).toBeLessThan(oldBytes);
      }

      byKind[item.kind].unified.push(unifiedRecall);
      byKind[item.kind].old.push(oldRecall);
    }

    for (const kind of Object.keys(byKind) as QueryKind[]) {
      expect(average(byKind[kind].unified)).toBe(1);
    }

    const latencies: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      await queryUnifiedSearch(index, "hello", { limit: 5, kinds: ["symbol"] }, cachePath);
      latencies.push(performance.now() - start);
    }
    expect(percentile(latencies, 0.5)).toBeGreaterThanOrEqual(0);
    expect(percentile(latencies, 0.95)).toBeGreaterThanOrEqual(percentile(latencies, 0.5));
  });
});
