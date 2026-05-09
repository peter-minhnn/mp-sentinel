/**
 * MCP review preview — read-only target resolution, file filtering,
 * deterministic non-AI findings. No AI calls, no git comments, no writes.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { FileHandler } from "../file-handler/index.js";
import { getSecurityService } from "../security/index.js";
import { runDeterministicReview } from "../../cli/deterministic-review.js";
import { loadProjectConfig } from "../../utils/config.js";
import { listFilesForTarget, collectReviewInput } from "../../utils/git.js";
import { isGitRepository } from "../../utils/git.js";
import { estimatePayloadTokens } from "../../utils/tokens.js";
import { resolveTokenLimit } from "../../utils/tokens.js";
import type { ReviewTarget } from "../../types/index.js";

const execAsync = promisify(exec);

export interface ReviewTargetInput {
  mode: "staged" | "range" | "commit" | "files";
  value?: string;
  files?: string[];
}

export interface GuardrailInput {
  maxFiles?: number;
  maxDiffLines?: number;
  maxCharsPerFile?: number;
  contextLines?: number;
  tokenLimit?: number;
}

/**
 * Resolve a ReviewTargetInput to a ReviewTarget, applying defaults.
 */
const resolveTarget = (input?: ReviewTargetInput): ReviewTarget => {
  if (!input) return { mode: "range", value: "origin/main...HEAD" };
  if (input.mode === "files") return { mode: "files", files: input.files ?? [] };
  if (input.mode === "staged") return { mode: "staged" };
  return { mode: input.mode, value: input.value ?? "origin/main...HEAD" };
};

/**
 * Validate git-based targets. Returns an error string or null.
 */
const validateGitTarget = async (
  target: ReviewTarget,
  projectRoot: string,
): Promise<string | null> => {
  if (target.mode === "files") {
    if (!target.files || target.files.length === 0)
      return "Files target requires a non-empty files array";
    return null;
  }
  if (target.mode === "commit" && !target.value) return "Commit target requires a value";
  if (target.mode === "range" && !target.value) return "Range target requires a value";
  const isGit = await isGitRepository(projectRoot);
  if (!isGit) return "Not a git repository";
  // Validate that the commit/range ref exists
  try {
    const ref =
      target.mode === "commit"
        ? target.value!
        : target.value!.includes("...")
          ? target.value!.split("...")[0]!
          : target.value!;
    await execAsync(`git rev-parse --verify ${ref.includes(" ") ? `"${ref}"` : ref}`, {
      cwd: projectRoot,
    });
  } catch {
    return `Invalid ${target.mode} target: "${target.value}"`;
  }
  return null;
};

/**
 * Resolve guardrail defaults from project config.
 */
const resolveGuardrails = async (
  projectRoot: string,
  input?: GuardrailInput,
): Promise<{
  maxFiles: number;
  maxDiffLines: number;
  maxCharsPerFile: number;
  contextLines: number;
  tokenLimit: number;
}> => {
  const config = await loadProjectConfig(projectRoot);
  return {
    maxFiles: Math.max(1, input?.maxFiles ?? config.ai?.maxFiles ?? 15),
    maxDiffLines: Math.max(100, input?.maxDiffLines ?? config.ai?.maxDiffLines ?? 1200),
    maxCharsPerFile: Math.max(1000, input?.maxCharsPerFile ?? config.ai?.maxCharsPerFile ?? 12000),
    contextLines: input?.contextLines ?? 2,
    tokenLimit: resolveTokenLimit(undefined, input?.tokenLimit ?? config.ai?.tokenLimit),
  };
};

/**
 * Review scope — resolve target, filter files, collect diff metadata.
 * Never returns raw patch content.
 */
