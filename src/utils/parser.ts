/**
 * Parsing utilities for AI responses
 */

import type { AuditIssue, AuditResult } from "../types/index.js";

// ── Category validation ─────────────────────────────────────────────────

const VALID_CATEGORIES: ReadonlySet<string> = new Set([
  "security",
  "runtime-crash",
  "architecture",
  "dependency-version",
  "test-gap",
  "performance",
  "maintainability",
]);

// ── Normalization ──────────────────────────────────────────────────────

const normalizeAuditResult = (value: AuditResult): AuditResult => {
  const status = value.status;
  if (!status || !["PASS", "FAIL", "ERROR"].includes(status)) {
    return {
      status: "ERROR",
      message: "Invalid AI response format",
      issues: [],
    };
  }

  if (!value.issues || !Array.isArray(value.issues)) {
    return { ...value, issues: [] };
  }

  const normalizedIssues = value.issues
    .filter((issue) => issue && typeof issue.message === "string")
    .map((issue): AuditIssue => {
      const normalized: AuditIssue = {
        line: typeof issue.line === "number" && issue.line > 0 ? issue.line : 1,
        severity:
          issue.severity === "CRITICAL" || issue.severity === "WARNING" || issue.severity === "INFO"
            ? issue.severity
            : "WARNING",
        message: issue.message,
      };

      // Preserve optional metadata fields when present
      // Only accept category values from the valid rubric
      if (typeof issue.category === "string" && VALID_CATEGORIES.has(issue.category)) {
        normalized.category = issue.category;
      }
      if (
        issue.confidence === "low" ||
        issue.confidence === "medium" ||
        issue.confidence === "high"
      ) {
        normalized.confidence = issue.confidence;
      }
      if (typeof issue.evidence === "string" && issue.evidence.length > 0) {
        normalized.evidence = issue.evidence;
      }
      if (typeof issue.suggestion === "string" && issue.suggestion.length > 0) {
        normalized.suggestion = issue.suggestion;
      }

      return normalized;
    });

  // Normalize: PASS with actionable issues (CRITICAL/WARNING) → FAIL
  // INFO-only stays PASS; ERROR and FAIL are preserved as-is
  if (
    value.status === "PASS" &&
    normalizedIssues.some((i) => i.severity === "CRITICAL" || i.severity === "WARNING")
  ) {
    return { ...value, issues: normalizedIssues, status: "FAIL" };
  }

  return { ...value, issues: normalizedIssues };
};

/**
 * Clean JSON from markdown code blocks
 */
export const cleanJSON = (text: string): string => {
  return text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
};

/**
 * Parse AI response to AuditResult with error handling
 */
export const parseAuditResponse = (responseText: string): AuditResult => {
  const cleaned = cleanJSON(responseText);

  try {
    const parsed = JSON.parse(cleaned) as AuditResult;
    return normalizeAuditResult(parsed);
  } catch {
    // Try to extract JSON from the response
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as AuditResult;
        return normalizeAuditResult(parsed);
      } catch {
        // Fall through to error response
      }
    }

    return {
      status: "ERROR",
      message: "Failed to parse AI response",
      issues: [],
    };
  }
};

/**
 * Format file size for display
 */
export const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

// NOTE: formatDuration is exported from '../utils/logger.js' — use that instead.
