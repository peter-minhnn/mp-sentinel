/**
 * Tests for the unused-import backstop.
 * Regression source: the diff-only AI reviewer flagged React/Avatar/dayjs/clsx
 * as "unused import" while they were used elsewhere in the file. ESLint
 * verifies usage across the whole file, so it is the authority where it ran.
 */

import { describe, it, expect } from "@jest/globals";
import { reconcileUnusedImportFindings } from "../utils/reconcile-unused-import-findings.js";
import type { AuditIssue, FileAuditResult } from "../types/index.js";

function file(
  filePath: string,
  issues: AuditIssue[],
  status: FileAuditResult["result"]["status"] = "FAIL",
): FileAuditResult {
  return { filePath, duration: 0, result: { status, issues } };
}

const aiUnused = (message: string, severity: AuditIssue["severity"] = "WARNING"): AuditIssue => ({
  line: 1,
  severity,
  category: "maintainability",
  confidence: "high",
  message,
  evidence: "import React from 'react';",
});

const lintAll = (_: string): boolean => true;

describe("reconcileUnusedImportFindings", () => {
  it("drops AI unused-import findings when ESLint linted the file", () => {
    const issues = [
      aiUnused("Unused import: React is imported but never used"),
      aiUnused("Unused import: Avatar is imported but never used in the component"),
    ];
    const { results, suppressed, downgraded } = reconcileUnusedImportFindings(
      [file("src/a.tsx", issues)],
      { eslintRan: true, isFileLinted: lintAll },
    );
    expect(suppressed).toBe(2);
    expect(downgraded).toBe(0);
    expect(results[0]!.result.issues).toHaveLength(0);
  });

  it("relaxes FAIL → PASS when the dropped findings were the only actionable ones", () => {
    const { results } = reconcileUnusedImportFindings(
      [file("src/a.tsx", [aiUnused("Unused import: clsx is imported but never used")])],
      { eslintRan: true, isFileLinted: lintAll },
    );
    expect(results[0]!.result.status).toBe("PASS");
  });

  it("keeps FAIL when another actionable finding remains", () => {
    const realBug: AuditIssue = {
      line: 9,
      severity: "CRITICAL",
      category: "runtime-crash",
      message: "Null dereference on detailData",
      evidence: "detailData.id",
    };
    const { results } = reconcileUnusedImportFindings(
      [file("src/a.tsx", [aiUnused("Unused import: dayjs is imported but never used"), realBug])],
      { eslintRan: true, isFileLinted: lintAll },
    );
    expect(results[0]!.result.status).toBe("FAIL");
    expect(results[0]!.result.issues).toHaveLength(1);
  });

  it("downgrades to INFO/low when the file was not linted", () => {
    const { results, suppressed, downgraded } = reconcileUnusedImportFindings(
      [file("src/a.tsx", [aiUnused("Unused import: React is imported but never used")])],
      { eslintRan: false, isFileLinted: lintAll },
    );
    expect(downgraded).toBe(1);
    expect(suppressed).toBe(0);
    const issue = results[0]!.result.issues![0]!;
    expect(issue.severity).toBe("INFO");
    expect(issue.confidence).toBe("low");
    expect(issue.message).toContain("unverifiable on diff");
    // INFO is non-actionable → status relaxes.
    expect(results[0]!.result.status).toBe("PASS");
  });

  it("downgrades when ESLint ran but did not cover this file's extension", () => {
    const onlyTs = (p: string): boolean => p.endsWith(".ts") || p.endsWith(".tsx");
    const { suppressed, downgraded } = reconcileUnusedImportFindings(
      [file("src/styles.css", [aiUnused("Unused import: tokens never used in the file")])],
      { eslintRan: true, isFileLinted: onlyTs },
    );
    expect(suppressed).toBe(0);
    expect(downgraded).toBe(1);
  });

  it("never touches ESLint-sourced unused findings", () => {
    const eslintIssue: AuditIssue = {
      line: 2,
      severity: "WARNING",
      category: "maintainability",
      confidence: "high",
      message: "[ESLint] 'Avatar' is defined but never used (@typescript-eslint/no-unused-vars)",
      evidence: "eslint:@typescript-eslint/no-unused-vars",
    };
    const { results, suppressed, downgraded } = reconcileUnusedImportFindings(
      [file("src/a.tsx", [eslintIssue])],
      { eslintRan: true, isFileLinted: lintAll },
    );
    expect(suppressed).toBe(0);
    expect(downgraded).toBe(0);
    expect(results[0]!.result.issues).toHaveLength(1);
  });

  it("ignores unrelated findings", () => {
    const other: AuditIssue = {
      line: 5,
      severity: "WARNING",
      category: "performance",
      message: "Inline object literal passed as prop defeats memoization",
    };
    const { results, suppressed, downgraded } = reconcileUnusedImportFindings(
      [file("src/a.tsx", [other])],
      { eslintRan: true, isFileLinted: lintAll },
    );
    expect(suppressed).toBe(0);
    expect(downgraded).toBe(0);
    expect(results[0]!.result.issues![0]).toEqual(other);
  });

  it("leaves an already-INFO unused finding unchanged when not linted", () => {
    const { results, downgraded } = reconcileUnusedImportFindings(
      [file("src/a.tsx", [aiUnused("Unused import: React never used", "INFO")], "PASS")],
      { eslintRan: false, isFileLinted: lintAll },
    );
    expect(downgraded).toBe(0);
    expect(results[0]!.result.issues![0]!.severity).toBe("INFO");
  });
});
