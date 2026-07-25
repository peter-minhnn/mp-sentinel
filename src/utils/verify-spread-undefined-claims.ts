/**
 * Spread-of-undefined backstop for CRITICAL findings.
 *
 * Field sample (review-0703.md): `useEquipmentData.ts` flagged CRITICAL for
 * "spreading optional `params` when undefined will throw a runtime TypeError"
 * on `({ limit, active, ...params })`. That is wrong: OBJECT spread of
 * `undefined`/`null` is a no-op per the ES2018 spec (`{ ...undefined }` → `{}`),
 * it does not throw. Only ARRAY spread (`[...x]`) and CALL spread (`f(...x)`) of
 * a nullish value throw ("x is not iterable").
 *
 * The distinction is mechanically checkable: read the source, find the spread,
 * and walk backwards to the nearest enclosing bracket. `{` → object spread
 * (safe) → downgrade the CRITICAL to WARNING. `[` or `(` → iterable spread
 * (really can throw) → left untouched. Fail-open: if the file or spread can't be
 * located, nothing changes.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AuditIssue, FileAuditResult } from "../types/index.js";

const isSpreadThrowClaim = (issue: AuditIssue): boolean =>
  issue.severity === "CRITICAL" &&
  /\bspread(?:ing)?\b/i.test(issue.message) &&
  /\b(?:undefined|null)\b/i.test(issue.message) &&
  /\b(?:throw|throws|thrown|type\s?error|crash|runtime error)\b/i.test(issue.message);

/** Pull the spread identifier, e.g. `...params,` → `params`. */
const extractSpreadIdent = (text: string): string | null => {
  const m = text.match(/\.\.\.\s*([A-Za-z_$][\w$]*)/);
  return m?.[1] ?? null;
};

/**
 * Absolute char offset of `...ident`. Tries a window around the reported line
 * first, then — because AI line numbers are unreliable and may not yet be
 * relocated when this runs — falls back to a whole-file search, using it only
 * when the token is UNIQUE (so we never guess the wrong spread).
 */
const findSpreadOffset = (content: string, ident: string, line: number): number => {
  const lines = content.split("\n");
  const needle = `...${ident}`;
  const offsetAt = (idx: number, col: number): number => {
    let off = 0;
    for (let k = 0; k < idx; k++) off += lines[k]!.length + 1;
    return off + col;
  };

  const start = Math.max(0, line - 1);
  const window = [start];
  for (let d = 1; d <= 3; d++) window.push(start - d, start + d);
  for (const idx of window) {
    if (idx < 0 || idx >= lines.length) continue;
    const col = lines[idx]!.indexOf(needle);
    if (col >= 0) return offsetAt(idx, col);
  }

  // Fallback: whole-file, only when unambiguous.
  let found = -1;
  let count = 0;
  for (let idx = 0; idx < lines.length; idx++) {
    const col = lines[idx]!.indexOf(needle);
    if (col < 0) continue;
    count += 1;
    if (count === 1) found = offsetAt(idx, col);
    if (count > 1) return -1;
  }
  return found;
};

/** Nearest enclosing opener before `offset`, or null. Ignores balanced pairs. */
const enclosingOpener = (content: string, offset: number): "{" | "[" | "(" | null => {
  let depth = 0;
  for (let i = offset - 1; i >= 0; i--) {
    const ch = content[i];
    if (ch === "}" || ch === "]" || ch === ")") depth++;
    else if (ch === "{" || ch === "[" || ch === "(") {
      if (depth === 0) return ch;
      depth--;
    }
  }
  return null;
};

export interface VerifySpreadResult {
  results: FileAuditResult[];
  downgraded: number;
}

/**
 * Downgrade "spread of undefined throws" CRITICALs that are actually OBJECT
 * spreads (safe no-op). Array/call spreads and unlocatable spreads are kept.
 */
export const verifySpreadUndefinedClaims = (
  results: readonly FileAuditResult[],
  options: { cwd?: string; readFileImpl?: (path: string) => string } = {},
): VerifySpreadResult => {
  const cwd = options.cwd ?? process.cwd();
  const readImpl = options.readFileImpl ?? ((p: string) => readFileSync(p, "utf-8"));

  let downgraded = 0;
  const next = results.map((file): FileAuditResult => {
    const issues = file.result.issues ?? [];
    if (!issues.some(isSpreadThrowClaim)) return file;

    let content: string | null = null;
    try {
      content = readImpl(resolve(cwd, file.filePath));
    } catch {
      content = null;
    }
    if (content === null) return file;

    const nextIssues = issues.map((issue): AuditIssue => {
      if (!isSpreadThrowClaim(issue)) return issue;
      const ident = extractSpreadIdent(`${issue.evidence ?? ""} ${issue.message}`);
      if (!ident) return issue;
      const offset = findSpreadOffset(content, ident, issue.line);
      if (offset < 0) return issue;
      if (enclosingOpener(content, offset) !== "{") return issue; // array/call spread can throw

      downgraded += 1;
      return {
        ...issue,
        severity: "WARNING",
        confidence: "low",
        message: `${issue.message} [downgraded: object spread of undefined/null is a no-op, not a crash]`,
      };
    });

    return { ...file, result: { ...file.result, issues: nextIssues } };
  });

  return { results: next, downgraded };
};
