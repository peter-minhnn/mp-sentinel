/**
 * HEAD reconciliation for historical-commit reviews (`--commit <sha>`).
 *
 * Reviewing an old commit reports issues as they existed THEN. By the time
 * the report is read, later commits may already have fixed them — benchmarks
 * showed reports listing already-fixed bugs as "must fix before merge".
 *
 * For every finding that carries an `evidence` quote, this pass classifies it
 * against the CURRENT working tree:
 *
 *   1. evidence found in the file at HEAD      → active (finding untouched)
 *   2. evidence absent, but `git log -S` finds
 *      commits that added/removed it           → resolution: "resolved-at-head"
 *                                                + resolvedBy: <newest sha>
 *   3. evidence absent from file AND history   → resolution: "unverified"
 *                                                (paraphrased or hallucinated)
 *      → severity downgraded to WARNING, confidence "low"
 *
 * Resolved findings keep their severity for the record but are excluded from
 * pass/fail evaluation and severity counts (see utils/severity.ts —
 * activeIssues). Findings without evidence are never reclassified.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AuditIssue, FileAuditResult } from "../types/index.js";

const execAsync = promisify(exec);

const MIN_EVIDENCE_LENGTH = 12;

export interface ReconcileOptions {
  cwd?: string;
  /** Test seam — file reader override. */
  readFileImpl?: (absolutePath: string) => Promise<string>;
  /** Test seam — `git log -S` lookup override. Returns short SHAs, newest first. */
  pickaxeImpl?: (evidence: string, filePath: string, cwd: string) => Promise<string[]>;
}

export interface ReconcileResult {
  results: FileAuditResult[];
  /** Issues marked resolved-at-head. */
  resolved: number;
  /** Issues downgraded as unverified (evidence not found anywhere). */
  unverified: number;
}

const normalize = (text: string): string => text.replace(/\s+/g, " ").trim();

const hasVerifiableEvidence = (issue: AuditIssue): boolean =>
  typeof issue.evidence === "string" && normalize(issue.evidence).length >= MIN_EVIDENCE_LENGTH;

/**
 * `git log -S<evidence>` — commits that changed the number of occurrences of
 * the evidence string in this file (i.e. introduced or removed it).
 */
const defaultPickaxe = async (
  evidence: string,
  filePath: string,
  cwd: string,
): Promise<string[]> => {
  // -S takes the string verbatim; pass via stdin-safe single quoting.
  const escaped = evidence.replace(/'/g, `'\\''`);
  const command = `git log -S'${escaped}' --format=%h -n 5 -- '${filePath.replace(/'/g, `'\\''`)}'`;
  const { stdout } = await execAsync(command, { cwd });
  return stdout
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
};

const markResolved = (issue: AuditIssue, resolvedBy: string): AuditIssue => ({
  ...issue,
  resolution: "resolved-at-head",
  resolvedBy,
  message: `${issue.message} [resolved at HEAD by ${resolvedBy}]`,
});

const markUnverified = (issue: AuditIssue): AuditIssue => ({
  ...issue,
  resolution: "unverified",
  severity: "WARNING",
  confidence: "low",
  message: `${issue.message} [unverified: evidence not found in file or git history]`,
});

/**
 * Classify one issue. Returns the (possibly replaced) issue plus which
 * counter to bump.
 */
const reconcileIssue = async (
  issue: AuditIssue,
  fileContent: string | null,
  filePath: string,
  cwd: string,
  pickaxe: NonNullable<ReconcileOptions["pickaxeImpl"]>,
): Promise<{ issue: AuditIssue; outcome: "active" | "resolved" | "unverified" }> => {
  const evidence = normalize(issue.evidence as string);
  if (fileContent !== null && fileContent.includes(evidence)) {
    return { issue, outcome: "active" };
  }
  try {
    const shas = await pickaxe(issue.evidence as string, filePath, cwd);
    const newest = shas[0];
    if (newest) {
      return { issue: markResolved(issue, newest), outcome: "resolved" };
    }
  } catch {
    // git unavailable / not a repo — treat as unverified-by-history below,
    // but without history data we stay conservative and keep the finding.
    return { issue, outcome: "active" };
  }
  return { issue: markUnverified(issue), outcome: "unverified" };
};

/**
 * Reconcile all findings with verifiable evidence against the working tree.
 * Fail-open at every step: no evidence, unreadable git, or any error keeps
 * the finding active rather than silently dropping it.
 */
export const reconcileFindings = async (
  results: readonly FileAuditResult[],
  options: ReconcileOptions = {},
): Promise<ReconcileResult> => {
  const cwd = options.cwd ?? process.cwd();
  const readFileImpl =
    options.readFileImpl ?? ((absolutePath: string) => readFile(absolutePath, "utf8"));
  const pickaxe = options.pickaxeImpl ?? defaultPickaxe;

  let resolved = 0;
  let unverified = 0;
  const next: FileAuditResult[] = [];

  for (const file of results) {
    const issues = file.result.issues ?? [];
    if (!issues.some(hasVerifiableEvidence)) {
      next.push(file);
      continue;
    }

    let fileContent: string | null = null;
    try {
      fileContent = normalize(await readFileImpl(resolve(cwd, file.filePath)));
    } catch {
      fileContent = null;
    }

    let fileChanged = false;
    const nextIssues: AuditIssue[] = [];
    for (const issue of issues) {
      if (!hasVerifiableEvidence(issue)) {
        nextIssues.push(issue);
        continue;
      }
      const { issue: reconciled, outcome } = await reconcileIssue(
        issue,
        fileContent,
        file.filePath,
        cwd,
        pickaxe,
      );
      if (outcome === "resolved") resolved += 1;
      if (outcome === "unverified") unverified += 1;
      if (reconciled !== issue) fileChanged = true;
      nextIssues.push(reconciled);
    }

    next.push(fileChanged ? { ...file, result: { ...file.result, issues: nextIssues } } : file);
  }

  return { results: next, resolved, unverified };
};
