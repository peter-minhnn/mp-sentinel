import { test } from "node:test";
import assert from "node:assert/strict";
import { guardAnchorCoverage } from "./anchor-coverage-guard.mjs";
const capsule = (...names) => ({ files: names.map((file) => ({ file })), usedTokens: 100 });
const hit = (file, ...anchors) => ({
  file,
  graphOnly: false,
  contributions: anchors.map((anchor) => ({ anchor, rrf: 0.1 })),
});

test("rare incidental matches cannot replace supported baseline domain/action coverage", () => {
  const baseline = capsule("invoice"),
    proposal = capsule("warning");
  const result = guardAnchorCoverage({
    baseline,
    proposal,
    anchors: ["invoice", "export", "warning"],
    trace: [hit("invoice", "invoice", "export"), hit("warning", "warning")],
  });
  assert.strictEqual(result.capsule, baseline);
  assert.deepEqual(result.diagnostic.lost, ["invoice", "export"]);
});
test("different files may replace baseline if supported coverage is preserved", () => {
  const baseline = capsule("old"),
    proposal = capsule("new");
  const result = guardAnchorCoverage({
    baseline,
    proposal,
    anchors: ["invoice", "customer"],
    trace: [hit("old", "invoice"), hit("new", "invoice", "customer")],
  });
  assert.strictEqual(result.capsule, proposal);
  assert.equal(result.diagnostic.fallback, false);
});
test("graph-only, unsupported and zero-score matches cannot fabricate coverage", () => {
  const result = guardAnchorCoverage({
    baseline: capsule("a"),
    proposal: capsule("b"),
    anchors: ["invoice", "unused"],
    trace: [hit("a", "invoice"), { ...hit("b", "invoice"), graphOnly: true }],
  });
  assert.deepEqual(result.diagnostic.lost, ["invoice"]);
  const zero = hit("b", "invoice");
  zero.contributions[0].rrf = 0;
  assert.equal(
    guardAnchorCoverage({
      baseline: capsule("a"),
      proposal: capsule("b"),
      anchors: ["invoice"],
      trace: [hit("a", "invoice"), zero],
    }).diagnostic.fallback,
    true,
  );
});
test("unmeasurable coverage falls back; post-pack files, not candidate ranks, decide", () => {
  const baseline = capsule("a"),
    proposal = capsule();
  assert.equal(
    guardAnchorCoverage({ baseline, proposal, anchors: [], trace: [] }).diagnostic.reason,
    "no-supported-baseline-anchor",
  );
  assert.equal(
    guardAnchorCoverage({
      baseline,
      proposal,
      anchors: ["invoice"],
      trace: [hit("a", "invoice"), hit("b", "invoice")],
    }).diagnostic.fallback,
    true,
  );
});
