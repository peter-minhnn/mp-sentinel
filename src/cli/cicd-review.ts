/**
 * CI/CD Review Mode
 * Default mode: uses git diff against a target branch
 * Supports GitHub Actions and GitLab CI/CD integration
 */

import type { FileAuditResult, ProjectConfig } from "../types/index.js";
import { getChangedFiles } from "../utils/git.js";
import { readFilesForAudit } from "../services/file.js";
import { getSecurityService } from "../services/security/index.js";
import { auditCommit, auditFilesWithConcurrency } from "../services/ai.js";
import { AIConfig } from "../services/ai/config.js";
import { log } from "../utils/logger.js";
import { printResultsSummary } from "./summary.js";
import { createSecurityOnlyResults } from "./review.js";
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
      `AI unavailable: ${aiAvailability.reason}. Falling back to deterministic security-only review.`,
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

  // Audit with concurrency or deterministic security-only fallback
  const auditResults = aiEnabled
    ? await auditFilesWithConcurrency(sanitizedFiles, config, maxConcurrency)
    : createSecurityOnlyResults(sanitizedFiles, redactionReport);

  // Git Provider Integration (GitHub/GitLab) — lazy-loaded
  await postGitProviderComments(auditResults);

  // Print summary
  const auditDuration = performance.now() - startTime;
  const allPassed = printResultsSummary(auditResults, auditDuration);

  return allPassed ? 0 : 1;
};

/**
 * Post review comments to git provider (GitHub/GitLab) if available
 */
const postGitProviderComments = async (auditResults: FileAuditResult[]): Promise<void> => {
  try {
    const gitProvider = await import("../services/git-provider.js").then((m) => m.getGitProvider());

    if (!gitProvider) return;

    log.info("Git Provider detected. Posting comments for issues...");

    const failedAudits = auditResults.filter(
      (r) => r.result.status === "FAIL" && r.result.issues && r.result.issues.length > 0,
    );

    for (const audit of failedAudits) {
      for (const issue of audit.result.issues ?? []) {
        await gitProvider.postComment(audit.filePath, issue.line, issue);
      }
    }
  } catch {
    // Git provider not available — silently skip
  }
};
