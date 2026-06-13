/**
 * Severity threshold resolution + pass/fail predicate (Phase 1.5).
 *
 * The review pipeline historically failed on any CRITICAL or WARNING
 * finding. This module preserves that as the *default* (`WARNING`) while
 * letting users opt into stricter (`CRITICAL`-only) or stricter-still
 * (`INFO`, any finding) policies via:
 *
 *   1. `--severity-threshold <level>` CLI flag (highest precedence)
 *   2. `review.protectedBranches[<current-branch>]` config override
 *   3. `review.severityThreshold` config baseline
 *   4. Built-in default: `WARNING`
 *
 * Runtime errors (FileAuditResult.status === "ERROR") always fail the
 * review regardless of threshold — they signal an audit pipeline failure,
 * not a code-quality finding.
 */

import type { AuditIssue, ProjectConfig, SeverityThreshold } from "../types/index.js";
import { UserError } from "./errors.js";

export const DEFAULT_SEVERITY_THRESHOLD: SeverityThreshold = "WARNING";

const SEVERITY_RANK: Record<SeverityThreshold, number> = {
  CRITICAL: 2,
  WARNING: 1,
  INFO: 0,
};

/**
 * Parse a raw flag value into a SeverityThreshold or throw a UserError.
 * Accepts case-insensitive input ("critical", "CRITICAL", "Critical" all work).
 */
export const parseSeverityThreshold = (raw: string): SeverityThreshold => {
  const upper = raw.trim().toUpperCase();
  if (upper === "CRITICAL" || upper === "WARNING" || upper === "INFO") return upper;
  throw new UserError(
    `Invalid severity threshold "${raw}". Expected one of: CRITICAL, WARNING, INFO.`,
  );
};

export interface ResolveOptions {
  cliFlag?: string;
  /** Loaded ProjectConfig (after Zod validation). */
  config: Pick<ProjectConfig, "review">;
  /** Result of utils/git#getCurrentBranch(). May be empty in detached HEAD. */
  currentBranch?: string;
}

/**
 * Resolve which threshold applies to the current run.
 * Pure — no I/O. CLI flag wins over branch override wins over baseline.
 */
export const resolveSeverityThreshold = (opts: ResolveOptions): SeverityThreshold => {
  if (opts.cliFlag) return parseSeverityThreshold(opts.cliFlag);

  const review = opts.config.review;
  const branchOverride = opts.currentBranch && review?.protectedBranches?.[opts.currentBranch];
  if (branchOverride) return branchOverride;

  return review?.severityThreshold ?? DEFAULT_SEVERITY_THRESHOLD;
};

/**
 * Issues that are still actionable: excludes findings reconciled as
 * "resolved-at-head" (fixed by a later commit — kept in the report for the
 * record, but they must not fail a review or count toward severity totals).
 */
export const activeIssues = (issues: AuditIssue[] | undefined): AuditIssue[] =>
  (issues ?? []).filter((issue) => issue.resolution !== "resolved-at-head");

/**
 * Returns true when at least one ACTIVE issue meets-or-exceeds the threshold.
 * Issues whose severity is below the threshold — or that were reconciled as
 * resolved-at-head — are ignored.
 */
export const issuesFailThreshold = (
  issues: AuditIssue[] | undefined,
  threshold: SeverityThreshold,
): boolean => {
  const active = activeIssues(issues);
  if (active.length === 0) return false;
  const minRank = SEVERITY_RANK[threshold];
  return active.some((issue) => SEVERITY_RANK[issue.severity] >= minRank);
};
