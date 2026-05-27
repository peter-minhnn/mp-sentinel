/**
 * Tests for deterministic review helper and printResultsSummary.
 */

import { describe, it, expect, jest } from "@jest/globals";
import { runDeterministicReview } from "../cli/deterministic-review.js";
import { printResultsSummary } from "../cli/summary.js";
import type { AuditIssue, FileAuditResult } from "../types/index.js";

// ── Helpers ────────────────────────────────────────────────────────────────

const noRedactions: Array<{
  path: string;
  redactedCount: number;
  matchedPatterns: string[];
}> = [];

const makeRedaction = (
  path: string,
  patterns: string[] = ["AWS_ACCESS_KEY"],
): { path: string; redactedCount: number; matchedPatterns: string[] } => ({
  path,
  redactedCount: 1,
  matchedPatterns: patterns,
});

const makeResult = (
  filePath: string,
  status: "PASS" | "FAIL" | "ERROR" = "PASS",
  issues: AuditIssue[] = [],
): FileAuditResult => ({
  filePath,
  result: { status, issues },
  duration: 0,
});

const makeIssue = (
  severity: "CRITICAL" | "WARNING" | "INFO",
  line: number,
  message: string,
): AuditIssue => ({
  line,
  severity,
  message,
  category: "security",
  confidence: "high",
  evidence: `test: ${message}`,
});

// ── runDeterministicReview tests ────────────────────────────────────────────

