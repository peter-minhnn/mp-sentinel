/**
 * Version-claim backstop for library-version assertions.
 *
 * Field testing produced a recurring false positive: the model asserts that a
 * library "removed / deprecated X in version N" and raises it as CRITICAL —
 * but the claim is wrong (e.g. "per-call `onSuccess`/`onError` callbacks on
 * `mutate()` were removed in TanStack Query v5" — they were NOT; only the
 * `useQuery` callbacks were). A reviewer sees only a diff hunk, never the
 * dependency's changelog, so a "removed/deprecated in vX" assertion is
 * inherently unverifiable from the review inputs and the model's training data
 * lags real releases.
 *
 * This pass does NOT try to confirm the changelog (offline). Instead it applies
 * confidence discipline the prompt already asks for but the model doesn't
 * reliably follow:
 *   - CRITICAL version-removal/deprecation claim → downgraded to WARNING,
 *     confidence "low", tagged so a human confirms against the installed
 *     version. (Never dropped — the claim might be real.)
 *   - A non-CRITICAL claim asserted with HIGH confidence → confidence lowered
 *     to "low" + tagged, severity untouched.
 *
 * Conservative by construction: fires only when the message pairs a
 * removal/deprecation verb WITH a version marker (`v5`, `version 6`, `5.59.20`),
 * so ordinary findings that merely mention a number are left alone.
 */

import type { AuditIssue, FileAuditResult } from "../types/index.js";

/** A removal/deprecation verb sitting near a version marker (either order). */
const VERSION_CLAIM_RE = new RegExp(
  // verb → version
  "\\b(removed|dropped|deprecated|no longer (?:supported|available|exists?|works?)|" +
    "not (?:a )?(?:valid|supported|available)|breaking change)\\b[^.]{0,60}" +
    "\\b(v\\d+|version\\s+\\d+|\\d+\\.\\d+(?:\\.\\d+)?)\\b" +
    "|" +
    // version → verb
    "\\b(v\\d+|version\\s+\\d+|\\d+\\.\\d+(?:\\.\\d+)?)\\b[^.]{0,60}" +
    "\\b(removed|dropped|deprecated|no longer (?:supported|available|exists?|works?))\\b",
  "i",
);

const isVersionClaim = (issue: AuditIssue): boolean =>
  issue.severity !== "INFO" && VERSION_CLAIM_RE.test(issue.message);

export interface VerifyVersionResult {
  results: FileAuditResult[];
  downgraded: number;
}

/**
 * Downgrade unverifiable library-version claims. CRITICALs drop to WARNING;
 * high-confidence non-CRITICALs keep their severity but lose the false
 * certainty. Both get a tag pointing the reviewer at the installed version.
 */
export const verifyVersionClaims = (results: readonly FileAuditResult[]): VerifyVersionResult => {
  let downgraded = 0;

  const next = results.map((file): FileAuditResult => {
    const issues = file.result.issues ?? [];
    if (!issues.some(isVersionClaim)) return file;

    const nextIssues = issues.map((issue): AuditIssue => {
      if (!isVersionClaim(issue)) return issue;

      if (issue.severity === "CRITICAL") {
        downgraded += 1;
        return {
          ...issue,
          severity: "WARNING",
          confidence: "low",
          message: `${issue.message} [downgraded: unverified version claim — confirm against the installed version before acting]`,
        };
      }

      // Non-CRITICAL asserted with high confidence: strip the false certainty.
      if (issue.confidence === "high") {
        downgraded += 1;
        return {
          ...issue,
          confidence: "low",
          message: `${issue.message} [unverified version claim — confirm against the installed version]`,
        };
      }

      return issue;
    });

    return { ...file, result: { ...file.result, issues: nextIssues } };
  });

  return { results: next, downgraded };
};
