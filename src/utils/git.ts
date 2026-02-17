/**
 * Git utilities with async support and better error handling
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  CommitInfo,
  CommitPattern,
  ReviewInputFile,
  ReviewSkippedItem,
  ReviewTarget,
} from "../types/index.js";
import { log } from "./logger.js";

const execAsync = promisify(exec);

const SUPPORTED_EXTENSIONS =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|cs|go|java|rs|kt|swift)$/;

export interface GitDiffOptions {
  targetBranch?: string;
  extensions?: RegExp;
}

export interface CollectReviewInputOptions {
  target: ReviewTarget;
  maxFiles: number;
  maxDiffLines: number;
  maxCharsPerFile: number;
  contextLines?: number;
  filePaths?: string[];
}

export interface CollectReviewInputResult {
  files: ReviewInputFile[];
  skipped: ReviewSkippedItem[];
  totalChangedLines: number;
}

export interface GetRecentCommitsOptions {
  count?: number;
  includeMergeCommits?: boolean;
  extensions?: RegExp;
  /** Enable branch diff mode - get commits that differ from compareBranch */
  branchDiffMode?: boolean;
  /** Target branch to compare against (default: 'origin/main') */
  compareBranch?: string;
}

/**
 * Get last commit message asynchronously
 */
export const getLastCommitMessage = async (): Promise<string> => {
  try {
    const { stdout } = await execAsync("git log -1 --pretty=%B");
    return stdout.trim();
  } catch {
    return "";
  }
};

/**
 * Get recent commits with their details for local review mode
 * This allows reviewing multiple commits without CI/CD
 *
 * Supports two modes:
 * 1. Count mode (default): Get last N commits
 * 2. Branch diff mode: Get all commits that differ from compareBranch
 */
export const getRecentCommits = async (
  options: GetRecentCommitsOptions = {},
): Promise<CommitInfo[]> => {
  const {
    count = 1,
    includeMergeCommits = false,
    extensions = SUPPORTED_EXTENSIONS,
    branchDiffMode = false,
    compareBranch = "origin/main",
  } = options;

  try {
    const noMergesFlag = includeMergeCommits ? "" : "--no-merges";
    const format = "%H|%s|%an|%ai";

    let command: string;

    if (branchDiffMode) {
      // Branch diff mode: get all commits since branching from compareBranch
      // First, try to find the merge-base (common ancestor)
      try {
        const { stdout: mergeBase } = await execAsync(
          `git merge-base ${compareBranch} HEAD`,
        );
        const baseCommit = mergeBase.trim();

        if (baseCommit) {
          // Get all commits from merge-base to HEAD
          command = `git log ${baseCommit}..HEAD ${noMergesFlag} --pretty=format:"${format}"`;
        } else {
          // Fallback to direct comparison
          command = `git log ${compareBranch}..HEAD ${noMergesFlag} --pretty=format:"${format}"`;
        }
      } catch {
        // If merge-base fails, try direct comparison
        command = `git log ${compareBranch}..HEAD ${noMergesFlag} --pretty=format:"${format}"`;
      }
    } else {
      // Count mode: get last N commits
      command = `git log -${count} ${noMergesFlag} --pretty=format:"${format}"`;
    }

    const { stdout } = await execAsync(command);

    if (!stdout.trim()) {
      return [];
    }

    const commitLines = stdout.trim().split("\n");
    const commits: CommitInfo[] = [];

    for (const line of commitLines) {
      const [hash, message, author, date] = line.split("|");
      if (!hash) continue;

      // Get files changed in this commit
      const files = await getFilesInCommit(hash, extensions);

      commits.push({
        hash: hash.trim(),
        message: message?.trim() || "",
        author: author?.trim() || "",
        date: date?.trim() || "",
        files,
      });
    }

    return commits;
  } catch {
    log.warning("Failed to get recent commits.");
    return [];
  }
};

/**
 * Get list of files changed in a specific commit
 */
export const getFilesInCommit = async (
  commitHash: string,
  extensions: RegExp = SUPPORTED_EXTENSIONS,
): Promise<string[]> => {
  try {
    const command = `git diff-tree --no-commit-id --name-only -r ${commitHash}`;
    const { stdout } = await execAsync(command);
    return parseAndFilterFiles(stdout, extensions);
  } catch {
    return [];
  }
};

/**
 * Pattern match result with detailed matching info
 */
export interface PatternMatchResult {
  matched: boolean;
  pattern: CommitPattern | undefined;
  matchedPatterns: CommitPattern[];
  unmatchedRequiredPatterns: CommitPattern[];
}

/**
 * Options for pattern matching
 */
