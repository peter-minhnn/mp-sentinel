/**
 * Tests for the exact-duplicate finding remover.
 */

import { describe, it, expect } from "@jest/globals";
import { dedupeFindings } from "../utils/dedupe-findings.js";
import type { AuditIssue, FileAuditResult } from "../types/index.js";

function file(filePath: string, issues: AuditIssue[]): FileAuditResult {
  return { filePath, duration: 0, result: { status: "FAIL", issues } };
}

describe("dedupeFindings", () => {
  it("removes an exact duplicate at the same line", () => {
    const issues: AuditIssue[] = [
      { line: 5, severity: "WARNING", message: "Avoid the any type" },
      { line: 5, severity: "WARNING", message: "Avoid the any type" },
    ];
    const { results, removed } = dedupeFindings([file("a.ts", issues)]);
    expect(removed).toBe(1);
    expect(results[0]!.result.issues).toHaveLength(1);
  });

  it("normalizes whitespace/case when comparing", () => {
    const issues: AuditIssue[] = [
      { line: 1, severity: "WARNING", message: "Inline style detected" },
      { line: 1, severity: "WARNING", message: "inline   STYLE detected" },
    ];
    const { removed } = dedupeFindings([file("a.ts", issues)]);
    expect(removed).toBe(1);
  });

  it("keeps distinct issues on the same line", () => {
    const issues: AuditIssue[] = [
      { line: 7, severity: "WARNING", message: "Issue A" },
      { line: 7, severity: "WARNING", message: "Issue B" },
    ];
    const { results, removed } = dedupeFindings([file("a.ts", issues)]);
    expect(removed).toBe(0);
    expect(results[0]!.result.issues).toHaveLength(2);
  });

  it("keeps the same message on different lines", () => {
    const issues: AuditIssue[] = [
      { line: 1, severity: "WARNING", message: "dup" },
      { line: 9, severity: "WARNING", message: "dup" },
    ];
    const { removed } = dedupeFindings([file("a.ts", issues)]);
    expect(removed).toBe(0);
  });

  it("does not change the file object when there are no duplicates", () => {
    const original = file("a.ts", [{ line: 1, severity: "INFO", message: "x" }]);
    const { results, removed } = dedupeFindings([original]);
    expect(removed).toBe(0);
    expect(results[0]).toBe(original); // same reference (no copy)
  });
});
