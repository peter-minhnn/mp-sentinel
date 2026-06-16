import { strict as assert } from "node:assert";
import { test } from "node:test";

import { groupFindingsByFile, normalizeFindings, summarizeReport } from "../src/normalize.js";
import type { ReviewReport } from "../src/types.js";

function report(): ReviewReport {
  return {
    schemaVersion: "1.0",
    status: "FAIL",
    aiEnabled: true,
    promptVersion: "v1",
    summary: {
      totalFiles: 2,
      auditedFiles: 2,
      passedFiles: 1,
      failedFiles: 1,
      criticalIssues: 1,
      warningIssues: 1,
      infoIssues: 0,
      durationMs: 10,
      totalChangedLines: 5,
    },
    results: [
      {
        filePath: "a.ts",
        duration: 5,
        cached: true,
        result: {
          status: "FAIL",
          issues: [
            { line: 3, severity: "CRITICAL", message: "bug", suggestion: "fix it", category: "runtime-crash" },
            { line: 7, severity: "WARNING", message: "fixed already", resolution: "resolved-at-head", resolvedBy: "abc123" },
            { line: 9, severity: "INFO", message: "maybe hallucinated", resolution: "unverified" },
          ],
        },
      },
      { filePath: "b.ts", duration: 5, result: { status: "PASS", issues: [] } },
    ],
    skipped: [],
    errors: [],
    generatedAt: "2026-06-16T00:00:00Z",
  };
}

test("normalize filters resolved and unverified by default", () => {
  const findings = normalizeFindings(report());
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.message, "bug");
  assert.equal(findings[0]?.cached, true);
  assert.equal(findings[0]?.category, "runtime-crash");
});

test("normalize can include resolved and unverified", () => {
  const findings = normalizeFindings(report(), { includeResolved: true, includeUnverified: true });
  assert.equal(findings.length, 3);
});

test("groupFindingsByFile keeps per-file lists", () => {
  const grouped = groupFindingsByFile(normalizeFindings(report(), { includeUnverified: true }));
  assert.equal(grouped.get("a.ts")?.length, 2);
  assert.equal(grouped.has("b.ts"), false);
});

test("summarizeReport is a compact one-liner", () => {
  assert.equal(
    summarizeReport(report()),
    "FAIL — 1 critical, 1 warning, 0 info across 2/2 files",
  );
});