export interface PatternMatchOptions {
  /** Match mode: 'any' (default) - match if any pattern matches, 'all' - require all required patterns */
  mode?: "any" | "all";
}

/**
 * Check if a commit message matches the specified patterns
 *
 * Supports two modes:
 * - 'any' (default): Returns true if ANY pattern matches
 * - 'all': Returns true only if ALL patterns marked as 'required' match
 */
export const matchCommitPattern = (
  message: string,
  patterns: CommitPattern[],
  options: PatternMatchOptions = {},
): PatternMatchResult => {
  const { mode = "any" } = options;

  const matchedPatterns: CommitPattern[] = [];
  const unmatchedRequiredPatterns: CommitPattern[] = [];

  for (const p of patterns) {
    try {
      const regex = new RegExp(p.pattern, "i");
      if (regex.test(message)) {
        matchedPatterns.push(p);
      } else if (p.required) {
        unmatchedRequiredPatterns.push(p);
      }
    } catch {
      // Invalid regex, skip this pattern
      continue;
    }
  }

  if (mode === "all") {
    // In 'all' mode, all required patterns must match
    const requiredPatterns = patterns.filter((p) => p.required);
    const allRequiredMatched = requiredPatterns.every((rp) =>
      matchedPatterns.some((mp) => mp.pattern === rp.pattern),
    );

    return {
      matched: allRequiredMatched && matchedPatterns.length > 0,
      pattern: matchedPatterns[0],
      matchedPatterns,
      unmatchedRequiredPatterns,
    };
  }

  // In 'any' mode, just need one match
  return {
    matched: matchedPatterns.length > 0,
    pattern: matchedPatterns[0],
    matchedPatterns,
    unmatchedRequiredPatterns,
  };
};

/**
 * Check if a commit message should be skipped based on skip patterns
 */
export const shouldSkipCommit = (
  message: string,
  skipPatterns: string[],
): boolean => {
  const lowerMessage = message.toLowerCase();
  return skipPatterns.some((pattern) =>
    lowerMessage.includes(pattern.toLowerCase()),
  );
};

/**
 * Get all unique files from multiple commits
 */
export const getFilesFromCommits = (commits: CommitInfo[]): string[] => {
  const fileSet = new Set<string>();
  for (const commit of commits) {
    for (const file of commit.files) {
      fileSet.add(file);
    }
  }
  return Array.from(fileSet);
};

/**
 * Get changed files against target branch with parallel execution
 */
export const getChangedFiles = async (
  options: GitDiffOptions = {},
): Promise<string[]> => {
  const { targetBranch = "origin/main", extensions = SUPPORTED_EXTENSIONS } =
    options;

  try {
    // Try three-dot diff first (for PR/MR scenarios)
    const command = `git diff --name-only --diff-filter=ACMR ${targetBranch}...HEAD`;
    const { stdout } = await execAsync(command);

    return parseAndFilterFiles(stdout, extensions);
  } catch {
    try {
      // Fallback to two-dot diff
      const command = `git diff --name-only --diff-filter=ACMR ${targetBranch}`;
      const { stdout } = await execAsync(command);
      return parseAndFilterFiles(stdout, extensions);
    } catch {
      log.warning("Git diff failed. No files to audit.");
      return [];
    }
  }
};

/**
 * Check if current directory is a git repository
 */
export const isGitRepository = async (): Promise<boolean> => {
  try {
    await execAsync("git rev-parse --is-inside-work-tree");
    return true;
  } catch {
    return false;
  }
};

/**
 * Get current branch name
 */
export const getCurrentBranch = async (): Promise<string> => {
  try {
    const { stdout } = await execAsync("git branch --show-current");
    return stdout.trim();
  } catch {
    return "unknown";
  }
};

const parseAndFilterFiles = (output: string, extensions: RegExp): string[] => {
  return output
    .split("\n")
    .map((file) => file.trim())
    .filter((file) => file.length > 0)
    .filter((file) => extensions.test(file));
};

