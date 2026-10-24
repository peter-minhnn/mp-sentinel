import { test } from "node:test";
import assert from "node:assert/strict";
import { preserveSeeds } from "./seed-preserve.mjs";
const records = (...names) => names.map((file, i) => ({ file, rank: i + 1 }));
const trace = (file, kind, hitScore, graphOnly = false) => ({
  file,
  graphOnly,
  contributions: [{ kind, hitScore }],
});

test("direct baseline seed stays, rarity fills remaining slots without duplicates", () => {
  const result = preserveSeeds(records("seed", "weak", "other"), records("rare", "seed", "new"), [
    trace("seed", "symbol", 90),
  ]);
  assert.deepEqual(
    result.records.slice(0, 3).map((x) => x.file),
    ["seed", "rare", "new"],
  );
  assert.deepEqual(result.protectedFiles, ["seed"]);
  assert.deepEqual(
    result.records.map((x) => x.rank),
    [1, 2, 3, 4, 5],
  );
});
test("substring and graph-only matches do not receive protection", () => {
  const result = preserveSeeds(records("weak", "graph"), records("rare"), [
    trace("weak", "symbol", 70),
    trace("graph", "file", 100, true),
  ]);
  assert.deepEqual(result.protectedFiles, []);
  assert.equal(result.records[0].file, "rare");
});
test("all strong top-three seeds preserve coverage and order; no later seed is promoted", () => {
  const base = records("a", "b", "c", "d");
  const result = preserveSeeds(base, records("rare", "d"), [
    trace("a", "file", 95),
    trace("b", "import", 90),
    trace("c", "symbol", 100),
    trace("d", "symbol", 100),
  ]);
  assert.deepEqual(
    result.records.slice(0, 3).map((x) => x.file),
    ["a", "b", "c"],
  );
});
