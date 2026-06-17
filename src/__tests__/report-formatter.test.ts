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

// ── INFO-only files appear in Findings ──────────────────────────────────────

describe("formatMarkdownReport — INFO-only files", () => {
  it("renders INFO-only files in `## Findings` so summary and body agree", () => {
    const md = formatMarkdownReport(
      makeReport({
        status: "PASS",
        summary: {
          ...makeReport().summary,
          criticalIssues: 0,
          warningIssues: 0,
          infoIssues: 1,
        },
        results: [
          {
            filePath: "src/info-only.ts",
            duration: 5,
            result: {
              status: "PASS",
              issues: [{ line: 4, severity: "INFO", message: "Consider a clearer name" }],
            },
          },
        ],
      }),
    );
    expect(md).toContain("## Findings");
    expect(md).toContain("src/info-only.ts");
    expect(md).toContain("Consider a clearer name");
  });
});

// ── Target label & diff lines ──────────────────────────────────────────────

describe("formatMarkdownReport — target label & diff lines", () => {
  it("prefers targetLabel over the raw machine target", () => {
    const md = formatMarkdownReport(
      makeReport({
        target: { mode: "range", value: "origin/develop" },
        targetLabel: "branch-diff (feature/x vs origin/develop)",
      }),
    );
    expect(md).toContain("branch-diff (feature/x vs origin/develop)");
    expect(md).not.toContain("range:origin/develop");
  });

  it("falls back to the machine target when no label is set", () => {
    const md = formatMarkdownReport(makeReport({ target: { mode: "staged" } }));
    expect(md).toContain("staged");
  });

  it("shows the diff-line count when available", () => {
    const md = formatMarkdownReport(
      makeReport({ summary: { ...makeReport().summary, totalChangedLines: 42 } }),
    );
    expect(md).toMatch(/Diff lines \| 42/);
  });

  it("shows N/A for diff lines when 0 but files were audited", () => {
    const md = formatMarkdownReport(
      makeReport({ summary: { ...makeReport().summary, totalChangedLines: 0, auditedFiles: 3 } }),
    );
    expect(md).toMatch(/Diff lines \| N\/A/);
  });
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

  it("renders the findings section for INFO-only PASS files (summary/body must agree)", () => {
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
    expect(md).toContain("## Findings");
    expect(md).toContain("src/test.ts");
    expect(md).toContain("minor style issue");
    expect(md).toContain("INFO");
  });

  it("renders summary with Icon | Metric | Value columns", () => {
    const report = makeReport();
    const md = formatMarkdownReport(report);

    // Markdown table header with Icon column
    expect(md).toContain("| Icon | Metric | Value |");
    // Summary rows included
    expect(md).toContain("| Status |");
    expect(md).toContain("| Target |");
    expect(md).toContain("| AI Enabled |");
    expect(md).toContain("| Total files |");
  });

  it("sorts findings by severity then file path", () => {
    const report = makeReport({
      results: [
        {
          filePath: "src/z.ts",
          duration: 50,
          result: {
            status: "FAIL",
            issues: [
              { line: 5, severity: "INFO", message: "info in z" },
              { line: 3, severity: "CRITICAL", message: "critical in z" },
            ],
          },
        },
        {
          filePath: "src/a.ts",
          duration: 50,
          result: {
            status: "FAIL",
            issues: [{ line: 1, severity: "WARNING", message: "warning in a" }],
          },
        },
      ],
    });

    const md = formatMarkdownReport(report);

    // CRITICAL file should come before WARNING file
    const criticalIdx = md.indexOf("critical in z");
    const warningIdx = md.indexOf("warning in a");
    expect(criticalIdx).toBeLessThan(warningIdx);
  });

  it("starts with the report header, not the ASCII banner", () => {
    const report = makeReport();
    const md = formatMarkdownReport(report);

    // Markdown output must start with the # MP Sentinel header, not banner text
    expect(md.startsWith("# MP Sentinel Review Report")).toBe(true);
    expect(md).not.toContain("MP SENTINEL - Code Review");
    expect(md).not.toContain("AI-Powered Code Review");
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

  it("renders the modern compact header and overview section", () => {
    const report = makeReport();
    printConsoleReport(report);

    const calls = (console.log as jest.Mock).mock.calls.map((c) => c.join(" ")).join("\n");

    // Compact header with product name + version (no large ASCII banner)
    expect(calls).toContain("MP Sentinel");
    expect(calls).toMatch(/MP Sentinel.*v\d/);
    expect(calls).not.toContain("MP SENTINEL - Code Review");
    // Overview section with key/value rows
    expect(calls).toContain("Overview");
    expect(calls).toContain("Status");
    expect(calls).toContain("FAIL");
    expect(calls).toContain("Target");
    expect(calls).toContain("AI review");
    expect(calls).toContain("audited");
    expect(calls).toContain("critical");
    expect(calls).toContain("Diff lines");
    expect(calls).toContain("Duration");
  });

  it("renders token usage and estimated cost when available", () => {
    const report = makeReport({
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
        tokenUsage: {
          inputTokens: 1234,
          outputTokens: 567,
          callCount: 2,
          estimatedCostUsd: 0.0123,
        },
      },
    });
    printConsoleReport(report);

    const calls = (console.log as jest.Mock).mock.calls.map((c) => c.join(" ")).join("\n");
    expect(calls).toContain("Tokens");
    expect(calls).toContain("in=1,234");
    expect(calls).toContain("out=567");
    expect(calls).toContain("2 calls");
    expect(calls).toContain("Est. cost");
    expect(calls).toContain("$0.0123");
  });

  it("renders skipped and runtime-error sections only when present", () => {
    const cleanReport = makeReport();
    printConsoleReport(cleanReport);
    let calls = (console.log as jest.Mock).mock.calls.map((c) => c.join(" ")).join("\n");
    expect(calls).not.toContain("Skipped");

    (console.log as jest.Mock).mockClear();
    (console.error as jest.Mock).mockClear();

    const report = makeReport({
      skipped: [{ path: "vendor/min.js", reason: "minified file" }],
      errors: ["provider exploded"],
    });
    printConsoleReport(report);

    calls = (console.log as jest.Mock).mock.calls.map((c) => c.join(" ")).join("\n");
    const errCalls = (console.error as jest.Mock).mock.calls.map((c) => c.join(" ")).join("\n");
    expect(calls).toContain("Skipped (1)");
    expect(calls).toContain("vendor/min.js");
    expect(calls).toContain("minified file");
    expect(errCalls).toContain("Runtime errors (1)");
  });

  it("sorts findings by severity then file path", () => {
    const report = makeReport({
      results: [
        {
          filePath: "src/z.ts",
          duration: 50,
          result: {
            status: "FAIL",
            issues: [
              { line: 5, severity: "INFO", message: "info in z" },
              { line: 3, severity: "CRITICAL", message: "critical in z" },
            ],
          },
        },
        {
          filePath: "src/a.ts",
          duration: 50,
          result: {
            status: "FAIL",
            issues: [{ line: 1, severity: "WARNING", message: "warning in a" }],
          },
        },
      ],
    });

    printConsoleReport(report);
    const calls = (console.log as jest.Mock).mock.calls.map((c) => c.join(" ")).join("\n");

    // CRITICAL issue should appear in output before WARNING issue
    const criticalIdx = calls.indexOf("critical in z");
    const warningIdx = calls.indexOf("warning in a");
    expect(criticalIdx).toBeLessThan(warningIdx);
  });
});

// ── Color behavior tests ───────────────────────────────────────────────────

describe("printConsoleReport — color behavior", () => {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalNoColor = process.env["NO_COLOR"];

  beforeEach(() => {
    console.log = jest.fn();
    console.error = jest.fn();
    console.warn = jest.fn();
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
    if (originalNoColor === undefined) {
      delete process.env["NO_COLOR"];
    } else {
      process.env["NO_COLOR"] = originalNoColor;
    }
  });

  const reportWithFinding = (): ReviewReport =>
    makeReport({
      results: [
        {
          filePath: "src/x.ts",
          duration: 10,
          result: {
            status: "FAIL",
            issues: [{ line: 1, severity: "CRITICAL", message: "boom" }],
          },
        },
      ],
    });

  it("emits ANSI escape codes by default", () => {
    delete process.env["NO_COLOR"];
    printConsoleReport(reportWithFinding());

    const calls = (console.log as jest.Mock).mock.calls.map((c) => c.join(" ")).join("\n");
    expect(calls).toContain("\x1b[");
  });

  it("emits no ANSI escape codes when NO_COLOR is set", () => {
    process.env["NO_COLOR"] = "1";
    printConsoleReport(reportWithFinding());

    const calls = (console.log as jest.Mock).mock.calls.map((c) => c.join(" ")).join("\n");
    expect(calls).not.toContain("\x1b[");
    // Content is still present, just unstyled
    expect(calls).toContain("MP Sentinel");
    expect(calls).toContain("boom");
  });
});