export const getReviewScope = async (
  projectRoot: string,
  targetInput?: ReviewTargetInput,
  guardrailInput?: GuardrailInput,
): Promise<Record<string, unknown>> => {
  const target = resolveTarget(targetInput);
  const gitError = await validateGitTarget(target, projectRoot);
  if (gitError) return { error: gitError };
  const guardrails = await resolveGuardrails(projectRoot, guardrailInput);

  // List candidate files
  const candidateFiles = await listFilesForTarget(target, projectRoot);

  // File filtering
  const handler = new FileHandler({ cwd: projectRoot });
  const filterResult = await handler.filterPathsWithIgnores(candidateFiles);

  // Collect diffs with guardrails
  const diffResult = await collectReviewInput({
    target,
    maxFiles: guardrails.maxFiles,
    maxDiffLines: guardrails.maxDiffLines,
    maxCharsPerFile: guardrails.maxCharsPerFile,
    contextLines: guardrails.contextLines,
    filePaths: filterResult.accepted,
    cwd: projectRoot,
  });

  return {
    mode: target.mode,
    totalFiles: candidateFiles.length,
    acceptedCount: diffResult.files.length,
    acceptedFiles: diffResult.files.map((f) => f.path),
    skippedCount: diffResult.skipped.length,
    skippedFiles: diffResult.skipped.map((f) => ({ path: f.path, reason: f.reason })),
    totalChangedLines: diffResult.totalChangedLines,
    filterStats: filterResult.stats,
    guardrails,
  };
};

/**
 * Review deterministic — run non-AI review on collected diffs.
 * Includes findings, redaction summary, token estimate.
 */
export const getReviewDeterministic = async (
  projectRoot: string,
  targetInput?: ReviewTargetInput,
  guardrailInput?: GuardrailInput,
): Promise<Record<string, unknown>> => {
  const target = resolveTarget(targetInput);
  const gitError = await validateGitTarget(target, projectRoot);
  if (gitError) return { error: gitError };
  const guardrails = await resolveGuardrails(projectRoot, guardrailInput);

  // Collect diffs
  const candidateFiles = await listFilesForTarget(target, projectRoot);
  const handler = new FileHandler({ cwd: projectRoot });
  const filterResult = await handler.filterPathsWithIgnores(candidateFiles);
  const diffResult = await collectReviewInput({
    target,
    maxFiles: guardrails.maxFiles,
    maxDiffLines: guardrails.maxDiffLines,
    maxCharsPerFile: guardrails.maxCharsPerFile,
    contextLines: guardrails.contextLines,
    filePaths: filterResult.accepted,
    cwd: projectRoot,
  });

  // Sanitize diffs
  const securityService = getSecurityService();
  const sanitized = securityService.sanitizeFiles(
    diffResult.files.map((f) => ({ path: f.path, content: f.patch })),
  );

  // Run deterministic review
  const findings = runDeterministicReview(sanitized.sanitizedFiles, sanitized.redactionReport);

  // Token estimate
  const tokenEstimate = await estimatePayloadTokens(sanitized.sanitizedFiles);

  return {
    aiEnabled: false,
    mode: target.mode,
    findingsCount: findings.length,
    findings: findings.map((f) => ({
      filePath: f.filePath,
      result: {
        status: f.result.status,
        issueCount: f.result.issues?.length ?? 0,
        issues: f.result.issues?.map((i) => ({
          severity: i.severity,
          message: i.message,
          category: i.category,
        })),
      },
      duration: f.duration,
    })),
    redactionSummary: {
      totalRedacted: sanitized.totalRedacted,
      redactedPaths: sanitized.redactionReport
        .filter((r) => r.redactedCount > 0)
        .map((r) => ({ path: r.path, count: r.redactedCount })),
    },
    tokenEstimate,
    skippedFiles: diffResult.skipped.map((f) => ({ path: f.path, reason: f.reason })),
    guardrails,
  };
};

/**
 * Review filter files — run explicit paths through file filtering.
 */
export const getReviewFilterFiles = async (
  projectRoot: string,
  files: string[],
): Promise<Record<string, unknown>> => {
  const handler = new FileHandler({ cwd: projectRoot });
  const result = await handler.filterPathsWithIgnores(files);
  return {
    accepted: result.accepted,
    rejected: result.rejected.map((r) => ({ path: r.path, reason: r.reason })),
    stats: result.stats,
  };
};
