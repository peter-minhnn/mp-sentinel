/**
 * Local Review Mode
 * Handles commit-based code review directly on the current branch
 * without requiring CI/CD pipelines
 */

import type { ProjectConfig, CommitInfo } from "../types/index.js";
import {
  getRecentCommits,
  getFilesFromCommits,
  matchCommitPattern,
  shouldSkipCommit,
} from "../utils/git.js";
import { readFilesForAudit } from "../services/file.js";
import { auditCommit, auditFilesWithConcurrency } from "../services/ai.js";
import { log } from "../utils/logger.js";
import { printResultsSummary } from "./summary.js";
import type { CLIValues } from "./args.js";

export interface LocalReviewOptions {
  values: CLIValues;
  config: ProjectConfig;
  currentBranch: string;
  maxConcurrency: number;
  startTime: number;
}

/**
 * Execute local review mode
 * Returns process exit code (0 = success, 1 = failure)
 */
export const runLocalReview = async (
  options: LocalReviewOptions,
): Promise<number> => {
  const { values, config, currentBranch, maxConcurrency, startTime } = options;

  const commitCount =
    parseInt(values.commits, 10) || config.localReview?.commitCount || 1;
  const isBranchDiffMode =
    values["branch-diff"] || config.localReview?.branchDiffMode || false;
  const compareBranch =
    values["compare-branch"] ||
    config.localReview?.compareBranch ||
    "origin/main";
  const verbosePatternMatching =
    config.localReview?.verbosePatternMatching || values.verbose;

  log.header("🔍 Local Review Mode");

  if (isBranchDiffMode) {
    log.info(`Comparing branch '${currentBranch}' against '${compareBranch}'`);
  } else {
    log.info(
      `Reviewing ${commitCount} recent commit(s) on branch: ${currentBranch}`,
    );
  }

  // Get recent commits (with branch diff mode support)
  const recentCommits = await getRecentCommits({
    count: commitCount,
    includeMergeCommits: config.localReview?.includeMergeCommits ?? false,
    branchDiffMode: isBranchDiffMode,
    compareBranch,
  });

  if (recentCommits.length === 0) {
    if (isBranchDiffMode) {
      log.success(`No commits differ from '${compareBranch}'.`);
    } else {
      log.warning("No commits found to review.");
    }
    return 0;
  }

  log.info(`Found ${recentCommits.length} commit(s) to analyze`);

  // Filter commits based on patterns
  const commitsToReview = filterCommits(
    recentCommits,
    config,
    verbosePatternMatching,
    values.verbose,
  );

  if (commitsToReview.length === 0) {
    log.success("No commits match the review criteria.");
    if (values.verbose && (config.localReview?.filterByPattern ?? false)) {
      log.info(`Total commits scanned: ${recentCommits.length}`);
      log.info(
        `Patterns configured: ${(config.localReview?.commitPatterns ?? []).length}`,
      );
    }
    return 0;
  }

  // Print commits being reviewed
  printCommitList(commitsToReview);

  let hasErrors = false;

  // Audit commit messages
  if (!values["skip-commit"]) {
    hasErrors = await auditCommitMessages(commitsToReview, config);
  }

  // Get all unique files from all commits to review
  const filesToAudit = getFilesFromCommits(commitsToReview);

  if (filesToAudit.length === 0) {
    log.success("No code files changed in the reviewed commits.");
    return hasErrors ? 1 : 0;
  }

  log.info(
    `Found ${filesToAudit.length} unique file(s) across ${commitsToReview.length} commit(s)`,
  );

  // Read and audit files
  const fileReadResult = await readFilesForAudit(filesToAudit);

  if (fileReadResult.success.length === 0) {
    log.warning("No files could be read for auditing.");
    return 1;
  }

  const auditResults = await auditFilesWithConcurrency(
    fileReadResult.success.map((f) => ({ path: f.path, content: f.content })),
    config,
    maxConcurrency,
  );

  // Print summary
  const auditDuration = performance.now() - startTime;
  const allPassed = printResultsSummary(auditResults, auditDuration);

  if (!allPassed) {
    hasErrors = true;
  }

  // Final exit for local mode
  if (hasErrors) {
    log.critical("Local Review Failed: Issues found.");
    return 1;
  }

  log.success("Local Review Complete! All checks passed! ✨");
  return 0;
};

