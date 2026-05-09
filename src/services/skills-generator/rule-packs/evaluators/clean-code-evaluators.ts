/**
 * Clean-code rule-pack evaluators — deterministic file-level checks
 * for code quality policies (file length, function length, etc.).
 */

import type { FileEvaluator } from "../index.js";

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
