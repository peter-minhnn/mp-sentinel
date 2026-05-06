/**
 * Local Review Mode
 * Handles commit-based code review directly on the current branch
 * without requiring CI/CD pipelines
 */

import type { ProjectConfig, CommitInfo } from "../types/index.js";
import {
  getRecentCommits,
  getFilesFromCommits,
  getUncommittedFiles,
  matchCommitPattern,
  shouldSkipCommit,
} from "../utils/git.js";
import prompts from "prompts";
import { getSecurityService } from "../services/security/index.js";
import { readFilesForAudit } from "../services/file.js";
import { FileHandler } from "../services/file-handler/index.js";
import { auditCommit, auditFilesWithConcurrency, AIConfig } from "../services/ai/index.js";
import { generatePayloadSummary, resolveTokenLimit } from "../utils/tokens.js";
import { buildSystemPrompt } from "../config/prompts.js";
import { log } from "../utils/logger.js";
import { printResultsSummary } from "./summary.js";
import { runDeterministicReview } from "./deterministic-review.js";
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
export const runLocalReview = async (options: LocalReviewOptions): Promise<number> => {
  const { values, config, currentBranch, maxConcurrency, startTime } = options;

  const parsedCommits = values.commits ? parseInt(values.commits, 10) : undefined;
  const commitCount =
    parsedCommits || config.localReview?.commitCount || (values.interactive ? 15 : 1);
  const isBranchDiffMode = values["branch-diff"] || config.localReview?.branchDiffMode || false;
  const compareBranch =
    values["compare-branch"] || config.localReview?.compareBranch || "origin/main";
  const verbosePatternMatching = config.localReview?.verbosePatternMatching || values.verbose;
  const commitSha = values.commit;

  log.header("🔍 Local Review Mode");

  if (commitSha) {
    log.info(`Reviewing specific commit: ${commitSha} on branch: ${currentBranch}`);
  } else if (isBranchDiffMode) {
    log.info(`Comparing branch '${currentBranch}' against '${compareBranch}'`);
  } else {
    log.info(`Reviewing ${commitCount} recent commit(s) on branch: ${currentBranch}`);
  }

  // Get recent commits (with branch diff mode support)
  const recentCommits = await getRecentCommits({
    count: commitCount,
    includeMergeCommits: config.localReview?.includeMergeCommits ?? false,
    branchDiffMode: isBranchDiffMode,
    compareBranch,
    fetch: values.fetch,
    ...(commitSha ? { commitSha } : {}),
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
  let commitsToReview = filterCommits(
    recentCommits,
    config,
    verbosePatternMatching,
    values.verbose,
  );

  if (commitsToReview.length === 0) {
    log.success("No commits match the review criteria.");
    log.info(`${recentCommits.length} commit(s) scanned, 0 matched.`);
    // Always show a few example skipped commits so users can diagnose filter issues
    for (const c of recentCommits.slice(0, 3)) {
      log.file(`  ↳ ${c.hash.slice(0, 7)}: "${c.message}"`);
    }
    if (values.verbose && (config.localReview?.filterByPattern ?? false)) {
      log.info(`Patterns configured: ${(config.localReview?.commitPatterns ?? []).length}`);
    }
    return 0;
  }

  // Interactive Commit Picker Mode
  if (values.interactive) {
    const { selectedHashes } = await prompts({
      type: "multiselect",
      name: "selectedHashes",
      message: "Select commits to review:",
      choices: commitsToReview.map((c) => ({
        title: `${c.hash.slice(0, 7)}: ${c.message}`,
        value: c.hash,
        selected: true,
      })),
      instructions: false,
    });

    if (!selectedHashes || selectedHashes.length === 0) {
      log.warning("No commits selected via interactive mode. Exiting.");
      return 0;
    }

    commitsToReview = commitsToReview.filter((c) => selectedHashes.includes(c.hash));
  }

  // Print commits being reviewed
  printCommitList(commitsToReview);

  let hasErrors = false;
  const dryRun = values["dry-run"] || values["verbose-dry-run"];
  const verboseDryRun = values["verbose-dry-run"];
  const aiAvailability = AIConfig.probeEnvironment({ modelTier: config.ai?.modelTier });
  const aiEnabled = aiAvailability.status === "ready";

  if (!dryRun && !aiEnabled) {
    log.warning(
      `AI unavailable: ${aiAvailability.reason}. Skipping commit-message review and using deterministic non-AI review (secret redaction + risk analyzer; not a full AI substitute).`,
    );
  }

  // Audit commit messages
  if (!values["skip-commit"] && aiEnabled) {
    hasErrors = await auditCommitMessages(commitsToReview, config);
  }

  // Get all unique files from all commits to review
  const filesToAudit = getFilesFromCommits(commitsToReview);

  // Mixed Uncommitted Mode
  if (values["include-uncommitted"]) {
    log.info("Including uncommitted changes (staged and unstaged) in the review scope...");
    const uncommittedFiles = await getUncommittedFiles();
    if (uncommittedFiles.length > 0) {
      log.info(`Found ${uncommittedFiles.length} uncommitted file(s).`);
      for (const f of uncommittedFiles) {
        if (!filesToAudit.includes(f)) {
          filesToAudit.push(f);
        }
      }
    }
  }

  if (filesToAudit.length === 0) {
    log.success("No code files changed in the reviewed scope.");
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

  // 1. FILTER FILES WITH .mp-sentinelrc.json IGNORE PATTERNS
  const fileHandler = new FileHandler();
  const filterResult = await fileHandler.filterPathsWithIgnores(
    fileReadResult.success.map((f) => f.path),
  );

  const acceptedFilePaths = new Set(filterResult.accepted);
  const acceptedFiles = fileReadResult.success.filter((f) => acceptedFilePaths.has(f.path));

  if (filterResult.rejected.length > 0) {
    log.warning(`⚠️  Skipped ${filterResult.rejected.length} file(s) due to ignore rules:`);
    for (const { path, reason } of filterResult.rejected) {
      if (values.verbose) log.file(`   ❌ ${path}: ${reason}`);
    }
  }

  if (acceptedFiles.length === 0) {
    log.success("All changed files were ignored. Nothing to review.");
    return hasErrors ? 1 : 0;
  }

  // 2. SECURITY SANITIZATION
  const securityService = getSecurityService();
  const { sanitizedFiles, redactionReport } = securityService.sanitizeFiles(
    acceptedFiles.map((file) => ({ path: file.path, content: file.content })),
  );

  // 3. DRY RUN / TOKEN ESTIMATION
  if (dryRun) {
    // Attempt token estimation
    let providerName: string | undefined;
    try {
      const providerConfig = AIConfig.fromEnvironment({ modelTier: config.ai?.modelTier });
      providerName = providerConfig.provider;
    } catch {
      // Ignored
    }
    const cliLimit = values["token-limit"] ? parseInt(values["token-limit"], 10) : 0;
    const envLimit = Number(process.env.MP_SENTINEL_TOKEN_LIMIT) || 0;
    const tokenLimit = resolveTokenLimit(
      providerName,
      cliLimit || envLimit || config.ai?.tokenLimit,
    );

    let systemPromptForEstimate: string | undefined;
    try {
      systemPromptForEstimate = await buildSystemPrompt(config);
    } catch {
      // Ignored
    }

    const { exceeded, total, perFile } = await generatePayloadSummary(
      sanitizedFiles,
      tokenLimit,
      systemPromptForEstimate,
      "Code to review:\n",
      values.verbose || verboseDryRun,
    );

    log.info(
      `DRY-RUN preview: ${sanitizedFiles.length} file(s), ~${total.toLocaleString()} estimated tokens (limit: ${tokenLimit.toLocaleString()})`,
    );

    if (verboseDryRun && perFile.length > 0) {
      log.info("Per-file token breakdown:");
      const sorted = [...perFile].sort((a, b) => b.tokens - a.tokens);
      for (const f of sorted) {
        log.file(`   ${f.path}: ~${f.tokens.toLocaleString()} tokens`);
      }
    }

    if (exceeded) {
      log.warning(
        "WARNING: Token limit exceeded! You should reduce localReview.commitCount or ignore more files.",
      );
    }

    return 0; // End early for dry-run
  }

  const aiResults = aiEnabled
    ? await auditFilesWithConcurrency(sanitizedFiles, config, maxConcurrency)
    : undefined;

  const auditResults = runDeterministicReview(sanitizedFiles, redactionReport, aiResults);

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
 * Check if a commit message matches any of the given exclude regex patterns.
 * Invalid regex patterns are skipped with a warning.
 */
const matchesExcludePattern = (
  message: string,
  excludePatterns: string[],
  verbose: boolean,
): boolean => {
  for (const raw of excludePatterns) {
    try {
      if (new RegExp(raw, "i").test(message)) {
        return true;
      }
    } catch {
      if (verbose) {
        log.warning(`Invalid excludePattern regex: "${raw}" — skipping.`);
      }
    }
  }
  return false;
};

/**
 * Filter commits based on skip patterns, exclude patterns, and commit patterns from config
 */
const filterCommits = (
  commits: CommitInfo[],
  config: ProjectConfig,
  verbosePatternMatching: boolean,
  verbose: boolean,
): CommitInfo[] => {
  let filtered: CommitInfo[] = commits;
  const skipPatterns = config.localReview?.skipPatterns ?? [];
  const excludePatterns = config.localReview?.excludePatterns ?? [];
  const commitPatterns = config.localReview?.commitPatterns ?? [];
  const filterByPattern = config.localReview?.filterByPattern ?? false;
  const patternMatchMode = config.localReview?.patternMatchMode || "any";

  // Filter out skipped commits (simple prefix/substring match)
  if (skipPatterns.length > 0) {
    filtered = filtered.filter((commit) => {
      const shouldSkip = shouldSkipCommit(commit.message, skipPatterns);
      if (shouldSkip && verbosePatternMatching) {
        log.skip(`Skipping commit: ${commit.hash.slice(0, 7)} - "${commit.message}"`);
      }
      return !shouldSkip;
    });
  }

  // Filter out excluded commits (advanced regex match)
  if (excludePatterns.length > 0) {
    filtered = filtered.filter((commit) => {
      const excluded = matchesExcludePattern(commit.message, excludePatterns, verbose);
      if (excluded && verbosePatternMatching) {
        log.skip(
          `Excluding commit (excludePattern): ${commit.hash.slice(0, 7)} - "${commit.message}"`,
        );
      }
      return !excluded;
    });
  }

  // Filter by commit patterns if enabled
  if (filterByPattern && commitPatterns.length > 0) {
    if (verbosePatternMatching) {
      log.info(`Filtering commits by pattern (mode: ${patternMatchMode})`);
      log.info(`Available patterns: ${commitPatterns.map((p) => p.type || p.pattern).join(", ")}`);
    }

    filtered = filtered.filter((commit) => {
      const result = matchCommitPattern(commit.message, commitPatterns, {
        mode: patternMatchMode,
        // Pass excludePatterns for 'exclude-first' mode
        excludePatterns,
      });

      if (!result.matched && verbosePatternMatching) {
        log.warning(`❌ No match: ${commit.hash.slice(0, 7)} - "${commit.message}"`);
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
    console.log(`   ${commit.hash.slice(0, 7)} | ${commit.author} | ${commit.message}`);
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
      log.error(`✗ ${commit.hash.slice(0, 7)}: ${commitResult.message ?? "Invalid format"}`);
      if (commitResult.suggestion) {
        log.file(`  💡 ${commitResult.suggestion}`);
      }
      hasErrors = true;
    }
  }
  console.log();

  return hasErrors;
};
