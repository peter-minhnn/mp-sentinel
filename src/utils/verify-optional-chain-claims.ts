/**
 * Optional-chaining short-circuit backstop for crash/undefined findings.
 *
 * Field sample (review-0706.md): `BookingDetailsGrid.tsx` flagged WARNING for
 * "`.join(',')` may crash when `resources` is undefined" on the chain
 * `clickedOccurrence?.resources?.map(...).join(',')`. That is wrong: per the
 * ES2020 spec, once any `?.` in an Optional Chain short-circuits, the WHOLE
 * remainder of that chain is skipped — `undefined?.map(...).join(',')` evaluates
 * to `undefined`, it never calls `.join`. So a plain `.member` / `.method()`
 * that sits AFTER a `?.` in the same chain cannot throw on a nullish head.
 *
 * The distinction is mechanically checkable: take the flagged expression, find
 * the first `?.`, and scan the rest of that chain (skipping call/computed args)
 * for a top-level plain `.access`. If one exists, the AI's "crashes on
 * undefined" claim targets a short-circuit-protected access → downgrade to INFO.
 * Fail-open: if the chain or file can't be read, nothing changes.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AuditIssue, FileAuditResult } from "../types/index.js";

/** A finding asserting a member access throws / reads a property of nullish. */
const isOptionalChainCrashClaim = (issue: AuditIssue): boolean =>
  (issue.severity === "CRITICAL" || issue.severity === "WARNING") &&
  /\b(?:undefined|null|nullish)\b/i.test(issue.message) &&
  /\b(?:crash|throw|throws|thrown|type\s?error|cannot read|reading|access(?:ing)?|call(?:ing)?)\b/i.test(
    issue.message,
  ) &&
  // Must reference a member access — `.method(`, `.prop`, or the words property/method.
  /(?:\.\s*[A-Za-z_$][\w$]*|\bproperty\b|\bmethod\b)/i.test(
    `${issue.message} ${issue.evidence ?? ""}`,
  );

/**
 * True when `expr` contains an optional chain whose short-circuit protects a
 * later plain `.access`. Starting at the first `?.`, walk forward at chain
 * top-level (depth 0); a plain `.` beginning an identifier is a protected tail.
 * Call/computed args (`(...)`, `[...]`) are skipped; operators, separators and
 * statement terminators end the chain. Whitespace is not a terminator so the
 * check survives multi-line method chains.
 */
const hasProtectedTailAccess = (expr: string): boolean => {
  let from = 0;
  for (;;) {
    const q = expr.indexOf("?.", from);
    if (q < 0) return false;
    let depth = 0;
    for (let i = q + 2; i < expr.length; i++) {
      const ch = expr[i]!;
      if (ch === "(" || ch === "[") {
        depth++;
        continue;
      }
      if (ch === ")" || ch === "]") {
        depth--;
        continue;
      }
      if (depth > 0) continue;
      if (ch === ".") {
        if (expr[i - 1] === "?") continue; // another optional access — keep scanning
        if (/[A-Za-z_$]/.test(expr[i + 1] ?? "")) return true; // plain tail access → protected
      }
      if (/[\s\w$?]/.test(ch)) continue; // identifiers / whitespace / optional markers
      break; // operator, separator, brace → chain ended
    }
    from = q + 2;
  }
};

/** Small source window around `line` to capture chains that span lines. */
const readWindow = (content: string, line: number): string => {
  const lines = content.split("\n");
  const start = Math.max(0, line - 2);
  const end = Math.min(lines.length, line + 2);
  return lines.slice(start, end).join("\n");
};

export interface VerifyOptionalChainResult {
  results: FileAuditResult[];
  downgraded: number;
}

/**
 * Downgrade "member access crashes on undefined/null" findings whose access is
 * protected by an earlier `?.` in the same chain (short-circuit no-op). Genuine
 * unguarded accesses and unlocatable chains are left untouched.
 */
export const verifyOptionalChainClaims = (
  results: readonly FileAuditResult[],
  options: { cwd?: string; readFileImpl?: (path: string) => string } = {},
): VerifyOptionalChainResult => {
  const cwd = options.cwd ?? process.cwd();
  const readImpl = options.readFileImpl ?? ((p: string) => readFileSync(p, "utf-8"));

  let downgraded = 0;
  const next = results.map((file): FileAuditResult => {
    const issues = file.result.issues ?? [];
    if (!issues.some(isOptionalChainCrashClaim)) return file;

    let content: string | null = null;
    try {
      content = readImpl(resolve(cwd, file.filePath));
    } catch {
      content = null;
    }

    const nextIssues = issues.map((issue): AuditIssue => {
      if (!isOptionalChainCrashClaim(issue)) return issue;

      const evidence = issue.evidence ?? "";
      const windowText = content !== null ? readWindow(content, issue.line) : "";
      const expr = `${evidence}\n${windowText}`;
      if (!hasProtectedTailAccess(expr)) return issue;

      downgraded += 1;
      return {
        ...issue,
        severity: "INFO",
        confidence: "low",
        message: `${issue.message} [downgraded: access is protected by an earlier optional chain (?.) — a nullish head short-circuits the whole chain, it does not throw]`,
      };
    });

    return { ...file, result: { ...file.result, issues: nextIssues } };
  });

  return { results: next, downgraded };
};
