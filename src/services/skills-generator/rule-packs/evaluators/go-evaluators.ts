/**
 * Go rule-pack evaluators — deterministic, high-confidence checks that anchor
 * the AI review for Go projects.
 *
 *   - discarded-error : `_ = call(...)` throws away a function's only return
 *     value, which in Go is almost always an error that should be handled.
 */

import type { FileEvaluator, FileEvaluatorResult } from "../index.js";
import { isDiffMetaOrRemovedLine, isPatchContent } from "./text-scan.js";

function isGoFile(filePath: string): boolean {
  return filePath.endsWith(".go");
}

/** Go's inline lint suppression marker. */
function isNolint(line: string): boolean {
  return /\/\/\s*nolint/i.test(line);
}

/** `_ = someFunc(...)` / `_ = pkg.Func(...)` — sole return value discarded. */
const DISCARDED_ERROR_RE = /^[+ ]?\s*_\s*=\s*[A-Za-z_][\w.]*\s*\(/;

/**
 * Flag `_ = call(...)` assignments that discard a function's only return value.
 */
export const discardedError: FileEvaluator = {
  ruleId: "discarded-error",
  evaluate: ({ filePath, content, lines }): FileEvaluatorResult[] => {
    if (!isGoFile(filePath)) return [];

    const patch = isPatchContent(content);
    const results: FileEvaluatorResult[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (patch && isDiffMetaOrRemovedLine(line)) continue;
      if (isNolint(line)) continue;
      const col = line.search(DISCARDED_ERROR_RE);
      if (col < 0) continue;

      results.push({
        ruleId: "discarded-error",
        passed: false,
        message:
          "Discarded function result (`_ = call(...)`) — in Go the lone return value is usually an `error` that must be handled.",
        line: i + 1,
        column: col + 1,
        severity: "WARNING",
        suggestion:
          "Capture the result and handle the error (`if err := call(...); err != nil { … }`), or document why it is safe to ignore.",
      });
    }
    return results;
  },
};

export const goEvaluators: FileEvaluator[] = [discardedError];
