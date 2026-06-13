/**
 * Tests for the self-negation filter (Phase 4.1) and near-duplicate collapse
 * (Phase 4.2). Regression source: field test review-0612 on gems.
 */

import { describe, it, expect } from "@jest/globals";
import { filterSelfNegatedFindings, isSelfNegating } from "../utils/finding-hygiene.js";
import { dedupeFindings } from "../utils/dedupe-findings.js";
import type { AuditIssue, FileAuditResult } from "../types/index.js";

function file(filePath: string, issues: AuditIssue[]): FileAuditResult {
  return { filePath, duration: 0, result: { status: "FAIL", issues } };
}

describe("filterSelfNegatedFindings", () => {
  it("drops a WARNING that concludes 'No issue' (real field sample)", () => {
    const issues: AuditIssue[] = [
      {
        line: 1,
        severity: "WARNING",
        message:
          "Project rule 6 states components must not call useQuery directly. However, these hooks are already wrapped, so this is compliant. No issue.",
      },
    ];
    const { results, dropped } = filterSelfNegatedFindings([file("a.tsx", issues)]);
    expect(dropped).toBe(1);
    expect(results[0]!.result.issues).toHaveLength(0);
  });

  it("downgrades a CRITICAL hedged as 'false positive risk' (real field sample)", () => {
    const issues: AuditIssue[] = [
      {
        line: 1,
        severity: "CRITICAL",
        category: "runtime-crash",
        message:
          "useEffect missing dependency... so this is a false positive risk rather than a crash.",
      },
    ];
    const { results, downgraded } = filterSelfNegatedFindings([file("a.tsx", issues)]);
    expect(downgraded).toBe(1);
    const issue = results[0]!.result.issues![0]!;
    expect(issue.severity).toBe("INFO");
    expect(issue.message).toContain("[self-negated]");
  });

  it("keeps normal findings untouched", () => {
    const issues: AuditIssue[] = [
      { line: 2, severity: "WARNING", message: "Direct antd import of Carousel." },
      { line: 3, severity: "CRITICAL", message: "parseInt radix -1 always returns NaN." },
    ];
    const { results, dropped, downgraded } = filterSelfNegatedFindings([file("a.tsx", issues)]);
    expect(dropped).toBe(0);
    expect(downgraded).toBe(0);
    expect(results[0]!.result.issues).toHaveLength(2);
  });

  it("does not misfire on negation-adjacent but legitimate wording", () => {
    expect(isSelfNegating("Missing null check causes a crash when data is undefined.")).toBe(false);
    expect(isSelfNegating("This issue affects all consumers of the context.")).toBe(false);
  });
});

describe("near-duplicate collapse (dedupeFindings)", () => {
  it("collapses two same-line same-category CRITICALs with similar wording", () => {
    // Real field sample: two XSS criticals at SafeHtml.tsx:16 describing the
    // same DOMParser/createElement problem with different prose.
    const issues: AuditIssue[] = [
      {
        line: 16,
        severity: "CRITICAL",
        category: "security",
        message:
          "DOMParser is used to parse sanitized HTML and then React.createElement is called with arbitrary tag names and attributes, bypassing React XSS protections.",
        evidence: "const doc = new DOMParser().parseFromString(html, 'text/html');",
      },
      {
        line: 16,
        severity: "CRITICAL",
        category: "security",
        message:
          "The DOMParser approach creates React elements from arbitrary HTML; malicious attributes are passed directly to React.createElement, a bypass of React's XSS protection.",
      },
    ];
    const { results, removed } = dedupeFindings([file("SafeHtml.tsx", issues)]);
    expect(removed).toBe(1);
    const kept = results[0]!.result.issues!;
    expect(kept).toHaveLength(1);
    expect(kept[0]!.message).toContain("(+1 similar)");
    // Richest variant (has evidence) wins
    expect(kept[0]!.evidence).toBeDefined();
  });

  it("preserves distinct problems sharing a line and category", () => {
    const issues: AuditIssue[] = [
      {
        line: 1,
        severity: "WARNING",
        category: "maintainability",
        message: "Function spans 120 lines (limit 80) and mixes data fetching with rendering.",
      },
      {
        line: 1,
        severity: "WARNING",
        category: "maintainability",
        message: "Avoid inline style object literals; use a CSS module or utility classes.",
      },
    ];
    const { results, removed } = dedupeFindings([file("Big.tsx", issues)]);
    expect(removed).toBe(0);
    expect(results[0]!.result.issues).toHaveLength(2);
  });

  it("never collapses issues without a category", () => {
    const issues: AuditIssue[] = [
      { line: 5, severity: "WARNING", message: "Potential secret detected in config value." },
      { line: 5, severity: "WARNING", message: "Possible secret detected in config entry." },
    ];
    const { removed } = dedupeFindings([file("a.ts", issues)]);
    expect(removed).toBe(0);
  });

  it("still removes exact duplicates first", () => {
    const issues: AuditIssue[] = [
      { line: 5, severity: "WARNING", message: "Avoid the any type" },
      { line: 5, severity: "WARNING", message: "Avoid the any type" },
    ];
    const { removed } = dedupeFindings([file("a.ts", issues)]);
    expect(removed).toBe(1);
  });
});

