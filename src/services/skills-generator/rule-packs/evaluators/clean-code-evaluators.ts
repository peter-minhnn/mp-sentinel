/**
 * Clean-code rule-pack evaluators — deterministic file-level checks
 * for code quality policies (file length, function length, etc.).
 */

import type { FileEvaluator, FileEvaluatorResult } from "../index.js";
import {
  isDiffMetaOrRemovedLine,
  isPatchContent,
  stripDiffMarker,
  stripStringsAndComments,
} from "./text-scan.js";

/**
 * Check that files don't exceed the configured max line limit.
 */
export const fileTooLong: FileEvaluator = {
  ruleId: "file-too-long",
  evaluate: ({ filePath, lines, config }) => {
    const maxLines = (config?.maxFileLines as number) ?? 500;
    if (lines.length <= maxLines) return [];

    return [
      {
        ruleId: "file-too-long",
        passed: false,
        message: `File is ${lines.length} lines (max ${maxLines}). Consider splitting into smaller modules.`,
        line: maxLines + 1,
        column: 0,
        severity: "WARNING",
        suggestion: `Refactor this file to stay under ${maxLines} lines. Extract helper functions or types into separate modules.`,
      },
    ];
  },
};

/**
 * Check for functions that exceed the configured max function length.
 */
export const functionTooLong: FileEvaluator = {
  ruleId: "function-too-long",
  evaluate: ({ filePath, lines, config }) => {
    const maxFunctionLines = (config?.maxFunctionLines as number) ?? 80;
    const results: Array<{
      ruleId: string;
      passed: boolean;
      message: string;
      line: number;
      column: number;
      severity: "CRITICAL" | "WARNING" | "INFO";
      suggestion: string;
    }> = [];

    // Simple heuristic: find function-like patterns and count lines until matching }
    const funcStartRe =
      /(?:export\s+)?(?:async\s+)?function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?(?:\([^)]*\)|[^=])\s*=>|(?:class\s+\w+)/g;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (!funcStartRe.test(line)) continue;

      // Check if this looks like a function body (has { or =>)
      const trimmed = line.trim();
      if (!trimmed.includes("{") && !trimmed.includes("=>")) continue;

      // Count lines until the matching closing brace (basic approach)
      const startLine = i;
      let braceDepth = 0;
      let endLine = -1;
      let started = false;

      for (let j = startLine; j < lines.length; j++) {
        const l = lines[j]!;
        for (const ch of l) {
          if (ch === "{") {
            braceDepth++;
            started = true;
          } else if (ch === "}") {
            braceDepth--;
            if (started && braceDepth <= 0) {
              endLine = j;
              break;
            }
          }
        }
        if (endLine >= 0) break;
      }

      if (endLine >= 0) {
        const funcLines = endLine - startLine + 1;
        if (funcLines > maxFunctionLines) {
          results.push({
            ruleId: "function-too-long",
            passed: false,
            message: `Function starting at line ${startLine + 1} is ${funcLines} lines (max ${maxFunctionLines}).`,
            line: startLine + 1,
            column: 0,
            severity: "WARNING",
            suggestion: `Extract helper functions to reduce this function's body to ${maxFunctionLines} lines or fewer.`,
          });
        }
      }
    }

    return results;
  },
};

/** Files whose `catch (e) { … }` syntax this check understands. */
const JS_TS_FILE_RE = /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/;

/** A `catch` that opens a block: `catch {`, `catch (e) {`, etc. */
const CATCH_OPEN_RE = /\bcatch\b\s*(?:\([^)]*\))?\s*\{/;

/**
 * Flag empty `catch` blocks — bodies that contain no statements (truly empty or
 * comment-only). Swallowing errors silently hides failures and is a recurring
 * source of undebuggable bugs. An `eslint-disable` inside the body opts out.
 */
export const emptyCatch: FileEvaluator = {
  ruleId: "no-empty-catch",
  evaluate: ({ filePath, content, lines }): FileEvaluatorResult[] => {
    if (!JS_TS_FILE_RE.test(filePath)) return [];

    const patch = isPatchContent(content);
    const results: FileEvaluatorResult[] = [];

    for (let i = 0; i < lines.length; i++) {
      if (patch && isDiffMetaOrRemovedLine(lines[i]!)) continue;

      const code = stripStringsAndComments(stripDiffMarker(lines[i]!, patch));
      const match = CATCH_OPEN_RE.exec(code);
      if (!match) continue;

      const afterBrace = code.slice(match.index + match[0].length).trim();

      // Body present on the same line: empty only when it immediately closes.
      if (afterBrace.length > 0) {
        if (afterBrace.startsWith("}")) results.push(makeEmptyCatchFinding(i, match.index));
        continue;
      }

      // Body continues on following lines: skip blank/comment-only lines until
      // the first statement or the closing brace.
      let bodyEmpty = true;
      let suppressed = false;
      for (let j = i + 1; j < lines.length; j++) {
        if (patch && isDiffMetaOrRemovedLine(lines[j]!)) continue;
        const raw = stripDiffMarker(lines[j]!, patch);
        if (raw.includes("eslint-disable")) suppressed = true;
        const stripped = stripStringsAndComments(raw).trim();
        if (stripped.length === 0) continue; // blank or comment-only
        if (!stripped.startsWith("}")) bodyEmpty = false; // a real statement
        break;
      }

      if (bodyEmpty && !suppressed) results.push(makeEmptyCatchFinding(i, match.index));
    }

    return results;
  },
};

function makeEmptyCatchFinding(lineIndex: number, column: number): FileEvaluatorResult {
  return {
    ruleId: "no-empty-catch",
    passed: false,
    message:
      "Empty `catch` block silently swallows the error. At minimum log it; ideally handle the specific failure or rethrow.",
    line: lineIndex + 1,
    column: column + 1,
    severity: "WARNING",
    suggestion:
      "Log the caught error (`console.error` / structured logger) or handle/rethrow it. If it is genuinely safe to ignore, add an `// eslint-disable-next-line` with a comment explaining why.",
  };
}
