#!/usr/bin/env node
/**
 * MP Sentinel - CLI Entry Point
 * High-performance CLI for AI-powered code auditing
 *
 * Supports two modes:
 * 1. CI/CD Mode: Runs through GitHub Actions or GitLab CI/CD
 * 2. Local Review Mode: Runs directly on a branch checking commits via npx mp-sentinel
 */

import * as dotenv from "dotenv";
import { parseArgs } from "node:util";

import type {
  ProjectConfig,
  FileAuditResult,
  CommitInfo,
} from "./types/index.js";
import { loadProjectConfig } from "./utils/config.js";
import {
  getLastCommitMessage,
  getChangedFiles,
  isGitRepository,
  getCurrentBranch,
  getRecentCommits,
  getFilesFromCommits,
  matchCommitPattern,
  shouldSkipCommit,
} from "./utils/git.js";
import { readFilesForAudit } from "./services/file.js";
import { auditCommit, auditFilesWithConcurrency } from "./services/ai.js";
import { log, formatDuration } from "./utils/logger.js";

// Load environment variables
dotenv.config();

// CLI Options interface
interface CLIValues {
  help: boolean;
  version: boolean;
  "skip-commit": boolean;
  "skip-files": boolean;
  "target-branch"?: string;
  concurrency: string;
  verbose: boolean;
  /** Enable local review mode - review commits directly on current branch */
  local: boolean;
  /** Number of recent commits to review in local mode (default: from config or 1) */
  commits: string;
  /** Enable branch diff mode - get all commits that differ from compare-branch */
  "branch-diff": boolean;
  /** Target branch to compare against for branch-diff mode (default: origin/main) */
  "compare-branch"?: string;
}

// CLI argument parsing
const parseCliArgs = (): { values: CLIValues; positionals: string[] } => {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
        "skip-commit": { type: "boolean", default: false },
        "skip-files": { type: "boolean", default: false },
        "target-branch": { type: "string", short: "b" },
        concurrency: { type: "string", short: "c", default: "5" },
        verbose: { type: "boolean", default: false },
        // Local review mode options
        local: { type: "boolean", short: "l", default: false },
        commits: { type: "string", short: "n", default: "1" },
        // Branch diff mode options
        "branch-diff": { type: "boolean", short: "d", default: false },
        "compare-branch": { type: "string" },
      },
    });
    return { values: values as CLIValues, positionals };
  } catch {
    return {
      values: {
        help: false,
        version: false,
        "skip-commit": false,
        "skip-files": false,
        concurrency: "5",
        verbose: false,
        local: false,
        commits: "1",
        "branch-diff": false,
      },
      positionals: [],
    };
  }
};

const showHelp = () => {
  console.log(`
🏗️  MP Sentinel - AI-powered Code Guardian

Usage: mp-sentinel [options] [files...]

CI/CD Mode (Default):
  Runs in CI/CD pipelines (GitHub Actions, GitLab CI) using git diff.

Local Review Mode:
  Run directly on your branch using commit-based review.
  Configure via .sentinelrc.json for commit patterns.

Options:
  -h, --help             Show this help message
  -v, --version          Show version number
  --skip-commit          Skip commit message validation
  --skip-files           Skip file auditing
  -b, --target-branch    Target branch for diff (default: origin/main)
  -c, --concurrency      Max concurrent file audits (default: 5)
  --verbose              Enable verbose output

Local Review Options:
  -l, --local            Enable local review mode (review commits directly)
  -n, --commits <N>      Number of recent commits to review (default: 1)
  -d, --branch-diff      Enable branch diff mode (get all commits since branching)
  --compare-branch <BR>  Target branch to compare (default: origin/main)

Examples:
  # CI/CD Mode (default)
  mp-sentinel                          # Audit commit + changed files
  mp-sentinel --skip-commit            # Audit only changed files
  mp-sentinel src/file.ts              # Audit specific file(s)
  mp-sentinel -b develop               # Diff against 'develop' branch

  # Local Review Mode
  npx mp-sentinel --local              # Review last commit on current branch
  npx mp-sentinel -l -n 5              # Review last 5 commits
  npx mp-sentinel --local --verbose    # Verbose local review

  # Branch Diff Mode (compare against target branch)
  npx mp-sentinel -l -d                # Review all commits since branching from origin/main
  npx mp-sentinel -l -d --compare-branch origin/develop  # Compare against develop

Configuration (.sentinelrc.json):
  {
    "localReview": {
      "enabled": true,
      "commitCount": 10,
      "branchDiffMode": true,
      "compareBranch": "origin/main",
      "commitPatterns": [
        { "type": "feat", "pattern": "^TICKET-\\\\d+", "description": "Feature commits" },
        { "type": "fix", "pattern": "^fix/TICKET-\\\\d+", "description": "Fix commits" }
      ],
      "filterByPattern": true,
      "patternMatchMode": "any",
      "skipPatterns": ["skip:", "wip:", "draft:"]
    }
  }
`);
};

