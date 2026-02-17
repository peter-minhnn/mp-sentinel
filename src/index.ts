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
  isGitRepository,
  getCurrentBranch,
} from "./utils/git.js";
import { log, setLogQuietMode } from "./utils/logger.js";
import { parseCliArgs } from "./cli/args.js";
import { showHelp, showVersion } from "./cli/help.js";
import { runLocalReview } from "./cli/local-review.js";
import { runReview } from "./cli/review.js";
import { isTypedError, SystemError, UserError } from "./utils/errors.js";

// Load environment variables
dotenv.config();

/**
 * Main CLI execution
 */
const run = async (): Promise<void> => {
  const startTime = performance.now();
  const { command, values, positionals, commandPositionals } = parseCliArgs();
  const requestedFormat = values.format ?? process.env.MP_SENTINEL_FORMAT;
  const quietLogs =
    requestedFormat === "json" || requestedFormat === "markdown";
  setLogQuietMode(quietLogs);

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
    throw new SystemError("Not a git repository. Please run from a git project root.");
  }

  // Load configuration
  const config: ProjectConfig = await loadProjectConfig();
  const maxConcurrency =
    parseInt(
      values.concurrency ??
        process.env.MP_SENTINEL_CONCURRENCY ??
        String(config.maxConcurrency ?? 5),
      10,
    ) || 5;
  const targetBranch =
    values["target-branch"] ?? process.env.TARGET_BRANCH ?? "origin/main";

  const currentBranch = await getCurrentBranch();
  const isLocalMode = values.local;

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

  // Execute mode
  if (isLocalMode) {
    process.exitCode = await runLocalReview({
      values,
      config,
      currentBranch,
      maxConcurrency,
      startTime,
    });
  } else {
    process.exitCode = await runReview({
      values,
      commandPositionals: command === "review" ? commandPositionals : positionals,
      config,
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
  if (isTypedError(error)) {
    if (error instanceof UserError) {
      log.error(error.message);
    } else {
      log.critical(error.message);
    }
  } else {
    log.critical(
      `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  process.exitCode = 2;
});
