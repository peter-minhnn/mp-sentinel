/**
 * Tests for evidence-based line relocation (field test round 6).
 * Regression source: ~50% of findings anchored at line 1 (parser default
 * when the model omits a line).
 */

import { describe, it, expect } from "@jest/globals";
import { relocateFindingLines } from "../utils/relocate-lines.js";
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

const FILE = [
  "import { Button } from 'antd';", // 1
  "", // 2
  "export const Page = () => {", // 3
  "  const id = parseInt(String(x), 10);", // 4
  "  return <div style={{ color: '#e5002c' }} />;", // 5
  "};", // 6
].join("\n");

describe("relocateFindingLines", () => {
  it("moves a line-1 finding to where its evidence actually is", async () => {
    const issues: AuditIssue[] = [
      {
        line: 1,
        severity: "WARNING",
        category: "maintainability",
        message: "Hardcoded hex color",
        evidence: "return <div style={{ color: '#e5002c' }} />;",
      },
    ];
    const { results, relocated } = await relocateFindingLines([file("Page.tsx", issues)], {
      readFileImpl: reader({ "Page.tsx": FILE }),
    });
    expect(relocated).toBe(1);
    expect(results[0]!.result.issues![0]!.line).toBe(5);
  });

  it("matches whitespace-insensitively", async () => {
    const issues: AuditIssue[] = [
      {
        line: 1,
        severity: "WARNING",
        category: "maintainability",
        message: "x",
        evidence: "const id = parseInt(String(x),   10);",
      },
    ];
    const { results, relocated } = await relocateFindingLines([file("Page.tsx", issues)], {
      readFileImpl: reader({ "Page.tsx": FILE }),
    });
    expect(relocated).toBe(1);
    expect(results[0]!.result.issues![0]!.line).toBe(4);
  });

  it("leaves a finding whose claimed line already matches its evidence", async () => {
    const issues: AuditIssue[] = [
      {
        line: 4,
        severity: "WARNING",
        category: "maintainability",
        message: "x",
        evidence: "const id = parseInt(String(x), 10);",
      },
    ];
    const { results, relocated } = await relocateFindingLines([file("Page.tsx", issues)], {
      readFileImpl: reader({ "Page.tsx": FILE }),
    });
    expect(relocated).toBe(0);
    expect(results[0]!.result.issues![0]!.line).toBe(4);
  });

  it("leaves findings without evidence untouched", async () => {
    const issues: AuditIssue[] = [
      { line: 1, severity: "WARNING", category: "maintainability", message: "no evidence" },
    ];
    const { relocated } = await relocateFindingLines([file("Page.tsx", issues)], {
      readFileImpl: reader({ "Page.tsx": FILE }),
    });
    expect(relocated).toBe(0);
  });

  it("leaves findings whose evidence is not in the file (fail-open)", async () => {
    const issues: AuditIssue[] = [
      {
        line: 1,
        severity: "WARNING",
        category: "maintainability",
        message: "x",
        evidence: "something that does not exist anywhere",
      },
    ];
    const { results, relocated } = await relocateFindingLines([file("Page.tsx", issues)], {
      readFileImpl: reader({ "Page.tsx": FILE }),
    });
    expect(relocated).toBe(0);
    expect(results[0]!.result.issues![0]!.line).toBe(1);
  });

  it("relocates using the first non-trivial line of multi-line evidence", async () => {
    const issues: AuditIssue[] = [
      {
        line: 1,
        severity: "CRITICAL",
        category: "runtime-crash",
        message: "x",
        evidence: "export const Page = () => {\n  const id = parseInt(String(x), 10);",
      },
    ];
    const { results, relocated } = await relocateFindingLines([file("Page.tsx", issues)], {
      readFileImpl: reader({ "Page.tsx": FILE }),
    });
    expect(relocated).toBe(1);
    expect(results[0]!.result.issues![0]!.line).toBe(3);
  });

  it("relocates ellipsis-abstracted signature evidence (field sample)", async () => {
    const code = [
      "import { Table } from 'antd';", // 1
      "", // 2
      "export const DepartmentApprovalListPage = () => {", // 3
      "  const getColumns = () => {", // 4
      "    return [];", // 5
      "  };", // 6
      "  return <Table columns={getColumns()} />;", // 7
      "};", // 8
    ].join("\n");
    const issues: AuditIssue[] = [
      {
        line: 1,
        severity: "WARNING",
        category: "refactor",
        message: "getColumns should be memoized",
        evidence: "const getColumns = () => { ... }",
      },
      {
        line: 1,
        severity: "WARNING",
        category: "architecture",
        message: "page component too long",
        evidence: "export const DepartmentApprovalListPage = () => { ... }",
      },
    ];
    const { results, relocated } = await relocateFindingLines([file("Page.tsx", issues)], {
      readFileImpl: reader({ "Page.tsx": code }),
    });
    expect(relocated).toBe(2);
    expect(results[0]!.result.issues![0]!.line).toBe(4);
    expect(results[0]!.result.issues![1]!.line).toBe(3);
  });

  it("relocates evidence abstracted with a unicode ellipsis", async () => {
    const code = [
      "const a = 1;",
      "interface ToggleLikeParams { postId: number; isLiked: boolean }",
    ].join("\n");
    const issues: AuditIssue[] = [
      {
        line: 1,
        severity: "WARNING",
        category: "architecture",
        message: "inline payload type",
        evidence: "interface ToggleLikeParams { postId: number; … }",
      },
    ];
    const { results, relocated } = await relocateFindingLines([file("h.ts", issues)], {
      readFileImpl: reader({ "h.ts": code }),
    });
    expect(relocated).toBe(1);
    expect(results[0]!.result.issues![0]!.line).toBe(2);
  });

  it("relocates evidence wrapped in markdown backticks (field sample)", async () => {
    const code = [
      "const a = 1;", // 1
      "  queryKey: ['social-post-like-status', config.boardCode, postId],", // 2
    ].join("\n");
    const issues: AuditIssue[] = [
      {
        line: 1,
        severity: "WARNING",
        category: "architecture",
        message: "inline query key",
        // Backticks leaked from the model's markdown formatting.
        evidence: "`queryKey: ['social-post-like-status', config.boardCode, postId]`",
      },
    ];
    const { results, relocated } = await relocateFindingLines([file("h.ts", issues)], {
      readFileImpl: reader({ "h.ts": code }),
    });
    expect(relocated).toBe(1);
    expect(results[0]!.result.issues![0]!.line).toBe(2);
  });

  it("fails open when the file cannot be read", async () => {
    const issues: AuditIssue[] = [
      { line: 1, severity: "WARNING", message: "x", evidence: "return <div style" },
    ];
    const { relocated } = await relocateFindingLines([file("Gone.tsx", issues)], {
      readFileImpl: reader({}),
    });
    expect(relocated).toBe(0);
  });
});
