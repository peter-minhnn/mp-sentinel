/**
 * Self-import backstop for CRITICAL findings.
 *
 * Field sample (review-0701.md): the model flagged `templateRowHelpers.ts` for
 * a "self-import … circular dependency … build/runtime crash" because it imports
 * from `./templateBuilderHelpers`. Those are two DIFFERENT sibling files with
 * similar names — no self-import, no cycle. The model conflated the names.
 *
 * A self-import claim is mechanically checkable: a file only imports itself when
 * the imported specifier resolves to the SAME module basename as the file. So we
 * compare the finding's file basename against the import specifier's basename —
 * if they differ, the "self-import" premise is false and the CRITICAL is
 * downgraded to WARNING (kept visible, never dropped).
 *
 * Fires ONLY on the self-import phrasing (not a bare "circular dependency", which
 * can legitimately span two differently-named files and is not verifiable here).
 */

import { basename } from "node:path";
import type { AuditIssue, FileAuditResult } from "../types/index.js";

const SELF_IMPORT_RE =
  /\bself-?import\b|\bimports?\s+from\s+itself\b|\bimport(?:ing|s)?\s+from\s+(?:the\s+)?same\s+file\b/i;

const MODULE_EXT_RE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/i;

/** Basename without a module extension, e.g. `./a/foo.tsx` → `foo`. */
const moduleBase = (spec: string): string => basename(spec).replace(MODULE_EXT_RE, "");

/** Pull the module specifier from an `import … from '…'` / `require('…')` line. */
const extractSpecifier = (text: string): string | null => {
  const m =
    text.match(/from\s+['"]([^'"]+)['"]/) ??
    text.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/) ??
    text.match(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/);
  return m?.[1] ?? null;
};

export interface VerifySelfImportResult {
  results: FileAuditResult[];
  downgraded: number;
}

/**
 * Downgrade "self-import" CRITICALs whose import specifier points at a
 * differently-named module than the file itself — i.e. it is not actually a
 * self-import. Fail-open: if no specifier is found, or the basenames match
 * (a genuine self-import), the finding is left untouched.
 */
export const verifySelfImportClaims = (
  results: readonly FileAuditResult[],
): VerifySelfImportResult => {
  let downgraded = 0;

  const next = results.map((file): FileAuditResult => {
    const issues = file.result.issues ?? [];
    const relevant = issues.some(
      (i) => i.severity === "CRITICAL" && SELF_IMPORT_RE.test(i.message),
    );
    if (!relevant) return file;

    const fileBase = moduleBase(file.filePath);

    const nextIssues = issues.map((issue): AuditIssue => {
      if (issue.severity !== "CRITICAL" || !SELF_IMPORT_RE.test(issue.message)) return issue;

      const specifier = extractSpecifier(`${issue.evidence ?? ""} ${issue.message}`);
      if (!specifier) return issue;
      if (moduleBase(specifier) === fileBase) return issue; // genuine self-import

      downgraded += 1;
      return {
        ...issue,
        severity: "WARNING",
        confidence: "low",
        message: `${issue.message} [downgraded: not a self-import — '${fileBase}' imports a different module '${moduleBase(specifier)}']`,
      };
    });

    return { ...file, result: { ...file.result, issues: nextIssues } };
  });

  return { results: next, downgraded };
};
