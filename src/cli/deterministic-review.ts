/**
 * Deterministic non-AI review helper.
 *
 * Combines secret-redaction base results with risk-analyzer
 * findings (eval, dangerouslySetInnerHTML, SQL concat, execSync, etc.) to
 * produce a consistent fallback when AI is unavailable.
 *
 * When AI results are provided, merges deterministic findings into them so
 * that CRITICAL/WARNING findings are never silently dropped.
 */

import type { FileAuditResult } from "../types/index.js";
import { analyzeDiffs, mergeFindings } from "../services/risk-analyzer/index.js";

export const createSecurityOnlyResults = (
  files: Array<{ path: string; content: string }>,
  redactionReport: Array<{
    path: string;
    redactedCount: number;
    matchedPatterns: string[];
  }>,
): FileAuditResult[] => {
  const redactedMap = new Map(redactionReport.map((entry) => [entry.path, entry]));

  return files.map((file) => {
    const redaction = redactedMap.get(file.path);
    if (!redaction) {
      return {
        filePath: file.path,
        duration: 0,
        result: {
          status: "PASS",
          issues: [],
          message: "AI disabled",
        },
      };
    }

    return {
      filePath: file.path,
      duration: 0,
      result: {
        status: "FAIL",
        issues: [
          {
            line: 1,
            severity: "CRITICAL",
            message: `Potential secret detected (${redaction.redactedCount} redaction(s))`,
            suggestion:
              "Remove secrets from the diff and use environment variables or secret managers.",
          },
        ],
        message: `Matched patterns: ${redaction.matchedPatterns.join(", ")}`,
      },
    };
  });
};

export const runDeterministicReview = (
  sanitizedFiles: Array<{ path: string; content: string }>,
  redactionReport: Array<{
    path: string;
    redactedCount: number;
    matchedPatterns: string[];
  }>,
  aiResults?: FileAuditResult[],
): FileAuditResult[] => {
  const riskResult = analyzeDiffs(sanitizedFiles);
  const redactedPaths = new Set(redactionReport.map((r) => r.path));

  const baseResults = aiResults ?? createSecurityOnlyResults(sanitizedFiles, redactionReport);

  if (
    riskResult.totalCritical > 0 ||
    riskResult.totalWarning > 0 ||
    riskResult.totalInfo > 0 ||
    redactedPaths.size > 0
  ) {
    return mergeFindings(riskResult, baseResults, redactedPaths);
  }

  return baseResults;
};
