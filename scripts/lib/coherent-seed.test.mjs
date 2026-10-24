import { test } from "node:test";
import assert from "node:assert/strict";
import { preserveCoherentSeeds } from "./coherent-seed.mjs";
const candidates = (...names) => names.map((file, i) => ({ file, rank: i + 1 }));
test("partial callable evidence protects an existing seed, never an arbitrary later candidate", () => {
  const records = new Map(
    ["seed", "later"].map((file) => [
      file,
      { symbols: [{ name: "loadInvoiceForCustomer", type: "method" }] },
    ]),
  );
  const result = preserveCoherentSeeds(
    candidates("weak", "seed", "other", "later"),
    candidates("rare", "later"),
    [],
    records,
    ["invoices", "customer"],
  );
  assert.deepEqual(result.protectedFiles, ["seed"]);
  assert.deepEqual(
    result.records.slice(0, 3).map((x) => x.file),
    ["seed", "rare", "later"],
  );
});
test("distributed symbol matches cannot protect a seed", () => {
  const records = new Map([
    [
      "weak",
      {
        symbols: [
          { name: "getInvoice", type: "method" },
          { name: "getCustomer", type: "method" },
        ],
      },
    ],
  ]);
  const result = preserveCoherentSeeds(candidates("weak"), candidates("rare"), [], records, [
    "invoice",
    "customer",
  ]);
  assert.deepEqual(result.protectedFiles, []);
});
