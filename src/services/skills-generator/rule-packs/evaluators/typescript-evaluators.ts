/**
 * TypeScript rule-pack evaluators — deterministic file checks for strict
 * TypeScript conventions.
 *
 * `no-any` flags explicit `any` type usage, which silently disables type
 * checking. The scan is line-based and high-precision: it only matches `any`
 * in clear type positions, ignores string/comment text, and respects
 * `eslint-disable` opt-outs.
 */

import type { FileEvaluator, FileEvaluatorResult } from "../index.js";
import {
  isDiffMetaOrRemovedLine,
  isEslintSuppressed,
  isPatchContent,
  stripStringsAndComments,
} from "./text-scan.js";

/**
 * Patterns that indicate `any` used as a type. Each is anchored so it only
 * fires when `any` sits in a type position, not as part of a longer
 * identifier (e.g. `Company`, `many`, `anyOf`).
 */
const ANY_TYPE_PATTERNS: readonly RegExp[] = [
  /:\s*any\b/, // annotation: `x: any`, `): any`
  /\bas\s+any\b/, // assertion: `x as any`
  /<\s*any\s*>/, // single generic arg: `Array<any>`, `<any>`
  /\bany\s*\[\s*\]/, // array form: `any[]`
  /<\s*any\s*,/, // first generic arg: `Map<any, V>`
  /,\s*any\s*>/, // last generic arg: `Record<string, any>`
  /,\s*any\s*,/, // middle generic arg
];

const ANY_MESSAGE =
  "Avoid the `any` type — it disables type checking for that value. Use `unknown` with narrowing, a generic parameter, or a specific type.";

const ANY_SUGGESTION =
  "Replace `any` with `unknown` and narrow via a type guard, or declare a precise type. If a third-party type is genuinely untyped, isolate it behind a typed wrapper or an `// eslint-disable-next-line` with a comment explaining why.";

function isCheckableTsFile(filePath: string): boolean {
  if (filePath.endsWith(".d.ts")) return false; // declaration files legitimately use `any`
  return /\.(ts|tsx|mts|cts)$/.test(filePath);
}

/**
 * Flag explicit `any` type usage in TypeScript source files.
 */
export const noAny: FileEvaluator = {
  ruleId: "no-any",
  evaluate: ({ filePath, content, lines }): FileEvaluatorResult[] => {
    if (!isCheckableTsFile(filePath)) return [];

    const patch = isPatchContent(content);
    const results: FileEvaluatorResult[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (patch && isDiffMetaOrRemovedLine(lines[i]!)) continue;
      if (isEslintSuppressed(lines, i)) continue;

      const code = stripStringsAndComments(lines[i]!);
      if (!ANY_TYPE_PATTERNS.some((re) => re.test(code))) continue;

      const anyCol = code.search(/\bany\b/);
      results.push({
        ruleId: "no-any",
        passed: false,
        message: ANY_MESSAGE,
        line: i + 1,
        column: (anyCol >= 0 ? anyCol : 0) + 1,
        severity: "WARNING",
        suggestion: ANY_SUGGESTION,
      });
    }

    return results;
  },
};

/** Matches double type casts: `as unknown as` and `as any as`. */
const DOUBLE_CAST_RE = /\bas\s+(?:unknown|any)\s+as\b/;

const DOUBLE_CAST_MESSAGE =
  "Avoid double type casts (`as unknown as …` / `as any as …`) — they completely bypass type checking and hide real type mismatches.";

const DOUBLE_CAST_SUGGESTION =
  "Fix the value's type at its source (function return type, generic parameter, or a validated schema), or narrow at runtime with a type guard instead of force-casting through `unknown`/`any`.";

/**
 * Flag double type casts that launder a value through `unknown`/`any`.
 */
export const noDoubleCast: FileEvaluator = {
  ruleId: "no-double-cast",
  evaluate: ({ filePath, content, lines }): FileEvaluatorResult[] => {
    if (!isCheckableTsFile(filePath)) return [];

    const patch = isPatchContent(content);
    const results: FileEvaluatorResult[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (patch && isDiffMetaOrRemovedLine(lines[i]!)) continue;
      if (isEslintSuppressed(lines, i)) continue;

      const code = stripStringsAndComments(lines[i]!);
      const col = code.search(DOUBLE_CAST_RE);
      if (col < 0) continue;

      results.push({
        ruleId: "no-double-cast",
        passed: false,
        message: DOUBLE_CAST_MESSAGE,
        line: i + 1,
        column: col + 1,
        severity: "WARNING",
        suggestion: DOUBLE_CAST_SUGGESTION,
      });
    }

    return results;
  },
};
