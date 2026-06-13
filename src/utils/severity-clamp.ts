/**
 * Category-based severity clamp (post-AI deterministic pass).
 *
 * Benchmarks against real review reports showed severity inflation: findings
 * in style/architecture categories (e.g. "inline endpoint string") were
 * emitted as CRITICAL, drowning out genuine crash/security findings. This
 * pass enforces a per-category severity ceiling AFTER parsing so the report's
 * CRITICAL section only contains categories that can actually break things.
 *
 * Defaults (overridable via `.mp-sentinelrc.json → ai.severityCeilings`):
 *   security            → CRITICAL (no clamp)
 *   runtime-crash       → CRITICAL (no clamp)
 *   dependency-version  → CRITICAL (no clamp)
 *   architecture        → WARNING
 *   performance         → WARNING
 *   maintainability     → WARNING
 *   test-gap            → WARNING
 *
 * Findings without a category are never clamped (deterministic/rule-pack
 * findings own their severity).
 */

import type { AuditIssue, FileAuditResult } from "../types/index.js";

export type Severity = "CRITICAL" | "WARNING" | "INFO";

const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 3,
  WARNING: 2,
  INFO: 1,
};

export const DEFAULT_SEVERITY_CEILINGS: Readonly<Record<string, Severity>> = {
  architecture: "WARNING",
  performance: "WARNING",
  maintainability: "WARNING",
  "test-gap": "WARNING",
  refactor: "WARNING",
};

export interface ClampResult {
  results: FileAuditResult[];
  /** Number of issues whose severity was lowered. */
  clamped: number;
}

/** Categories whose CRITICALs require high confidence to remain blocking. */
const CONFIDENCE_FLOOR_CATEGORIES = new Set(["runtime-crash", "security"]);

const clampIssue = (issue: AuditIssue, ceilings: Record<string, Severity>): AuditIssue => {
  // Confidence gate: a CRITICAL the model itself marks low-confidence is not
  // actionable as CRITICAL — it needs human review, not a blocked merge.
  if (issue.severity === "CRITICAL" && issue.confidence === "low") {
    return {
      ...issue,
      severity: "WARNING",
      message: `${issue.message} [downgraded: low-confidence CRITICAL]`,
    };
  }
  // Confidence floor: runtime-crash / security CRITICALs at MEDIUM confidence
  // are speculative (field-tested: "navigator.clipboard without support
  // check", "apiItems[0] on empty array") — downgrade to WARNING for human
  // review rather than blocking the merge on a maybe.
  if (
    issue.severity === "CRITICAL" &&
    issue.confidence === "medium" &&
    issue.category !== undefined &&
    CONFIDENCE_FLOOR_CATEGORIES.has(issue.category)
  ) {
    return {
      ...issue,
      severity: "WARNING",
      message: `${issue.message} [needs-human-review: medium-confidence ${issue.category} CRITICAL]`,
    };
  }
  if (!issue.category) return issue;
  const ceiling = ceilings[issue.category];
  if (!ceiling) return issue;
  if (SEVERITY_RANK[issue.severity] <= SEVERITY_RANK[ceiling]) return issue;
  return {
    ...issue,
    severity: ceiling,
    message: `${issue.message} [severity capped: ${issue.category} → ${ceiling}]`,
  };
};

/**
 * Apply per-category severity ceilings to all issues.
 * User-provided ceilings MERGE over the defaults; mapping a category to
 * CRITICAL effectively disables its default clamp.
 */
export const clampSeverities = (
  results: readonly FileAuditResult[],
  userCeilings?: Record<string, Severity>,
): ClampResult => {
  const ceilings: Record<string, Severity> = { ...DEFAULT_SEVERITY_CEILINGS, ...userCeilings };
  let clamped = 0;

  const next = results.map((file): FileAuditResult => {
    const issues = file.result.issues ?? [];
    if (issues.length === 0) return file;

    let fileChanged = false;
    const nextIssues = issues.map((issue) => {
      const clampedIssue = clampIssue(issue, ceilings);
      if (clampedIssue !== issue) {
        clamped += 1;
        fileChanged = true;
      }
      return clampedIssue;
    });

    if (!fileChanged) return file;
    return { ...file, result: { ...file.result, issues: nextIssues } };
  });

  return { results: next, clamped };
};