describe("runDeterministicReview", () => {
  describe("without AI results (fallback mode)", () => {
    it("returns PASS for clean files", () => {
      const results = runDeterministicReview(
        [{ path: "src/clean.ts", content: "export const x = 1;\n" }],
        noRedactions,
      );

      expect(results).toHaveLength(1);
      expect(results[0]!.filePath).toBe("src/clean.ts");
      expect(results[0]!.result.status).toBe("PASS");
    });

    it("returns FAIL with CRITICAL for dangerous code (eval)", () => {
      const results = runDeterministicReview(
        [{ path: "src/bad.ts", content: 'eval("console.log(1)");\n' }],
        noRedactions,
      );

      expect(results).toHaveLength(1);
      expect(results[0]!.result.status).toBe("FAIL");
      const hasEvalIssue = results[0]!.result.issues?.some(
        (i) => i.severity === "CRITICAL" && i.message.includes("eval"),
      );
      expect(hasEvalIssue).toBe(true);
    });

    it("returns FAIL with CRITICAL for dangerouslySetInnerHTML", () => {
      const results = runDeterministicReview(
        [
          {
            path: "src/Component.tsx",
            content: "const x = <div dangerouslySetInnerHTML={{ __html: foo }} />;\n",
          },
        ],
        noRedactions,
      );

      const result = results[0]!;
      expect(result.result.status).toBe("FAIL");
      expect(
        result.result.issues?.some(
          (i) => i.severity === "CRITICAL" && i.message.includes("dangerouslySetInnerHTML"),
        ),
      ).toBe(true);
    });

    it("returns FAIL with CRITICAL for SQL concatenation", () => {
      const results = runDeterministicReview(
        [
          {
            path: "src/db.ts",
            content: 'const q = "SELECT * FROM users WHERE id = " + userId;\n',
          },
        ],
        noRedactions,
      );

      const result = results[0]!;
      expect(result.result.status).toBe("FAIL");
      expect(
        result.result.issues?.some((i) => i.severity === "CRITICAL" && i.message.includes("SQL")),
      ).toBe(true);
    });

    it("returns FAIL with WARNING for child_process.exec", () => {
      const results = runDeterministicReview(
        [
          {
            path: "src/run.ts",
            content: 'import { execSync } from "node:child_process";\nexecSync("ls");\n',
          },
        ],
        noRedactions,
      );

      const result = results[0]!;
      expect(result.result.status).toBe("FAIL");
      expect(
        result.result.issues?.some(
          (i) => i.severity === "WARNING" && i.message.includes("child_process"),
        ),
      ).toBe(true);
    });

    it("returns FAIL for redacted files", () => {
      const results = runDeterministicReview(
        [{ path: "src/secrets.ts", content: 'const key = "REDACTED";\n' }],
        [makeRedaction("src/secrets.ts")],
      );

      const result = results[0]!;
      expect(result.result.status).toBe("FAIL");
      expect(
        result.result.issues?.some(
          (i) => i.severity === "CRITICAL" && i.evidence === "secret-redaction",
        ),
      ).toBe(true);
    });

    it("returns PASS with INFO findings (does not force FAIL)", () => {
      const results = runDeterministicReview(
        [
          {
            path: "src/util.ts",
            content: 'console.log("debug message");\n',
          },
        ],
        noRedactions,
      );

      const result = results[0]!;
      expect(
        result.result.status === "PASS" ||
          (result.result.status === "FAIL" &&
            result.result.issues?.some((i) => i.severity !== "INFO")),
      ).toBe(true);
    });

    it("returns PASS for clean files with INFO-level hardcoded URL", () => {
      const results = runDeterministicReview(
        [
          {
            path: "src/config.ts",
            content: 'const url = "http://localhost:3000/api";\n',
          },
        ],
        noRedactions,
      );

      // INFO issues should not force FAIL
      const result = results[0]!;
      expect(result.result.status).toBe("PASS");
    });
  });

  describe("with AI results (merge mode)", () => {
    it("merges deterministic CRITICAL findings into AI PASS results", () => {
      const aiResults = [makeResult("src/bad.ts", "PASS")];

      const results = runDeterministicReview(
        [{ path: "src/bad.ts", content: 'eval("oops");\n' }],
        noRedactions,
        aiResults,
      );

      expect(results[0]!.result.status).toBe("FAIL");
      expect(
        results[0]!.result.issues?.some(
          (i) => i.severity === "CRITICAL" && i.message.includes("eval"),
        ),
      ).toBe(true);
    });

    it("keeps AI issues alongside deterministic findings", () => {
      const aiIssue = makeIssue("WARNING", 5, "AI-detected issue");
      const aiResults = [makeResult("src/mixed.ts", "PASS", [aiIssue])];

      const results = runDeterministicReview(
        [{ path: "src/mixed.ts", content: 'eval("bad");\n' }],
        noRedactions,
        aiResults,
      );

      const result = results[0]!;
      expect(result.result.status).toBe("FAIL");
      expect(result.result.issues?.some((i) => i.message === "AI-detected issue")).toBe(true);
      expect(
        result.result.issues?.some((i) => i.severity === "CRITICAL" && i.message.includes("eval")),
      ).toBe(true);
    });

    it("does not modify AI FAIL results that already have issues", () => {
      const aiIssue = makeIssue("CRITICAL", 1, "AI critical");
      const aiResults = [makeResult("src/fail.ts", "FAIL", [aiIssue])];

      const results = runDeterministicReview(
        [{ path: "src/fail.ts", content: "export const x = 1;\n" }],
        noRedactions,
        aiResults,
      );

      expect(results[0]!.result.status).toBe("FAIL");
      expect(results[0]!.result.issues).toHaveLength(1);
      expect(results[0]!.result.issues![0]!.message).toBe("AI critical");
    });

    it("handles empty AI results array gracefully", () => {
      const results = runDeterministicReview(
        [{ path: "src/bad.ts", content: 'eval("test");\n' }],
        noRedactions,
        [],
      );

      // Empty AI results + risk findings → synthetic entries for bad files
      const badFile = results.find((r) => r.filePath === "src/bad.ts");
      expect(badFile).toBeDefined();
      expect(badFile!.result.status).toBe("FAIL");
    });
  });
});

// ── printResultsSummary tests ───────────────────────────────────────────────

