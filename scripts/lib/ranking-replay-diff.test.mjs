import { test } from "node:test";
import assert from "node:assert/strict";
import { compareReplay } from "./ranking-replay-diff.mjs";

function report(values) {
  return {
    corpus: { sha256: "locked" },
    index: { coreSha256: "index" },
    runs: [
      {
        config: { id: "baseline", files: 3, agentBudget: 1200 },
        rows: values.map((kept, i) => ({
          query: `q${i}`,
          evidenceTotal: 2,
          opened: [],
          arms: { anchored: { kept } },
        })),
      },
    ],
  };
}

test("aggregate gain does not hide a per-query regression", () => {
  const diff = compareReplay(report([0, 2]), report([2, 1]));
  assert.equal(diff.netKept, 1);
  assert.equal(diff.regressed, 1);
  assert.equal(diff.improved, 1);
});

test("rejects changed corpus, allocation, query set and label count", () => {
  for (const mutate of [
    (r) => {
      r.corpus.sha256 = "changed";
    },
    (r) => {
      r.runs[0].config.files = 4;
    },
    (r) => {
      r.runs[0].rows[0].query = "other";
    },
    (r) => {
      r.runs[0].rows[0].evidenceTotal = 3;
    },
    (r) => {
      r.runs[0].rows.push(r.runs[0].rows[0]);
    },
  ]) {
    const next = report([1]);
    mutate(next);
    assert.throws(() => compareReplay(report([1]), next));
  }
});

test("index drift is reported, not silently treated as same-index ablation", () => {
  const next = report([1]);
  next.index.coreSha256 = "new";
  assert.equal(compareReplay(report([1]), next).indexChanged, true);
});
