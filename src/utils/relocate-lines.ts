/**
 * Evidence-based line relocation.
 *
 * Field testing showed ~50% of findings anchored at `line: 1` — the parser's
 * fallback when the model omits a line number. Since most findings carry an
 * `evidence` snippet (CRITICALs are required to), we can recover the real
 * location: search the file for the evidence and set `line` to where it
 * actually appears.
 *
 * Rules:
 *   - Only relocate when the finding has a usable `evidence` string AND the
 *     current line looks unreliable (line <= 1) OR the evidence is NOT on the
 *     claimed line. We never move a finding whose claimed line already matches
 *     its evidence.
 *   - Match the first non-whitespace-collapsed occurrence. Ambiguous evidence
 *     (appears many times) still picks the first — better than line 1.
 *   - Fail-open: unreadable file, missing/short evidence, or no match leaves
 *     the finding untouched.
 *
 * Deterministic findings (rule-pack/risk-analyzer) already carry precise lines
 * and usually no evidence, so they pass through unchanged.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AuditIssue, FileAuditResult } from "../types/index.js";

const MIN_EVIDENCE_LENGTH = 8;

/**
 * Normalize for matching: collapse whitespace AND strip markdown code
 * formatting the model often leaks into the evidence field (surrounding or
 * inline backticks, ```fences```), which never appears in the source file.
 */
const normalize = (text: string): string =>
  text
    .replace(/```[a-z]*\n?/gi, " ")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();

export interface RelocateOptions {
  cwd?: string;
  /** Test seam. */
  readFileImpl?: (absolutePath: string) => Promise<string>;
}

export interface RelocateResult {
  results: FileAuditResult[];
  /** Number of findings whose line number was corrected. */
  relocated: number;
}

const lineContaining = (normalizedLines: string[], needle: string): number => {
  if (needle.length < MIN_EVIDENCE_LENGTH) return 0;
  for (let i = 0; i < normalizedLines.length; i++) {
    if (normalizedLines[i]!.includes(needle)) return i + 1;
  }
  return 0;
};

/**
 * Models frequently abstract evidence with an ellipsis — `const getColumns =
 * () => { ... }`, `interface ToggleLikeParams { postId: number; ... }`. The
 * full string never matches the file. Split on ellipsis runs and return the
 * longest literal segment, which usually contains the stable signature
 * prefix (`const getColumns = () => {`).
 */
const longestLiteralSegment = (evidence: string): string => {
  const segments = evidence
    .split(/\.{2,}|…/) // "..." (or more dots) and the unicode ellipsis
    .map((s) => normalize(s))
    .filter((s) => s.length >= MIN_EVIDENCE_LENGTH);
  if (segments.length === 0) return "";
  return segments.reduce((longest, s) => (s.length > longest.length ? s : longest), "");
};

/**
 * Find the 1-based line number of `evidence` in `lines` (whitespace-insensitive,
 * first match). Returns 0 if not found. Tries, in order: the whole snippet,
 * the longest literal segment of an ellipsis-abstracted snippet, then the
 * first non-trivial line of a multi-line snippet.
 */
const findEvidenceLine = (normalizedLines: string[], evidence: string): number => {
  const whole = lineContaining(normalizedLines, normalize(evidence));
  if (whole > 0) return whole;

  if (/\.{2,}|…/.test(evidence)) {
    const segment = longestLiteralSegment(evidence);
    if (segment) {
      const segLine = lineContaining(normalizedLines, segment);
      if (segLine > 0) return segLine;
    }
  }

  const firstLine = evidence
    .split("\n")
    .map((l) => normalize(l))
    .find((l) => l.length >= MIN_EVIDENCE_LENGTH);
  if (firstLine) {
    const flLine = lineContaining(normalizedLines, firstLine);
    if (flLine > 0) return flLine;
  }
  return 0;
};

/**
 * Relocate findings to the line where their evidence actually appears.
 */
export const relocateFindingLines = async (
  results: readonly FileAuditResult[],
  options: RelocateOptions = {},
): Promise<RelocateResult> => {
  const cwd = options.cwd ?? process.cwd();
  const readFileImpl =
    options.readFileImpl ?? ((absolutePath: string) => readFile(absolutePath, "utf8"));

  const cache = new Map<string, string[] | null>();
  const loadLines = async (filePath: string): Promise<string[] | null> => {
    const cached = cache.get(filePath);
    if (cached !== undefined) return cached;
    let normalizedLines: string[] | null = null;
    try {
      const content = await readFileImpl(resolve(cwd, filePath));
      normalizedLines = content.split("\n").map((l) => normalize(l));
    } catch {
      normalizedLines = null;
    }
    cache.set(filePath, normalizedLines);
    return normalizedLines;
  };

  let relocated = 0;
  const next: FileAuditResult[] = [];

  for (const file of results) {
    const issues = file.result.issues ?? [];
    const hasRelocatable = issues.some(
      (i) => typeof i.evidence === "string" && normalize(i.evidence).length >= MIN_EVIDENCE_LENGTH,
    );
    if (!hasRelocatable) {
      next.push(file);
      continue;
    }

    const normalizedLines = await loadLines(file.filePath);
    if (normalizedLines === null) {
      next.push(file);
      continue;
    }

    let changed = false;
    const nextIssues = issues.map((issue): AuditIssue => {
      if (typeof issue.evidence !== "string") return issue;
      const claimedLine = issue.line;
      // Skip when the claimed line already matches the evidence.
      if (
        claimedLine >= 1 &&
        claimedLine <= normalizedLines.length &&
        normalizedLines[claimedLine - 1]!.includes(normalize(issue.evidence))
      ) {
        return issue;
      }
      const found = findEvidenceLine(normalizedLines, issue.evidence);
      if (found === 0 || found === claimedLine) return issue;
      relocated += 1;
      changed = true;
      return { ...issue, line: found };
    });

    next.push(changed ? { ...file, result: { ...file.result, issues: nextIssues } } : file);
  }

  return { results: next, relocated };
};
