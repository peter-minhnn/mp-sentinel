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
import { isGitRepository, getCurrentBranch } from "./utils/git.js";
import { log, setLogQuietMode } from "./utils/logger.js";
import { parseCliArgs } from "./cli/args.js";
import { runLocalReview } from "./cli/local-review.js";
import { runReview } from "./cli/review.js";
import { isTypedError, SystemError, UserError } from "./utils/errors.js";

// Load environment variables
dotenv.config({ quiet: true });

// ── SIGINT handler — clean up progress bar on Ctrl+C ─────────────────────────
process.on("SIGINT", () => {
  // Move to a new line so the progress bar doesn't leave artefacts
  process.stdout.write("\n");
  log.warning("Interrupted by user (SIGINT). Exiting.");
  process.exit(130); // 128 + SIGINT(2)
});

/**
 * Force process exit after ensuring output streams are drained.
 * Review commands use this to prevent lingering after the report is printed.
 */
const exitAfterFlush = (code: number): void => {
  const flushStream = (stream: typeof process.stdout, done: () => void): void => {
    if (stream.writableLength > 0) {
      stream.write("", done);
      return;
    }
    done();
  };

  flushStream(process.stdout, () => {
    if (process.stderr.writableLength > 0) {
      process.stderr.write("", () => process.exit(code));
      return;
    }
    process.exit(code);
  });
};

/**
 * Main CLI execution
 */
const run = async (): Promise<void> => {
  const startTime = performance.now();
  const { command, values, positionals, commandPositionals } = parseCliArgs();
  const requestedFormat =
    command === "indexing"
      ? values["index-format"]
      : command === "create-skills"
        ? values["create-skills-format"]
        : (values.format ?? process.env.MP_SENTINEL_FORMAT);
  const quietLogs =
    values.quiet ||
    requestedFormat === "json" ||
    requestedFormat === "markdown" ||
    requestedFormat === "sarif";
  setLogQuietMode(quietLogs);

  // Handle indexing command with lazy loading
  if (command === "indexing") {
    try {
      const { runIndexingCommand } = await import("./commands/indexing.js");
      process.exitCode = await runIndexingCommand(values);
    } catch (error) {
      if (values["index-format"] === "json") {
        console.log(
          JSON.stringify({
            status: "ERROR",
            error: error instanceof Error ? error.message : "Indexing failed with unknown error",
          }),
        );
        process.exitCode = 2;
        return;
      }
      if (error instanceof Error) {
        log.critical(`Indexing failed: ${error.message}`);
      } else {
        log.critical("Indexing failed with unknown error");
      }
      process.exitCode = 2;
    }
    return;
  }

  // Handle create-skills command with lazy loading
  if (command === "create-skills") {
    try {
      const { runCreateSkillsCommand } = await import("./commands/create-skills.js");
      process.exitCode = await runCreateSkillsCommand({
        ...(typeof values.agent === "string" && { agent: values.agent }),
        "all-agents": values["all-agents"],
        ...(typeof values["create-skills-format"] === "string" && {
          "create-skills-format": values["create-skills-format"],
        }),
        "create-skills-force": values["create-skills-force"],
        "skip-index-refresh": values["skip-index-refresh"],
        "create-skills-dry-run": values["create-skills-dry-run"],
        "create-skills-check": values["create-skills-check"],
        "create-skills-no-ai-enrich": values["create-skills-no-ai-enrich"],
        ...(values["explain-agents"] === true && { "explain-agents": true }),
        ...(values["doctor"] === true && { doctor: true }),
      });
    } catch (error) {
      if (values["create-skills-format"] === "json") {
        console.log(
          JSON.stringify({
            status: "ERROR",
            error:
              error instanceof Error ? error.message : "create-skills failed with unknown error",
          }),
        );
        process.exitCode = 2;
        return;
      }
      if (error instanceof Error) {
        log.critical(`create-skills failed: ${error.message}`);
      } else {
        log.critical("create-skills failed with unknown error");
      }
      process.exitCode = 2;
    }
    return;
  }

  // Handle mcp-server command — routes before git/config review startup
  if (command === "mcp-server") {
    setLogQuietMode(true);
    try {
      const { runMCPServerCommand } = await import("./commands/mcp-server.js");
      process.exitCode = await runMCPServerCommand();
    } catch (error) {
      if (error instanceof Error) {
        process.stderr.write(`mcp-server failed: ${error.message}\n`);
      } else {
        process.stderr.write("mcp-server failed with unknown error\n");
      }
      process.exitCode = 2;
    }
    return;
  }

  // Check if in git repository (for review commands)
  if (!(await isGitRepository())) {
    throw new SystemError("Not a git repository. Please run from a git project root.");
  }

  // Load configuration
  const config: ProjectConfig = await loadProjectConfig();

  // CLI flag overrides
  if (values["no-skills-fetch"]) {
    config.enableSkillsFetch = false;
  }
  const _parsedConcurrency = parseInt(
    values.concurrency ?? process.env.MP_SENTINEL_CONCURRENCY ?? String(config.maxConcurrency ?? 5),
    10,
  );
  const maxConcurrency =
    Number.isFinite(_parsedConcurrency) && _parsedConcurrency > 0 ? _parsedConcurrency : 5;
  const targetBranch = values["target-branch"] ?? process.env.TARGET_BRANCH ?? "origin/main";

  const currentBranch = await getCurrentBranch();
  const isLocalMode = values.local;

  // Handle explain-context mode early (diagnostic only, no AI calls)
  if (values["explain-context"]) {
    const { renderExplainContext } = await import("./cli/review.js");
    await renderExplainContext({
      values,
      config,
      targetBranch,
      maxConcurrency,
      startTime,
    });
    return;
  }

  if (values.verbose) {
    logVerboseInfo(values, config, currentBranch, targetBranch, maxConcurrency, isLocalMode);
  }

  // Execute mode (review commands): force exit after report to prevent lingering.
  if (isLocalMode) {
    const exitCode = await runLocalReview({
      values,
      config,
      currentBranch,
      maxConcurrency,
      startTime,
    });
    exitAfterFlush(exitCode);
  } else {
    const cliTokenLimitRaw = values["token-limit"] ? parseInt(values["token-limit"], 10) : 0;
    const cliTokenLimit =
      Number.isFinite(cliTokenLimitRaw) && cliTokenLimitRaw > 0 ? cliTokenLimitRaw : 0;
    const exitCode = await runReview({
      values,
      commandPositionals: command === "review" ? commandPositionals : positionals,
      config,
      targetBranch,
      maxConcurrency,
      startTime,
      dryRun: values["dry-run"],
      verboseDryRun: values["verbose-dry-run"],
      ...(cliTokenLimit > 0 && { tokenLimitOverride: cliTokenLimit }),
    });
    exitAfterFlush(exitCode);
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
    const isBranchDiffMode = values["branch-diff"] || config.localReview?.branchDiffMode || false;
    const compareBranch =
      values["compare-branch"] || config.localReview?.compareBranch || "origin/main";
    const patternMatchMode = config.localReview?.patternMatchMode || "any";

    log.info(`Mode: Local Review`);
    if (isBranchDiffMode) {
      log.info(`Branch Diff Mode: ON (comparing with ${compareBranch})`);
    } else {
      const parsedCommits = values.commits ? parseInt(values.commits, 10) : undefined;
      const commitCount =
        parsedCommits || config.localReview?.commitCount || (values.interactive ? 15 : 1);
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
    log.critical(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exitCode = 2;
});
