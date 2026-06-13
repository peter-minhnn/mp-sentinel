/**
 * Tailwind CSS rule-pack evaluators — deterministic checks for Tailwind v4
 * conventions.
 *
 * `canonical-classes` mirrors the Tailwind IntelliSense `suggestCanonicalClasses`
 * hint: in v4, utilities whose theme scale accepts bare numeric values no
 * longer need arbitrary-value brackets — `z-[9999]` is canonically `z-9999`.
 * Only an allowlist of integer-bare-value utilities is rewritten, so
 * `w-[123px]` (unit required) and `opacity-[0.71]` (fraction) are never
 * touched. Version-gated to tailwindcss >= 4 via the rule pack.
 */

import type { FileEvaluator, FileEvaluatorResult } from "../index.js";
import { isDiffMetaOrRemovedLine, isEslintSuppressed, isPatchContent } from "./text-scan.js";

/**
 * Utilities that accept bare integer values in Tailwind v4. Conservative:
 * every entry maps `<utility>-[<int>]` to an equivalent `<utility>-<int>`.
 */
const BARE_VALUE_UTILITIES = [
  "z",
  "order",
  "opacity",
  "columns",
  "line-clamp",
  "grid-cols",
  "grid-rows",
  "col-span",
  "row-span",
  "col-start",
  "col-end",
  "row-start",
  "row-end",
] as const;

const CANONICAL_RE = new RegExp(`(-?)\\b(${BARE_VALUE_UTILITIES.join("|")})-\\[(\\d+)\\]`, "g");

function isMarkupSourceFile(filePath: string): boolean {
  return /\.(tsx|jsx|html|vue|svelte|astro)$/.test(filePath);
}

/**
 * Suggest canonical Tailwind v4 classes for bracketed integer arbitrary
 * values on bare-value utilities (e.g. `z-[9999]` → `z-9999`).
 */
export const canonicalClasses: FileEvaluator = {
  ruleId: "canonical-classes",
  requires: [{ dep: "tailwindcss", minMajor: 4 }],
  evaluate: ({ filePath, content, lines }): FileEvaluatorResult[] => {
    if (!isMarkupSourceFile(filePath)) return [];

    const patch = isPatchContent(content);
    const results: FileEvaluatorResult[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (patch && isDiffMetaOrRemovedLine(line)) continue;
      if (isEslintSuppressed(lines, i)) continue;

      CANONICAL_RE.lastIndex = 0;
      const replacements: string[] = [];
      let match: RegExpExecArray | null;
      let firstColumn = -1;
      while ((match = CANONICAL_RE.exec(line)) !== null) {
        if (firstColumn < 0) firstColumn = match.index;
        replacements.push(`\`${match[0]}\` → \`${match[1]}${match[2]}-${match[3]}\``);
      }
      if (replacements.length === 0) continue;

      results.push({
        ruleId: "canonical-classes",
        passed: false,
        message: `Tailwind v4 supports bare values here — write the canonical class: ${replacements.join(", ")}.`,
        line: i + 1,
        column: firstColumn + 1,
        severity: "INFO",
        suggestion:
          "Arbitrary-value brackets are only needed for values outside the theme scale (units, CSS functions). Bare integers on these utilities are canonical in v4 and play better with class sorting and IntelliSense.",
      });
    }
    return results;
  },
};
