#!/usr/bin/env node

"use strict";

/**
 * Serial isolation guard for tree-sitter-dependent Jest suites.
 *
 * Runs the historically fragile suites with --runInBand in one Jest process.
 * The command mirrors npm test by preloading jest.setup.cjs in the root CJS
 * context before Jest creates per-suite VM contexts.
 *
 * Exit codes:
 *   0 - all serial suites pass
 *   2 - Jest failed or its output could not be parsed for diagnostics
 */

const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");

const REPO_ROOT = resolve(__dirname, "..");

const SERIAL_SUITES = [
  "src/__tests__/release-check.test.ts",
  "src/__tests__/review-intelligence-fixtures.test.ts",
  "src/__tests__/build-review-context.test.ts",
  "src/__tests__/explain-context.test.ts",
  "src/__tests__/indexing.test.ts",
  "src/__tests__/create-skills.test.ts",
];

function parseTotals(output) {
  const failedTotals = output.match(
    /Tests:\s+(\d+)\s+failed,\s+(\d+)\s+passed,\s+(\d+)\s+total/,
  );
  if (failedTotals) {
    return {
      failed: parseInt(failedTotals[1], 10),
      passed: parseInt(failedTotals[2], 10),
      total: parseInt(failedTotals[3], 10),
    };
  }

  const passedTotals = output.match(/Tests:\s+(\d+)\s+passed,\s+(\d+)\s+total/);
  if (passedTotals) {
    return {
      failed: 0,
      passed: parseInt(passedTotals[1], 10),
      total: parseInt(passedTotals[2], 10),
    };
  }

  return null;
}

function run() {
  const jestEntry = resolve(REPO_ROOT, "node_modules", "jest", "bin", "jest.js");
  const setupFile = resolve(REPO_ROOT, "jest.setup.cjs");
  const args = [
    "--experimental-vm-modules",
    "--require",
    setupFile,
    jestEntry,
    "--runInBand",
    "--no-coverage",
    "--runTestsByPath",
    ...SERIAL_SUITES,
  ];

  const result = spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    timeout: 180_000,
    stdio: "pipe",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });

  const combined = `${result.stdout || ""}${result.stderr || ""}`;
  const totals = parseTotals(combined);

  if (result.status === 0) {
    if (totals) {
      console.log(
        `Serial isolation check: ${totals.failed} failed, ${totals.passed} passed, ${totals.total} total`,
      );
    }
    console.log("PASS: Serial tree-sitter suites passed.");
    process.exit(0);
  }

  if (totals) {
    console.error(
      `FAIL: Serial isolation regression: ${totals.failed} failed, ${totals.passed} passed, ${totals.total} total.`,
    );
  } else {
    console.error("FAIL: Serial isolation regression; could not parse Jest totals.");
  }
  console.error(combined.slice(-4000));
  process.exit(2);
}

run();
