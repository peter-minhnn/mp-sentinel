/**
 * Finding hygiene — self-negation filter.
 *
 * Field testing showed models emitting findings whose own message concludes
 * nothing is wrong ("…however, these hooks are already wrapped, so this is
 * compliant. No issue.") or hedges the claim away ("this is a false positive
 * risk rather than a crash"). Shipping these wastes reviewer attention and
 * inflates counts.
 *
 * Policy (conservative):
 *   - WARNING/INFO with a self-negating message → DROPPED.
 *   - CRITICAL with a self-negating message → kept but downgraded to INFO and
 *     tagged `[self-negated]` — visible for prompt tuning, never blocking.
 *
 * Only applied to AI findings (deterministic evaluators never self-negate).
 */

import type { AuditIssue, FileAuditResult } from "../types/index.js";

const SELF_NEGATION_PATTERNS: readonly RegExp[] = [
  /\bno (real |actual )?issue\b/i,
  /\b(?:this|which|that|it) is compliant\b/i,
  /\bnot (actually )?a problem\b/i,
  /\bfalse positive\b/i,
  /\bthis is (acceptable|fine|correct|intentional|expected|safe)\b/i,
  /\bno (action|change|fix) (is )?(needed|required)\b/i,
  /\bworks as intended\b/i,
  // Hedged variants observed in the field: the model raises the finding,
  // then concedes it is probably fine pending verification.
  /\bthis may be (acceptable|fine|intentional|compliant|correct)\b/i,
  /\bif (they|it|this|these) (are|is)[^.]*\bcompliant\b/i,
  /\blikely (intentional|acceptable|fine|a false positive)\b/i,
];

/**
 * A finding negates itself when its own prose concludes (or strongly hedges
 * toward) "nothing is wrong". Both message and suggestion are checked — field
 * samples put the concession in either field.
 */
export const isSelfNegating = (message: string, suggestion?: string): boolean =>
  SELF_NEGATION_PATTERNS.some(
    (pattern) => pattern.test(message) || (suggestion !== undefined && pattern.test(suggestion)),
  );

export interface HygieneResult {
  results: FileAuditResult[];
  dropped: number;
  downgraded: number;
}

const downgradeSelfNegated = (issue: AuditIssue): AuditIssue => ({
  ...issue,
  severity: "INFO",
  confidence: "low",
  message: `${issue.message} [self-negated]`,
});

// ── XSS sink verification ───────────────────────────────────────────────

/**
 * Actual XSS sinks. JSX text interpolation auto-escapes, so an XSS CRITICAL
 * is only credible when its evidence quotes one of these.
 */
const XSS_SINK_RE =
  /dangerouslySetInnerHTML|\binnerHTML\s*=|insertAdjacentHTML|document\.write|DOMParser|parseFromString|createContextualFragment|createElement|eval\s*\(|javascript:/i;

const isXssClaim = (issue: AuditIssue): boolean =>
  issue.severity === "CRITICAL" &&
  issue.category === "security" &&
  /\bXSS\b|cross-site scripting/i.test(issue.message);

/**
 * Downgrade CRITICAL XSS claims whose evidence contains no actual sink —
 * the dominant false-positive class is "JSX renders user content without
 * sanitization", which React already escapes. Claims WITHOUT evidence are
 * also downgraded (the prompt requires CRITICALs to quote the sink).
 */
export const downgradeUnsinkedXssClaims = (
  results: readonly FileAuditResult[],
): { results: FileAuditResult[]; downgraded: number } => {
  let downgraded = 0;
  const next = results.map((file): FileAuditResult => {
    const issues = file.result.issues ?? [];
    if (!issues.some(isXssClaim)) return file;

    const nextIssues = issues.map((issue): AuditIssue => {
      if (!isXssClaim(issue)) return issue;
      if (issue.evidence && XSS_SINK_RE.test(issue.evidence)) return issue;
      downgraded += 1;
      return {
        ...issue,
        severity: "WARNING",
        confidence: "low",
        message: `${issue.message} [downgraded: no XSS sink in evidence — JSX interpolation auto-escapes]`,
      };
    });
    return { ...file, result: { ...file.result, issues: nextIssues } };
  });
  return { results: next, downgraded };
};

/**
 * Remove or downgrade findings whose message negates itself.
 */
export const filterSelfNegatedFindings = (results: readonly FileAuditResult[]): HygieneResult => {
  let dropped = 0;
  let downgraded = 0;

  const next = results.map((file): FileAuditResult => {
    const issues = file.result.issues ?? [];
    if (!issues.some((issue) => isSelfNegating(issue.message, issue.suggestion))) return file;

    const kept: AuditIssue[] = [];
    for (const issue of issues) {
      if (!isSelfNegating(issue.message, issue.suggestion)) {
        kept.push(issue);
        continue;
      }
      if (issue.severity === "CRITICAL") {
        downgraded += 1;
        kept.push(downgradeSelfNegated(issue));
      } else {
        dropped += 1;
      }
    }
    return { ...file, result: { ...file.result, issues: kept } };
  });

  return { results: next, dropped, downgraded };
};
