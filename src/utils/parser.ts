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
  "refactor",
]);

/**
 * Collapse a model-authored prose field to a single line. Models routinely
 * emit multi-line messages/suggestions (markdown bullets, code blocks, blank
 * lines); printed raw they shred the console report — stray blank regions,
 * orphaned detail lines. Newlines and runs of whitespace become single
 * spaces. Code formatting belongs in `codeSuggestion`, which has its own
 * stricter sanitizer.
 */
const collapseProse = (value: string): string => value.replace(/\s+/g, " ").trim();

// ── Code suggestion sanitization ───────────────────────────────────────

/** Max length of a structured code suggestion accepted from the model. */
const CODE_SUGGESTION_MAX_LENGTH = 400;

/**
 * Accept a model-provided `codeSuggestion` only when it is a plausible
 * single-line code replacement (v1 scope): non-empty, single line, bounded in
 * size, and free of nested code fences (which would break a rendered
 * ```suggestion``` block). Returns the trimmed suggestion or undefined when it
 * should be dropped. Multi-line / range suggestions are out of scope for now.
 */
const sanitizeParsedCodeSuggestion = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.replace(/\s+$/, "");
  if (trimmed.trim().length === 0) return undefined;
  // v1: single-line replacements only.
  if (trimmed.includes("\n")) return undefined;
  if (trimmed.length > CODE_SUGGESTION_MAX_LENGTH) return undefined;
  // Nested triple-backtick fences cannot be embedded in a suggestion block.
  if (trimmed.includes("```")) return undefined;
  return trimmed;
};

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
        message: collapseProse(issue.message),
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
      if (typeof issue.suggestion === "string" && collapseProse(issue.suggestion).length > 0) {
        normalized.suggestion = collapseProse(issue.suggestion);
      }
      const codeSuggestion = sanitizeParsedCodeSuggestion(issue.codeSuggestion);
      if (codeSuggestion !== undefined) {
        normalized.codeSuggestion = codeSuggestion;
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

// ── Tolerant JSON recovery ─────────────────────────────────────────────────
//
// Real models occasionally emit JSON that `JSON.parse` rejects: trailing
// commas, prose around the object, or — most damagingly — a response truncated
// by the output-token limit (common for large files with many findings). The
// old parser returned status "ERROR" for all of these, which DROPS the file
// from the review entirely. The recovery layers below salvage as much as
// possible so a file still gets the findings the model did produce.

/** Attempt a strict parse, returning null instead of throwing. */
const tryParse = (text: string): AuditResult | null => {
  try {
    return JSON.parse(text) as AuditResult;
  } catch {
    return null;
  }
};

/** Remove trailing commas before a closing `}` or `]` (a frequent LLM slip). */
const stripTrailingCommas = (text: string): string => text.replace(/,(\s*[}\]])/g, "$1");

/**
 * Index of the structural character that closes the JSON value starting at
 * `start` (`{` or `[`), honoring string literals and escapes. Returns -1 when
 * the value is never closed (e.g. a truncated response).
 */
const matchBalanced = (text: string, start: number): number => {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
};

/** Extract the first complete balanced `{…}` object substring, or null. */
const extractFirstBalancedObject = (text: string): string | null => {
  const start = text.indexOf("{");
  if (start < 0) return null;
  const end = matchBalanced(text, start);
  return end < 0 ? null : text.slice(start, end + 1);
};

/** Recover a `PASS`/`FAIL` status hint from a partial response. */
const extractStatusHint = (text: string): "PASS" | "FAIL" | undefined => {
  const match = text.match(/"status"\s*:\s*"(PASS|FAIL)"/);
  return match ? (match[1] as "PASS" | "FAIL") : undefined;
};

/**
 * Salvage complete issue objects from the `"issues"` array of a partial or
 * truncated response. Walks the array element-by-element and stops at the first
 * incomplete object, keeping everything parsed so far.
 */
const salvageIssues = (text: string): AuditIssue[] => {
  const keyIdx = text.indexOf('"issues"');
  if (keyIdx < 0) return [];
  const arrayStart = text.indexOf("[", keyIdx);
  if (arrayStart < 0) return [];

  const issues: AuditIssue[] = [];
  let i = arrayStart + 1;
  while (i < text.length) {
    while (i < text.length && /[\s,]/.test(text[i]!)) i++;
    if (i >= text.length || text[i] === "]") break;
    if (text[i] !== "{") break;

    const end = matchBalanced(text, i);
    if (end < 0) break; // truncated trailing object — keep what we have
    const objStr = text.slice(i, end + 1);
    const parsed = tryParse(objStr) ?? tryParse(stripTrailingCommas(objStr));
    if (!parsed || typeof (parsed as unknown as AuditIssue).message !== "string") break;
    issues.push(parsed as unknown as AuditIssue);
    i = end + 1;
  }
  return issues;
};

/**
 * Parse AI response to AuditResult with layered, tolerant error recovery.
 *
 * Order: strict parse → trailing-comma repair → first balanced object →
 * salvage `issues[]` from a truncated response → ERROR. Genuine non-JSON
 * (no object, no salvageable issues) still resolves to status "ERROR".
 */
export const parseAuditResponse = (responseText: string): AuditResult => {
  const cleaned = cleanJSON(responseText);

  // 1. Strict parse (fast path for well-formed responses).
  const strict = tryParse(cleaned);
  if (strict) return normalizeAuditResult(strict);

  // 2. Repair trailing commas, then parse.
  const repaired = tryParse(stripTrailingCommas(cleaned));
  if (repaired) return normalizeAuditResult(repaired);

  // 3. Extract the first balanced { … } object (handles surrounding prose).
  const objStr = extractFirstBalancedObject(cleaned);
  if (objStr) {
    const obj = tryParse(objStr) ?? tryParse(stripTrailingCommas(objStr));
    if (obj) return normalizeAuditResult(obj);
  }

  // 4. Salvage individual issues from a truncated / partial response.
  const salvaged = salvageIssues(cleaned);
  if (salvaged.length > 0) {
    // Default to PASS and let normalizeAuditResult upgrade to FAIL when the
    // salvaged issues warrant it (any CRITICAL/WARNING).
    const status = extractStatusHint(cleaned) ?? "PASS";
    return normalizeAuditResult({ status, issues: salvaged });
  }

  // 5. Unrecoverable.
  return {
    status: "ERROR",
    message: "Failed to parse AI response",
    issues: [],
  };
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
