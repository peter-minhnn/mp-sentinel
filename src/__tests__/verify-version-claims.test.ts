/**
 * Regression tests for the version-claim backstop (P0-A) and the build-break
 * downgrader (P0-B). Field source: review-0701.md on gems —
 *   - FP: "callbacks on mutate() removed in TanStack Query v5" (they were not).
 *   - Over-severity: "misplaced import causes a syntax error / breaks the build"
 *     (ESM hoists imports; the file compiles fine).
 */

import { describe, it, expect } from "@jest/globals";
import { verifyVersionClaims } from "../utils/verify-version-claims.js";
import { downgradeBuildBreakClaims } from "../utils/finding-hygiene.js";
import type { AuditIssue, FileAuditResult } from "../types/index.js";

function file(filePath: string, issues: AuditIssue[]): FileAuditResult {
  return { filePath, duration: 0, result: { status: "FAIL", issues } };
}

describe("verifyVersionClaims", () => {
  it("downgrades the TanStack v5 mutate-callbacks CRITICAL false positive", () => {
    const issues: AuditIssue[] = [
      {
        line: 69,
        severity: "CRITICAL",
        category: "runtime-crash",
        message:
          "Callbacks on `mutate()` are removed in TanStack Query v5 (used version: 5.59.20). The onSuccess and onError callbacks passed here will never execute.",
      },
    ];
    const { results, downgraded } = verifyVersionClaims([file("page.tsx", issues)]);
    expect(downgraded).toBe(1);
    const issue = results[0]!.result.issues![0]!;
    expect(issue.severity).toBe("WARNING");
    expect(issue.confidence).toBe("low");
    expect(issue.message).toContain("[downgraded: unverified version claim");
  });

  it("lowers confidence on a high-confidence non-CRITICAL version-removal claim", () => {
    const issues: AuditIssue[] = [
      {
        line: 35,
        severity: "WARNING",
        confidence: "high",
        category: "dependency-version",
        message: "`hideFooter` was deprecated in antd v5; use footer={null}.",
      },
    ];
    const { results, downgraded } = verifyVersionClaims([file("modal.tsx", issues)]);
    expect(downgraded).toBe(1);
    const issue = results[0]!.result.issues![0]!;
    expect(issue.severity).toBe("WARNING"); // severity untouched for non-CRITICAL
    expect(issue.confidence).toBe("low");
    expect(issue.message).toContain("unverified version claim");
  });

  it("keeps a real bug (no version marker) untouched", () => {
    const issues: AuditIssue[] = [
      {
        line: 81,
        severity: "CRITICAL",
        category: "runtime-crash",
        message:
          "In edit mode, existing attachments are removed because mapping to originFileObj filters out already-uploaded files, causing data loss on update.",
      },
    ];
    const { results, downgraded } = verifyVersionClaims([file("useForm.ts", issues)]);
    expect(downgraded).toBe(0);
    expect(results[0]!.result.issues![0]!.severity).toBe("CRITICAL");
  });

  it("does not fire on a plain number without a removal/deprecation verb", () => {
    const issues: AuditIssue[] = [
      {
        line: 10,
        severity: "CRITICAL",
        category: "runtime-crash",
        message: "Array index 5 is accessed without a bounds check and may be undefined.",
      },
    ];
    const { downgraded } = verifyVersionClaims([file("a.ts", issues)]);
    expect(downgraded).toBe(0);
  });
});

describe("downgradeBuildBreakClaims", () => {
  it("downgrades the misplaced-import 'syntax error / breaks build' CRITICAL", () => {
    const issues: AuditIssue[] = [
      {
        line: 25,
        severity: "CRITICAL",
        category: "runtime-crash",
        message:
          "Misplaced import statement causes a syntax error (import declarations must be at the top level). This will break the build and crash at runtime.",
        evidence: "import { useMemo, useCallback } from 'react';",
      },
    ];
    const { results, downgraded } = downgradeBuildBreakClaims([file("canvas.tsx", issues)]);
    expect(downgraded).toBe(1);
    const issue = results[0]!.result.issues![0]!;
    expect(issue.severity).toBe("WARNING");
    expect(issue.confidence).toBe("low");
    expect(issue.message).toContain(
      "[downgraded: build/syntax breakage is caught deterministically",
    );
  });

  it("keeps a genuine runtime-crash CRITICAL untouched", () => {
    const issues: AuditIssue[] = [
      {
        line: 51,
        severity: "CRITICAL",
        category: "runtime-crash",
        message: "navigator.clipboard.writeText may crash without feature detection.",
      },
    ];
    const { downgraded } = downgradeBuildBreakClaims([file("actions.tsx", issues)]);
    expect(downgraded).toBe(0);
  });
});
