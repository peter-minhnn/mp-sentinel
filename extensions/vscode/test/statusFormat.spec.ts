import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { IndexHealthOutput } from "mp-sentinel-extension-core";

import { formatIndexHealth, formatReviewStatus, IDLE_STATUS } from "../src/pure/statusFormat.js";

test("review status: PASS is clean, FAIL gets an error background", () => {
  const pass = formatReviewStatus("PASS", "PASS — 0 critical");
  assert.ok(pass.text.includes("$(pass)"));
  assert.equal(pass.background, "none");

  const fail = formatReviewStatus("FAIL", "FAIL — 2 critical");
  assert.ok(fail.text.includes("$(error)"));
  assert.equal(fail.background, "error");
  assert.equal(fail.tooltip, "FAIL — 2 critical");
});

test("healthy index clears stale state by returning the idle tooltip", () => {
  const display = formatIndexHealth({ status: "ok", totalFiles: 100 });
  assert.equal(display.healthy, true);
  assert.equal(display.tooltip, IDLE_STATUS.tooltip);
  assert.equal(display.background, "none");
  assert.deepEqual(display.actions, []);
});

test("healthy index with parser debt offers Show Output and reports counts", () => {
  const health: IndexHealthOutput = {
    status: "ok",
    totalFiles: 379,
    parseErrorCount: 3,
    recoveredFiles: 18,
    suggestedCommands: ["mp-sentinel indexing --recovered --index-format json"],
  };
  const display = formatIndexHealth(health);
  assert.equal(display.healthy, true);
  assert.deepEqual(display.actions, ["Show Output"]);
  assert.ok(display.lines.some((l) => l.includes("parse errors: 3")));
  assert.ok(display.lines.some((l) => l.includes("recovered files: 18")));
  assert.ok(display.lines.some((l) => l.includes("suggested:")));
});

test("a stale index offers Rebuild Index and a warning background", () => {
  const display = formatIndexHealth({ status: "stale", staleReasons: ["git head drift"] });
  assert.equal(display.healthy, false);
  assert.deepEqual(display.actions, ["Rebuild Index", "Show Output"]);
  assert.equal(display.background, "warning");
  assert.ok(display.tooltip.includes("stale"));
});

test("a missing index is unhealthy and prompts a rebuild", () => {
  const display = formatIndexHealth({ status: "missing" });
  assert.equal(display.healthy, false);
  assert.ok(display.actions.includes("Rebuild Index"));
});
