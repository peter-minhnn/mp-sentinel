/**
 * CI/CD Review Mode
 * Default mode: uses git diff against a target branch
 * Supports GitHub Actions and GitLab CI/CD integration
 */

import type { ProjectConfig } from "../types/index.js";
import { getChangedFiles } from "../utils/git.js";
import { readFilesForAudit } from "../services/file.js";
import { getSecurityService } from "../services/security/index.js";
import { auditCommit, auditFilesWithConcurrency } from "../services/ai.js";
import { AIConfig } from "../services/ai/config.js";
import { log } from "../utils/logger.js";
import { printResultsSummary } from "./summary.js";
import { runDeterministicReview } from "./deterministic-review.js";
import { postGitProviderComments } from "../services/git-provider.js";
import type { CLIValues } from "./args.js";

export interface CICDReviewOptions {
  values: CLIValues;
  positionals: string[];
  config: ProjectConfig;
  commitMsg: string;
  targetBranch: string;
  maxConcurrency: number;
  startTime: number;
}

/**
 * Execute CI/CD review mode
 * Returns process exit code (0 = success, 1 = failure)
 */
export const runCICDReview = async (options: CICDReviewOptions): Promise<number> => {
  const { values, positionals, config, commitMsg, targetBranch, maxConcurrency, startTime } =
    options;

  let hasErrors = false;
  const aiAvailability = AIConfig.probeEnvironment({ modelTier: config.ai?.modelTier });
  const aiEnabled = aiAvailability.status === "ready";

  if (!aiEnabled) {
    log.warning(
      `AI unavailable: ${aiAvailability.reason}. Falling back to deterministic non-AI review (secret redaction + risk analyzer; not a full AI substitute).`,
    );
  }

  // Audit commit message
  if (!values["skip-commit"] && commitMsg && aiEnabled) {
    const commitResult = await auditCommit(commitMsg, config);

    if (commitResult.status === "PASS") {
      log.success("Commit Message: OK");
    } else {
      log.error(`Commit Message Invalid: ${commitResult.message ?? "Unknown error"}`);
      if (commitResult.suggestion) {
        log.file(`💡 Suggestion: ${commitResult.suggestion}`);
      }
      hasErrors = true;
    }
  } else if (!values["skip-commit"] && commitMsg && !aiEnabled) {
    log.warning("Commit-message review skipped because AI is unavailable.");
  }

  // Get files to audit
  const filesToAudit = await resolveFilesToAudit(positionals, values["skip-files"], targetBranch);

  if (filesToAudit === null) {
    // No files and no errors from skip-files
    return hasErrors ? 1 : 0;
  }

  // Audit files
  if (filesToAudit.length > 0) {
    const auditExitCode = await auditFileList(
      filesToAudit,
      config,
      maxConcurrency,
      startTime,
      aiEnabled,
    );
    if (auditExitCode !== 0) {
      hasErrors = true;
    }
  }

  // Final exit
  if (hasErrors) {
    log.critical("Audit Failed: Critical issues found.");
    return 1;
  }

  log.success("All checks passed! ✨");
  return 0;
};

// ──────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Resolve which files to audit based on CLI args or git diff
 * Returns null when no files need auditing (e.g., skip-files or no changes)
 */
const resolveFilesToAudit = async (
  positionals: string[],
  skipFiles: boolean,
  targetBranch: string,
): Promise<string[] | null> => {
  if (positionals.length > 0) {
    // Check if the user accidentally used 'review' as a command
    if (positionals[0] === "review") {
      log.warning("The 'review' argument is being treated as a file path.");
      log.file("Note: 'mp-sentinel review' is not a valid subcommand. Using default behavior.");
    }

    log.info(`Using ${positionals.length} specified file(s)`);
    return positionals;
  }

  if (!skipFiles) {
    const changedFiles = await getChangedFiles({ targetBranch });

    if (changedFiles.length === 0) {
      log.success("No relevant code changes detected.");
      return null;
    }

    log.info(`Found ${changedFiles.length} changed file(s) to audit`);
    return changedFiles;
  }

  return [];
};

/**
 * Audit a list of files with git provider integration
 * Returns 0 on success, 1 on failure
 */
const auditFileList = async (
  filePaths: string[],
  config: ProjectConfig,
  maxConcurrency: number,
  startTime: number,
  aiEnabled: boolean,
): Promise<number> => {
  const fileReadResult = await readFilesForAudit(filePaths);

  if (fileReadResult.success.length === 0) {
    log.warning("No files could be read for auditing.");
    return 1;
  }

  const securityService = getSecurityService();
  const { sanitizedFiles, redactionReport } = securityService.sanitizeFiles(
    fileReadResult.success.map((f) => ({ path: f.path, content: f.content })),
  );

  // Audit with concurrency + deterministic findings merged in
  const aiResults = aiEnabled
    ? await auditFilesWithConcurrency(sanitizedFiles, config, maxConcurrency)
    : undefined;

  const auditResults = runDeterministicReview(sanitizedFiles, redactionReport, aiResults);

  // Git Provider Integration (GitHub/GitLab)
  await postGitProviderComments(auditResults);

  // Print summary
  const auditDuration = performance.now() - startTime;
  const allPassed = printResultsSummary(auditResults, auditDuration);

  return allPassed ? 0 : 1;
};
