/**
 * CLI handler for indexing --task-context.
 */

import { UserError } from "../utils/errors.js";
import type { SourceIndex } from "../types/index.js";
import { emitIndexJson, isIndexJsonPretty } from "../services/source-index/json-output.js";
import {
  buildTaskContext,
  rankTaskCandidates,
  DEFAULT_TASK_MAX_FILES,
  DEFAULT_TASK_TOKEN_BUDGET,
  MAX_TASK_FILES,
} from "../services/source-index/task-context.js";

/** Candidates listed by `--explain-ranking`. Bounded so the output stays readable. */
export const MAX_RANKING_CANDIDATES = 50;

export function parseTokenBudgetFlag(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_TASK_TOKEN_BUDGET;
  const trimmed = raw.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new UserError(`--token-budget must be an integer >= 1 (got ${JSON.stringify(raw)})`);
  }
  const n = Number.parseInt(trimmed, 10);
  return Math.min(4000, Math.max(100, n));
}

export async function handleTaskContext(
  prompt: string,
  index: SourceIndex | null,
  format: "console" | "json",
  cachePath: string,
  maxFiles: number = DEFAULT_TASK_MAX_FILES,
  tokenBudget: number = DEFAULT_TASK_TOKEN_BUDGET,
): Promise<number> {
  const cap = Math.min(MAX_TASK_FILES, Math.max(1, maxFiles));
  // `--pretty` whitespace is part of the emitted JSON, so it must be inside the budget.
  const pretty = format === "json" && isIndexJsonPretty();
  const result = await buildTaskContext(
    index,
    prompt,
    { maxFiles: cap, tokenBudget, ...(pretty ? { pretty: true } : {}) },
    cachePath,
  );

  if (format === "json") {
    emitIndexJson(result);
    return 0;
  }

  console.log();
  if (result.files.length === 0) {
    console.log("No task-context files for that prompt.");
  } else {
    console.log(`Task context (${result.files.length} files, ~${result.usedTokens} tokens):`);
    for (const file of result.files) {
      const anchors = file.anchors.join(", ");
      console.log(`  ${file.rank}. ${file.file}  [${file.score}]  ${anchors}`);
    }
    if (result.truncated) {
      console.log(`  truncated; omitted ${result.omittedCount} file(s)`);
    }
    for (const warning of result.warnings) {
      console.log(`  warning: ${warning}`);
    }
  }
  console.log();
  return 0;
}

/**
 * Handle `--task-context --explain-ranking`: emit the ranked candidate list
 * as it stands *before* capping and packing, so a missing file can be traced
 * to retrieval (absent), ranking (present but low), or the token budget
 * (ranked high, still not in the capsule).
 */
export async function handleTaskRanking(
  prompt: string,
  index: SourceIndex | null,
  format: "console" | "json",
  cachePath: string,
): Promise<number> {
  const { anchors, warnings, records } = await rankTaskCandidates(index, prompt, cachePath);
  const candidates = records.slice(0, MAX_RANKING_CANDIDATES).map((rec) => ({
    file: rec.file,
    rank: rec.rank,
    score: rec.score,
    anchors: rec.anchors,
  }));
  const output = {
    anchors,
    candidateCount: records.length,
    truncated: records.length > candidates.length,
    candidates,
    warnings,
  };

  if (format === "json") {
    emitIndexJson(output);
    return 0;
  }

  console.log();
  if (candidates.length === 0) {
    console.log("No task-context candidates for that prompt.");
  } else {
    console.log(`Task-context candidates (${records.length} before packing):`);
    for (const candidate of candidates) {
      console.log(
        `  ${candidate.rank}. ${candidate.file}  [${candidate.score}]  ${candidate.anchors.join(", ")}`,
      );
    }
    if (output.truncated) {
      console.log(`  ... ${records.length - candidates.length} more not shown`);
    }
    for (const warning of warnings) console.log(`  warning: ${warning}`);
  }
  console.log();
  return 0;
}
