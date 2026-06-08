/**
 * Tests for the baseline / ratchet module.
 */

import { describe, it, expect } from "@jest/globals";
import {
  fingerprintIssue,
  computeFingerprintCounts,
  filterAgainstBaseline,
  type Baseline,
} from "../services/baseline.js";
import type { AuditIssue, FileAuditResult } from "../types/index.js";

function issue(partial: Partial<AuditIssue> & { message: string }): AuditIssue {
  return {
    line: partial.line ?? 1,
    severity: partial.severity ?? "WARNING",
    message: partial.message,
    ...(partial.category ? { category: partial.category } : {}),
  };
}

function fileResult(filePath: string, issues: AuditIssue[]): FileAuditResult {
  const status = issues.some((i) => i.severity === "CRITICAL" || i.severity === "WARNING")
    ? "FAIL"
    : "PASS";
  return { filePath, duration: 0, result: { status, issues } };
}

function makeBaseline(fingerprints: Record<string, number>): Baseline {
  return { version: 1, generatedAt: "2026-01-01T00:00:00Z", fingerprints };
}

describe("fingerprintIssue", () => {
  it("is stable across line-number drift", () => {
    const a = fingerprintIssue("src/a.ts", issue({ message: "Empty catch", line: 10 }));
    const b = fingerprintIssue("src/a.ts", issue({ message: "Empty catch", line: 250 }));
    expect(a).toBe(b);
  });

  it("ignores cosmetic message differences (case/quotes/whitespace)", () => {
    const a = fingerprintIssue("src/a.ts", issue({ message: "Avoid `any` type" }));
    const b = fingerprintIssue("src/a.ts", issue({ message: "avoid any   TYPE" }));
    expect(a).toBe(b);
  });

  it("differs by file, severity, and category", () => {
    const base = issue({ message: "x", severity: "WARNING", category: "security" });
    expect(fingerprintIssue("a.ts", base)).not.toBe(fingerprintIssue("b.ts", base));
    expect(fingerprintIssue("a.ts", base)).not.toBe(
      fingerprintIssue("a.ts", issue({ message: "x", severity: "CRITICAL", category: "security" })),
    );
    expect(fingerprintIssue("a.ts", base)).not.toBe(
      fingerprintIssue(
        "a.ts",
        issue({ message: "x", severity: "WARNING", category: "performance" }),
      ),
    );
  });
});

describe("filterAgainstBaseline", () => {
  it("suppresses a finding present in the baseline", () => {
    const results = [fileResult("a.ts", [issue({ message: "known issue", severity: "WARNING" })])];
    const baseline = makeBaseline(computeFingerprintCounts(results));

    const { results: filtered, suppressed } = filterAgainstBaseline(results, baseline);
    expect(suppressed).toBe(1);
    expect(filtered[0]!.result.issues).toHaveLength(0);
    expect(filtered[0]!.result.status).toBe("PASS"); // status downgraded
  });

  it("keeps a NEW finding not in the baseline", () => {
    const baselineResults = [fileResult("a.ts", [issue({ message: "old" })])];
    const baseline = makeBaseline(computeFingerprintCounts(baselineResults));

    const current = [
      fileResult("a.ts", [
        issue({ message: "old" }),
        issue({ message: "new critical", severity: "CRITICAL" }),
      ]),
    ];
    const { results: filtered, suppressed } = filterAgainstBaseline(current, baseline);
    expect(suppressed).toBe(1);
    expect(filtered[0]!.result.issues).toHaveLength(1);
    expect(filtered[0]!.result.issues?.[0]?.message).toBe("new critical");
    expect(filtered[0]!.result.status).toBe("FAIL");
  });

  it("treats extra occurrences beyond the baseline count as NEW", () => {
    // Baseline accepted 1 occurrence; current has 2 → 1 suppressed, 1 kept.
    const baseline = makeBaseline(
      computeFingerprintCounts([fileResult("a.ts", [issue({ message: "dup" })])]),
    );
    const current = [
      fileResult("a.ts", [issue({ message: "dup", line: 5 }), issue({ message: "dup", line: 99 })]),
    ];
    const { suppressed, results } = filterAgainstBaseline(current, baseline);
    expect(suppressed).toBe(1);
    expect(results[0]!.result.issues).toHaveLength(1);
  });

  it("preserves ERROR status even when issues are suppressed", () => {
    const results: FileAuditResult[] = [
      { filePath: "a.ts", duration: 0, result: { status: "ERROR", issues: [] } },
    ];
    const baseline = makeBaseline({});
    const { results: filtered } = filterAgainstBaseline(results, baseline);
    expect(filtered[0]!.result.status).toBe("ERROR");
  });
});
