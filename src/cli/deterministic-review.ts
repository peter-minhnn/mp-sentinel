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

import type { FileAuditResult, AuditIssue } from "../types/index.js";
import { analyzeDiffs, mergeFindings } from "../services/risk-analyzer/index.js";
import { evaluateChangedFiles } from "../services/skills-generator/rule-packs/evaluator.js";
import type { RulePackContext } from "../services/skills-generator/rule-packs/index.js";

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

/**
 * Run rule-pack evaluators against sanitized files and convert findings
 * to FileAuditResult format that the review pipeline consumes.
 *
 * This can be called from the review pipeline AFTER `runDeterministicReview`
 * to merge rule-pack findings with AI and deterministic findings.
 *
 * @param sanitizedFiles - The same sanitized files passed to runDeterministicReview
 * @param severityOverrides - Optional severity overrides from config
 * @returns FileAuditResult[] with rule-pack findings, or empty if none
 */
export function runRulePackEvaluators(
  sanitizedFiles: Array<{ path: string; content: string }>,
  severityOverrides?: Record<string, "CRITICAL" | "WARNING" | "INFO">,
): FileAuditResult[] {
  // Build a broad RulePackContext — include all languages detected in the files
  // so language-specific evaluators activate. Individual evaluators check file
  // extensions internally, so we err on the side of including everything.
  const langDist: Record<string, number> = {};
  for (const f of sanitizedFiles) {
    const ext = f.path.split(".").pop()?.toLowerCase() ?? "ts";
    // Map extensions to language names
    const lang =
      ext === "svelte"
        ? "svelte"
        : ext === "vue"
          ? "vue"
          : ext === "py"
            ? "python"
            : ext === "go"
              ? "go"
              : ext === "rs"
                ? "rust"
                : ["ts", "tsx"].includes(ext)
                  ? "typescript"
                  : "other";
    langDist[lang] = (langDist[lang] ?? 0) + 1;
  }

  const ctx: RulePackContext = {
    langProfile: {
      dominant: Object.entries(langDist).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown",
      secondary: [],
      distribution: langDist,
      indexableShare: 0.5,
      nonIndexableHotspots: [],
    },
    frameworks: [],
    deps: {},
  };

  const files = new Map(sanitizedFiles.map((f) => [f.path, f.content]));
  const findings = evaluateChangedFiles(ctx, {
    files,
    severityOverrides,
  });

  if (findings.length === 0) return [];

  // Group findings by file path
  const byFile = new Map<string, AuditIssue[]>();
  for (const f of findings) {
    const existing = byFile.get(f.filePath) ?? [];
    existing.push(f.issue);
    byFile.set(f.filePath, existing);
  }

  const results: FileAuditResult[] = [];
  for (const [filePath, issues] of byFile) {
    const hasCritical = issues.some((i) => i.severity === "CRITICAL");
    results.push({
      filePath,
      duration: 0,
      result: {
        status: hasCritical ? "FAIL" : "FAIL",
        issues,
        message: `${issues.length} rule-pack violation(s)`,
      },
    });
  }

  return results;
}

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
