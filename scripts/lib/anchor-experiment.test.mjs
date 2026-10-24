import { test } from "node:test";
import assert from "node:assert/strict";
import { transform } from "esbuild";
import { anchorExperiment } from "./anchor-experiment.mjs";

const fixture = `
const MAX_TASK_ANCHORS = 6, RRF_K = 60;
interface KindHit {
  anchor: string;
}
export function extractTaskAnchors(prompt: string) {
  const ranked = prompt.split(" ").map(token => ({ token }));
  return ranked.slice(0, MAX_TASK_ANCHORS).map(r => r.token);
}
function querySymbols(index, anchor) { return index.files.filter(f => f.anchors.includes(anchor)).map(f => ({file:f.path})); }
function queryImports() { return []; }
function queryFiles() { return []; }
async function collectKindHits(index, anchors) {
  const hits = anchors.flatMap(anchor => querySymbols(index, anchor).map(hit => ({...hit, anchor, rank:1})));
  const warnings = [];
  return { hits, warnings };
}
function fuse(hits) {
  const cur = { rrf: 0 }, weight = 1;
  for (const hit of hits) { cur.rrf += weight / (RRF_K + hit.rank); }
  return cur.rrf;
}
export async function rankTaskCandidates(index, prompt) {
  const trimmed = prompt.trim();
  const anchors = extractTaskAnchors(trimmed);
  return {anchors, score:fuse((await collectKindHits(index, anchors)).hits)};
}
export function traceFusion(index, prompt) {
  const anchors = extractTaskAnchors(prompt.trim());
  return anchors;
}
`;
const index = {
  files: Array.from({ length: 10 }, (_, i) => ({
    path: `f${i}`,
    anchors: i === 0 ? ["common", "rare"] : ["common"],
  })),
};
async function load(variant) {
  const { code } = await transform(anchorExperiment(fixture, variant), {
    loader: "ts",
    format: "esm",
  });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

test("current source is untouched; unsupported variant/drift fail closed", () => {
  assert.equal(anchorExperiment(fixture, "current"), fixture);
  assert.throws(() => anchorExperiment(fixture, "other"));
  assert.throws(() => anchorExperiment("", "anchor-select"));
});

test("selection recovers supported short anchor beyond first six and keeps explicit token", async () => {
  const module = await load("anchor-select");
  const prompt = "zero one two three four common rare src/file.ts";
  const result = await module.rankTaskCandidates(index, prompt);
  assert.equal(result.anchors.length, 6);
  assert.deepEqual(result.anchors.slice(0, 3), ["src/file.ts", "rare", "common"]);
  assert.deepEqual(module.traceFusion(index, prompt), result.anchors);
});

test("IDF counts distinct files, suppresses universal anchor and preserves selected tokens", async () => {
  const module = await load("anchor-weight");
  assert.equal(module.experimentAnchorStats(index, "common").idf, 0);
  const rare = module.experimentAnchorStats(index, "rare");
  assert.equal(rare.files, 1);
  assert.ok(rare.idf > 0 && rare.idf < 1);
  const result = await module.rankTaskCandidates(index, "common rare");
  assert.deepEqual(result.anchors, ["common", "rare"]);
  assert.ok(Math.abs(result.score - rare.idf / 61) < 1e-12);
});
