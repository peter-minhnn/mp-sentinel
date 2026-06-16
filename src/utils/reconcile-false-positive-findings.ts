/**
 * Backstops for two recurring AI false-positive classes observed in the field
 * (both verified against gems-e-approval-web/useResourceSearch.ts).
 *
 * 1. **Lodash "imports the entire package".** The model flags a per-method
 *    subpath import (`import debounce from 'lodash/debounce'`) or an ESM
 *    `lodash-es` import as pulling the whole library. Both are already
 *    tree-shakeable; only a bare whole-package import (`from 'lodash'` /
 *    `require('lodash')`) is the real bundle concern. When the file has no
 *    whole-package import, the claim is provably false from the source -> drop.
 *
 * 2. **Hook misplacement.** The model claims a hook "is not placed in a
 *    feature's `hooks/` directory" when the file already lives under a `hooks/`
 *    folder (it only saw the diff, not the path). When the file path already
 *    contains a `hooks/` segment, the misplacement claim is false -> drop.
 *
 * Conservative by construction: only AI-sourced findings (no `eslint:`
 * evidence) whose message matches the specific shape are touched; ESLint
 * findings and everything else pass through unchanged. Per-file status is only
 * ever relaxed FAIL -> PASS when no actionable issue remains.
 */

import type { AuditIssue, FileAuditResult } from "../types/index.js";

const isESLintSourced = (issue: AuditIssue): boolean =>
  (issue.evidence ?? "").startsWith("eslint:");

/** Conservatively relax FAIL -> PASS when no actionable issue remains. */
const recomputeStatus = (
  previous: FileAuditResult["result"]["status"],
  issues: AuditIssue[],
): FileAuditResult["result"]["status"] => {
  if (previous !== "FAIL") return previous;
  const stillActionable = issues.some((i) => i.severity === "CRITICAL" || i.severity === "WARNING");
  return stillActionable ? "FAIL" : "PASS";
};

export interface ReconcileFalsePositiveResult {
  results: FileAuditResult[];
  /** AI findings dropped because the claim is contradicted by the source/path. */
  suppressed: number;
}

// ── Lodash tree-shaking false positives ───────────────────────────────────────

/** Mentions lodash (or lodash-es). */
const LODASH_RE = /\blodash(?:-es)?\b/i;
/** A bundle-size / tree-shaking concern in the message. */
const BUNDLE_CONCERN_RE =
  /\b(?:entire|whole|full|all of|complete)\b[^.]*\bpackage\b|\bimports?\s+all\b|\btree[-\s]?shak/i;

const isAILodashBundleFinding = (issue: AuditIssue): boolean =>
  !isESLintSourced(issue) && LODASH_RE.test(issue.message) && BUNDLE_CONCERN_RE.test(issue.message);

/**
 * True when the file imports lodash as a WHOLE package (`from 'lodash'` or
 * `require('lodash')`). Subpath (`lodash/debounce`) and `lodash-es` imports end
 * with `/...` or `-es` before the closing quote, so they never match.
 */
const hasWholePackageLodashImport = (content: string): boolean =>
  /(?:import[^;\n]*\bfrom\s*|require\(\s*)['"]lodash['"]/.test(content);

export interface ReconcileLodashOptions {
  /** File path -> full content, so subpath-only imports can be verified. */
  fileContents: Map<string, string>;
}

/**
 * Drop AI lodash-bundle findings on files whose lodash usage is entirely
 * subpath / `lodash-es` (already tree-shakeable). Files with a real
 * whole-package import keep the finding; files whose content is unavailable are
 * left untouched (cannot verify).
 */
export const reconcileLodashBundleFindings = (
  results: readonly FileAuditResult[],
  options: ReconcileLodashOptions,
): ReconcileFalsePositiveResult => {
  let suppressed = 0;
  const next = results.map((file): FileAuditResult => {
    const issues = file.result.issues ?? [];
    if (!issues.some(isAILodashBundleFinding)) return file;

    const content = options.fileContents.get(file.filePath);
    if (content === undefined) return file; // cannot verify -> keep
    if (hasWholePackageLodashImport(content)) return file; // real concern -> keep

    const nextIssues = issues.filter((issue) => {
      if (isAILodashBundleFinding(issue)) {
        suppressed += 1;
        return false;
      }
      return true;
    });
    return {
      ...file,
      result: {
        ...file.result,
        issues: nextIssues,
        status: recomputeStatus(file.result.status, nextIssues),
      },
    };
  });
  return { results: next, suppressed };
};

// ── Hook misplacement false positives ─────────────────────────────────────────

const HOOK_RE = /\bhook\b/i;
const HOOK_RELOCATE_RE =
  /\b(?:not\s+placed|move\s+(?:this|the|it)|should\s+(?:be\s+)?(?:under|in|moved|placed|extracted|live)|belongs?\s+(?:in|under)|place\s+it\s+in)\b/i;
const HOOK_DIR_RE = /hooks\/?/i;

const isAIHookMisplacementFinding = (issue: AuditIssue): boolean =>
  !isESLintSourced(issue) &&
  HOOK_RE.test(issue.message) &&
  HOOK_RELOCATE_RE.test(issue.message) &&
  HOOK_DIR_RE.test(issue.message);

/** True when the file path already contains a `hooks/` segment. */
const isUnderHooksDir = (filePath: string): boolean => /[\\/]hooks[\\/]/i.test(filePath);

/**
 * Drop AI "hook not placed in a hooks/ directory" findings for files that are
 * already under a `hooks/` folder -- the path contradicts the claim.
 */
export const reconcileHookPlacementFindings = (
  results: readonly FileAuditResult[],
): ReconcileFalsePositiveResult => {
  let suppressed = 0;
  const next = results.map((file): FileAuditResult => {
    if (!isUnderHooksDir(file.filePath)) return file;
    const issues = file.result.issues ?? [];
    if (!issues.some(isAIHookMisplacementFinding)) return file;

    const nextIssues = issues.filter((issue) => {
      if (isAIHookMisplacementFinding(issue)) {
        suppressed += 1;
        return false;
      }
      return true;
    });
    return {
      ...file,
      result: {
        ...file.result,
        issues: nextIssues,
        status: recomputeStatus(file.result.status, nextIssues),
      },
    };
  });
  return { results: next, suppressed };
};