const shellEscape = (value: string): string =>
  `'${value.replace(/'/g, `'\\''`)}'`;

const countPatchChanges = (
  patch: string,
): { additions: number; deletions: number; changedLines: number } => {
  const lines = patch.split("\n");
  let additions = 0;
  let deletions = 0;

  for (const line of lines) {
    if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      continue;
    }
    if (line.startsWith("+")) {
      additions++;
      continue;
    }
    if (line.startsWith("-")) {
      deletions++;
    }
  }

  return {
    additions,
    deletions,
    changedLines: additions + deletions,
  };
};

const buildSyntheticDiff = async (filePath: string): Promise<string> => {
  const content = await readFile(resolve(filePath), "utf-8");
  const lines = content.split("\n").slice(0, 400);
  const contentPatch = lines.map((line) => `+${line}`).join("\n");
  return [
    `diff --git a/${filePath} b/${filePath}`,
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    contentPatch,
  ].join("\n");
};

export const listFilesForTarget = async (
  target: ReviewTarget,
): Promise<string[]> => {
  if (target.mode === "files") {
    return target.files ?? [];
  }

  try {
    let command = "";
    switch (target.mode) {
      case "staged":
        command = "git diff --cached --name-only --diff-filter=ACMR";
        break;
      case "commit":
        command = `git show --pretty=format: --name-only --diff-filter=ACMR ${shellEscape(target.value ?? "")}`;
        break;
      case "range":
        command = `git diff --name-only --diff-filter=ACMR ${shellEscape(target.value ?? "")}`;
        break;
      default:
        return [];
    }

    const { stdout } = await execAsync(command);
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
};

const getPatchForFile = async (
  target: ReviewTarget,
  filePath: string,
  contextLines: number,
): Promise<string> => {
  const escapedPath = shellEscape(filePath);

  try {
    switch (target.mode) {
      case "staged": {
        const { stdout } = await execAsync(
          `git diff --cached --no-color --unified=${contextLines} -- ${escapedPath}`,
        );
        return stdout;
      }
      case "commit": {
        const { stdout } = await execAsync(
          `git show --no-color --unified=${contextLines} --pretty=format: ${shellEscape(target.value ?? "")} -- ${escapedPath}`,
        );
        return stdout;
      }
      case "range": {
        const { stdout } = await execAsync(
          `git diff --no-color --unified=${contextLines} ${shellEscape(target.value ?? "")} -- ${escapedPath}`,
        );
        return stdout;
      }
      case "files": {
        const { stdout } = await execAsync(
          `git diff --no-color --unified=${contextLines} HEAD -- ${escapedPath}`,
        );
        if (stdout.trim().length > 0) {
          return stdout;
        }
        return buildSyntheticDiff(filePath);
      }
      default:
        return "";
    }
  } catch {
    if (target.mode === "files") {
      try {
        return await buildSyntheticDiff(filePath);
      } catch {
        return "";
      }
    }
    return "";
  }
};

export const collectReviewInput = async (
  options: CollectReviewInputOptions,
): Promise<CollectReviewInputResult> => {
  const {
    target,
    maxFiles,
    maxDiffLines,
    maxCharsPerFile,
    contextLines = 2,
    filePaths,
  } = options;

  const skipped: ReviewSkippedItem[] = [];
  const accepted: ReviewInputFile[] = [];
  const fileCandidates = filePaths ?? (await listFilesForTarget(target));
  const uniqueFiles = Array.from(new Set(fileCandidates)).sort((a, b) =>
    a.localeCompare(b),
  );

  let totalChangedLines = 0;

  if (uniqueFiles.length > maxFiles) {
    for (const filePath of uniqueFiles.slice(maxFiles)) {
      skipped.push({
        path: filePath,
        reason: `Skipped by maxFiles guardrail (${maxFiles})`,
      });
    }
  }

  for (const filePath of uniqueFiles.slice(0, maxFiles)) {
    const patch = await getPatchForFile(target, filePath, contextLines);
    if (!patch.trim()) {
      skipped.push({ path: filePath, reason: "No textual diff content" });
      continue;
    }

    if (patch.includes("Binary files ") || patch.includes("GIT binary patch")) {
      skipped.push({ path: filePath, reason: "Binary diff skipped" });
      continue;
    }

    const stats = countPatchChanges(patch);
    if (stats.changedLines === 0) {
      skipped.push({ path: filePath, reason: "No changed lines in patch" });
      continue;
    }

    if (totalChangedLines + stats.changedLines > maxDiffLines) {
      skipped.push({
        path: filePath,
        reason: `Skipped by maxDiffLines guardrail (${maxDiffLines})`,
      });
      continue;
    }

    let finalPatch = patch;
    let truncated = false;
    if (finalPatch.length > maxCharsPerFile) {
      finalPatch =
        finalPatch.slice(0, maxCharsPerFile) +
        "\n\n# [truncated by mp-sentinel maxCharsPerFile]";
      truncated = true;
    }

    totalChangedLines += stats.changedLines;
    accepted.push({
      path: filePath,
      patch: finalPatch,
      additions: stats.additions,
      deletions: stats.deletions,
      changedLines: stats.changedLines,
      truncated,
    });
  }

  return {
    files: accepted,
    skipped,
    totalChangedLines,
  };
};
