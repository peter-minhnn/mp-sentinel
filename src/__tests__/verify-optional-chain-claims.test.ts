/**
 * Regression tests for the optional-chaining short-circuit backstop. Field
 * source: review-0706.md — BookingDetailsGrid.tsx flagged WARNING for
 * "`.join(',')` may crash when `resources` is undefined" on the chain
 * `clickedOccurrence?.resources?.map(...).join(',')`, which is a safe no-op:
 * a nullish head short-circuits the WHOLE chain, so `.join` is never called.
 */

import { describe, it, expect } from "@jest/globals";
import { verifyOptionalChainClaims } from "../utils/verify-optional-chain-claims.js";
import type { AuditIssue, FileAuditResult } from "../types/index.js";

function file(filePath: string, issues: AuditIssue[]): FileAuditResult {
  return { filePath, duration: 0, result: { status: "FAIL", issues } };
}

const crashClaim = (line: number, evidence: string): AuditIssue => ({
  line,
  severity: "WARNING",
  category: "runtime-crash",
  message: "`.join(',')` may crash when `resources` is undefined.",
  evidence,
});

describe("verifyOptionalChainClaims", () => {
  it("downgrades a plain access protected by an earlier ?. in the same chain", () => {
    const src = ["const ids =", "  clickedOccurrence?.resources?.map((r) => r.id).join(',');"].join(
      "\n",
    );
    const { results, downgraded } = verifyOptionalChainClaims(
      [
        file("BookingDetailsGrid.tsx", [
          crashClaim(2, "clickedOccurrence?.resources?.map((r) => r.id).join(',')"),
        ]),
      ],
      { readFileImpl: () => src },
    );
    expect(downgraded).toBe(1);
    const issue = results[0]!.result.issues![0]!;
    expect(issue.severity).toBe("INFO");
    expect(issue.message).toContain(
      "[downgraded: access is protected by an earlier optional chain",
    );
  });

  it("keeps an unguarded access with no optional chain (really can throw)", () => {
    const src = ["const ids = data.resources.map((r) => r.id).join(',');"].join("\n");
    const { downgraded } = verifyOptionalChainClaims(
      [file("a.ts", [crashClaim(1, "data.resources.map((r) => r.id).join(',')")])],
      { readFileImpl: () => src },
    );
    expect(downgraded).toBe(0);
  });

  it("keeps a plain access that sits BEFORE the ?. (not short-circuit protected)", () => {
    // `data.resources` runs before any `?.`, so a nullish `data` still throws.
    const src = ["const first = data.resources?.[0];"].join("\n");
    const { downgraded } = verifyOptionalChainClaims(
      [file("b.ts", [crashClaim(1, "data.resources?.[0]")])],
      { readFileImpl: () => src },
    );
    expect(downgraded).toBe(0);
  });

  it("detects the protected access from the source window when evidence is bare", () => {
    const src = [
      "function render() {",
      "  return user",
      "    ?.profile",
      "    .displayName.toUpperCase();",
      "}",
    ].join("\n");
    const { downgraded } = verifyOptionalChainClaims(
      [
        file("c.ts", [
          {
            line: 4,
            severity: "CRITICAL",
            category: "runtime-crash",
            message: "`.toUpperCase` will throw when `profile` is undefined.",
          },
        ]),
      ],
      { readFileImpl: () => src },
    );
    expect(downgraded).toBe(1);
  });

  it("fails open when the file cannot be read and evidence lacks a chain", () => {
    const { downgraded } = verifyOptionalChainClaims(
      [file("missing.ts", [crashClaim(5, "resources.join(',')")])],
      {
        readFileImpl: () => {
          throw new Error("ENOENT");
        },
      },
    );
    expect(downgraded).toBe(0);
  });

  it("ignores findings unrelated to nullish member access", () => {
    const issues: AuditIssue[] = [
      {
        line: 5,
        severity: "CRITICAL",
        category: "security",
        message: "Hardcoded API key detected in source.",
      },
    ];
    const { downgraded } = verifyOptionalChainClaims([file("d.ts", issues)], {
      readFileImpl: () => "whatever",
    });
    expect(downgraded).toBe(0);
  });
});
