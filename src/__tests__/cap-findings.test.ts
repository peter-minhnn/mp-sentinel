/**
 * Tests for the per-file noise budget (Phase 4.5).
 * Regression source: local-mode rule packs produced files with 20+ style
 * warnings, burying high-value findings.
 */

import { describe, it, expect } from "@jest/globals";
import { capFindingsPerFile } from "../utils/cap-findings.js";
import type { AuditIssue, FileAuditResult } from "../types/index.js";

function file(filePath: string, issues: AuditIssue[]): FileAuditResult {
  return { filePath, duration: 0, result: { status: "FAIL", issues } };
}

const warnings = (n: number): AuditIssue[] =>
  Array.from({ length: n }, (_, i) => ({
    line: i + 1,
    severity: "WARNING" as const,
    category: "maintainability",
    message: `style warning ${i}`,
  }));

describe("capFindingsPerFile", () => {
  it("is a no-op when max <= 0", () => {
    const input = [file("a.tsx", warnings(30))];
    const { results, hidden } = capFindingsPerFile(input, 0);
    expect(hidden).toBe(0);
    expect(results[0]!.result.issues).toHaveLength(30);
  });

  it("caps non-critical findings and adds a summary", () => {
    const { results, hidden } = capFindingsPerFile([file("a.tsx", warnings(24))], 10);
    expect(hidden).toBe(14);
    const issues = results[0]!.result.issues!;
    // 10 kept + 1 summary
    expect(issues).toHaveLength(11);
    const summary = issues[issues.length - 1]!;
    expect(summary.severity).toBe("INFO");
    expect(summary.message).toContain("+14 more");
  });

  it("never caps CRITICAL findings", () => {
    const issues: AuditIssue[] = [
      ...Array.from({ length: 5 }, (_, i) => ({
        line: i + 1,
        severity: "CRITICAL" as const,
        category: "security",
        message: `crit ${i}`,
      })),
      ...warnings(20),
    ];
    const { results } = capFindingsPerFile([file("a.tsx", issues)], 3);
    const kept = results[0]!.result.issues!;
    expect(kept.filter((i) => i.severity === "CRITICAL")).toHaveLength(5);
    // 3 warnings kept + 1 summary
    expect(kept.filter((i) => i.severity === "WARNING")).toHaveLength(3);
  });

  it("keeps the most informative findings (evidence/longer prose) first", () => {
    const issues: AuditIssue[] = [
      { line: 1, severity: "WARNING", category: "maintainability", message: "short" },
      {
        line: 2,
        severity: "WARNING",
        category: "maintainability",
        message: "detailed finding with evidence",
        evidence: "const x = '#fff';",
      },
      { line: 3, severity: "WARNING", category: "maintainability", message: "tiny" },
    ];
    const { results } = capFindingsPerFile([file("a.tsx", issues)], 1);
    const kept = results[0]!.result.issues!.filter((i) => i.severity === "WARNING");
    expect(kept).toHaveLength(1);
    expect(kept[0]!.evidence).toBeDefined();
  });

  it("leaves files under the cap untouched", () => {
    const input = [file("a.tsx", warnings(5))];
    const { results, hidden } = capFindingsPerFile(input, 10);
    expect(hidden).toBe(0);
    expect(results[0]).toBe(input[0]);
  });
});
