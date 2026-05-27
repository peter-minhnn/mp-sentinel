/**
 * Unit tests for the SARIF 2.1.0 formatter.
 */

import { describe, expect, it } from "@jest/globals";
import { formatSarifReport, stringifySarif } from "../formatters/sarif.js";
import type { ReviewReport } from "../types/index.js";

const baseReport: ReviewReport = {
  schemaVersion: "1.0",
  status: "FAIL",
  target: { mode: "files" },
  aiEnabled: true,
  promptVersion: "2026-05-04",
  summary: {
    totalFiles: 1,
    auditedFiles: 1,
    passedFiles: 0,
    failedFiles: 1,
    criticalIssues: 1,
    warningIssues: 1,
    infoIssues: 0,
    durationMs: 100,
    totalChangedLines: 10,
  },
  results: [
    {
      filePath: "src/foo.ts",
      duration: 50,
      result: {
        status: "FAIL",
        issues: [
          {
            line: 12,
            severity: "CRITICAL",
            message: "SQL injection via string concat",
            category: "security",
            confidence: "high",
            evidence: "query = `SELECT * FROM users WHERE id = ${userId}`",
            suggestion: "Use parameterized queries.",
          },
          {
            line: 30,
            severity: "WARNING",
            message: "console.log left in production code",
            category: "maintainability",
          },
        ],
      },
    },
  ],
  skipped: [],
  errors: [],
  generatedAt: "2026-05-27T12:34:56Z",
};

describe("formatSarifReport", () => {
  it("produces a SARIF 2.1.0 log with one run", () => {
    const log = formatSarifReport(baseReport);
    expect(log.version).toBe("2.1.0");
    expect(log.runs).toHaveLength(1);
  });

  it("populates tool driver metadata", () => {
    const log = formatSarifReport(baseReport);
    const driver = log.runs[0]!.tool.driver;
    expect(driver.name).toBe("mp-sentinel");
    expect(typeof driver.version).toBe("string");
    expect(driver.informationUri).toContain("github.com");
  });

  it("emits one result per issue with correct level mapping", () => {
    const log = formatSarifReport(baseReport);
    const results = log.runs[0]!.results;
    expect(results).toHaveLength(2);
    expect(results[0]!.level).toBe("error");
    expect(results[0]!.ruleId).toBe("mp-sentinel/security");
    expect(results[0]!.locations[0]!.physicalLocation.region.startLine).toBe(12);
    expect(results[1]!.level).toBe("warning");
    expect(results[1]!.ruleId).toBe("mp-sentinel/maintainability");
  });

  it("carries evidence and suggestion through properties", () => {
    const log = formatSarifReport(baseReport);
    const first = log.runs[0]!.results[0]!;
    expect(first.properties.evidence).toContain("SELECT");
    expect(first.properties.suggestion).toContain("parameterized");
  });

  it("clamps issues at line 0 up to line 1 (SARIF requires startLine >= 1)", () => {
    const report: ReviewReport = {
      ...baseReport,
      results: [
        {
          filePath: "f.ts",
          duration: 1,
          result: {
            status: "FAIL",
            issues: [{ line: 0, severity: "INFO", message: "no line info" }],
          },
        },
      ],
    };
    const log = formatSarifReport(report);
    expect(log.runs[0]!.results[0]!.locations[0]!.physicalLocation.region.startLine).toBe(1);
  });

  it("derives a rules[] entry per distinct ruleId", () => {
    const log = formatSarifReport(baseReport);
    const rules = log.runs[0]!.tool.driver.rules;
    const ids = rules.map((r) => r.id);
    expect(ids).toContain("mp-sentinel/security");
    expect(ids).toContain("mp-sentinel/maintainability");
  });

  it("emits a runtime-error result for ERROR-status files", () => {
    const report: ReviewReport = {
      ...baseReport,
      results: [
        {
          filePath: "broken.ts",
          duration: 1,
          result: { status: "ERROR", message: "Provider timeout", issues: [] },
        },
      ],
    };
    const log = formatSarifReport(report);
    expect(log.runs[0]!.results[0]!.ruleId).toBe("mp-sentinel/runtime-error");
    expect(log.runs[0]!.results[0]!.message.text).toContain("Provider timeout");
  });

  it("marks cached entries via properties.cached", () => {
    const report: ReviewReport = {
      ...baseReport,
      results: [
        {
          filePath: "f.ts",
          duration: 1,
          cached: true,
          result: {
            status: "FAIL",
            issues: [{ line: 1, severity: "WARNING", message: "x" }],
          },
        },
      ],
    };
    const log = formatSarifReport(report);
    expect(log.runs[0]!.results[0]!.properties.cached).toBe(true);
  });

  it("round-trips through JSON.stringify and JSON.parse", () => {
    const text = stringifySarif(baseReport);
    const parsed = JSON.parse(text) as { version: string; runs: unknown[] };
    expect(parsed.version).toBe("2.1.0");
    expect(parsed.runs).toHaveLength(1);
  });
});
