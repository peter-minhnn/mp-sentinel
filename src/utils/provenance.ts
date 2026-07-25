/**
 * Reproduce/provenance metadata collector for review reports.
 *
 * Field sample (review-0706.md): the report recorded only `AI Enabled: true`
 * and a timestamp, so a later reviewer could not tell that the branch had
 * advanced (101 → 106 files) and the scope counts were stale. Recording the
 * exact command, comparison base, threshold, provider/model, cache mode,
 * include-uncommitted flag, and — decisively — the git HEAD SHA lets a
 * consumer detect that drift immediately: a HEAD mismatch means re-run.
 *
 * Fail-open: git lookups that fail simply omit their field; the rest of the
 * provenance is still emitted.
 */

import { getCurrentHeadSha } from "./git.js";
import type { ReviewProvenance, SeverityThreshold } from "../types/index.js";

export interface ProvenanceInput {
  /** CLI args after the binary; defaults to `process.argv.slice(2)`. */
  argv?: readonly string[];
  /** Comparison base for a branch/range diff, e.g. `origin/develop`. */
  compareBranch?: string;
  /** Resolved severity threshold in effect for pass/fail. */
  threshold?: SeverityThreshold;
  /** AI provider id when AI review ran. */
  provider?: string;
  /** AI model id when AI review ran. */
  model?: string;
  /** True when `--no-cache` bypassed the AI response cache. */
  cacheBypassed?: boolean;
  /** True when staged/unstaged changes were folded into scope. */
  includeUncommitted?: boolean;
  /** Source-index manifest hash the run observed, when available. */
  indexHash?: string;
  /** Working directory for git lookups. */
  cwd?: string;
  /** Injectable HEAD-sha resolver (tests). */
  headShaImpl?: (cwd?: string) => Promise<string | null>;
}

/**
 * Assemble a `ReviewProvenance` from what the caller knows, enriching with the
 * current git HEAD SHA. Only defined fields are set, so the object stays clean
 * under `exactOptionalPropertyTypes`.
 */
export const collectProvenance = async (input: ProvenanceInput = {}): Promise<ReviewProvenance> => {
  const argv = input.argv ?? process.argv.slice(2);
  const readHeadSha = input.headShaImpl ?? getCurrentHeadSha;

  let gitHeadSha: string | null = null;
  try {
    gitHeadSha = await readHeadSha(input.cwd);
  } catch {
    gitHeadSha = null;
  }

  const provenance: ReviewProvenance = {};
  const command = argv.join(" ").trim();
  if (command.length > 0) provenance.command = command;
  if (input.compareBranch) provenance.compareBranch = input.compareBranch;
  if (input.threshold) provenance.threshold = input.threshold;
  if (input.provider) provenance.provider = input.provider;
  if (input.model) provenance.model = input.model;
  if (input.cacheBypassed !== undefined) {
    provenance.cache = input.cacheBypassed ? "bypassed" : "enabled";
  }
  if (input.includeUncommitted !== undefined) {
    provenance.includeUncommitted = input.includeUncommitted;
  }
  if (gitHeadSha) provenance.gitHeadSha = gitHeadSha;
  if (input.indexHash) provenance.indexHash = input.indexHash;

  return provenance;
};
