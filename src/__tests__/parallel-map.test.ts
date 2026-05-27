/**
 * Tests for the bounded-concurrency parallelMap helper (Phase 3.1).
 */

import { describe, expect, it } from "@jest/globals";
import { defaultIndexingConcurrency, parallelMap } from "../services/source-index/parallel.js";

describe("defaultIndexingConcurrency", () => {
  it("returns a positive integer", () => {
    const n = defaultIndexingConcurrency();
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(1);
    // Capped at 8 by design — over-spinning workers for tree-sitter parse
    // has diminishing returns and adds context-switch noise.
    expect(n).toBeLessThanOrEqual(8);
  });
});

describe("parallelMap", () => {
  it("preserves input order in the output array", async () => {
    const input = [1, 2, 3, 4, 5];
    const out = await parallelMap(input, async (x) => x * 10, 2);
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });

  it("never runs more than `concurrency` tasks at the same time", async () => {
    let inFlight = 0;
    let maxObserved = 0;
    const task = async (x: number): Promise<number> => {
      inFlight++;
      maxObserved = Math.max(maxObserved, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return x;
    };
    const items = Array.from({ length: 20 }, (_, i) => i);
    await parallelMap(items, task, 4);
    expect(maxObserved).toBeLessThanOrEqual(4);
  });

  it("handles an empty input array", async () => {
    const out = await parallelMap([], async () => 1, 4);
    expect(out).toEqual([]);
  });

  it("propagates rejection from a task", async () => {
    const items = [1, 2, 3];
    const promise = parallelMap(
      items,
      async (x) => {
        if (x === 2) throw new Error("kaboom");
        return x;
      },
      2,
    );
    await expect(promise).rejects.toThrow("kaboom");
  });

  it("normalizes concurrency below 1 to 1 (serial)", async () => {
    let inFlight = 0;
    let maxObserved = 0;
    const task = async (x: number): Promise<number> => {
      inFlight++;
      maxObserved = Math.max(maxObserved, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return x;
    };
    const out = await parallelMap([1, 2, 3], task, 0);
    expect(out).toEqual([1, 2, 3]);
    expect(maxObserved).toBe(1);
  });

  it("uses default concurrency when none is provided", async () => {
    const out = await parallelMap([1, 2, 3, 4, 5], async (x) => x);
    expect(out).toEqual([1, 2, 3, 4, 5]);
  });
});
