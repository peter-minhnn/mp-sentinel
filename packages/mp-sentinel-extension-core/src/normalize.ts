/**
 * Normalizes a {@link ReviewReport} into a flat, editor-agnostic finding list.
 *
 * The VS Code adapter (or any future adapter) maps {@link NormalizedFinding}
 * into its own diagnostic type. Keeping this mapping here means severity rules
 * and filtering live in one tested place, not in UI code.
 */

import type { ReviewReport, Severity } from "./types.js";

export interface NormalizedFinding {
  filePath: string;
  /** 1-based line number as emitted by the CLI. */
  line: number;
  severity: Severity;
  message: string;
  suggestion?: string;
  category?: string;
  confidence?: "low" | "medium" | "high";
  evidence?: string;
  codeSuggestion?: string;
  /** True when this file's audit was served from cache. */
  cached?: boolean;
}

export interface NormalizeOptions {
  /**
   * Include findings the CLI marked `resolution: "resolved-at-head"`
   * (already fixed by a later commit). Default false.
   */
  includeResolved?: boolean;
  /**
   * Include findings the CLI marked `resolution: "unverified"`
   * (evidence not found in tree or history). Default false.
   */
  includeUnverified?: boolean;
}

/** Flattens all per-file issues into a single list, applying resolution filters. */
export function normalizeFindings(
  report: ReviewReport,
  options: NormalizeOptions = {},
): NormalizedFinding[] {
  const { includeResolved = false, includeUnverified = false } = options;
  const out: NormalizedFinding[] = [];

  for (const file of report.results) {
    const issues = file.result.issues ?? [];
    for (const issue of issues) {
      if (issue.resolution === "resolved-at-head" && !includeResolved) continue;
      if (issue.resolution === "unverified" && !includeUnverified) continue;

      const finding: NormalizedFinding = {
        filePath: file.filePath,
        line: issue.line,
        severity: issue.severity,
        message: issue.message,
      };
      if (issue.suggestion !== undefined) finding.suggestion = issue.suggestion;
      if (issue.category !== undefined) finding.category = issue.category;
      if (issue.confidence !== undefined) finding.confidence = issue.confidence;
      if (issue.evidence !== undefined) finding.evidence = issue.evidence;
      if (issue.codeSuggestion !== undefined) finding.codeSuggestion = issue.codeSuggestion;
      if (file.cached !== undefined) finding.cached = file.cached;
      out.push(finding);
    }
  }

  return out;
}

/** Groups findings by file path, preserving insertion order within each file. */
export function groupFindingsByFile(
  findings: readonly NormalizedFinding[],
): Map<string, NormalizedFinding[]> {
  const map = new Map<string, NormalizedFinding[]>();
  for (const finding of findings) {
    const list = map.get(finding.filePath);
    if (list) {
      list.push(finding);
    } else {
      map.set(finding.filePath, [finding]);
    }
  }
  return map;
}

/** A compact, human-readable one-liner for a status bar / notification. */
export function summarizeReport(report: ReviewReport): string {
  const s = report.summary;
  return (
    `${report.status} — ${s.criticalIssues} critical, ${s.warningIssues} warning, ` +
    `${s.infoIssues} info across ${s.auditedFiles}/${s.totalFiles} files`
  );
}
