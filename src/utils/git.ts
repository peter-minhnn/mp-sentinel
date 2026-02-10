/**
 * Git utilities with async support and better error handling
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { CommitInfo, CommitPattern } from "../types/index.js";
import { log } from "./logger.js";

const execAsync = promisify(exec);

const SUPPORTED_EXTENSIONS =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|cs|go|java|rs|kt|swift)$/;

export interface GitDiffOptions {
  targetBranch?: string;
  extensions?: RegExp;
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
