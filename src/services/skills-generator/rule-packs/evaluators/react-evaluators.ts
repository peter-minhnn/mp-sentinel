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
  stripDiffMarker,
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

// ── Refactor / re-render evaluators ─────────────────────────────────────────

/**
 * Matches a component declared inside another block: an INDENTED
 * `const Foo = (…) =>` / `function Foo(` with a PascalCase name. A component
 * created during render gets a new identity every render — React unmounts and
 * remounts its entire subtree (state loss + full re-render) on every parent
 * render.
 */
const NESTED_COMPONENT_RE =
  /^[ \t]+(?:export\s+)?(?:const|function)\s+[A-Z][A-Za-z0-9]*\s*(?:=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>|\()/;

function isTestLikeFile(filePath: string): boolean {
  return /\.(test|spec|stories)\.[jt]sx?$/.test(filePath);
}

/**
 * Flag components/render-functions declared inside another component body.
 */
export const componentInsideComponent: FileEvaluator = {
  ruleId: "component-inside-component",
  evaluate: ({ filePath, content, lines }): FileEvaluatorResult[] => {
    if (!isJsxFile(filePath) || isTestLikeFile(filePath)) return [];

    const patch = isPatchContent(content);
    const results: FileEvaluatorResult[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (patch && isDiffMetaOrRemovedLine(lines[i]!)) continue;
      if (isEslintSuppressed(lines, i)) continue;

      const code = stripStringsAndComments(stripDiffMarker(lines[i]!, patch));
      if (!NESTED_COMPONENT_RE.test(code)) continue;

      results.push({
        ruleId: "component-inside-component",
        passed: false,
        message:
          "Component declared inside another component body — it gets a new identity on every parent render, so React remounts its whole subtree (state reset + full re-render) each time.",
        line: i + 1,
        severity: "WARNING",
        suggestion:
          "Move the component to module scope and pass the values it closes over as props. If it must stay local for closure reasons, render its JSX inline or wrap the extraction point in `useCallback`-free module-level code.",
      });
    }
    return results;
  },
};

/** Matches `<Something.Provider value={{ … }}` / `<SomethingProvider value={{`. */
const UNSTABLE_PROVIDER_VALUE_RE = /Provider[^>]*\bvalue\s*=\s*\{\s*\{/;

/**
 * Flag context Provider `value={{ ... }}` object literals — a fresh object
 * identity every render re-renders EVERY consumer of the context.
 */
export const unstableContextValue: FileEvaluator = {
  ruleId: "unstable-context-value",
  evaluate: ({ filePath, content, lines }): FileEvaluatorResult[] => {
    if (!isJsxFile(filePath)) return [];

    const patch = isPatchContent(content);
    const results: FileEvaluatorResult[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (patch && isDiffMetaOrRemovedLine(lines[i]!)) continue;
      if (isEslintSuppressed(lines, i)) continue;

      const code = stripStringsAndComments(stripDiffMarker(lines[i]!, patch));
      const col = code.search(UNSTABLE_PROVIDER_VALUE_RE);
      if (col < 0) continue;

      results.push({
        ruleId: "unstable-context-value",
        passed: false,
        message:
          "Context Provider `value={{ ... }}` creates a new object every render — every consumer of this context re-renders on each parent render, even when the data is unchanged.",
        line: i + 1,
        column: col + 1,
        severity: "WARNING",
        suggestion:
          "Memoize the value: `const ctxValue = useMemo(() => ({ ... }), [deps]);` and pass `value={ctxValue}` — or split the context into separate state/dispatch contexts.",
      });
    }
    return results;
  },
};

const MAX_FUNCTION_LINES = 80;

/** Matches the start of a named function/component declaration. */
const FUNCTION_START_RE =
  /(?:^|\s)(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+[\w$]+\s*\(|(?:^|\s)(?:export\s+)?const\s+[\w$]+(?:\s*:\s*[^=]+)?\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^=]+)?=>\s*\{/;

const countBraces = (code: string): number => {
  let depth = 0;
  for (const ch of code) {
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
  }
  return depth;
};

/**
 * Flag functions/components longer than MAX_FUNCTION_LINES (clean-code limit).
 * Full-file contents only — brace tracking over partial diff hunks would lie.
 * Line-based brace counting is approximate (multi-line template literals can
 * skew it), so the threshold errs high to stay low-noise.
 */
export const longFunction: FileEvaluator = {
  ruleId: "long-function",
  evaluate: ({ filePath, content, lines }): FileEvaluatorResult[] => {
    if (!isReactSourceFile(filePath) || isTestLikeFile(filePath)) return [];
    if (isPatchContent(content)) return [];

    const results: FileEvaluatorResult[] = [];
    const stack: Array<{ startLine: number; entryDepth: number }> = [];
    let depth = 0;

    for (let i = 0; i < lines.length; i++) {
      const code = stripStringsAndComments(lines[i]!);
      if (FUNCTION_START_RE.test(code) && code.includes("{")) {
        stack.push({ startLine: i, entryDepth: depth });
      }
      depth += countBraces(code);

      while (stack.length > 0 && depth <= stack[stack.length - 1]!.entryDepth) {
        const fn = stack.pop()!;
        const length = i - fn.startLine + 1;
        if (length > MAX_FUNCTION_LINES) {
          results.push({
            ruleId: "long-function",
            passed: false,
            message: `Function/component spans ${length} lines (limit ${MAX_FUNCTION_LINES}) — long bodies mix concerns, hide re-render cost, and resist testing.`,
            line: fn.startLine + 1,
            severity: "WARNING",
            suggestion:
              "Split by concern: extract data fetching/derivation into a custom hook, repeated JSX blocks into child components, and pure logic into helpers. Each extracted child also creates a memoization boundary that limits re-renders.",
          });
        }
      }
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
