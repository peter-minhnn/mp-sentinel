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

// ── "Unused JSX element" false positives ──────────────────────────────────────

/**
 * The model sometimes flags a component as "unused" purely because it sees the
 * tag in the diff without the surrounding render tree -- e.g. "Unused JSX
 * element `<CancelBookingModal>`" for a component that is actually rendered. A
 * JSX element present in the return tree is by definition rendered, so the only
 * legitimate "unused" claim concerns a *declaration/import* that is never
 * referenced -- never a tag that appears in the markup.
 */
const UNUSED_RE = /\bunused\b/i;
/** Claim is about a rendered element/component (the false-positive class). */
const JSX_ELEMENT_RE = /\b(?:jsx\s+element|element|component|rendered)\b/i;
/**
 * Claim is about a prop/attribute/handler/argument/variable/import, NOT a
 * rendered element. These are legitimate "unused" targets and must NOT be
 * suppressed even when they mention JSX or sit on a JSX line.
 */
const JSX_NON_ELEMENT_RE =
  /\b(?:prop|property|attribute|attr|handler|callback|argument|param(?:eter)?|variable|import|state|hook)\b/i;

const isAIUnusedJsxFinding = (issue: AuditIssue): boolean =>
  !isESLintSourced(issue) &&
  UNUSED_RE.test(issue.message) &&
  JSX_ELEMENT_RE.test(issue.message) &&
  !JSX_NON_ELEMENT_RE.test(issue.message);

/** Component names referenced in the message (`<Name>` or `` `Name` ``, PascalCase). */
const componentNamesInMessage = (message: string): string[] => {
  const names = new Set<string>();
  for (const m of message.matchAll(/<\s*([A-Z][A-Za-z0-9_]*)/g)) {
    if (m[1]) names.add(m[1]);
  }
  for (const m of message.matchAll(/`([A-Z][A-Za-z0-9_]*)`/g)) {
    if (m[1]) names.add(m[1]);
  }
  return [...names];
};

/** True when `name` is rendered as a JSX tag (`<Name` / `<Name>`) anywhere in the file. */
const isRenderedAsJsx = (content: string, name: string): boolean =>
  new RegExp(`<\\s*${name}\\b`).test(content);

/** True when the finding's own line is a JSX opening tag for a component. */
const lineIsJsxElement = (content: string, line: number): boolean => {
  if (!Number.isInteger(line) || line < 1) return false;
  const target = content.split(/\r?\n/)[line - 1] ?? "";
  return /<\s*[A-Z][A-Za-z0-9_]*/.test(target);
};

export interface ReconcileUnusedJsxOptions {
  /** File path -> full content, so render-tree presence can be verified. */
  fileContents: Map<string, string>;
}

// ── Ant Design icon barrel false positives ────────────────────────────────────

/**
 * The model applies a "import UI from the gems-ui barrel, not directly" rule to
 * `@ant-design/icons` imports. Icons are not UI primitives that route through
 * the design-system barrel, so a `from '@ant-design/icons'` import is exempt.
 * Component imports from `'antd'` (e.g. `{ Button, Modal }`) are NOT exempt and
 * keep their finding.
 */
const GEMS_BARREL_RE =
  /gems[-\s]?ui|@\/shared\/gems-ui|design system|barrel|direct(?:ly)?\s+import/i;
const ANTD_ICONS_RE = /@ant-design\/icons/i;
const hasAntdIconsImport = (content: string): boolean =>
  /from\s*['"]@ant-design\/icons['"]/.test(content);

const isAIAntdIconBarrelFinding = (issue: AuditIssue): boolean =>
  !isESLintSourced(issue) &&
  GEMS_BARREL_RE.test(issue.message) &&
  ANTD_ICONS_RE.test(issue.message);

export interface ReconcileAntdIconOptions {
  /** File path -> full content, so the icon import can be verified from source. */
  fileContents: Map<string, string>;
}

/**
 * Drop AI gems-ui/barrel findings that target an `@ant-design/icons` import,
 * verified against the source (the file actually imports from
 * `@ant-design/icons`). Files whose content is unavailable, or that don't
 * import icons, are left untouched.
 */
export const reconcileAntdIconImportFindings = (
  results: readonly FileAuditResult[],
  options: ReconcileAntdIconOptions,
): ReconcileFalsePositiveResult => {
  let suppressed = 0;
  const next = results.map((file): FileAuditResult => {
    const issues = file.result.issues ?? [];
    if (!issues.some(isAIAntdIconBarrelFinding)) return file;

    const content = options.fileContents.get(file.filePath);
    if (content === undefined || !hasAntdIconsImport(content)) return file; // can't verify -> keep

    const nextIssues = issues.filter((issue) => {
      if (isAIAntdIconBarrelFinding(issue)) {
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

/**
 * Drop AI "unused JSX/element/component" findings when the cited component is
 * actually rendered in the file (`<Name ...>`), or — when no name is cited — the
 * finding's own line is a JSX element. Files whose content is unavailable, or
 * whose claim can't be contradicted from source, are left untouched.
 */
export const reconcileUnusedJsxFindings = (
  results: readonly FileAuditResult[],
  options: ReconcileUnusedJsxOptions,
): ReconcileFalsePositiveResult => {
  let suppressed = 0;
  const next = results.map((file): FileAuditResult => {
    const issues = file.result.issues ?? [];
    if (!issues.some(isAIUnusedJsxFinding)) return file;

    const content = options.fileContents.get(file.filePath);
    if (content === undefined) return file; // cannot verify -> keep

    const isFalsePositive = (issue: AuditIssue): boolean => {
      if (!isAIUnusedJsxFinding(issue)) return false;
      const names = componentNamesInMessage(issue.message);
      if (names.some((name) => isRenderedAsJsx(content, name))) return true;
      // No specific component cited: treat an "unused JSX element" claim whose
      // line is a JSX tag as the false positive it almost always is.
      return names.length === 0 && lineIsJsxElement(content, issue.line);
    };

    if (!issues.some(isFalsePositive)) return file;
    const nextIssues = issues.filter((issue) => {
      if (isFalsePositive(issue)) {
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
