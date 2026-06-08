/**
 * TanStack Query rule-pack evaluators — deterministic checks for React Query.
 *
 * `no-inline-query-keys` flags `queryKey` / `mutationKey` arrays whose first
 * element is a string or number literal. Inline literal keys drift out of sync
 * across call sites; keys should be centralized in a feature's constants.
 */

import type { FileEvaluator, FileEvaluatorResult } from "../index.js";
import { isDiffMetaOrRemovedLine, isEslintSuppressed, isPatchContent } from "./text-scan.js";

/**
 * Matches `queryKey: [` / `mutationKey: [` immediately followed by a string or
 * numeric literal (the inline-literal form we want to discourage). A key built
 * from a constant identifier — `queryKey: [DETAIL_QUERY_KEYS.list]` — does NOT
 * match, since the first element is not a literal.
 */
const INLINE_KEY_RE = /\b(queryKey|mutationKey)\s*:\s*\[\s*(?:['"`]|-?\d)/;

/** Remove a trailing line comment so commented-out keys aren't flagged. */
function stripLineComment(line: string): string {
  return line.replace(/\/\/.*$/, "");
}

function isTsFile(filePath: string): boolean {
  return /\.(ts|tsx)$/.test(filePath);
}

/**
 * Flag inline literal `queryKey` / `mutationKey` arrays.
 */
export const noInlineQueryKeys: FileEvaluator = {
  ruleId: "no-inline-query-keys",
  evaluate: ({ filePath, content, lines }): FileEvaluatorResult[] => {
    if (!isTsFile(filePath)) return [];

    const patch = isPatchContent(content);
    const results: FileEvaluatorResult[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (patch && isDiffMetaOrRemovedLine(lines[i]!)) continue;
      if (isEslintSuppressed(lines, i)) continue;

      const code = stripLineComment(lines[i]!);
      const match = code.match(INLINE_KEY_RE);
      if (!match) continue;

      results.push({
        ruleId: "no-inline-query-keys",
        passed: false,
        message: `Inline literal \`${match[1]}\` array — query keys must come from a feature constant (e.g. \`DETAIL_QUERY_KEYS\`) so every call site stays in sync.`,
        line: i + 1,
        column: (code.indexOf(match[0]) >= 0 ? code.indexOf(match[0]) : 0) + 1,
        severity: "WARNING",
        suggestion:
          "Declare the key in the feature's `constants.ts` and reference it here, instead of an inline array literal.",
      });
    }

    return results;
  },
};
