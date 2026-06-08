/**
 * React rule-pack evaluators — deterministic file checks for React/JSX
 * conventions.
 *
 * `no-inline-style` flags JSX inline `style={{ ... }}` object literals. These
 * bypass the design system / CSS layer and allocate a fresh object on every
 * render. An object *reference* (`style={styles.row}`) is intentionally NOT
 * flagged — only the double-brace literal form is.
 *
 * `exhaustive-deps-suppressed` flags `eslint-disable … react-hooks/exhaustive-deps`
 * comments, which hide missing hook dependencies and are a leading cause of
 * stale-closure / stale-state bugs.
 */

import type { FileEvaluator, FileEvaluatorResult } from "../index.js";
import {
  isDiffMetaOrRemovedLine,
  isEslintSuppressed,
  isPatchContent,
  stripStringsAndComments,
} from "./text-scan.js";

/** Matches JSX inline style object literals: `style={{`, `style = { {`, etc. */
const INLINE_STYLE_RE = /style\s*=\s*\{\s*\{/;

const INLINE_STYLE_MESSAGE =
  "Avoid inline `style={{ }}` object literals — they bypass the styling layer and re-allocate on every render. Use a CSS Module or utility classes.";

const INLINE_STYLE_SUGGESTION =
  "Move these styles into a co-located `*.module.css` file or utility classes. For genuinely dynamic values, drive a class name or a CSS custom property instead of an inline literal.";

function isJsxFile(filePath: string): boolean {
  return /\.(tsx|jsx)$/.test(filePath);
}

/**
 * Flag JSX inline `style={{ ... }}` object literals in React component files.
 */
export const noInlineStyle: FileEvaluator = {
  ruleId: "no-inline-style",
  evaluate: ({ filePath, content, lines }): FileEvaluatorResult[] => {
    if (!isJsxFile(filePath)) return [];

    const patch = isPatchContent(content);
    const results: FileEvaluatorResult[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (patch && isDiffMetaOrRemovedLine(lines[i]!)) continue;
      if (isEslintSuppressed(lines, i)) continue;

      const code = stripStringsAndComments(lines[i]!);
      const col = code.search(INLINE_STYLE_RE);
      if (col < 0) continue;

      results.push({
        ruleId: "no-inline-style",
        passed: false,
        message: INLINE_STYLE_MESSAGE,
        line: i + 1,
        column: col + 1,
        severity: "WARNING",
        suggestion: INLINE_STYLE_SUGGESTION,
      });
    }

    return results;
  },
};

/** Matches an eslint-disable comment that silences react-hooks/exhaustive-deps. */
const EXHAUSTIVE_DEPS_RE = /eslint-disable(?:-next-line|-line)?[^\n]*react-hooks\/exhaustive-deps/;

function isReactSourceFile(filePath: string): boolean {
  return /\.(tsx|jsx|ts)$/.test(filePath);
}

/**
 * Flag suppression of `react-hooks/exhaustive-deps`. Unlike other evaluators
 * this targets the disable comment itself, so it intentionally does NOT honor
 * eslint-disable as an opt-out.
 */
export const exhaustiveDepsSuppressed: FileEvaluator = {
  ruleId: "exhaustive-deps-suppressed",
  evaluate: ({ filePath, content, lines }): FileEvaluatorResult[] => {
    if (!isReactSourceFile(filePath)) return [];

    const patch = isPatchContent(content);
    const results: FileEvaluatorResult[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (patch && isDiffMetaOrRemovedLine(lines[i]!)) continue;
      const col = lines[i]!.search(EXHAUSTIVE_DEPS_RE);
      if (col < 0) continue;

      results.push({
        ruleId: "exhaustive-deps-suppressed",
        passed: false,
        message:
          "Suppressing `react-hooks/exhaustive-deps` hides a missing hook dependency — a leading cause of stale-closure / stale-state bugs.",
        line: i + 1,
        column: col + 1,
        severity: "WARNING",
        suggestion:
          "Add the missing dependency to the array, or restructure with `useCallback` / `useRef` / a functional state update so the dependency is genuinely unnecessary — rather than disabling the rule.",
      });
    }

    return results;
  },
};
