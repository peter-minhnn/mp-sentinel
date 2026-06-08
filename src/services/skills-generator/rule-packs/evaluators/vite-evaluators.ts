/**
 * Vite rule-pack evaluators — deterministic checks for Vite-specific pitfalls.
 *
 * `no-framework-directives` flags `'use client'` / `'use server'` directives.
 * These are Next.js / React Server Components markers with no meaning in a
 * Vite app; their presence signals copy-pasted Next.js patterns.
 */

import type { FileEvaluator, FileEvaluatorResult } from "../index.js";
import { isDiffMetaOrRemovedLine, isPatchContent } from "./text-scan.js";

/**
 * A line consisting solely of a `'use client'` / `'use server'` directive.
 *
 * An optional leading `+` or space tolerates unified-diff content (added /
 * context lines), since the review pipeline feeds evaluators patch text. A
 * leading `-` (a removed line) deliberately does NOT match — deleting the
 * directive is the fix, not a violation.
 */
const DIRECTIVE_LINE_RE = /^[+ ]?\s*['"]use (client|server)['"]\s*;?\s*$/;

function isScriptFile(filePath: string): boolean {
  return /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/.test(filePath);
}

/**
 * Flag Next.js/RSC `'use client'` / `'use server'` directives in a Vite app.
 */
export const noFrameworkDirectives: FileEvaluator = {
  ruleId: "no-framework-directives",
  evaluate: ({ filePath, content, lines }): FileEvaluatorResult[] => {
    if (!isScriptFile(filePath)) return [];

    const patch = isPatchContent(content);
    const results: FileEvaluatorResult[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (patch && isDiffMetaOrRemovedLine(lines[i]!)) continue;
      const match = lines[i]!.match(DIRECTIVE_LINE_RE);
      if (!match) continue;

      results.push({
        ruleId: "no-framework-directives",
        passed: false,
        message: `Remove the \`'use ${match[1]}'\` directive — it is a Next.js / React Server Components marker with no effect in a Vite app and indicates a copied Next.js pattern.`,
        line: i + 1,
        column: 1,
        severity: "WARNING",
        suggestion:
          "Delete the directive. Vite apps render on the client by default; there is no server/client component boundary to declare.",
      });
    }

    return results;
  },
};
