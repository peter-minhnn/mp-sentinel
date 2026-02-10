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

import type { ProjectConfig } from "./types/index.js";
import { loadProjectConfig } from "./utils/config.js";
import {
  getLastCommitMessage,
  isGitRepository,
  getCurrentBranch,
} from "./utils/git.js";
import { log } from "./utils/logger.js";
import { parseCliArgs } from "./cli/args.js";
import { showHelp, showVersion } from "./cli/help.js";
import { runLocalReview } from "./cli/local-review.js";
import { runCICDReview } from "./cli/cicd-review.js";

// Load environment variables
dotenv.config();

/**
 * Main CLI execution
 */
const run = async (): Promise<void> => {
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

  // Get commit message and current branch
  const commitMsg = await getLastCommitMessage();
  const currentBranch = await getCurrentBranch();

  // Check if local review mode is enabled (via CLI flag or config)
  const isLocalMode = values.local || config.localReview?.enabled;

  if (values.verbose) {
    logVerboseInfo(
      values,
      config,
      currentBranch,
      targetBranch,
      maxConcurrency,
      isLocalMode,
    );
  }

  // Check bypass
  const bypassKey = config.bypassKeyword ?? "skip:";
  if (commitMsg.toLowerCase().includes(bypassKey.toLowerCase())) {
    log.skip(`BYPASS DETECTED in commit message: "${commitMsg}"`);
    log.skip("Skipping Audit Checks as requested.");
    process.exitCode = 0;
    return;
  }

  // Execute appropriate mode
  if (isLocalMode) {
    process.exitCode = await runLocalReview({
      values,
      config,
      currentBranch,
      maxConcurrency,
      startTime,
    });
  } else {
    process.exitCode = await runCICDReview({
      values,
      positionals,
      config,
      commitMsg,
      targetBranch,
      maxConcurrency,
      startTime,
    });
  }
};

/**
 * Log verbose debugging information
 */
const logVerboseInfo = (
  values: ReturnType<typeof parseCliArgs>["values"],
  config: ProjectConfig,
  currentBranch: string,
  targetBranch: string,
  maxConcurrency: number,
  isLocalMode: boolean | undefined,
): void => {
  log.info(`Current branch: ${currentBranch}`);
  log.info(`Target branch: ${targetBranch}`);
  log.info(`Max concurrency: ${maxConcurrency}`);

  if (isLocalMode) {
    const isBranchDiffMode =
      values["branch-diff"] || config.localReview?.branchDiffMode || false;
    const compareBranch =
      values["compare-branch"] ||
      config.localReview?.compareBranch ||
      "origin/main";
    const patternMatchMode = config.localReview?.patternMatchMode || "any";

    log.info(`Mode: Local Review`);
    if (isBranchDiffMode) {
      log.info(`Branch Diff Mode: ON (comparing with ${compareBranch})`);
    } else {
      const commitCount =
        parseInt(values.commits, 10) || config.localReview?.commitCount || 1;
      log.info(`Commits to review: ${commitCount}`);
    }
    log.info(`Pattern Match Mode: ${patternMatchMode}`);
  } else {
    log.info(`Mode: CI/CD (Git Diff)`);
  }
};

// Execute
run().catch((error: unknown) => {
  log.critical(
    `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
