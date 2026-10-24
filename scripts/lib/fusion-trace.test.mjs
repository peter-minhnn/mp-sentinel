import { test } from "node:test";
import assert from "node:assert/strict";
import { transform } from "esbuild";
import { withFusionTrace } from "./fusion-trace.mjs";

const fixture = `
const EXACT_BOOST = 1.5, GRAPH_SEED_LIMIT = 3;
function extractTaskAnchors() { return ["cache", "sidecar"]; }
async function collectKindHits() { return { hits: [
  { file: "direct", anchor: "cache", kind: "symbol", rank: 1, score: 100, value: 0.2 },
  { file: "direct", anchor: "sidecar", kind: "file", rank: 2, score: 80, value: 0.3 }
] }; }
function fuseByFile(hits) {
  const map = new Map();
  for (const hit of hits) {
    const prev = map.get(hit.file) ?? { rrf: 0, exact: false };
    map.set(hit.file, { rrf: prev.rrf + hit.value, exact: prev.exact || hit.score === 100 });
  }
  return map;
}
function rankedSeedPaths(map) { return [...map.keys()]; }
function expandGraph(index, seeds, map) { map.set("neighbor", { rrf: 0.125, exact: false }); }
`;

test("instrumentation only appends to source", () => {
  assert.ok(withFusionTrace(fixture).startsWith(fixture));
});

test("trace separates graph-only score and preserves exact multiplier", async () => {
  const { code } = await transform(withFusionTrace(fixture), { loader: "ts", format: "esm" });
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
  );
  const [direct, graph] = await module.traceFusion({ files: [] }, "task");
  assert.equal(direct.rrf, 0.5);
  assert.equal(direct.effectiveScore, 0.75);
  assert.equal(direct.graphOnly, false);
  assert.equal(
    direct.contributions.reduce((n, entry) => n + entry.rrf, 0),
    direct.rrf,
  );
  assert.deepEqual(
    direct.contributions.map((entry) => entry.anchor),
    ["cache", "sidecar"],
  );
  assert.equal(graph.graphOnly, true);
  assert.equal(graph.effectiveScore, 0.125);
  assert.deepEqual(graph.contributions, []);
});
