import { test } from "node:test";
import assert from "node:assert/strict";
import { identifierComponents, coherentIdentifierEvidence } from "./identifier-evidence.mjs";
const file = (...symbols) => ({ symbols });
const callable = (name, type = "function") => ({ name, type });

test("whole camel/acronym/snake components, plural normalization and duplicate roots", () => {
  assert.deepEqual(identifierComponents("getHTTPInvoiceItemsByCustomer"), [
    "http",
    "invoice",
    "item",
    "customer",
  ]);
  assert.deepEqual(identifierComponents("invoice_items_customer"), ["invoice", "item", "customer"]);
  assert.equal(
    coherentIdentifierEvidence(file(callable("findInvoiceItemsByCustomer")), [
      "invoices",
      "customer",
    ]).length,
    1,
  );
  assert.equal(
    coherentIdentifierEvidence(file(callable("findInvoices")), ["invoice", "invoices"]).length,
    0,
  );
});
test("distributed path/import/parent matches and incidental substrings are not evidence", () => {
  const record = {
    ...file(callable("getInvoice"), callable("getCustomer")),
    path: "invoice/customer.ts",
    imports: [{ source: "invoice-customer" }],
  };
  assert.equal(coherentIdentifierEvidence(record, ["invoice", "customer"]).length, 0);
  assert.equal(
    coherentIdentifierEvidence(file(callable("controlRelationship")), ["role", "control"]).length,
    0,
  );
  assert.equal(
    coherentIdentifierEvidence(file({ ...callable("getInvoice"), parent: "Customer" }), [
      "invoice",
      "customer",
    ]).length,
    0,
  );
});
test("interfaces/types/classes do not substitute for callable implementation", () => {
  for (const type of ["interface", "type", "class", "variable"]) {
    assert.equal(
      coherentIdentifierEvidence(file(callable("InvoiceCustomer", type)), ["invoice", "customer"])
        .length,
      0,
    );
  }
  for (const type of ["function", "method", "arrow-function"]) {
    assert.equal(
      coherentIdentifierEvidence(file(callable("loadInvoiceCustomer", type)), [
        "invoice",
        "customer",
      ]).length,
      1,
    );
  }
});
test("Vietnamese prompt can carry identifiers without invented translation", () => {
  assert.equal(
    coherentIdentifierEvidence(file(callable("loadInvoiceCustomer")), [
      "lấy",
      "invoice",
      "theo",
      "customer",
    ]).length,
    1,
  );
  assert.equal(
    coherentIdentifierEvidence(file(callable("loadInvoiceCustomer")), [
      "hóa",
      "đơn",
      "khách",
      "hàng",
    ]).length,
    0,
  );
  assert.equal(coherentIdentifierEvidence(file(callable("getUser")), ["get", "user"]).length, 0);
});