// ──────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Filter commits based on skip patterns and commit patterns from config
 */
const filterCommits = (
  commits: CommitInfo[],
  config: ProjectConfig,
  verbosePatternMatching: boolean,
  verbose: boolean,
): CommitInfo[] => {
  let filtered: CommitInfo[] = commits;
  const skipPatterns = config.localReview?.skipPatterns ?? [];
  const commitPatterns = config.localReview?.commitPatterns ?? [];
  const filterByPattern = config.localReview?.filterByPattern ?? false;
  const patternMatchMode = config.localReview?.patternMatchMode || "any";

  // Filter out skipped commits
  if (skipPatterns.length > 0) {
    filtered = filtered.filter((commit) => {
      const shouldSkip = shouldSkipCommit(commit.message, skipPatterns);
      if (shouldSkip && verbosePatternMatching) {
        log.skip(
          `Skipping commit: ${commit.hash.slice(0, 7)} - "${commit.message}"`,
        );
      }
      return !shouldSkip;
    });
  }

  // Filter by commit patterns if enabled
  if (filterByPattern && commitPatterns.length > 0) {
    if (verbosePatternMatching) {
      log.info(`Filtering commits by pattern (mode: ${patternMatchMode})`);
      log.info(
        `Available patterns: ${commitPatterns.map((p) => p.type || p.pattern).join(", ")}`,
      );
    }

    filtered = filtered.filter((commit) => {
      const result = matchCommitPattern(commit.message, commitPatterns, {
        mode: patternMatchMode,
      });

      if (!result.matched && verbosePatternMatching) {
        log.warning(
          `❌ No match: ${commit.hash.slice(0, 7)} - "${commit.message}"`,
        );
        if (result.unmatchedRequiredPatterns.length > 0) {
          log.file(
            `   Missing required patterns: ${result.unmatchedRequiredPatterns.map((p) => p.type).join(", ")}`,
          );
        }
      }
      if (result.matched && verbosePatternMatching) {
        const matchedTypes = result.matchedPatterns
          .map((p) => p.type || p.description || p.pattern)
          .join(", ");
        log.success(`✓ Matched [${matchedTypes}]: ${commit.hash.slice(0, 7)}`);
      }
      return result.matched;
    });
  }

  return filtered;
};

/**
 * Print formatted list of commits to be reviewed
 */
const printCommitList = (commits: CommitInfo[]): void => {
  console.log();
  log.info(`📋 Commits to review (${commits.length}):`);
  for (const commit of commits) {
    console.log(
      `   ${commit.hash.slice(0, 7)} | ${commit.author} | ${commit.message}`,
    );
  }
  console.log();
};

/**
 * Audit commit messages and return whether any errors were found
 */
const auditCommitMessages = async (
  commits: CommitInfo[],
  config: ProjectConfig,
): Promise<boolean> => {
  let hasErrors = false;

  log.info("Validating commit messages...");
  for (const commit of commits) {
    const commitResult = await auditCommit(commit.message, config);

    if (commitResult.status === "PASS") {
      log.success(`✓ ${commit.hash.slice(0, 7)}: OK`);
    } else {
      log.error(
        `✗ ${commit.hash.slice(0, 7)}: ${commitResult.message ?? "Invalid format"}`,
      );
      if (commitResult.suggestion) {
        log.file(`  💡 ${commitResult.suggestion}`);
      }
      hasErrors = true;
    }
  }
  console.log();

  return hasErrors;
};
