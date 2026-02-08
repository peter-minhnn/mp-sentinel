/**
 * Git utilities with async support and better error handling
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { CommitInfo, CommitPattern } from '../types/index.js';

const execAsync = promisify(exec);

const SUPPORTED_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|py|cs|go|java|rs|kt|swift)$/;

export interface GitDiffOptions {
  targetBranch?: string;
  extensions?: RegExp;
}

export interface GetRecentCommitsOptions {
  count?: number;
  includeMergeCommits?: boolean;
  extensions?: RegExp;
}

/**
 * Get last commit message asynchronously
 */
export const getLastCommitMessage = async (): Promise<string> => {
  try {
    const { stdout } = await execAsync('git log -1 --pretty=%B');
    return stdout.trim();
  } catch {
    return '';
  }
};

/**
 * Get recent commits with their details for local review mode
 * This allows reviewing multiple commits without CI/CD
 */
export const getRecentCommits = async (options: GetRecentCommitsOptions = {}): Promise<CommitInfo[]> => {
  const { 
    count = 1, 
    includeMergeCommits = false,
    extensions = SUPPORTED_EXTENSIONS 
  } = options;

  try {
    // Get commit hashes with message, author, and date
    const noMergesFlag = includeMergeCommits ? '' : '--no-merges';
    const format = '%H|%s|%an|%ai';
    const command = `git log -${count} ${noMergesFlag} --pretty=format:"${format}"`;
    const { stdout } = await execAsync(command);
    
    if (!stdout.trim()) {
      return [];
    }

    const commitLines = stdout.trim().split('\n');
    const commits: CommitInfo[] = [];

    for (const line of commitLines) {
      const [hash, message, author, date] = line.split('|');
      if (!hash) continue;

      // Get files changed in this commit
      const files = await getFilesInCommit(hash, extensions);
      
      commits.push({
        hash: hash.trim(),
        message: message?.trim() || '',
        author: author?.trim() || '',
        date: date?.trim() || '',
        files,
      });
    }

    return commits;
  } catch {
    console.warn('⚠️  Failed to get recent commits.');
    return [];
  }
};

/**
 * Get list of files changed in a specific commit
 */
export const getFilesInCommit = async (
  commitHash: string, 
  extensions: RegExp = SUPPORTED_EXTENSIONS
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
 * Check if a commit message matches any of the specified patterns
 */
export const matchCommitPattern = (
  message: string, 
  patterns: CommitPattern[]
): { matched: boolean; pattern?: CommitPattern } => {
  for (const p of patterns) {
    try {
      const regex = new RegExp(p.pattern, 'i');
      if (regex.test(message)) {
        return { matched: true, pattern: p };
      }
    } catch {
      // Invalid regex, skip this pattern
      continue;
    }
  }
  return { matched: false };
};

/**
 * Check if a commit message should be skipped based on skip patterns
 */
export const shouldSkipCommit = (
  message: string, 
  skipPatterns: string[]
): boolean => {
  const lowerMessage = message.toLowerCase();
  return skipPatterns.some(pattern => 
    lowerMessage.includes(pattern.toLowerCase())
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
export const getChangedFiles = async (options: GitDiffOptions = {}): Promise<string[]> => {
  const { targetBranch = 'origin/main', extensions = SUPPORTED_EXTENSIONS } = options;

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
      console.warn('⚠️  Git diff failed. No files to audit.');
      return [];
    }
  }
};

/**
 * Check if current directory is a git repository
 */
export const isGitRepository = async (): Promise<boolean> => {
  try {
    await execAsync('git rev-parse --is-inside-work-tree');
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
    const { stdout } = await execAsync('git branch --show-current');
    return stdout.trim();
  } catch {
    return 'unknown';
  }
};

const parseAndFilterFiles = (output: string, extensions: RegExp): string[] => {
  return output
    .split('\n')
    .map(file => file.trim())
    .filter(file => file.length > 0)
    .filter(file => extensions.test(file));
};

