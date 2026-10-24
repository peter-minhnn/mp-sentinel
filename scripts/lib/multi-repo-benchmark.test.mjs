import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateReports, runCohort, validateManifest } from "../multi-repo-benchmark.mjs";

const entry = (id, kept, labels) => ({
  id,
  status: "measured",
  summary: {
    labels,
    arms: Object.fromEntries(
      ["anchored", "plain"].map((arm) => [
        arm,
        { kept, retention: kept / labels, packingLost: 0, rankingLost: labels - kept },
      ]),
    ),
  },
});

test("macro weights repositories equally; micro weights independent evidence labels", () => {
  const result = aggregateReports([entry("a", 1, 2), entry("b", 9, 10)]);
  assert.equal(result.arms.anchored.macroRetention, 0.7);
  assert.equal(result.arms.anchored.microRetention, 10 / 12);
});

test("failure remains visible, later repositories run, and no full-cohort score is claimed", () => {
  const called = [];
  const report = runCohort([{ id: "a" }, { id: "b" }, { id: "c" }], (repo) => {
    called.push(repo.id);
    if (repo.id === "b") throw new Error("invalid labels");
    return entry(repo.id, 1, 2);
  });
  assert.deepEqual(called, ["a", "b", "c"]);
  assert.equal(report.summary.complete, false);
  assert.equal(report.summary.failed, 1);
  assert.equal(report.summary.arms.anchored.macroRetention, null);
  assert.equal(report.summary.arms.anchored.microRetention, null);
  assert.match(report.entries[1].error, /invalid labels/);
});

test("empty cohorts and duplicate aliases/roots are invalid", () => {
  assert.equal(aggregateReports([]).complete, false);
  assert.throws(() => validateManifest({ repos: [] }, "/tmp"));
  assert.throws(() =>
    validateManifest({ repos: [{ id: "../bad", root: "a", corpus: "a.json" }] }, "/tmp"),
  );
  assert.throws(() =>
    validateManifest(
      {
        repos: [
          { id: "a", root: "a", corpus: "a.json" },
          { id: "b", root: "a", corpus: "b.json" },
        ],
      },
      "/tmp",
    ),
  );
  assert.deepEqual(
    validateManifest({ repos: [{ id: "a", root: "repo", corpus: "a.json" }] }, "/tmp"),
    [{ id: "a", root: "/tmp/repo", corpus: "/tmp/a.json" }],
  );
});
