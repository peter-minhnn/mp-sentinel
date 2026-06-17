/**
 * Cross-category same-line collapse.
 *
 * `dedupeFindings` removes exact and same-category near-duplicates. This pass
 * handles the remaining case the field surfaced: two findings of *different*
 * categories at the same line describing the same underlying issue (e.g. a
 * `runtime-crash` and a `maintainability` finding both about the dependency
 * array at line 172). Reported separately they look like two independent bugs.
 *
 * Conservative by construction: only findings at the SAME line whose messages
 * are highly similar (overlap >= 0.5) collapse, keeping the higher-severity
 * (then richer) finding. Distinct problems that merely share a line, or that
 * read differently, are preserved.
 */

import type { AuditIssue, FileAuditResult } from "../types/index.js";

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 3, WARNING: 2, INFO: 1 };

const richness = (issue: AuditIssue): number =>
  (issue.evidence?.length ?? 0) * 2 + issue.message.length + (issue.suggestion?.length ?? 0);

/** Highest severity first, then most informative. */
const byPriority = (a: AuditIssue, b: AuditIssue): number => {
  const sev = (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0);
  return sev !== 0 ? sev : richness(b) - richness(a);
};

const wordSet = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2),
  );

/** Overlap coefficient (shared / smaller set) over message word sets. */
const messageSimilarity = (a: AuditIssue, b: AuditIssue): number => {
  const wa = wordSet(a.message);
  const wb = wordSet(b.message);
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared += 1;
  return shared / Math.min(wa.size, wb.size);
};

const CROSS_CATEGORY_THRESHOLD = 0.5;

export interface CrossCategoryDedupeResult {
  results: FileAuditResult[];
  removed: number;
}

function collapseSameLine(issues: AuditIssue[]): { kept: AuditIssue[]; removed: number } {
  const byLine = new Map<number, AuditIssue[]>();
  for (const issue of issues) {
    const group = byLine.get(issue.line);
    if (group) group.push(issue);
    else byLine.set(issue.line, [issue]);
  }

  let removed = 0;
  const kept: AuditIssue[] = [];
  for (const group of byLine.values()) {
    if (group.length < 2) {
      kept.push(...group);
      continue;
    }
    // Highest-priority finding becomes the representative; similar findings at
    // the same line (any category) are absorbed into it.
    const representatives: AuditIssue[] = [];
    for (const issue of [...group].sort(byPriority)) {
      const absorbed = representatives.some(
        (rep) => messageSimilarity(rep, issue) >= CROSS_CATEGORY_THRESHOLD,
      );
      if (absorbed) removed += 1;
      else representatives.push(issue);
    }
    kept.push(...representatives);
  }
  return { kept, removed };
}

/**
 * Collapse cross-category same-line near-duplicates per file. Status is
 * unaffected: the kept representative is always the highest-severity member, so
 * no FAIL-worthy issue is ever dropped below a kept one.
 */
export function dedupeCrossCategoryFindings(
  results: readonly FileAuditResult[],
): CrossCategoryDedupeResult {
  let removed = 0;
  const deduped = results.map((file): FileAuditResult => {
    const issues = file.result.issues ?? [];
    if (issues.length < 2) return file;
    const { kept, removed: n } = collapseSameLine(issues);
    if (n === 0) return file;
    removed += n;
    return { ...file, result: { ...file.result, issues: kept } };
  });
  return { results: deduped, removed };
}