describe("printResultsSummary", () => {
  let consoleLogSpy: ReturnType<typeof jest.spyOn>;
  let consoleErrorSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("returns true when all results PASS", () => {
    const results = [makeResult("a.ts", "PASS"), makeResult("b.ts", "PASS")];
    expect(printResultsSummary(results, 1000)).toBe(true);
  });

  it("returns false when any result is FAIL", () => {
    const results = [makeResult("a.ts", "PASS"), makeResult("b.ts", "FAIL")];
    expect(printResultsSummary(results, 1000)).toBe(false);
  });

  it("returns false when any result is ERROR", () => {
    const results = [makeResult("a.ts", "PASS"), makeResult("b.ts", "ERROR")];
    expect(printResultsSummary(results, 1000)).toBe(false);
  });

  it("returns false for FAIL with WARNING-only issues (no CRITICAL)", () => {
    const warningIssue = makeIssue("WARNING", 1, "something risky");
    const results = [makeResult("a.ts", "PASS"), makeResult("b.ts", "FAIL", [warningIssue])];
    expect(printResultsSummary(results, 1000)).toBe(false);
  });

  it("returns true for FAIL with INFO-only issues under default WARNING threshold (Phase 1.5)", () => {
    // INFO findings fall below the default WARNING threshold, so even when
    // an AI marks status=FAIL with only INFO-severity issues the review
    // passes. To fail on INFO use --severity-threshold INFO.
    const infoIssue = makeIssue("INFO", 1, "info message");
    const results = [makeResult("a.ts", "FAIL", [infoIssue])];
    expect(printResultsSummary(results, 1000)).toBe(true);
  });

  it("returns false for FAIL with INFO-only issues when threshold is INFO", () => {
    const infoIssue = makeIssue("INFO", 1, "info message");
    const results = [makeResult("a.ts", "FAIL", [infoIssue])];
    expect(printResultsSummary(results, 1000, "INFO")).toBe(false);
  });

  it("returns true for FAIL with WARNING-only issues when threshold is CRITICAL", () => {
    const warningIssue = makeIssue("WARNING", 1, "noisy but not failing");
    const results = [makeResult("a.ts", "FAIL", [warningIssue])];
    expect(printResultsSummary(results, 1000, "CRITICAL")).toBe(true);
  });

  it("returns false when there are system errors (FAIL with no issues)", () => {
    const results = [makeResult("a.ts", "PASS"), makeResult("b.ts", "FAIL")];
    expect(printResultsSummary(results, 1000)).toBe(false);
  });

  it("renders the new icon table layout in output", () => {
    const results = [makeResult("a.ts", "PASS"), makeResult("b.ts", "PASS")];
    printResultsSummary(results, 1000);

    const calls = (console.log as jest.Mock).mock.calls.map((c) => c.join(" ")).join("\n");
    expect(calls).toContain("📊 Audit Summary");
    expect(calls).toContain("✅ Passed");
    expect(calls).toContain("❌ Failed");
    expect(calls).toContain("💥 Errors");
    expect(calls).toContain("🚨 Critical");
    expect(calls).toContain("⏱️  Duration");
  });

  it("uses severity sorting in output", () => {
    const criticalIssue = makeIssue("CRITICAL", 5, "critical problem");
    const warningIssue = makeIssue("WARNING", 3, "warning problem");
    const results = [
      makeResult("z.ts", "FAIL", [warningIssue]),
      makeResult("a.ts", "FAIL", [criticalIssue]),
    ];
    printResultsSummary(results, 1000);

    const calls = (console.log as jest.Mock).mock.calls.map((c) => c.join(" ")).join("\n");
    // CRITICAL file should appear before WARNING file in output
    const criticalIdx = calls.indexOf("critical problem");
    const warningIdx = calls.indexOf("warning problem");
    expect(criticalIdx).toBeLessThan(warningIdx);
  });
});
