import { test } from "node:test";
import assert from "node:assert/strict";
import { coverageDecision } from "./coverage-decision.mjs";
const capsule = { files: [{ file: "a" }] };
const row = (query, kept) => ({
  query,
  labels: 2,
  labelsInOpenedFiles: kept,
  capsule,
  coverageGuard: { fallback: false },
});
test("preserved lexical coverage cannot hide evidence loss behind aggregate gains", () => {
  const result = coverageDecision([row("a", 0), row("b", 2)], [row("a", 2), row("b", 1)]);
  assert.equal(result.keptDelta, 1);
  assert.equal(result.status, "reject");
});
test("a fallback must reproduce the baseline capsule exactly", () => {
  const next = { ...row("a", 1), coverageGuard: { fallback: true }, capsule: { files: [] } };
  assert.throws(() => coverageDecision([row("a", 1)], [next]), /fallback/);
});
test("chain scoring checks both arms, not just file selection", () => {
  const base = { ...row("a", 2), chain: { arms: { anchored: { kept: 2 }, plain: { kept: 2 } } } };
  const next = { ...row("a", 2), chain: { arms: { anchored: { kept: 2 }, plain: { kept: 1 } } } };
  assert.equal(coverageDecision([base], [next]).status, "reject");
});
