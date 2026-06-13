/**
 * Tests for the category-based severity clamp.
 *
 * Regression source: real-world reports where architecture/style findings
 * (inline endpoint strings) were emitted as CRITICAL.
 */

import { describe, it, expect } from "@jest/globals";
import { clampSeverities } from "../utils/severity-clamp.js";
import type { AuditIssue, FileAuditResult } from "../types/index.js";

function file(filePath: string, issues: AuditIssue[]): FileAuditResult {
  return { filePath, duration: 0, result: { status: "FAIL", issues } };
}

describe("clampSeverities", () => {
  it("caps architecture CRITICAL at WARNING (style-as-critical regression)", () => {
    const issues: AuditIssue[] = [
      {
        line: 44,
        severity: "CRITICAL",
        category: "architecture",
        message: "Inline endpoint string with ?companyId= query param",
      },
    ];
    const { results, clamped } = clampSeverities([file("boardApi.ts", issues)]);
    expect(clamped).toBe(1);
    const issue = results[0]!.result.issues![0]!;
    expect(issue.severity).toBe("WARNING");
    expect(issue.message).toContain("[severity capped: architecture → WARNING]");
  });

  it("never clamps security or runtime-crash findings", () => {
    const issues: AuditIssue[] = [
      { line: 1, severity: "CRITICAL", category: "security", message: "Hardcoded fallback role" },
      { line: 2, severity: "CRITICAL", category: "runtime-crash", message: "parseInt radix -1" },
    ];
    const { results, clamped } = clampSeverities([file("auth.ts", issues)]);
    expect(clamped).toBe(0);
    expect(results[0]!.result.issues!.every((i) => i.severity === "CRITICAL")).toBe(true);
  });

  it("leaves uncategorized findings untouched", () => {
    const issues: AuditIssue[] = [{ line: 3, severity: "CRITICAL", message: "No category" }];
    const { clamped } = clampSeverities([file("a.ts", issues)]);
    expect(clamped).toBe(0);
  });

  it("does not raise severities below the ceiling", () => {
    const issues: AuditIssue[] = [
      { line: 4, severity: "INFO", category: "architecture", message: "Minor layering note" },
    ];
    const { results, clamped } = clampSeverities([file("a.ts", issues)]);
    expect(clamped).toBe(0);
    expect(results[0]!.result.issues![0]!.severity).toBe("INFO");
  });

  it("user ceilings merge over defaults and can disable a default clamp", () => {
    const issues: AuditIssue[] = [
      { line: 5, severity: "CRITICAL", category: "architecture", message: "Layering break" },
      { line: 6, severity: "WARNING", category: "performance", message: "O(n^2) filter" },
    ];
    const { results, clamped } = clampSeverities([file("a.ts", issues)], {
      architecture: "CRITICAL", // disable default clamp
      performance: "INFO", // tighten default
    });
    expect(clamped).toBe(1);
    expect(results[0]!.result.issues![0]!.severity).toBe("CRITICAL");
    expect(results[0]!.result.issues![1]!.severity).toBe("INFO");
  });

  it("downgrades low-confidence CRITICALs regardless of category", () => {
    const issues: AuditIssue[] = [
      {
        line: 8,
        severity: "CRITICAL",
        category: "runtime-crash",
        confidence: "low",
        message: "Possible crash",
      },
    ];
    const { results, clamped } = clampSeverities([file("a.ts", issues)]);
    expect(clamped).toBe(1);
    const issue = results[0]!.result.issues![0]!;
    expect(issue.severity).toBe("WARNING");
    expect(issue.message).toContain("[downgraded: low-confidence CRITICAL]");
  });

  it("keeps high-confidence and no-confidence runtime-crash/security CRITICALs", () => {
    const issues: AuditIssue[] = [
      {
        line: 9,
        severity: "CRITICAL",
        category: "runtime-crash",
        confidence: "high",
        message: "Crash",
      },
      { line: 10, severity: "CRITICAL", category: "security", message: "No confidence field" },
    ];
    const { clamped } = clampSeverities([file("a.ts", issues)]);
    expect(clamped).toBe(0);
  });

  it("downgrades medium-confidence runtime-crash/security CRITICALs (confidence floor)", () => {
    const issues: AuditIssue[] = [
      {
        line: 1,
        severity: "CRITICAL",
        category: "runtime-crash",
        confidence: "medium",
        message: "apiItems[0] on empty array may be undefined",
      },
      {
        line: 2,
        severity: "CRITICAL",
        category: "security",
        confidence: "medium",
        message: "localStorage value injected into URL",
      },
    ];
    const { results, clamped } = clampSeverities([file("a.ts", issues)]);
    expect(clamped).toBe(2);
    expect(results[0]!.result.issues!.every((i) => i.severity === "WARNING")).toBe(true);
    expect(results[0]!.result.issues![0]!.message).toContain("[needs-human-review");
  });

  it("does NOT apply the confidence floor to medium architecture/maintainability", () => {
    // Those are already capped to WARNING by the ceiling, not the floor —
    // ensure the floor message does not leak onto non-crash/security cats.
    const issues: AuditIssue[] = [
      {
        line: 1,
        severity: "CRITICAL",
        category: "architecture",
        confidence: "medium",
        message: "Layering break",
      },
    ];
    const { results } = clampSeverities([file("a.ts", issues)]);
    expect(results[0]!.result.issues![0]!.message).toContain("[severity capped");
    expect(results[0]!.result.issues![0]!.message).not.toContain("needs-human-review");
  });

  it("returns the same file object when nothing changes", () => {
    const input = file("a.ts", [
      { line: 1, severity: "WARNING", category: "architecture", message: "x" },
    ]);
    const { results } = clampSeverities([input]);
    expect(results[0]).toBe(input);
  });
});
