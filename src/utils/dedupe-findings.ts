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
 * Near-duplicate key: same line, severity, and category — the model often
 * reports the same problem twice at one location with different prose
 * (observed in the field: two XSS CRITICALs at the same line saying the same
 * thing). Issues WITHOUT a category are exempt (deterministic findings from
 * different rules legitimately share a line).
 */
function nearDupKey(issue: AuditIssue): string | null {
  if (!issue.category) return null;
  return `${issue.line}|${issue.severity}|${issue.category}`;
}

/** Information richness: prefer the variant with the most evidence/prose. */
const richness = (issue: AuditIssue): number =>
  (issue.evidence?.length ?? 0) * 2 + issue.message.length + (issue.suggestion?.length ?? 0);

const wordSet = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2),
  );

/**
 * Overlap coefficient (shared / min set size) over message word sets — a
 * cheap "same problem?" test. More tolerant than Jaccard of one message
 * being longer than the other, which is the common shape of model
 * near-duplicates (same claim, different prose length).
 */
const messageSimilarity = (a: AuditIssue, b: AuditIssue): number => {
  const wa = wordSet(a.message);
  const wb = wordSet(b.message);
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared += 1;
  return shared / Math.min(wa.size, wb.size);
};

const SIMILARITY_THRESHOLD = 0.35;

/**
 * Collapse near-duplicates within one file's issues: same line + severity +
 * category AND similar wording (Jaccard ≥ 0.4) keeps only the richest
 * variant, annotated with `(+N similar)`. Distinct problems that merely share
 * a location are preserved.
 */
function collapseNearDuplicates(issues: AuditIssue[]): { kept: AuditIssue[]; removed: number } {
  const groups = new Map<string, AuditIssue[]>();
  const passthrough: AuditIssue[] = [];
  for (const issue of issues) {
    const key = nearDupKey(issue);
    if (key === null) {
      passthrough.push(issue);
      continue;
    }
    const group = groups.get(key);
    if (group) group.push(issue);
    else groups.set(key, [issue]);
  }

  let removed = 0;
  const collapsed: AuditIssue[] = [];
  for (const group of groups.values()) {
    // Greedy clustering: richest first; absorb members with similar wording.
    const sorted = [...group].sort((a, b) => richness(b) - richness(a));
    const clusters: Array<{ representative: AuditIssue; absorbed: number }> = [];
    for (const issue of sorted) {
      const home = clusters.find(
        (c) => messageSimilarity(c.representative, issue) >= SIMILARITY_THRESHOLD,
      );
      if (home) {
        home.absorbed += 1;
        removed += 1;
      } else {
        clusters.push({ representative: issue, absorbed: 0 });
      }
    }
    for (const cluster of clusters) {
      collapsed.push(
        cluster.absorbed === 0
          ? cluster.representative
          : {
              ...cluster.representative,
              message: `${cluster.representative.message} (+${cluster.absorbed} similar)`,
            },
      );
    }
  }

  return { kept: [...passthrough, ...collapsed], removed };
}

/**
 * Remove exact-duplicate issues within each file, then collapse remaining
 * near-duplicates (same line/severity/category). Status is unaffected because
 * a removed duplicate always leaves an issue of identical severity behind.
 */
export function dedupeFindings(results: readonly FileAuditResult[]): DedupeResult {
  let removed = 0;

  const deduped = results.map((file): FileAuditResult => {
    const issues = file.result.issues ?? [];
    if (issues.length < 2) return file;

    const seen = new Set<string>();
    const exact: AuditIssue[] = [];
    for (const issue of issues) {
      const key = issueKey(issue);
      if (seen.has(key)) {
        removed += 1;
        continue;
      }
      seen.add(key);
      exact.push(issue);
    }

    const { kept, removed: nearRemoved } = collapseNearDuplicates(exact);
    removed += nearRemoved;

    if (kept.length === issues.length) return file;
    return { ...file, result: { ...file.result, issues: kept } };
  });

  return { results: deduped, removed };
}