const showVersion = () => {
  console.log("1.0.0");
};

/**
 * Print audit results summary
 */
const printResultsSummary = (
  results: FileAuditResult[],
  totalDuration: number,
): boolean => {
  const passed = results.filter((r) => r.result.status === "PASS");
  const failed = results.filter((r) => r.result.status === "FAIL");
  const criticalFiles = results.filter((r) =>
    r.result.issues?.some((i) => i.severity === "CRITICAL"),
  );

  log.divider();
  console.log();
  console.log(`📊 Audit Summary`);
  console.log(`   Total files:    ${results.length}`);
  console.log(`   ✅ Passed:       ${passed.length}`);
  console.log(`   ❌ Failed:       ${failed.length}`);
  console.log(`   🚨 Critical:     ${criticalFiles.length}`);
  console.log(`   ⏱️  Duration:     ${formatDuration(totalDuration)}`);
  console.log();

  // Check for system errors (failed status but no issues logged)
  const systemErrors = results.filter(
    (r) =>
      r.result.status === "FAIL" &&
      (!r.result.issues || r.result.issues.length === 0),
  );

  // Print detailed issues
  for (const result of failed) {
    console.log(`❌ ${result.filePath}:`);

    // If we have specific issues, list them
    if (result.result.issues && result.result.issues.length > 0) {
      for (const issue of result.result.issues) {
        log.issue(issue.severity, issue.line, issue.message);
        if (issue.suggestion) {
          log.file(`💡 ${issue.suggestion}`);
        }
      }
    } else {
      // Otherwise print the general error message
      log.error(result.result.message || "Unknown error occurred during audit");
    }
    console.log();
  }

  // Fail if there are critical issues OR system errors
  return criticalFiles.length === 0 && systemErrors.length === 0;
};

/**
 * Main CLI execution
 */
