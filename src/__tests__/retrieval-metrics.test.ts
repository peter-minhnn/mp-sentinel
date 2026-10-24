import { describe, expect, it } from "@jest/globals";

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

describe("retrieval metrics", () => {
  it("dedupes ranked files in first-seen order", () => {
    expect(uniqueRankedFiles(["a.ts", "b.ts", "a.ts", "c.ts"])).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("computes Recall@K against the relevant set", () => {
    expect(recallAtK(["a.ts", "b.ts", "c.ts"], ["a.ts", "c.ts"], 5)).toBe(1);
    expect(recallAtK(["a.ts", "b.ts"], ["a.ts", "c.ts"], 5)).toBe(0.5);
    expect(recallAtK(["x.ts"], ["a.ts"], 5)).toBe(0);
    expect(recallAtK(["a.ts"], [], 5)).toBe(0);
  });

  it("computes MRR from the first relevant hit", () => {
    expect(meanReciprocalRank(["a.ts", "b.ts"], ["a.ts"])).toBe(1);
    expect(meanReciprocalRank(["x.ts", "a.ts"], ["a.ts"])).toBe(0.5);
    expect(meanReciprocalRank(["x.ts", "y.ts"], ["a.ts"])).toBe(0);
    expect(meanReciprocalRank(["a.ts"], [])).toBe(0);
  });

  it("reports Top-1 against the relevant set", () => {
    expect(top1Hit(["a.ts", "b.ts"], ["a.ts"])).toBe(true);
    expect(top1Hit(["b.ts", "a.ts"], ["a.ts"])).toBe(false);
    expect(top1Hit([], ["a.ts"])).toBe(false);
    expect(top1Hit(["a.ts"], [])).toBe(false);
  });

  it("estimates payload size and tokens", () => {
    expect(payloadBytes({ a: 1 })).toBeGreaterThan(0);
    expect(estimateTokens(4)).toBe(1);
    expect(estimateTokens(5)).toBe(2);
  });

  it("computes percentiles and averages", () => {
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2);
    expect(percentile([1, 2, 3, 4], 0.95)).toBeGreaterThanOrEqual(percentile([1, 2, 3, 4], 0.5));
    expect(average([0, 1, 1])).toBeCloseTo(2 / 3);
    expect(average([])).toBe(0);
  });
});
