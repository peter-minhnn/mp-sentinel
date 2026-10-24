import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fusionVariant } from "./fusion-ablation.mjs";
const source = readFileSync(
  new URL("../../src/services/source-index/task-context.ts", import.meta.url),
  "utf8",
);

test("current is byte-identical; capped variant changes only retrieval limits", () => {
  assert.equal(fusionVariant(source, "current"), source);
  const capped = fusionVariant(source, "distinct-capped");
  assert.equal(
    capped
      .replace(
        "querySymbols(index, anchor, PER_KIND_LIMIT)",
        "querySymbols(index, anchor, Infinity)",
      )
      .replace(
        "queryImports(index, anchor, PER_KIND_LIMIT)",
        "queryImports(index, anchor, Infinity)",
      ),
    source,
  );
});
test("legacy variant restores entry-level votes without changing fusion weights", () => {
  const legacy = fusionVariant(source, "legacy-votes");
  assert.ok(legacy.includes("return rows.map((row, i)"));
  assert.equal(
    legacy.slice(legacy.indexOf("function kindWeight"), legacy.indexOf("function toKindHits")),
    source.slice(source.indexOf("function kindWeight"), source.indexOf("function toKindHits")),
  );
});
test("unknown variant and source drift fail closed", () => {
  assert.throws(() => fusionVariant(source, "other"));
  assert.throws(() => fusionVariant("", "legacy-votes"));
});
