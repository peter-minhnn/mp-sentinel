/**
 * Regression tests for the spread-of-undefined backstop (P0-D). Field source:
 * review-0703.md — useEquipmentData.ts flagged CRITICAL for object-spreading an
 * optional `params` (`({ limit, active, ...params })`), which is a safe no-op.
 */

import { describe, it, expect } from "@jest/globals";
import { verifySpreadUndefinedClaims } from "../utils/verify-spread-undefined-claims.js";
import type { AuditIssue, FileAuditResult } from "../types/index.js";

function file(filePath: string, issues: AuditIssue[]): FileAuditResult {
  return { filePath, duration: 0, result: { status: "FAIL", issues } };
}

const claim = (line: number): AuditIssue => ({
  line,
  severity: "CRITICAL",
  category: "runtime-crash",
  message: "Spreading optional `params` when undefined will throw a runtime TypeError.",
  evidence: "...params,",
});

describe("verifySpreadUndefinedClaims", () => {
  it("downgrades an OBJECT spread of undefined (safe no-op)", () => {
    const src = [
      "function useX(params?: P) {",
      "  const q = useMemo(",
      "    () => ({",
      "      limit: 10,",
      "      ...params,",
      "    }),",
      "    [params],",
      "  );",
      "}",
    ].join("\n");
    const { results, downgraded } = verifySpreadUndefinedClaims([file("useX.ts", [claim(5)])], {
      readFileImpl: () => src,
    });
    expect(downgraded).toBe(1);
    const issue = results[0]!.result.issues![0]!;
    expect(issue.severity).toBe("WARNING");
    expect(issue.message).toContain("[downgraded: object spread of undefined/null is a no-op");
  });

  it("keeps an ARRAY spread of undefined (really can throw)", () => {
    const src = ["const arr = [", "  1,", "  ...params,", "];"].join("\n");
    const { downgraded } = verifySpreadUndefinedClaims([file("a.ts", [claim(3)])], {
      readFileImpl: () => src,
    });
    expect(downgraded).toBe(0);
  });

  it("keeps a CALL spread of undefined (really can throw)", () => {
    const src = ["doThing(", "  base,", "  ...params,", ");"].join("\n");
    const { downgraded } = verifySpreadUndefinedClaims([file("b.ts", [claim(3)])], {
      readFileImpl: () => src,
    });
    expect(downgraded).toBe(0);
  });

  it("downgrades via whole-file fallback when the reported line is wrong but the spread is unique", () => {
    const src = [
      "function useX(params?: P) {",
      "  const q = useMemo(",
      "    () => ({",
      "      limit: 10,",
      "      ...params,",
      "    }),",
      "    [params],",
      "  );",
      "}",
    ].join("\n");
    // Reported line 99 is far from the real line 5 (pre-relocation AI guess).
    const { downgraded } = verifySpreadUndefinedClaims([file("useX.ts", [claim(99)])], {
      readFileImpl: () => src,
    });
    expect(downgraded).toBe(1);
  });

  it("fails open when the spread token is ambiguous and the line is wrong", () => {
    const src = ["const a = { ...params };", "const b = [ ...params ];", "// filler"].join("\n");
    const { downgraded } = verifySpreadUndefinedClaims([file("amb.ts", [claim(99)])], {
      readFileImpl: () => src,
    });
    expect(downgraded).toBe(0);
  });

  it("fails open when the file cannot be read", () => {
    const { downgraded } = verifySpreadUndefinedClaims([file("missing.ts", [claim(5)])], {
      readFileImpl: () => {
        throw new Error("ENOENT");
      },
    });
    expect(downgraded).toBe(0);
  });

  it("ignores non-spread findings", () => {
    const issues: AuditIssue[] = [
      {
        line: 5,
        severity: "CRITICAL",
        category: "runtime-crash",
        message: "Array index access without bounds check may throw.",
      },
    ];
    const { downgraded } = verifySpreadUndefinedClaims([file("c.ts", issues)], {
      readFileImpl: () => "whatever",
    });
    expect(downgraded).toBe(0);
  });
});