const run = async () => {
  const startTime = performance.now();
  const { values, positionals } = parseCliArgs();

  // Handle --help and --version
  if (values.help) {
    showHelp();
    process.exitCode = 0;
    return;
  }

  if (values.version) {
    showVersion();
    process.exitCode = 0;
    return;
  }

  // Check if in git repository
  if (!(await isGitRepository())) {
    log.error("Not a git repository. Please run from a git project root.");
    process.exitCode = 1;
    return;
  }

  log.header("MP Sentinel - Code Audit");

  // Load configuration
  const config: ProjectConfig = await loadProjectConfig();
  const maxConcurrency = parseInt(values.concurrency, 10) || 5;
  const targetBranch =
    values["target-branch"] ?? process.env.TARGET_BRANCH ?? "origin/main";

  // Get commit message
  const commitMsg = await getLastCommitMessage();
  const currentBranch = await getCurrentBranch();

  // Check if local review mode is enabled (via CLI flag or config)
  const isLocalMode = values.local || config.localReview?.enabled;
  const commitCount =
    parseInt(values.commits, 10) || config.localReview?.commitCount || 1;
  
  // Branch diff mode settings (CLI override config)
  const isBranchDiffMode = values["branch-diff"] || config.localReview?.branchDiffMode || false;
  const compareBranch = values["compare-branch"] || config.localReview?.compareBranch || "origin/main";
  const patternMatchMode = config.localReview?.patternMatchMode || "any";
  const verbosePatternMatching = config.localReview?.verbosePatternMatching || values.verbose;

  if (values.verbose) {
    log.info(`Current branch: ${currentBranch}`);
    log.info(`Target branch: ${targetBranch}`);
    log.info(`Max concurrency: ${maxConcurrency}`);
    if (isLocalMode) {
      log.info(`Mode: Local Review`);
      if (isBranchDiffMode) {
        log.info(`Branch Diff Mode: ON (comparing with ${compareBranch})`);
      } else {
        log.info(`Commits to review: ${commitCount}`);
      }
      log.info(`Pattern Match Mode: ${patternMatchMode}`);
    } else {
      log.info(`Mode: CI/CD (Git Diff)`);
    }
  }

  // Check bypass
  const bypassKey = config.bypassKeyword ?? "skip:";
  if (commitMsg.toLowerCase().includes(bypassKey.toLowerCase())) {
    log.skip(`BYPASS DETECTED in commit message: "${commitMsg}"`);
    log.skip("Skipping Audit Checks as requested.");
    process.exitCode = 0;
    return;
  }

  let hasErrors = false;

  // ============================================
  // LOCAL REVIEW MODE
  // Allows running reviews directly on a branch
  // without GitHub Actions or GitLab CI/CD
  // ============================================
  if (isLocalMode) {
    log.header("🔍 Local Review Mode");
    
    if (isBranchDiffMode) {
      log.info(
        `Comparing branch '${currentBranch}' against '${compareBranch}'`,
      );
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
      compareBranch: compareBranch,
    });

    if (recentCommits.length === 0) {
      if (isBranchDiffMode) {
        log.success(`No commits differ from '${compareBranch}'.`);
      } else {
        log.warning("No commits found to review.");
      }
      process.exitCode = 0;
      return;
    }

    log.info(`Found ${recentCommits.length} commit(s) to analyze`);


    // Filter commits based on patterns if configured
    let commitsToReview: CommitInfo[] = recentCommits;
    const skipPatterns = config.localReview?.skipPatterns ?? [];
    const commitPatterns = config.localReview?.commitPatterns ?? [];
    const filterByPattern = config.localReview?.filterByPattern ?? false;

    // Filter out skipped commits
    if (skipPatterns.length > 0) {
      commitsToReview = commitsToReview.filter((commit) => {
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
        log.info(`Available patterns: ${commitPatterns.map(p => p.type || p.pattern).join(", ")}`);
      }
      
      commitsToReview = commitsToReview.filter((commit) => {
        const result = matchCommitPattern(
          commit.message,
          commitPatterns,
          { mode: patternMatchMode }
        );
        
        if (!result.matched && verbosePatternMatching) {
          log.warning(
            `❌ No match: ${commit.hash.slice(0, 7)} - "${commit.message}"`,
          );
          if (result.unmatchedRequiredPatterns.length > 0) {
            log.file(`   Missing required patterns: ${result.unmatchedRequiredPatterns.map(p => p.type).join(", ")}`);
          }
        }
        if (result.matched && verbosePatternMatching) {
          const matchedTypes = result.matchedPatterns.map(p => p.type || p.description || p.pattern).join(", ");
          log.success(
            `✓ Matched [${matchedTypes}]: ${commit.hash.slice(0, 7)}`,
          );
        }
        return result.matched;
      });
    }

    if (commitsToReview.length === 0) {
      log.success("No commits match the review criteria.");
      if (values.verbose && filterByPattern) {
        log.info(`Total commits scanned: ${recentCommits.length}`);
        log.info(`Patterns configured: ${commitPatterns.length}`);
      }
      process.exitCode = 0;
      return;
    }

    // Print commits being reviewed
    console.log();
    log.info(`📋 Commits to review (${commitsToReview.length}):`);
    for (const commit of commitsToReview) {
      console.log(
        `   ${commit.hash.slice(0, 7)} | ${commit.author} | ${commit.message}`,
      );
    }
    console.log();

    // Audit commit messages
    if (!values["skip-commit"]) {
      log.info("Validating commit messages...");
      for (const commit of commitsToReview) {
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
    }

    // Get all unique files from all commits to review
    const filesToAudit = getFilesFromCommits(commitsToReview);

    if (filesToAudit.length === 0) {
      log.success("No code files changed in the reviewed commits.");
      process.exitCode = hasErrors ? 1 : 0;
      return;
    }

    log.info(
      `Found ${filesToAudit.length} unique file(s) across ${commitsToReview.length} commit(s)`,
    );

    // Read and audit files
    const fileReadResult = await readFilesForAudit(filesToAudit);

    if (fileReadResult.success.length === 0) {
      log.warning("No files could be read for auditing.");
      process.exitCode = 1;
      return;
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
      process.exitCode = 1;
    } else {
      log.success("Local Review Complete! All checks passed! ✨");
      process.exitCode = 0;
    }
    return;
  }

  // ============================================
  // CI/CD MODE (Default)
  // Uses git diff against target branch
  // ============================================

  // Audit commit message
  if (!values["skip-commit"] && commitMsg) {
    const commitResult = await auditCommit(commitMsg, config);

    if (commitResult.status === "PASS") {
      log.success("Commit Message: OK");
    } else {
      log.error(
        `Commit Message Invalid: ${commitResult.message ?? "Unknown error"}`,
      );
      if (commitResult.suggestion) {
        log.file(`💡 Suggestion: ${commitResult.suggestion}`);
      }
      hasErrors = true;
    }
  }

  // Get files to audit
  let filesToAudit: string[];

  if (positionals.length > 0) {
    // Check if the user accidentally used 'review' as a command
    if (positionals[0] === "review") {
      log.warning("The 'review' argument is being treated as a file path.");
      log.file(
        "Note: 'mp-sentinel review' is not a valid subcommand. Using default behavior.",
      );
    }

    // Use specified files
    filesToAudit = positionals;
    log.info(`Using ${filesToAudit.length} specified file(s)`);
  } else if (!values["skip-files"]) {
    // Get changed files from git
    filesToAudit = await getChangedFiles({ targetBranch });

    if (filesToAudit.length === 0) {
      log.success("No relevant code changes detected.");
      process.exitCode = hasErrors ? 1 : 0;
      return;
    }

    log.info(`Found ${filesToAudit.length} changed file(s) to audit`);
  } else {
    filesToAudit = [];
  }

  // Audit files
  if (filesToAudit.length > 0) {
    // Read files efficiently
    const fileReadResult = await readFilesForAudit(filesToAudit);

    if (fileReadResult.success.length === 0) {
      log.warning("No files could be read for auditing.");
      // If we failed to read any files, but there were files to audit, it's an error.
      process.exitCode = 1;
      return;
    }

    // Audit with concurrency
    const auditResults = await auditFilesWithConcurrency(
      fileReadResult.success.map((f) => ({ path: f.path, content: f.content })),
      config,
      maxConcurrency,
    );

    // Git Provider Integration (GitHub/GitLab)
    const gitProvider = await import("./services/git-provider.js").then((m) =>
      m.getGitProvider(),
    );

    if (gitProvider) {
      log.info("Git Provider detected. Posting comments for issues...");
      // Post comments for failed audits
      const failedAudits = auditResults.filter(
        (r) =>
          r.result.status === "FAIL" &&
          r.result.issues &&
          r.result.issues.length > 0,
      );

      for (const audit of failedAudits) {
        for (const issue of audit.result.issues!) {
          await gitProvider.postComment(audit.filePath, issue.line, issue);
        }
      }
    }

    // Print summary
    const auditDuration = performance.now() - startTime;
    const allPassed = printResultsSummary(auditResults, auditDuration);

    if (!allPassed) {
      hasErrors = true;
    }
  }

  // Final exit
  if (hasErrors) {
    log.critical("Audit Failed: Critical issues found.");
    process.exitCode = 1;
  } else {
    log.success("All checks passed! ✨");
    process.exitCode = 0;
  }
};

// Execute
run().catch((error: unknown) => {
  log.critical(
    `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
