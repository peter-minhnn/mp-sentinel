/**
 * Tests for deterministic evidence verification of CRITICAL findings.
 *
 * Regression source: false-positive CRITICALs whose quoted evidence did not
 * exist in the file (stale finding from an earlier commit, paraphrased
 * evidence, guard clause missed by the model).
 */

import { describe, it, expect } from "@jest/globals";
import { verifyEvidence } from "../utils/verify-evidence.js";
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

describe("verifyEvidence", () => {
  it("keeps a CRITICAL whose evidence exists in the file", async () => {
    const issues: AuditIssue[] = [
      {
        line: 14,
        severity: "CRITICAL",
        message: "Invalid radix",
        evidence: "const postId = parseInt(String(id), -1);",
      },
    ];
    const { results, downgraded } = await verifyEvidence([file("page.tsx", issues)], {
      readFileImpl: reader({
        "page.tsx": "export const Page = () => {\n  const postId = parseInt(String(id), -1);\n}",
      }),
    });
    expect(downgraded).toBe(0);
    expect(results[0]!.result.issues![0]!.severity).toBe("CRITICAL");
  });

  it("downgrades a CRITICAL whose evidence is NOT in the file (stale finding)", async () => {
    const issues: AuditIssue[] = [
      {
        line: 136,
        severity: "CRITICAL",
        message: "Invalid dayjs unit",
        evidence: "untilDate.endOf('D').toISOString()",
      },
    ];
    const { results, downgraded } = await verifyEvidence([file("modal.tsx", issues)], {
      readFileImpl: reader({
        "modal.tsx": "rule.until = untilDate.endOf('day').toISOString();",
      }),
    });
    expect(downgraded).toBe(1);
    const issue = results[0]!.result.issues![0]!;
    expect(issue.severity).toBe("WARNING");
    expect(issue.confidence).toBe("low");
    expect(issue.message).toContain("[unverified");
  });

  it("matches evidence whitespace-insensitively", async () => {
    const issues: AuditIssue[] = [
      {
        line: 1,
        severity: "CRITICAL",
        message: "x",
        evidence: "const a = {  foo:   1 };",
      },
    ];
    const { downgraded } = await verifyEvidence([file("a.ts", issues)], {
      readFileImpl: reader({ "a.ts": "const a = {\n  foo: 1\n};" }),
    });
    expect(downgraded).toBe(0);
  });

  it("skips CRITICALs without evidence (deterministic findings)", async () => {
    const issues: AuditIssue[] = [{ line: 1, severity: "CRITICAL", message: "rule-pack finding" }];
    const { results, downgraded } = await verifyEvidence([file("a.ts", issues)], {
      readFileImpl: reader({ "a.ts": "anything" }),
    });
    expect(downgraded).toBe(0);
    expect(results[0]!.result.issues![0]!.severity).toBe("CRITICAL");
  });

  it("skips evidence snippets that are too short to be meaningful", async () => {
    const issues: AuditIssue[] = [
      { line: 1, severity: "CRITICAL", message: "x", evidence: "a + b" },
    ];
    const { downgraded } = await verifyEvidence([file("a.ts", issues)], {
      readFileImpl: reader({ "a.ts": "completely different content" }),
    });
    expect(downgraded).toBe(0);
  });

  it("fails open when the file cannot be read", async () => {
    const issues: AuditIssue[] = [
      {
        line: 1,
        severity: "CRITICAL",
        message: "x",
        evidence: "some evidence snippet here",
      },
    ];
    const { results, downgraded } = await verifyEvidence([file("deleted.ts", issues)], {
      readFileImpl: reader({}),
    });
    expect(downgraded).toBe(0);
    expect(results[0]!.result.issues![0]!.severity).toBe("CRITICAL");
  });

  it("never touches WARNING/INFO findings", async () => {
    const issues: AuditIssue[] = [
      { line: 1, severity: "WARNING", message: "w", evidence: "not in the file at all" },
      { line: 2, severity: "INFO", message: "i", evidence: "also not in the file" },
    ];
    const { results, downgraded } = await verifyEvidence([file("a.ts", issues)], {
      readFileImpl: reader({ "a.ts": "unrelated" }),
    });
    expect(downgraded).toBe(0);
    expect(results[0]!.result.issues!.map((i) => i.severity)).toEqual(["WARNING", "INFO"]);
  });
});
