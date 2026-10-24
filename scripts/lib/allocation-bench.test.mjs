import { test } from "node:test";
import assert from "node:assert/strict";
import { get_encoding } from "tiktoken";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { frozenConfigurations } from "../agent-allocation-benchmark.mjs";
import { ALLOCATIONS, measureRow, selectAllocation, validateRows } from "./allocation-bench.mjs";

const encoder = get_encoding("cl100k_base");

test("explicit replay preserves an old frozen policy across code changes without weakening transfer checks", () => {
  const dir = mkdtempSync(join(tmpdir(), "allocation-selection-"));
  try {
    const path = join(dir, "selection.json");
    const selection = {
      phase: "tuning",
      tool: { revision: "old" },
      corpus: { sha256: "old" },
      index: {},
      selected: "baseline",
      runs: [
        {
          config: ALLOCATIONS[0],
          rows: [
            {
              query: "x",
              evidenceTotal: 1,
              calls: 2,
              arms: { anchored: { kept: 1, tokens: 100 } },
            },
          ],
        },
      ],
    };
    writeFileSync(path, JSON.stringify(selection));
    const identity = { tool: { revision: "new" }, corpus: { sha256: "new" }, index: {} };
    assert.throws(
      () => frozenConfigurations({ phase: "transfer", selection: path }, identity, {}),
      /tool fingerprint/,
    );
    const report = {};
    assert.deepEqual(frozenConfigurations({ phase: "replay", selection: path }, identity, report), [
      ALLOCATIONS[0],
    ]);
    assert.deepEqual(report.selectionOrigin.tool, selection.tool);
    selection.runs[0].config = { ...ALLOCATIONS[0], agentBudget: 2000 };
    writeFileSync(path, JSON.stringify(selection));
    assert.throws(
      () => frozenConfigurations({ phase: "replay", selection: path }, identity, {}),
      /allocation changed/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
function emitted(payload) {
  let previous = -1;
  payload.usedTokens = 0;
  while (previous !== payload.usedTokens) {
    previous = payload.usedTokens;
    payload.usedTokens = encoder.encode(JSON.stringify(payload)).length;
  }
  return { payload, raw: JSON.stringify(payload), latencyMs: 1 };
}
const row = {
  query: "alpha beta",
  relevant: ["a.ts", "b.ts"],
  evidence: [
    { file: "a.ts", kind: "symbol", name: "alpha" },
    { file: "b.ts", kind: "symbol", name: "beta" },
  ],
};
const records = new Map([
  ["a.ts", { symbols: [{ name: "alpha" }] }],
  ["b.ts", { symbols: [{ name: "beta" }] }],
]);

test("requests each limit and counts only files actually emitted by the task capsule", () => {
  for (const config of ALLOCATIONS) {
    const calls = [];
    const query = (args) => {
      calls.push(args);
      if (args.includes("--explain-ranking"))
        return {
          payload: {
            candidates: [
              { file: "a.ts", rank: 1 },
              { file: "b.ts", rank: 2 },
            ],
            candidateCount: 2,
            truncated: false,
          },
        };
      if (args[0] === "--task-context")
        return emitted({ files: [{ file: "a.ts", anchors: ["alpha"] }], anchors: [] });
      return emitted({ file: { symbols: [{ name: "alpha" }] } });
    };
    const result = measureRow(row, config, records, query);
    assert.equal(calls[0][calls[0].indexOf("--limit") + 1], String(config.files));
    assert.equal(result.calls, 2);
    assert.equal(result.diagnosticCalls, 1);
    assert.equal(result.arms.anchored.kept, 1);
    assert.equal(result.arms.anchored.missing[0].cause, "dropped-by-task-budget");
    assert.equal(calls.filter((args) => args[0] === "--agent-context").length, 2);
    assert.ok(calls.some((args) => args.includes("--focus")));
  }
});

test("more opened files can improve coverage while smaller capsules lose evidence", () => {
  const query = (args) => {
    if (args.includes("--explain-ranking"))
      return {
        payload: {
          candidates: [
            { file: "a.ts", rank: 1 },
            { file: "b.ts", rank: 2 },
          ],
          candidateCount: 2,
          truncated: false,
        },
      };
    if (args[0] === "--task-context")
      return emitted({
        files: [
          { file: "a.ts", anchors: ["alpha"] },
          { file: "b.ts", anchors: ["beta"] },
        ],
      });
    return emitted({ file: { symbols: [] } });
  };
  const result = measureRow(row, ALLOCATIONS[4], records, query);
  assert.equal(result.coverageBeforePacking, 2);
  assert.equal(result.arms.anchored.kept, 0);
  assert.equal(result.arms.anchored.packingLost, 2);
});

const measured = (query, kept, tokens = 1000, calls = 4) => ({
  query,
  evidenceTotal: 3,
  calls,
  arms: { anchored: { kept, tokens } },
});
test("selection rejects aggregate gains that regress a query and keeps baseline on ties", () => {
  const baseline = { config: ALLOCATIONS[0], rows: [measured("a", 2), measured("b", 1)] };
  const regressed = { config: ALLOCATIONS[1], rows: [measured("a", 1), measured("b", 3)] };
  assert.equal(selectAllocation([baseline, regressed]), "baseline");
  const tied = { config: ALLOCATIONS[2], rows: baseline.rows };
  assert.equal(selectAllocation([baseline, tied]), "baseline");
  const winner = { config: ALLOCATIONS[3], rows: [measured("a", 2), measured("b", 2)] };
  assert.equal(selectAllocation([baseline, regressed, winner]), "C");
});

test("selection breaks quality ties by calls then tokens", () => {
  const run = (id, calls, tokens) => ({
    config: { id },
    rows: [measured("a", id === "baseline" ? 1 : 2, tokens, calls)],
  });
  assert.equal(
    selectAllocation([
      run("baseline", 4, 100),
      run("A", 5, 300),
      run("B", 6, 200),
      run("C", 5, 250),
    ]),
    "C",
  );
});

test("invalid labels and overlapping slices fail before querying", () => {
  validateRows([row], records);
  assert.throws(
    () => validateRows([{ ...row, heldOut: true, validation: true }], records),
    /overlapping/,
  );
  assert.throws(
    () =>
      validateRows(
        [{ ...row, evidence: [{ file: "a.ts", kind: "symbol", name: "absent" }] }],
        records,
      ),
    /invalid evidence/,
  );
});

test("incorrect token accounting and over-budget emissions fail", () => {
  assert.throws(
    () =>
      measureRow(row, ALLOCATIONS[0], records, () => ({ payload: { usedTokens: 999 }, raw: "{}" })),
    /accounting/,
  );
  const oversized = emitted({ files: [], data: "long ".repeat(1000) });
  assert.throws(() => measureRow(row, ALLOCATIONS[0], records, () => oversized), /accounting/);
});
