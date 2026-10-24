/**
 * This-repo retrieval corpus contract.
 *
 * The fixture in retrieval-benchmark.test.ts stays the CI smoke gate.
 * scripts/retrieval-golden.json is the measurement set used before
 * designing mp_sentinel_task_context. Labels must stay valid: paths
 * exist, queries are unique per kind, and relevant sets are non-empty.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "@jest/globals";

interface GoldenQuery {
  kind: string;
  shape: string;
  query: string;
  relevant: string[];
}

const KINDS = ["symbol", "path", "import", "code", "fuzzy", "task"] as const;
/** Cut-off used by the bench (Recall@K / hits per query). */
const K = 5;
const SHAPES = ["exact", "ambiguous", "fuzzy", "task", "multi"] as const;
const GOLDEN_PATH = resolve("scripts/retrieval-golden.json");

describe("retrieval golden corpus", () => {
  const raw = readFileSync(GOLDEN_PATH, "utf-8");
  const golden = JSON.parse(raw) as GoldenQuery[];

  it("has 25-50 queries with required fields", () => {
    expect(Array.isArray(golden)).toBe(true);
    expect(golden.length).toBeGreaterThanOrEqual(25);
    expect(golden.length).toBeLessThanOrEqual(50);
    for (const item of golden) {
      expect(KINDS).toContain(item.kind);
      expect(SHAPES).toContain(item.shape);
      expect(item.query.trim().length).toBeGreaterThan(0);
      expect(Array.isArray(item.relevant)).toBe(true);
    }
  });

  it("covers every kind and shape, with task queries spanning multiple files", () => {
    const kinds = new Set(golden.map((q) => q.kind));
    const shapes = new Set(golden.map((q) => q.shape));
    for (const kind of KINDS) expect(kinds.has(kind)).toBe(true);
    for (const shape of SHAPES) expect(shapes.has(shape)).toBe(true);

    for (const kind of KINDS) {
      expect(golden.filter((q) => q.kind === kind).length).toBeGreaterThanOrEqual(3);
    }

    const taskQueries = golden.filter((q) => q.shape === "task");
    expect(taskQueries.length).toBeGreaterThanOrEqual(6);
    expect(taskQueries.some((q) => q.relevant.length >= 2)).toBe(true);
    const vietnamese = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
    expect(taskQueries.filter((q) => vietnamese.test(q.query)).length).toBeGreaterThanOrEqual(3);
    expect(taskQueries.some((q) => q.query.length > 80)).toBe(true);
  });

  it("locks unique kind+query pairs and non-empty unique existing paths", () => {
    const seen = new Set<string>();
    for (const item of golden) {
      const key = `${item.kind}\0${item.query}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);

      expect(item.relevant.length).toBeGreaterThan(0);
      const paths = new Set<string>();
      for (const file of item.relevant) {
        expect(file).toMatch(/^[a-zA-Z0-9_./@-]+$/);
        expect(file.includes("\\")).toBe(false);
        expect(file.startsWith("/")).toBe(false);
        expect(paths.has(file)).toBe(false);
        paths.add(file);
        expect(existsSync(resolve(file))).toBe(true);
      }
    }
  });

  it("keeps exact rows answerable at K and multi rows deliberately over K", () => {
    // An exact row with more labels than K can never score 1.0 -- it measures
    // the corpus, not the ranker, and every new match drags the slice down.
    // Queries that really do have more than K correct answers live in the
    // "multi" shape, which the bench scores for no-regression vs old finders.
    for (const item of golden) {
      if (item.shape === "exact") expect(item.relevant.length).toBeLessThanOrEqual(K);
      if (item.shape === "multi") expect(item.relevant.length).toBeGreaterThan(K);
    }
    expect(golden.some((item) => item.shape === "multi")).toBe(true);
  });
});
