/**
 * Tests for HEAD reconciliation of historical-commit findings.
 *
 * Regression source: per-commit review reports listing bugs as "must fix
 * before merge" that later commits in the same branch had already fixed.
 */

import { describe, it, expect } from "@jest/globals";
import { reconcileFindings } from "../utils/reconcile-findings.js";
import { activeIssues, issuesFailThreshold } from "../utils/severity.js";
import type { AuditIssue, FileAuditResult } from "../types/index.js";

function file(filePath: string, issues: AuditIssue[]): FileAuditResult {
  return { filePath, duration: 0, result: { status: "FAIL", issues } };
}

const reader =
  (contents: Record<string, string>) =>
  async (absolutePath: string): Promise<string> => {
    for (const [name, content] of Object.entries(contents)) {
      if (absolutePath.endsWith(name)) return content;
    }
    throw new Error(`ENOENT: ${absolutePath}`);
  };

describe("reconcileFindings", () => {
  it("keeps a finding active when evidence still exists at HEAD", async () => {
    const issues: AuditIssue[] = [
      {
        line: 41,
        severity: "CRITICAL",
        message: "useQuery called directly in component",
        evidence: "const { data } = useQuery({ queryKey: ['x'] })",
      },
    ];
    const { results, resolved, unverified } = await reconcileFindings([file("a.tsx", issues)], {
      readFileImpl: reader({ "a.tsx": "const { data } = useQuery({ queryKey: ['x'] })" }),
      pickaxeImpl: async () => [],
    });
    expect(resolved).toBe(0);
    expect(unverified).toBe(0);
    expect(results[0]!.result.issues![0]!.resolution).toBeUndefined();
  });

  it("marks a finding resolved-at-head when evidence is gone but history shows the fix", async () => {
    const issues: AuditIssue[] = [
      {
        line: 14,
        severity: "CRITICAL",
        message: "parseInt radix -1 always returns NaN",
        evidence: "const postId = parseInt(String(id), -1);",
      },
    ];
    const { results, resolved } = await reconcileFindings([file("page.tsx", issues)], {
      readFileImpl: reader({ "page.tsx": "const postId = Number(id);" }),
      pickaxeImpl: async () => ["ad30c91", "40754c7"],
    });
    expect(resolved).toBe(1);
    const issue = results[0]!.result.issues![0]!;
    expect(issue.resolution).toBe("resolved-at-head");
    expect(issue.resolvedBy).toBe("ad30c91");
    expect(issue.message).toContain("[resolved at HEAD by ad30c91]");
    // Severity preserved for the record
    expect(issue.severity).toBe("CRITICAL");
  });

  it("resolved findings no longer fail the threshold or count as active", async () => {
    const issues: AuditIssue[] = [
      {
        line: 1,
        severity: "CRITICAL",
        message: "stale bug",
        evidence: "this code was removed later on",
      },
    ];
    const { results } = await reconcileFindings([file("a.ts", issues)], {
      readFileImpl: reader({ "a.ts": "completely different now" }),
      pickaxeImpl: async () => ["abc1234"],
    });
    const reconciled = results[0]!.result.issues;
    expect(issuesFailThreshold(reconciled, "WARNING")).toBe(false);
    expect(activeIssues(reconciled)).toHaveLength(0);
  });

  it("downgrades to unverified when evidence is in neither file nor history", async () => {
    const issues: AuditIssue[] = [
      {
        line: 9,
        severity: "CRITICAL",
        message: "hallucinated crash",
        evidence: "code that never existed anywhere",
      },
    ];
    const { results, unverified } = await reconcileFindings([file("a.ts", issues)], {
      readFileImpl: reader({ "a.ts": "real content" }),
      pickaxeImpl: async () => [],
    });
    expect(unverified).toBe(1);
    const issue = results[0]!.result.issues![0]!;
    expect(issue.resolution).toBe("unverified");
    expect(issue.severity).toBe("WARNING");
    expect(issue.confidence).toBe("low");
    // Unverified findings still count as active (they need human review)
    expect(activeIssues([issue])).toHaveLength(1);
  });

  it("fails open when git pickaxe errors", async () => {
    const issues: AuditIssue[] = [
      { line: 1, severity: "CRITICAL", message: "x", evidence: "evidence string long enough" },
    ];
    const { results, resolved, unverified } = await reconcileFindings([file("a.ts", issues)], {
      readFileImpl: reader({ "a.ts": "different" }),
      pickaxeImpl: async () => {
        throw new Error("not a git repository");
      },
    });
    expect(resolved).toBe(0);
    expect(unverified).toBe(0);
    expect(results[0]!.result.issues![0]!.resolution).toBeUndefined();
  });

  it("never reclassifies findings without evidence", async () => {
    const issues: AuditIssue[] = [{ line: 1, severity: "CRITICAL", message: "deterministic" }];
    const { results, resolved, unverified } = await reconcileFindings([file("a.ts", issues)], {
      readFileImpl: reader({}),
      pickaxeImpl: async () => ["abc1234"],
    });
    expect(resolved).toBe(0);
    expect(unverified).toBe(0);
    expect(results[0]!.result.issues![0]!.resolution).toBeUndefined();
  });
});
