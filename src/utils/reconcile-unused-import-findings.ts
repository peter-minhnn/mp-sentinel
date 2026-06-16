/**
 * Unused-import backstop.
 *
 * The AI reviewer sees only diff hunks, so it recurrently flags an import as
 * "unused" / "imported but never used" when the symbol IS used elsewhere in
 * the file — in a hunk the model never saw (observed in the field on large
 * files: React, Avatar, dayjs, clsx all reported unused while clearly used).
 *
 * ESLint's `no-unused-vars` / `unused-imports` rules evaluate the WHOLE file,
 * so we treat ESLint as the authority on unused symbols:
 *
 * - File WAS linted by the ESLint adapter → DROP every AI unused-import
 *   finding for it. If the symbol is genuinely unused, ESLint already emitted
 *   its own finding (kept untouched, merged earlier); if ESLint stayed silent
 *   the symbol is used and the AI claim is a false positive.
 * - File was NOT linted (adapter disabled/unavailable, or a non-lintable
 *   extension) → DOWNGRADE the AI finding to INFO / low confidence with a note,
 *   since it cannot be verified from the diff alone. It stays visible but no
 *   longer fails the review.
 *
 * Conservative by construction: only AI-sourced findings whose message matches
 * the unused-import shape are touched. ESLint-sourced findings (evidence
 * `eslint:*`) and any other finding are passed through unchanged. Per-file
 * status is only ever relaxed FAIL → PASS, and only when no CRITICAL/WARNING
 * issue remains after reconciliation.
 */

import type { AuditIssue, FileAuditResult } from "../types/index.js";

/**
 * Matches the AI's unused-import/variable phrasings, e.g.
 * "Unused import: Avatar ...", "Unused `Avatar` import",
 * "imported but never used", "is defined but never used",
 * "never used in the component", "not used in the component's JSX",
 * "imported from ... but not used in the file".
 */
const UNUSED_IMPORT_RE =
  /\bunused\b[^.\n]{0,60}?\b(?:import|variable|binding)\b|\b(?:import(?:ed)?|variable|binding)\b[^.\n]{0,60}?\b(?:never|not)\s+used\b|\bis\s+(?:defined|declared|imported|assigned)\b[^.]*?\b(?:never|not)\s+used\b|\b(?:never|not)\s+used\b\s+in\s+the\s+(?:component|file|module|jsx)\b/i;

/** ESLint-sourced findings carry an `eslint:<ruleId>` evidence string. */
const isESLintSourced = (issue: AuditIssue): boolean =>
  (issue.evidence ?? "").startsWith("eslint:");

/** An AI finding asserting an import/variable is unused. */
const isAIUnusedImportFinding = (issue: AuditIssue): boolean =>
  !isESLintSourced(issue) && UNUSED_IMPORT_RE.test(issue.message);

export interface ReconcileUnusedImportOptions {
  /** True when the ESLint adapter ran successfully over the review scope. */
  eslintRan: boolean;
  /** Predicate: is this file path one ESLint was asked to lint (by extension)? */
  isFileLinted: (path: string) => boolean;
}

export interface ReconcileUnusedImportResult {
  results: FileAuditResult[];
  /** AI unused-import findings dropped because ESLint is the authority. */
  suppressed: number;
  /** AI unused-import findings demoted to INFO because they were unverifiable. */
  downgraded: number;
}

/** Conservatively relax FAIL → PASS when no actionable issue remains. */
const recomputeStatus = (
  previous: FileAuditResult["result"]["status"],
  issues: AuditIssue[],
): FileAuditResult["result"]["status"] => {
  if (previous !== "FAIL") return previous;
  const stillActionable = issues.some((i) => i.severity === "CRITICAL" || i.severity === "WARNING");
  return stillActionable ? "FAIL" : "PASS";
};

/**
 * Reconcile AI unused-import findings against ESLint's whole-file verdict.
 * See the file header for the drop/downgrade contract.
 */
export const reconcileUnusedImportFindings = (
  results: readonly FileAuditResult[],
  options: ReconcileUnusedImportOptions,
): ReconcileUnusedImportResult => {
  let suppressed = 0;
  let downgraded = 0;

  const next = results.map((file): FileAuditResult => {
    const issues = file.result.issues ?? [];
    if (!issues.some(isAIUnusedImportFinding)) return file;

    const linted = options.eslintRan && options.isFileLinted(file.filePath);
    const nextIssues: AuditIssue[] = [];

    for (const issue of issues) {
      if (!isAIUnusedImportFinding(issue)) {
        nextIssues.push(issue);
        continue;
      }

      if (linted) {
        // ESLint owns this verdict for the file — drop the AI claim.
        suppressed += 1;
        continue;
      }

      if (issue.severity === "INFO") {
        // Already non-actionable; leave it as-is.
        nextIssues.push(issue);
        continue;
      }

      downgraded += 1;
      nextIssues.push({
        ...issue,
        severity: "INFO",
        confidence: "low",
        message: `${issue.message} [downgraded: unused-import claim unverifiable on diff — enable the ESLint adapter for full-file verification]`,
      });
    }

    return {
      ...file,
      result: {
        ...file.result,
        issues: nextIssues,
        status: recomputeStatus(file.result.status, nextIssues),
      },
    };
  });

  return { results: next, suppressed, downgraded };
};
