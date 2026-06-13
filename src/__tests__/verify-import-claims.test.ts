/**
 * Tests for the import-existence backstop (field test round 4).
 * Regression source: CRITICAL "import path does not match / build failure"
 * for `RichTextEditor` whose target file actually exists on disk.
 */

import { describe, it, expect } from "@jest/globals";
import { verifyImportClaims } from "../utils/verify-import-claims.js";
import type { AuditIssue, FileAuditResult } from "../types/index.js";

function file(filePath: string, issues: AuditIssue[]): FileAuditResult {
  return { filePath, duration: 0, result: { status: "FAIL", issues } };
}

/** Pretend these absolute paths exist. */
const existsFor =
  (present: string[]) =>
  (p: string): boolean =>
    present.some((name) => p.endsWith(name));

describe("verifyImportClaims", () => {
  it("downgrades a missing-import CRITICAL whose alias target exists (RichTextEditor)", () => {
    const issues: AuditIssue[] = [
      {
        line: 1,
        severity: "CRITICAL",
        category: "runtime-crash",
        message:
          "Import path does not match project structure: RichTextEditor is imported from '@/components/RichTextEditor' but lives elsewhere. This will cause a build failure.",
        evidence: "import { RichTextEditor } from '@/components/RichTextEditor';",
      },
    ];
    const { results, downgraded } = verifyImportClaims([file("src/page.tsx", issues)], {
      cwd: "/proj",
      existsImpl: existsFor(["/proj/src/components/RichTextEditor.tsx"]),
    });
    expect(downgraded).toBe(1);
    const issue = results[0]!.result.issues![0]!;
    expect(issue.severity).toBe("WARNING");
    expect(issue.message).toContain("exists on disk");
  });

  it("keeps the CRITICAL when the import target truly does not exist", () => {
    const issues: AuditIssue[] = [
      {
        line: 1,
        severity: "CRITICAL",
        category: "runtime-crash",
        message: "Import does not exist and will cause a build failure.",
        evidence: "import { Gone } from '@/components/Gone';",
      },
    ];
    const { downgraded } = verifyImportClaims([file("src/page.tsx", issues)], {
      cwd: "/proj",
      existsImpl: existsFor(["/proj/src/components/Exists.tsx"]),
    });
    expect(downgraded).toBe(0);
  });

  it("resolves relative imports against the importing file", () => {
    const issues: AuditIssue[] = [
      {
        line: 1,
        severity: "CRITICAL",
        category: "runtime-crash",
        message: "Module not found — will cause a build failure.",
        evidence: "import { Card } from './components/card';",
      },
    ];
    const { downgraded } = verifyImportClaims([file("src/features/x/page.tsx", issues)], {
      cwd: "/proj",
      existsImpl: existsFor(["/proj/src/features/x/components/card.tsx"]),
    });
    expect(downgraded).toBe(1);
  });

  it("ignores CRITICALs that are not about imports", () => {
    const issues: AuditIssue[] = [
      {
        line: 1,
        severity: "CRITICAL",
        category: "runtime-crash",
        message: "parseInt returns NaN here.",
        evidence: "const id = parseInt(x);",
      },
    ];
    const { downgraded } = verifyImportClaims([file("a.tsx", issues)], {
      cwd: "/proj",
      existsImpl: () => true,
    });
    expect(downgraded).toBe(0);
  });

  it("leaves bare-package import claims untouched (no resolvable specifier)", () => {
    const issues: AuditIssue[] = [
      {
        line: 1,
        severity: "CRITICAL",
        category: "runtime-crash",
        message: "Module 'some-pkg' not found and will cause a build failure.",
        evidence: "import x from 'some-pkg';",
      },
    ];
    const { downgraded } = verifyImportClaims([file("a.tsx", issues)], {
      cwd: "/proj",
      existsImpl: () => true,
    });
    expect(downgraded).toBe(0);
  });
});
