import { strict as assert } from "node:assert";
import { test } from "node:test";

import { branchReportPath } from "../src/pure/reportPath.js";

test("formats reports/review-MMDD.md using the local date", () => {
  // June 17 2026 → month index 5.
  assert.equal(branchReportPath("reports", new Date(2026, 5, 17)), "reports/review-0617.md");
});

test("zero-pads single-digit months and days", () => {
  assert.equal(branchReportPath("reports", new Date(2026, 0, 3)), "reports/review-0103.md");
});

test("tolerates a trailing slash on the directory", () => {
  assert.equal(branchReportPath("reports/", new Date(2026, 5, 17)), "reports/review-0617.md");
});

test("supports a nested directory", () => {
  assert.equal(
    branchReportPath("docs/reviews", new Date(2026, 11, 31)),
    "docs/reviews/review-1231.md",
  );
});

test("an empty directory yields a bare filename", () => {
  assert.equal(branchReportPath("", new Date(2026, 5, 1)), "review-0601.md");
});
