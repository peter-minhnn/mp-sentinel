/**
 * Per-file noise budget (Phase 4.5).
 *
 * Wiring the deterministic rule-pack evaluators into local mode surfaced
 * files with 20+ style/maintainability warnings — useful signal, but a wall
 * of repetition that buries the high-value findings. This pass caps the
 * number of NON-CRITICAL findings per file. CRITICAL findings are always
 * kept. When a file is over budget, the least-severe / least-informative
 * WARNING and INFO findings are dropped and one summary finding records how
 * many were hidden, so nothing disappears silently.
 *
 * Disabled (no cap) when `max <= 0`.
 */

import type { AuditIssue, FileAuditResult } from "../types/index.js";

const SEVERITY_RANK: Record<AuditIssue["severity"], number> = {
  CRITICAL: 3,
  WARNING: 2,
  INFO: 1,
};

/** Keep the most severe, then most informative (evidence + prose) first. */
const findingPriority = (issue: AuditIssue): number =>
  SEVERITY_RANK[issue.severity] * 100_000 +
  (issue.evidence?.length ?? 0) * 2 +
  issue.message.length;

export interface CapResult {
  results: FileAuditResult[];
  /** Total findings hidden across all files. */
  hidden: number;
}

/**
 * Cap non-CRITICAL findings per file at `max`. CRITICALs pass through
 * uncapped and do not count against the budget.
 */
export const capFindingsPerFile = (results: readonly FileAuditResult[], max: number): CapResult => {
  if (!Number.isFinite(max) || max <= 0) return { results: [...results], hidden: 0 };

  let hidden = 0;
  const next = results.map((file): FileAuditResult => {
    const issues = file.result.issues ?? [];
    const criticals = issues.filter((i) => i.severity === "CRITICAL");
    const nonCriticals = issues.filter((i) => i.severity !== "CRITICAL");
    if (nonCriticals.length <= max) return file;

    const keptNonCritical = [...nonCriticals]
      .sort((a, b) => findingPriority(b) - findingPriority(a))
      .slice(0, max);
    const dropped = nonCriticals.length - keptNonCritical.length;
    hidden += dropped;

    const summary: AuditIssue = {
      line: 1,
      severity: "INFO",
      category: "maintainability",
      message: `+${dropped} more lower-severity finding(s) hidden by review.maxFindingsPerFile (${max}). Raise the cap or fix the shown findings to reveal them.`,
    };

    // Preserve original ordering for the kept findings (report sorts later).
    const keptSet = new Set(keptNonCritical);
    const orderedKept = nonCriticals.filter((i) => keptSet.has(i));
    return {
      ...file,
      result: { ...file.result, issues: [...criticals, ...orderedKept, summary] },
    };
  });

  return { results: next, hidden };
};
