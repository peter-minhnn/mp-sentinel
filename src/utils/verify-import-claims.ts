/**
 * Import-existence backstop for CRITICAL findings.
 *
 * Field testing produced a recurring false positive: the model reads the
 * source index, sees a symbol defined in one place, and concludes an import
 * of the SAME name from a different path "does not exist" / "will cause a
 * build failure" — when the imported file is actually present on disk (e.g.
 * `RichTextEditor` exists at both `@/components/...` and a feature path).
 *
 * This pass extracts the import specifier the finding is about, resolves it
 * against the working tree (honoring common alias prefixes + extension /
 * index resolution), and if the target file EXISTS, downgrades the CRITICAL
 * to WARNING with a `[downgraded: import target exists on disk]` tag.
 *
 * Conservative: only fires on findings that (a) are CRITICAL, (b) claim a
 * missing/incorrect import/build failure, and (c) carry an evidence string
 * containing a resolvable specifier. Anything else is left untouched.
 */

import { existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import type { AuditIssue, FileAuditResult } from "../types/index.js";

const MISSING_IMPORT_RE =
  /\b(does not (exist|match)|doesn'?t (exist|match)|not found|no such (file|module)|cannot (be )?resolve|will cause a build failure|wrong import path|incorrect import path|import path does not)/i;

/** Pull the module specifier from `from '...'`, `import('...')`, or `require('...')`. */
const extractSpecifier = (text: string): string | null => {
  const patterns = [
    /from\s+['"]([^'"]+)['"]/,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/,
    /['"](@\/[^'"]+|\.{1,2}\/[^'"]+|[~#$][^'"]*\/[^'"]+)['"]/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
};

const CANDIDATE_EXTENSIONS = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  "/index.ts",
  "/index.tsx",
  "/index.js",
  "/index.jsx",
];

/**
 * Map an alias-prefixed specifier to candidate base paths under the project.
 * We don't read tsconfig here (kept dependency-free); instead we try the
 * conventional `<root>/src/<rest>` and `<root>/<rest>` for `@/`, `~/`, `#`,
 * `$lib/` style prefixes, which covers the vast majority of setups.
 */
const candidateBases = (specifier: string, cwd: string, fromFileDir: string): string[] => {
  // Relative import — resolve against the importing file's directory.
  if (specifier.startsWith(".")) return [resolve(fromFileDir, specifier)];

  const aliasMatch = specifier.match(/^(@\/|~\/|~|#\/?|\$lib\/|@app\/)(.*)$/);
  if (aliasMatch) {
    const rest = aliasMatch[2] ?? "";
    return [join(cwd, "src", rest), join(cwd, rest)];
  }
  return [];
};

const importTargetExists = (
  specifier: string,
  cwd: string,
  fromFilePath: string,
  existsImpl: (p: string) => boolean,
): boolean => {
  const fromDir = dirname(resolve(cwd, fromFilePath));
  for (const base of candidateBases(specifier, cwd, fromDir)) {
    for (const ext of CANDIDATE_EXTENSIONS) {
      if (existsImpl(base + ext)) return true;
    }
  }
  return false;
};

export interface VerifyImportOptions {
  cwd?: string;
  /** Test seam. */
  existsImpl?: (path: string) => boolean;
}

export interface VerifyImportResult {
  results: FileAuditResult[];
  downgraded: number;
}

/**
 * Downgrade CRITICAL "missing import" findings whose target actually
 * resolves on disk. Fail-open: unresolvable specifiers or non-alias/relative
 * specifiers (bare packages) are left as-is — we only override when we can
 * positively confirm the file exists.
 */
export const verifyImportClaims = (
  results: readonly FileAuditResult[],
  options: VerifyImportOptions = {},
): VerifyImportResult => {
  const cwd = options.cwd ?? process.cwd();
  const existsImpl = options.existsImpl ?? existsSync;

  let downgraded = 0;
  const next = results.map((file): FileAuditResult => {
    const issues = file.result.issues ?? [];
    const relevant = issues.some(
      (i) => i.severity === "CRITICAL" && MISSING_IMPORT_RE.test(i.message),
    );
    if (!relevant) return file;

    const nextIssues = issues.map((issue): AuditIssue => {
      if (issue.severity !== "CRITICAL" || !MISSING_IMPORT_RE.test(issue.message)) return issue;
      const source = `${issue.evidence ?? ""} ${issue.message}`;
      const specifier = extractSpecifier(source);
      if (!specifier) return issue;
      if (!importTargetExists(specifier, cwd, file.filePath, existsImpl)) return issue;

      downgraded += 1;
      return {
        ...issue,
        severity: "WARNING",
        confidence: "low",
        message: `${issue.message} [downgraded: import target '${specifier}' exists on disk]`,
      };
    });

    return { ...file, result: { ...file.result, issues: nextIssues } };
  });

  return { results: next, downgraded };
};
