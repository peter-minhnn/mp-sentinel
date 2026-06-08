/**
 * Python rule-pack evaluators — deterministic, high-confidence checks that
 * anchor the AI review for Python projects.
 *
 *   - bare-except         : `except:` swallows every exception (incl. SystemExit)
 *   - mutable-default-arg : `def f(x=[])` shares one mutable default across calls
 *   - debugger-statement  : leftover `breakpoint()` / `pdb.set_trace()` / `import pdb`
 */

import type { FileEvaluator, FileEvaluatorResult } from "../index.js";
import { isDiffMetaOrRemovedLine, isPatchContent } from "./text-scan.js";

function isPythonFile(filePath: string): boolean {
  return /\.(py|pyi)$/.test(filePath);
}

/** Python's inline suppression marker. */
function isNoqa(line: string): boolean {
  return /#\s*noqa/i.test(line);
}

const BARE_EXCEPT_RE = /^[+ ]?\s*except\s*:/;
const MUTABLE_DEFAULT_RE = /def\s+\w+\s*\([^)]*=\s*(?:\[\]|\{\}|list\(\)|dict\(\)|set\(\))/;
const DEBUGGER_RE = /\b(?:breakpoint\s*\(|pdb\s*\.\s*set_trace\s*\(|import\s+pdb\b)/;

interface PyRule {
  ruleId: string;
  re: RegExp;
  message: string;
  suggestion: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
}

const PY_RULES: readonly PyRule[] = [
  {
    ruleId: "bare-except",
    re: BARE_EXCEPT_RE,
    message:
      "Bare `except:` catches everything (including `KeyboardInterrupt` / `SystemExit`) and hides real errors.",
    suggestion:
      "Catch a specific exception type, e.g. `except ValueError:`, or `except Exception:`.",
    severity: "WARNING",
  },
  {
    ruleId: "mutable-default-arg",
    re: MUTABLE_DEFAULT_RE,
    message:
      "Mutable default argument — the same list/dict/set is shared across all calls and accumulates state.",
    suggestion: "Default to `None` and create the container inside the function body.",
    severity: "WARNING",
  },
  {
    ruleId: "debugger-statement",
    re: DEBUGGER_RE,
    message: "Leftover debugger statement — `breakpoint()` / `pdb` must not ship to production.",
    suggestion: "Remove the debugger call/import before committing.",
    severity: "WARNING",
  },
];

function makeEvaluator(rule: PyRule): FileEvaluator {
  return {
    ruleId: rule.ruleId,
    evaluate: ({ filePath, content, lines }): FileEvaluatorResult[] => {
      if (!isPythonFile(filePath)) return [];

      const patch = isPatchContent(content);
      const results: FileEvaluatorResult[] = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (patch && isDiffMetaOrRemovedLine(line)) continue;
        if (isNoqa(line)) continue;
        const col = line.search(rule.re);
        if (col < 0) continue;

        results.push({
          ruleId: rule.ruleId,
          passed: false,
          message: rule.message,
          line: i + 1,
          column: col + 1,
          severity: rule.severity,
          suggestion: rule.suggestion,
        });
      }
      return results;
    },
  };
}

export const pythonEvaluators: FileEvaluator[] = PY_RULES.map(makeEvaluator);
