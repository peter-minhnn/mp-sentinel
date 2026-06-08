/**
 * Post-merge exact-duplicate removal.
 *
 * `mergeFindings` already drops AI findings that overlap a deterministic finding
 * by category + line. This pass removes the remaining EXACT duplicates within a
 * file — identical message at the same line/severity (e.g. the model repeating
 * itself, or a local + AI finding with verbatim-equal wording). It is
 * deliberately conservative: only findings that are byte-for-byte equivalent
 * (after whitespace/case normalization) are collapsed, so genuinely distinct
 * issues on the same line are always preserved.
 */

import type { AuditIssue, FileAuditResult } from "../types/index.js";

function normalizeMessage(message: string): string {
  return message.toLowerCase().replace(/\s+/g, " ").trim();
}

function issueKey(issue: AuditIssue): string {
  return `${issue.line}|${issue.severity}|${issue.category ?? ""}|${normalizeMessage(issue.message)}`;
}

export interface DedupeResult {
  results: FileAuditResult[];
  removed: number;
}

/**
 * Remove exact-duplicate issues within each file. Status is unaffected because
 * a removed duplicate always leaves an identical-severity issue behind.
 */
export function dedupeFindings(results: readonly FileAuditResult[]): DedupeResult {
  let removed = 0;

  const deduped = results.map((file): FileAuditResult => {
    const issues = file.result.issues ?? [];
    if (issues.length < 2) return file;

    const seen = new Set<string>();
    const kept: AuditIssue[] = [];
    for (const issue of issues) {
      const key = issueKey(issue);
      if (seen.has(key)) {
        removed += 1;
        continue;
      }
      seen.add(key);
      kept.push(issue);
    }

    if (kept.length === issues.length) return file;
    return { ...file, result: { ...file.result, issues: kept } };
  });

  return { results: deduped, removed };
}
