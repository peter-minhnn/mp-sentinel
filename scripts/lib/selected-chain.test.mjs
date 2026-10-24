import { test } from "node:test";
import assert from "node:assert/strict";
import { get_encoding } from "tiktoken";
import { measureSelectedChain } from "./selected-chain.mjs";
const encoder = get_encoding("cl100k_base");
function payload(value) {
  let last = -1;
  value.usedTokens = 0;
  while (last !== value.usedTokens) {
    last = value.usedTokens;
    value.usedTokens = encoder.encode(JSON.stringify(value)).length;
  }
  return value;
}
const row = {
  query: "invoice customer",
  relevant: ["a.ts", "b.ts"],
  evidence: [
    { file: "a.ts", kind: "symbol", name: "loadInvoiceCustomer" },
    { file: "b.ts", kind: "symbol", name: "validateInvoice" },
  ],
};
const capsule = payload({
  files: [{ file: "a.ts", anchors: ["invoice", "customer"] }],
  anchors: [],
});
const records = new Map([["a.ts", { symbols: [{ name: "loadInvoiceCustomer" }] }]]);

test("real agent calls and original metrics distinguish unopened evidence from packing loss", () => {
  const requests = [];
  const query = (args) => {
    requests.push(args);
    const result = payload({ file: { symbols: [{ name: "loadInvoiceCustomer" }] } });
    return { payload: result, raw: JSON.stringify(result), latencyMs: 1 };
  };
  const result = measureSelectedChain({
    row,
    capsule,
    candidates: [{ file: "a.ts" }, { file: "b.ts" }],
    records,
    query,
  });
  assert.equal(requests.length, 2);
  assert.ok(requests.every((args) => args[0] === "--agent-context"));
  assert.ok(requests[0].includes("--focus"));
  assert.ok(!requests[1].includes("--focus"));
  assert.equal(result.arms.anchored.kept, 1);
  assert.equal(result.arms.anchored.rankingLost, 1);
  assert.equal(result.arms.anchored.packingLost, 0);
});
test("budget accounting remains enforced for actual agent output", () => {
  assert.throws(
    () =>
      measureSelectedChain({
        row,
        capsule,
        candidates: [{ file: "a.ts" }],
        records,
        query: () => ({ payload: { usedTokens: 999 }, raw: "{}", latencyMs: 0 }),
      }),
    /budget\/accounting/,
  );
});
