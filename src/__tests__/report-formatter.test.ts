/**
 * Tests for console/markdown report formatters.
 *
 * Verifies that metadata (category, confidence, evidence) is displayed
 * correctly and that issues without metadata still render as before.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import type { ReviewReport } from "../types/index.js";
import { formatMarkdownReport, printConsoleReport } from "../formatters/report.js";

// ── Helpers ────────────────────────────────────────────────────────────────

const makeReport = (overrides?: Partial<ReviewReport>): ReviewReport => ({
  schemaVersion: "1.0",
  status: "FAIL",
  target: { mode: "commit" },
  aiEnabled: true,
  promptVersion: "2026-05-04",
  summary: {
    totalFiles: 1,
    auditedFiles: 1,
    passedFiles: 0,
    failedFiles: 1,
    criticalIssues: 1,
    warningIssues: 0,
    infoIssues: 0,
    durationMs: 100,
    totalChangedLines: 10,
  },
  results: [],
  skipped: [],
  errors: [],
  generatedAt: "2026-05-04T00:00:00.000Z",
  ...overrides,
});

// ── Markdown report tests ──────────────────────────────────────────────────

describe("formatMarkdownReport — metadata display", () => {
  it("renders category/confidence tag when present", () => {
    const report = makeReport({
      status: "FAIL",
      results: [
        {
          filePath: "src/utils/unsafe.ts",
          duration: 50,
          result: {
            status: "FAIL",
            issues: [
              {
                line: 10,
                severity: "CRITICAL",
                message: "eval() detected",
                category: "security",
                confidence: "high",
                evidence: "pattern: eval, match: eval(code)",
              },
            ],
          },
        },
      ],
    });

    const md = formatMarkdownReport(report);

    expect(md).toContain("[security/high]");
    expect(md).toContain("eval() detected");
    expect(md).toContain("CRITICAL");
    expect(md).toContain("pattern: eval, match: eval(code)");
  });

  it("renders evidence line with multiline collapsed", () => {
    const report = makeReport({
      results: [
        {
          filePath: "src/test.ts",
          duration: 50,
          result: {
            status: "FAIL",
            issues: [
              {
                line: 5,
                severity: "WARNING",
                message: "something dangerous",
                category: "runtime-crash",
                confidence: "medium",
                evidence: "line 1\nline 2\nline 3",
              },
            ],
          },
        },
      ],
    });

    const md = formatMarkdownReport(report);

    // Multiline evidence is collapsed to single line
    expect(md).toContain("line 1 line 2 line 3");
    expect(md).not.toContain("line 1\nline 2");
  });

  it("truncates long evidence to 160 chars", () => {
    const longEvidence = "x".repeat(300);
    const report = makeReport({
      results: [
        {
          filePath: "src/long.ts",
          duration: 50,
          result: {
            status: "FAIL",
            issues: [
              {
                line: 1,
                severity: "WARNING",
                message: "long evidence",
                category: "security",
                confidence: "high",
                evidence: longEvidence,
              },
            ],
          },
        },
      ],
    });

    const md = formatMarkdownReport(report);

    expect(md).toContain("...");
    expect(md.length).toBeLessThan(2000); // Sanity check
    // Should not contain the full 300 chars
    expect(md).not.toContain("x".repeat(200));
  });

  it("renders issues without metadata the same as before", () => {
    const report = makeReport({
      results: [
        {
          filePath: "src/old.ts",
          duration: 50,
          result: {
            status: "FAIL",
            issues: [
              {
                line: 3,
                severity: "INFO",
                message: "simple message",
              },
            ],
          },
        },
      ],
    });

    const md = formatMarkdownReport(report);

    expect(md).toContain("INFO");
    expect(md).toContain("simple message");
    // No metadata tag
    expect(md).not.toMatch(/\[.*?\/.*?\]/);
  });

  it("includes suggestion when present", () => {
    const report = makeReport({
      results: [
        {
          filePath: "src/hint.ts",
          duration: 50,
          result: {
            status: "FAIL",
            issues: [
              {
                line: 7,
                severity: "WARNING",
                message: "use safer alternative",
                category: "security",
                confidence: "medium",
                suggestion: "Consider using DOMPurify",
              },
            ],
          },
        },
      ],
    });

    const md = formatMarkdownReport(report);

    expect(md).toContain("[security/medium]");
    expect(md).toContain("Consider using DOMPurify");
  });

  it("renders findings for PASS-status result with actionable issues (defense in depth)", () => {
    const report = makeReport({
      results: [
        {
          filePath: "src/test.ts",
          duration: 50,
          result: {
            status: "PASS",
            issues: [{ line: 5, severity: "WARNING", message: "should still render" }],
          },
        },
      ],
    });

    const md = formatMarkdownReport(report);
    expect(md).toContain("should still render");
    expect(md).toContain("WARNING");
    expect(md).toContain("## Findings");
  });

  it("does NOT render findings section when only INFO issues exist with PASS status", () => {
    const report = makeReport({
      status: "PASS",
      summary: {
        totalFiles: 1,
        auditedFiles: 1,
        passedFiles: 1,
        failedFiles: 0,
        criticalIssues: 0,
        warningIssues: 0,
        infoIssues: 1,
        durationMs: 100,
        totalChangedLines: 10,
      },
      results: [
        {
          filePath: "src/test.ts",
          duration: 50,
          result: {
            status: "PASS",
            issues: [{ line: 5, severity: "INFO", message: "minor style issue" }],
          },
        },
      ],
    });

    const md = formatMarkdownReport(report);
    expect(md).not.toContain("## Findings");
  });
});

// ── Console report tests ───────────────────────────────────────────────────

describe("printConsoleReport — metadata display", () => {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  beforeEach(() => {
    console.log = jest.fn();
    console.error = jest.fn();
    console.warn = jest.fn();
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  });

  it("includes metadata tag and evidence for issue with category/confidence", () => {
    const report = makeReport({
      results: [
        {
          filePath: "src/unsafe.ts",
          duration: 50,
          result: {
            status: "FAIL",
            issues: [
              {
                line: 10,
                severity: "CRITICAL",
                message: "eval() used",
                category: "security",
                confidence: "high",
                evidence: "pattern: eval, match: eval(code)",
              },
            ],
          },
        },
      ],
    });

    printConsoleReport(report);

    const calls = (console.log as jest.Mock).mock.calls.map((c) => c.join(" ")).join("\n");

    // Contains metadata tag near the message
    expect(calls).toContain("security/high");
    expect(calls).toContain("eval() used");
    // Evidence appears on a separate dimmed line
    expect(calls).toContain("pattern: eval, match: eval(code)");
  });

  it("renders issues without metadata as before", () => {
    const report = makeReport({
      results: [
        {
          filePath: "src/plain.ts",
          duration: 50,
          result: {
            status: "FAIL",
            issues: [
              {
                line: 5,
                severity: "WARNING",
                message: "no metadata here",
              },
            ],
          },
        },
      ],
    });

    printConsoleReport(report);

    const calls = (console.log as jest.Mock).mock.calls.map((c) => c.join(" ")).join("\n");

    expect(calls).toContain("no metadata here");
    // No metadata tag pattern
    expect(calls).not.toMatch(/\[.*?\/.*?\]/);
  });

  it("renders PASS-status result with CRITICAL issues (defense in depth)", () => {
    const report = makeReport({
      results: [
        {
          filePath: "src/test.ts",
          duration: 50,
          result: {
            status: "PASS",
            issues: [{ line: 5, severity: "CRITICAL", message: "hidden critical" }],
          },
        },
      ],
    });

    printConsoleReport(report);
    const calls = (console.log as jest.Mock).mock.calls.map((c) => c.join(" ")).join("\n");
    expect(calls).toContain("hidden critical");
    expect(calls).toContain("CRITICAL");
  });
});
