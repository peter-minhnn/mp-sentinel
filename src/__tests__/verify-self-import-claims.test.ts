/**
 * Regression tests for the self-import backstop (P0-C). Field source:
 * review-0701.md — templateRowHelpers.ts flagged as a "self-import" for importing
 * from the sibling file templateBuilderHelpers.ts (different module, no cycle).
 */

import { describe, it, expect } from "@jest/globals";
import { verifySelfImportClaims } from "../utils/verify-self-import-claims.js";
import type { AuditIssue, FileAuditResult } from "../types/index.js";

function file(filePath: string, issues: AuditIssue[]): FileAuditResult {
  return { filePath, duration: 0, result: { status: "FAIL", issues } };
}

describe("verifySelfImportClaims", () => {
  it("downgrades the false self-import (sibling file, different basename)", () => {
    const issues: AuditIssue[] = [
      {
        line: 2,
        severity: "CRITICAL",
        category: "runtime-crash",
        message:
          "Self-import: 'generateId' imported from './templateBuilderHelpers' in a file named 'templateBuilderHelpers.ts'. This will cause a circular dependency and likely a build or runtime crash.",
        evidence: "import { generateId } from './templateBuilderHelpers';",
      },
    ];
    const { results, downgraded } = verifySelfImportClaims([
      file("src/features/templates/hooks/templateRowHelpers.ts", issues),
    ]);
    expect(downgraded).toBe(1);
    const issue = results[0]!.result.issues![0]!;
    expect(issue.severity).toBe("WARNING");
    expect(issue.confidence).toBe("low");
    expect(issue.message).toContain("[downgraded: not a self-import");
  });

  it("keeps a GENUINE self-import (same basename) untouched", () => {
    const issues: AuditIssue[] = [
      {
        line: 3,
        severity: "CRITICAL",
        category: "runtime-crash",
        message: "Self-import: file imports from itself, causing a circular reference.",
        evidence: "import { foo } from './helpers';",
      },
    ];
    const { downgraded } = verifySelfImportClaims([file("src/utils/helpers.ts", issues)]);
    expect(downgraded).toBe(0);
  });

  it("ignores a bare 'circular dependency' claim without self-import wording", () => {
    const issues: AuditIssue[] = [
      {
        line: 1,
        severity: "CRITICAL",
        category: "architecture",
        message:
          "Circular dependency: types.ts imports from ./constants which imports from ./types.",
        evidence: "import { BOOKING_STATUS } from './constants';",
      },
    ];
    const { downgraded } = verifySelfImportClaims([file("src/features/booking/types.ts", issues)]);
    expect(downgraded).toBe(0);
  });

  it("leaves the claim untouched when no specifier can be extracted", () => {
    const issues: AuditIssue[] = [
      {
        line: 2,
        severity: "CRITICAL",
        category: "runtime-crash",
        message: "Self-import detected; the module appears to import from itself.",
      },
    ];
    const { downgraded } = verifySelfImportClaims([file("src/a/foo.ts", issues)]);
    expect(downgraded).toBe(0);
  });
});
