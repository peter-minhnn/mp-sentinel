/**
 * Chain scoring rules, including the degenerate cases.
 *
 * An empty denominator must never score as a perfect run: if task_context
 * opens no files or the corpus yields no answerable anchors, the measurement
 * is invalid and the bench has to say so instead of reporting 1.0 with a
 * flattering token count.
 */

import { describe, expect, it } from "@jest/globals";
import type { ChainRow } from "../../scripts/lib/chain-metrics.mjs";

// The bench and this test score with the same module -- no second copy.
const loadMetrics = async () => import("../../scripts/lib/chain-metrics.mjs");

type Row = ChainRow;

const healthyRow = (overrides: Partial<Row> = {}): Row => ({
  query: "atomic sidecar hydration",
  opened: ["src/a.ts", "src/b.ts", "src/c.ts"],
  calls: 4,
  relevantLabels: 2,
  relevantOpened: 2,
  taskTokens: 700,
  anchoredTokens: 4100,
  plainTokens: 4090,
  answerableAnchors: 6,
  anchoredKept: 6,
  plainKept: 5,
  evidenceTotal: 3,
  evidenceRankingMiss: 0,
  evidenceAnchoredPackingMiss: 0,
  evidencePlainPackingMiss: 0,
  ...overrides,
});

describe("classifyMissingFile", () => {
  const openFiles = 3;

  it("recognizes an empty complete ranking, but rejects absent or malformed data", async () => {
    const { hasRankingData, classifyMissingFile } = await loadMetrics();
    const empty = { candidates: [], candidateCount: 0, truncated: false };
    expect(hasRankingData(empty)).toBe(true);
    expect(
      classifyMissingFile({
        rank: 0,
        truncated: false,
        hasRanking: hasRankingData(empty),
        openFiles,
      }),
    ).toBe("not-candidate");
    for (const invalid of [
      null,
      {},
      { candidates: [] },
      { ...empty, candidateCount: 2 },
      { ...empty, truncated: true },
    ]) {
      expect(hasRankingData(invalid)).toBe(false);
    }
  });

  it("calls a file ranked below the opened window a ranking loss, not a missing candidate", async () => {
    const { classifyMissingFile } = await loadMetrics();
    // The old probe capped the list at 10 files, so rank 11 looked like
    // "retrieval never produced it".
    expect(classifyMissingFile({ rank: 11, truncated: true, hasRanking: true, openFiles })).toBe(
      "outside-top-n",
    );
    expect(classifyMissingFile({ rank: 4, truncated: false, hasRanking: true, openFiles })).toBe(
      "outside-top-n",
    );
  });

  it("blames the task capsule budget when the file ranked inside the window", async () => {
    const { classifyMissingFile } = await loadMetrics();
    expect(classifyMissingFile({ rank: 2, truncated: false, hasRanking: true, openFiles })).toBe(
      "dropped-by-task-budget",
    );
  });

  it("says not-candidate only when the candidate list is complete", async () => {
    const { classifyMissingFile } = await loadMetrics();
    expect(classifyMissingFile({ rank: 0, truncated: false, hasRanking: true, openFiles })).toBe(
      "not-candidate",
    );
    // Absence from a cut list proves nothing.
    expect(classifyMissingFile({ rank: 0, truncated: true, hasRanking: true, openFiles })).toBe(
      "unknown",
    );
  });

  it("reports unknown when there is no ranking data at all", async () => {
    const { classifyMissingFile } = await loadMetrics();
    expect(classifyMissingFile({ rank: 0, truncated: false, hasRanking: false, openFiles })).toBe(
      "unknown",
    );
  });
});

describe("chain gate thresholds", () => {
  it("are frozen: a silent loosening has to show up as a diff here", async () => {
    const { CHAIN_DEFAULTS } = await loadMetrics();
    expect(CHAIN_DEFAULTS).toEqual({
      taskBudget: 800,
      agentBudget: 1200,
      openFiles: 3,
      anchorRetentionMin: 0.85,
      evidenceRetentionMin: 0.7,
      rankingLossMax: 0.3,
    });
  });
});

describe("summarizeChain", () => {
  it("passes a healthy run", async () => {
    const { summarizeChain } = await loadMetrics();
    const { summary, failures } = summarizeChain([healthyRow(), healthyRow()]);
    expect(failures).toEqual([]);
    expect(summary.valid).toBe(true);
    expect(summary.anchorRetention?.anchored).toBe(1);
    expect(summary.evidenceRetention?.anchored).toBe(1);
    expect(summary.unscorableRows).toEqual([]);
  });

  it("fails when task_context opens no files", async () => {
    const { summarizeChain } = await loadMetrics();
    const { summary, failures } = summarizeChain([
      healthyRow(),
      healthyRow({
        query: "empty capsule",
        opened: [],
        calls: 1,
        relevantOpened: 0,
        anchoredTokens: 700,
        plainTokens: 700,
        answerableAnchors: 0,
        anchoredKept: 0,
        plainKept: 0,
        evidenceRankingMiss: 3,
      }),
    ]);
    expect(failures.join("\n")).toMatch(/opened no files/);
    // The row is reported, not silently averaged away.
    expect(summary.unscorableRows).toEqual([{ query: "empty capsule", reason: "no-files" }]);
    // ...and its flattering token count does not become the headline.
    expect(summary.tokensPerTask?.anchored).toBe(2400);
  });

  it("fails instead of scoring 1.0 when no anchor is answerable", async () => {
    const { summarizeChain } = await loadMetrics();
    const { summary, failures } = summarizeChain([
      healthyRow({ answerableAnchors: 0, anchoredKept: 0, plainKept: 0 }),
    ]);
    expect(failures.join("\n")).toMatch(/anchor retention is not measurable/);
    expect(summary.anchorRetention?.anchored).toBeNull();
    expect(summary.valid).toBe(false);
    expect(summary.unscorableRows).toEqual([
      { query: "atomic sidecar hydration", reason: "no-answerable-anchors" },
    ]);
  });

  it("fails when the corpus carries no evidence labels", async () => {
    const { summarizeChain } = await loadMetrics();
    const { summary, failures } = summarizeChain([
      healthyRow({ evidenceTotal: 0, evidenceRankingMiss: 0 }),
    ]);
    expect(failures.join("\n")).toMatch(/no evidence labels/);
    expect(summary.evidenceRetention?.anchored).toBeNull();
    expect(summary.valid).toBe(false);
  });

  it("fails on an empty run", async () => {
    const { summarizeChain } = await loadMetrics();
    const { summary, failures } = summarizeChain([]);
    expect(failures).toEqual(["no task rows measured"]);
    expect(summary.valid).toBe(false);
  });

  it("flags focus that loses evidence the unfocused capsule kept", async () => {
    const { summarizeChain } = await loadMetrics();
    const { failures } = summarizeChain([
      healthyRow({ evidenceAnchoredPackingMiss: 1, evidencePlainPackingMiss: 0 }),
    ]);
    expect(failures.join("\n")).toMatch(/anchored packing loss 1 > plain 0/);
  });

  it("flags a chain that blows the combined budget", async () => {
    const { summarizeChain } = await loadMetrics();
    const { failures } = summarizeChain([healthyRow({ anchoredTokens: 9999 })]);
    expect(failures.join("\n")).toMatch(/9999 tokens > 4400/);
  });

  it("flags catastrophic ranking loss", async () => {
    const { summarizeChain } = await loadMetrics();
    const { failures } = summarizeChain([healthyRow({ evidenceTotal: 4, evidenceRankingMiss: 3 })]);
    expect(failures.join("\n")).toMatch(/lost to ranking/);
  });
});