// ── recurring-issue grouping (Phase 4.3) ────────────────────────────────────

import { computeRecurringIssues } from "../formatters/report.js";

describe("computeRecurringIssues", () => {
  const antdImport = (filePath: string, line: number): FileAuditResult =>
    file(filePath, [
      {
        line,
        severity: "WARNING",
        category: "architecture",
        message: `Direct antd import of Carousel. Per project rules, import from @/shared/gems-ui.`,
      },
    ]);

  it("groups repeated findings across files (>=3 occurrences)", () => {
    const results = [antdImport("a.tsx", 1), antdImport("b.tsx", 2), antdImport("c.tsx", 3)];
    const groups = computeRecurringIssues(results);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.count).toBe(3);
    expect(groups[0]!.fileCount).toBe(3);
    expect(groups[0]!.category).toBe("architecture");
  });

  it("ignores groups below the threshold and uncategorized issues", () => {
    const results = [
      antdImport("a.tsx", 1),
      antdImport("b.tsx", 2),
      file("c.tsx", [{ line: 1, severity: "WARNING", message: "one-off uncategorized" }]),
    ];
    expect(computeRecurringIssues(results)).toHaveLength(0);
  });

  it("excludes resolved-at-head findings from counts", () => {
    const resolved = file("d.tsx", [
      {
        line: 9,
        severity: "WARNING",
        category: "architecture",
        message: "Direct antd import of Carousel. Per project rules, import from @/shared/gems-ui.",
        resolution: "resolved-at-head",
      },
    ]);
    const results = [antdImport("a.tsx", 1), antdImport("b.tsx", 2), resolved];
    expect(computeRecurringIssues(results)).toHaveLength(0);
  });
});

// ── XSS sink verification + hedged patterns (field test round 2) ────────────

import { downgradeUnsinkedXssClaims } from "../utils/finding-hygiene.js";

describe("downgradeUnsinkedXssClaims", () => {
  it("downgrades a JSX-interpolation XSS claim with no sink in evidence", () => {
    const issues: AuditIssue[] = [
      {
        line: 1,
        severity: "CRITICAL",
        category: "security",
        message:
          "XSS vulnerability: record.title and record.category?.name are rendered directly as HTML content without sanitization.",
        evidence: "render: (record) => <span>{record.title}</span>",
      },
    ];
    const { results, downgraded } = downgradeUnsinkedXssClaims([file("List.tsx", issues)]);
    expect(downgraded).toBe(1);
    const issue = results[0]!.result.issues![0]!;
    expect(issue.severity).toBe("WARNING");
    expect(issue.message).toContain("no XSS sink in evidence");
  });

  it("keeps XSS claims whose evidence quotes a real sink (SafeHtml DOMParser)", () => {
    const issues: AuditIssue[] = [
      {
        line: 14,
        severity: "CRITICAL",
        category: "security",
        message: "XSS via event handler attributes passed through to React.createElement.",
        evidence: "const doc = parser.parseFromString(sanitized, 'text/html');",
      },
    ];
    const { downgraded } = downgradeUnsinkedXssClaims([file("SafeHtml.tsx", issues)]);
    expect(downgraded).toBe(0);
  });

  it("downgrades CRITICAL XSS claims without any evidence", () => {
    const issues: AuditIssue[] = [
      {
        line: 1,
        severity: "CRITICAL",
        category: "security",
        message: "Potential XSS vulnerability in rendering.",
      },
    ];
    const { downgraded } = downgradeUnsinkedXssClaims([file("a.tsx", issues)]);
    expect(downgraded).toBe(1);
  });

  it("ignores non-XSS security criticals and non-critical XSS mentions", () => {
    const issues: AuditIssue[] = [
      {
        line: 1,
        severity: "CRITICAL",
        category: "security",
        message: "Hardcoded credential fallback.",
      },
      { line: 2, severity: "WARNING", category: "security", message: "Possible XSS, low impact." },
    ];
    const { downgraded } = downgradeUnsinkedXssClaims([file("a.tsx", issues)]);
    expect(downgraded).toBe(0);
  });
});

describe("hedged self-negation (field test round 2)", () => {
  it("catches 'may be acceptable' hedging in the message", () => {
    expect(
      isSelfNegating(
        "Component directly calls query hooks. However, these ARE feature hooks, so this may be acceptable if the project interprets the rule that way.",
      ),
    ).toBe(true);
  });

  it("catches 'if they are, this is compliant' in the suggestion field", () => {
    expect(
      isSelfNegating(
        "Component directly calls query hooks per rule 6.",
        "Verify that these are the feature's custom hooks. If they are, this is compliant.",
      ),
    ).toBe(true);
  });

  it("does not misfire on plain verification suggestions", () => {
    expect(
      isSelfNegating(
        "Hardcoded magic string 'board-community'.",
        "Move the value to the feature constants file.",
      ),
    ).toBe(false);
  });
});
