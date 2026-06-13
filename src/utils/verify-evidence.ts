/**
 * Deterministic evidence verification for CRITICAL findings.
 *
 * Benchmarks showed the worst false positives share one root cause: the model
 * claims a crash/security bug whose "evidence" does not actually match the
 * file (guard clause two lines above the hunk, import at the top of the file,
 * code already fixed in a later commit). This pass re-checks every CRITICAL
 * finding's `evidence` snippet against the CURRENT file content on disk:
 *
 *   - evidence present in file  → finding kept as-is (verified)
 *   - evidence NOT found        → severity downgraded to WARNING, confidence
 *                                 set to "low", message tagged [unverified]
 *
 * CRITICAL findings WITHOUT an evidence string are left untouched for
 * backward compatibility (deterministic/rule-pack findings don't carry
 * evidence). The prompt independently requires evidence for AI CRITICALs.
 *
 * Matching is whitespace-insensitive but otherwise literal. Snippets shorter
 * than MIN_EVIDENCE_LENGTH are too generic to verify and are skipped.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AuditIssue, FileAuditResult } from "../types/index.js";

const MIN_EVIDENCE_LENGTH = 12;

export interface VerifyEvidenceOptions {
  cwd?: string;
  /** Test seam — file reader override. */
  readFileImpl?: (absolutePath: string) => Promise<string>;
}

export interface VerifyEvidenceResult {
  results: FileAuditResult[];
  /** Number of CRITICAL issues downgraded because evidence was not found. */
  downgraded: number;
}

const normalize = (text: string): string => text.replace(/\s+/g, " ").trim();

const downgrade = (issue: AuditIssue): AuditIssue => ({
  ...issue,
  severity: "WARNING",
  confidence: "low",
  message: `${issue.message} [unverified: evidence not found in current file]`,
});

const shouldVerify = (issue: AuditIssue): boolean =>
  issue.severity === "CRITICAL" &&
  typeof issue.evidence === "string" &&
  normalize(issue.evidence).length >= MIN_EVIDENCE_LENGTH;

/**
 * Verify CRITICAL findings against current file contents.
 * Fail-open: unreadable files (deleted, renamed, binary) skip verification
 * rather than downgrading — absence of the file is not proof the finding is
 * wrong at the reviewed revision.
 */
export const verifyEvidence = async (
  results: readonly FileAuditResult[],
  options: VerifyEvidenceOptions = {},
): Promise<VerifyEvidenceResult> => {
  const cwd = options.cwd ?? process.cwd();
  const readFileImpl =
    options.readFileImpl ?? ((absolutePath: string) => readFile(absolutePath, "utf8"));

  const contentCache = new Map<string, string | null>();
  const loadNormalizedContent = async (filePath: string): Promise<string | null> => {
    const cached = contentCache.get(filePath);
    if (cached !== undefined) return cached;
    let normalized: string | null = null;
    try {
      normalized = normalize(await readFileImpl(resolve(cwd, filePath)));
    } catch {
      normalized = null;
    }
    contentCache.set(filePath, normalized);
    return normalized;
  };

  let downgraded = 0;
  const next: FileAuditResult[] = [];

  for (const file of results) {
    const issues = file.result.issues ?? [];
    if (!issues.some(shouldVerify)) {
      next.push(file);
      continue;
    }

    const content = await loadNormalizedContent(file.filePath);
    if (content === null) {
      next.push(file);
      continue;
    }

    let fileChanged = false;
    const nextIssues = issues.map((issue) => {
      if (!shouldVerify(issue)) return issue;
      if (content.includes(normalize(issue.evidence as string))) return issue;
      downgraded += 1;
      fileChanged = true;
      return downgrade(issue);
    });

    next.push(fileChanged ? { ...file, result: { ...file.result, issues: nextIssues } } : file);
  }

  return { results: next, downgraded };
};
