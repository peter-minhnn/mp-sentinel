/**
 * Tests for cross-category same-line dedupe. Models the field case where a
 * `runtime-crash` and a `maintainability` finding both describe the dependency
 * array at one line and read as two independent bugs.
 */

import { describe, it, expect } from "@jest/globals";
import { dedupeCrossCategoryFindings } from "../utils/dedupe-cross-category-findings.js";
import type { AuditIssue, FileAuditResult } from "../types/index.js";

function file(issues: AuditIssue[]): FileAuditResult {
  return { filePath: "src/a.tsx", duration: 0, result: { status: "FAIL", issues } };
}

const issue = (
  line: number,
  severity: AuditIssue["severity"],
  category: string,
  message: string,
): AuditIssue => ({ line, severity, category, confidence: "medium", message });

describe("dedupeCrossCategoryFindings", () => {
  it("merges same-line cross-category near-duplicates, keeping the higher severity", () => {
    const { results, removed } = dedupeCrossCategoryFindings([
      file([
        issue(
          172,
          "CRITICAL",
          "runtime-crash",
          "Missing dependency array causes a re-render crash loop",
        ),
        issue(
          172,
          "WARNING",
          "maintainability",
          "Missing dependency array on this effect; re-render loop risk",
        ),
      ]),
    ]);
    expect(removed).toBe(1);
    const kept = results[0]!.result.issues!;
    expect(kept).toHaveLength(1);
    expect(kept[0]!.severity).toBe("CRITICAL");
  });

  it("preserves distinct problems that merely share a line", () => {
    const { removed, results } = dedupeCrossCategoryFindings([
      file([
        issue(10, "WARNING", "security", "Unescaped user input rendered into the DOM (XSS)"),
        issue(10, "INFO", "style", "Prefer a const assertion for this literal tuple"),
      ]),
    ]);
    expect(removed).toBe(0);
    expect(results[0]!.result.issues).toHaveLength(2);
  });

  it("does not merge similar findings on different lines", () => {
    const { removed } = dedupeCrossCategoryFindings([
      file([
        issue(1, "WARNING", "a", "Missing dependency array on this effect"),
        issue(2, "WARNING", "b", "Missing dependency array on this effect"),
      ]),
    ]);
    expect(removed).toBe(0);
  });
});
