/**
 * Rule-pack evaluator engine — runs deterministic file-level checks
 * against changed files and produces review findings.
 *
 * Each active rule pack may supply `evaluators` (FileEvaluator[]).
 * This module collects them, runs them against the changed files, and
 * returns findings in the same shape as the AI review pipeline.
 *
 * No AI calls — purely deterministic.
 */

import type { AuditIssue } from "../../../types/index.js";
import { ALL_PACKS } from "./index.js";
import type { FileEvaluator, RulePack, RulePackContext } from "./index.js";

export { ALL_PACKS } from "./index.js";
export type { FileEvaluator, RulePack, RulePackContext } from "./index.js";

// ── Config ──────────────────────────────────────────────────────────────────

export interface EvaluateChangedFilesOptions {
  /** Severity overrides: ruleId -> severity */
  severityOverrides?: Record<string, "CRITICAL" | "WARNING" | "INFO"> | undefined;
  /** File content mapping: filePath -> content */
  files: Map<string, string>;
}

export interface EvaluatorFinding {
  filePath: string;
  ruleId: string;
  issue: AuditIssue;
}

/**
 * Collect all evaluators from ALL built-in rule packs (not filtered by context).
 * Filtering by active packs happens in evaluateChangedFiles.
 */
function getAllEvaluators(): FileEvaluator[] {
  const evaluators: FileEvaluator[] = [];
  for (const pack of ALL_PACKS) {
    if (pack.evaluators) {
      evaluators.push(...pack.evaluators);
    }
  }
  return evaluators;
}

/**
 * Run all rule-pack evaluators against the given changed files.
 * Only evaluators from packs whose `when()` predicate matches the context are run.
 *
 * @param ctx - RulePackContext for selecting active packs
 * @param options - Files to check + severity overrides
 * @returns Array of findings, one per violation
 */
export function evaluateChangedFiles(
  ctx: RulePackContext,
  options: EvaluateChangedFilesOptions,
): EvaluatorFinding[] {
  const findings: EvaluatorFinding[] = [];
  const { files, severityOverrides } = options;

  // Select active packs
  const activePackIds = new Set(
    ALL_PACKS.filter((p: RulePack) => p.when(ctx)).map((p: RulePack) => p.id),
  );

  // Run evaluators from active packs only
  for (const pack of ALL_PACKS) {
    if (!activePackIds.has(pack.id)) continue;
    if (!pack.evaluators || pack.evaluators.length === 0) continue;

    for (const evaluator of pack.evaluators) {
      // For each file that matches the evaluator, run it
      for (const [filePath, content] of files) {
        const lines = content.split("\n");
        const results = evaluator.evaluate({ filePath, content, lines });

        for (const result of results) {
          if (result.passed) continue;

          const fullRuleId = `${pack.id}/${evaluator.ruleId}`;
          const severity = severityOverrides?.[fullRuleId] ?? result.severity;

          const issue: {
            line: number;
            severity: "CRITICAL" | "WARNING" | "INFO";
            message: string;
            suggestion?: string;
            category: string;
            confidence: "high";
          } = {
            line: result.line,
            severity,
            message: result.message,
            category: "maintainability",
            confidence: "high",
          };
          if (result.suggestion !== undefined) {
            issue.suggestion = result.suggestion;
          }
          findings.push({ filePath, ruleId: fullRuleId, issue });
        }
      }
    }
  }

  return findings;
}
