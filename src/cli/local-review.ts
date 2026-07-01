/**
 * Local Review Mode
 * Handles commit-based code review directly on the current branch
 * without requiring CI/CD pipelines
 */

import type {
  ProjectConfig,
  CommitInfo,
  FileAuditResult,
  SeverityThreshold,
} from "../types/index.js";
import {
  getRecentCommits,
  getFilesFromCommits,
  getUncommittedFiles,
  matchCommitPattern,
  shouldSkipCommit,
  resolveRenamedPaths,
  getChangeStatsForTarget,
} from "../utils/git.js";
import prompts from "prompts";
import { getSecurityService } from "../services/security/index.js";
import { readFilesForAudit } from "../services/file.js";
import { FileHandler } from "../services/file-handler/index.js";
import { auditCommit, auditFilesWithConcurrency, AIConfig } from "../services/ai/index.js";
import { generatePayloadSummary, resolveTokenLimit } from "../utils/tokens.js";
import { buildSystemPrompt } from "../config/prompts.js";
import { log, setLogQuietMode } from "../utils/logger.js";
import { printResultsSummary } from "./summary.js";
import { gatherMCPContext } from "../services/mcp/index.js";
import { runDeterministicReview, runRulePackEvaluators } from "./deterministic-review.js";
import { readPackageManifest } from "../services/source-index/manifest.js";
import { buildIndexContext, buildReport } from "./review.js";
import { formatMarkdownReport } from "../formatters/report.js";
import { DEFAULT_PROMPT_VERSION } from "../config/prompts.js";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runESLintAdapter, isLintableFile } from "../services/eslint-adapter.js";
import { mergeFindings } from "../services/risk-analyzer/index.js";
import { dedupeFindings } from "../utils/dedupe-findings.js";
import { reconcileUnusedImportFindings } from "../utils/reconcile-unused-import-findings.js";
import {
  reconcileLodashBundleFindings,
  reconcileHookPlacementFindings,
  reconcileUnusedJsxFindings,
  reconcileAntdIconImportFindings,
} from "../utils/reconcile-false-positive-findings.js";
import { dedupeCrossCategoryFindings } from "../utils/dedupe-cross-category-findings.js";
import { capFindingsPerFile } from "../utils/cap-findings.js";
import { clampSeverities } from "../utils/severity-clamp.js";
import { verifyEvidence } from "../utils/verify-evidence.js";
import { verifyImportClaims } from "../utils/verify-import-claims.js";
import { verifySelfImportClaims } from "../utils/verify-self-import-claims.js";
import { verifyVersionClaims } from "../utils/verify-version-claims.js";
import { relocateFindingLines } from "../utils/relocate-lines.js";
import {
  downgradeBarrelExportClaims,
  downgradeBuildBreakClaims,
  downgradeDefensiveXssClaims,
  downgradeUnsinkedXssClaims,
  filterSelfNegatedFindings,
  flagVerbMismatchClaims,
  reclassifyWeakRandomFindings,
} from "../utils/finding-hygiene.js";
import type { CLIValues } from "./args.js";
import { resolveSeverityThreshold } from "../utils/severity.js";

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

  // Local mode emits a structured ReviewReport for `--format json` (stdout
  // stays JSON-only; logs already route to stderr/quiet). Other non-console
  // formats have no local renderer, so fall back to the console report with a
  // warning. Re-enable logs for that fallback unless the user asked for -q.
  const wantsJson = values.format === "json";
  if (!values.quiet && values.format && values.format !== "console" && !wantsJson) {
    setLogQuietMode(false);
    log.warning(
      `--format ${values.format} is not supported in local mode — rendering the console report.`,
    );
  }
  // Report target used for both the populated and the empty-result JSON paths.
  const reportCompareBranch = commitSha ?? (isBranchDiffMode ? compareBranch : "HEAD");
  // Any early return in JSON mode must still print a valid (empty) ReviewReport
  // so stdout is always parseable, never blank.
  const emitEmptyIfJson = (): void => {
    if (wantsJson) emitEmptyLocalJsonReport(reportCompareBranch, startTime);
  };

  // --no-cache: bypass the AI response cache for this run (pre-merge gates
  // should never serve findings from a previous prompt/file state).
  if (values["no-cache"]) {
    config.cacheEnabled = false;
    log.info("AI response cache bypassed for this run (--no-cache).");
  }

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
    emitEmptyIfJson();
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
    emitEmptyIfJson();
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

  // Chronological order (oldest first) — single source of truth for every
  // place commits are displayed, so "later commit" can never be misread.
  commitsToReview = sortCommitsChronologically(commitsToReview);

  // Print commits being reviewed (console-only: keeps JSON stdout clean).
  if (!wantsJson) printCommitList(commitsToReview);

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

  // Follow renames: commits list paths under their historical names, so files
  // renamed or deleted later in the range no longer exist on disk. Remap them
  // to their current path and drop deletions to avoid spurious "File not
  // found" skips. Range base = commit just before the oldest reviewed commit.
  const oldestCommit = commitsToReview[0];
  const rangeBase = oldestCommit ? `${oldestCommit.hash}^` : null;
  const renameResolution = await resolveRenamedPaths(filesToAudit, rangeBase);
  if (renameResolution.renamed.length > 0 || renameResolution.dropped.length > 0) {
    log.info(
      `Rename resolution: ${renameResolution.renamed.length} path(s) remapped to current names, ${renameResolution.dropped.length} deleted path(s) dropped.`,
    );
    if (values.verbose) {
      for (const { from, to } of renameResolution.renamed) log.file(`   ↪ ${from} → ${to}`);
      for (const path of renameResolution.dropped) log.file(`   ✗ ${path} (deleted in range)`);
    }
  }
  const resolvedFiles = renameResolution.paths;

  if (resolvedFiles.length === 0) {
    log.success("No code files changed in the reviewed scope.");
    emitEmptyIfJson();
    return hasErrors ? 1 : 0;
  }

  log.info(
    `Found ${resolvedFiles.length} unique file(s) across ${commitsToReview.length} commit(s)`,
  );

  // Read and audit files
  const fileReadResult = await readFilesForAudit(resolvedFiles);

  if (fileReadResult.success.length === 0) {
    log.warning("No files could be read for auditing.");
    emitEmptyIfJson();
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
    emitEmptyIfJson();
    return hasErrors ? 1 : 0;
  }

  // 2. SECURITY SANITIZATION
  const securityService = getSecurityService();
  const { sanitizedFiles, redactionReport } = securityService.sanitizeFiles(
    acceptedFiles.map((file) => ({ path: file.path, content: file.content })),
  );

  // 3. GATHER MCP CONTEXT (only when AI is enabled and not a dry run)
  const mcpContext =
    aiEnabled && !dryRun
      ? await gatherMCPContext(
          config,
          sanitizedFiles.map((f) => f.path),
          process.cwd(),
        )
      : null;

  // 3b. SOURCE INDEX CONTEXT — gives the AI cross-file awareness (dependents,
  // related symbols) so duplicate-logic and architecture findings are possible
  // in local mode, mirroring the CI/CD review path.
  const indexContext =
    aiEnabled && !dryRun
      ? await buildIndexContext(
          config,
          sanitizedFiles.map((f) => ({ path: f.path })),
          process.cwd(),
        )
      : null;

  // 4. DRY RUN / TOKEN ESTIMATION
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
      systemPromptForEstimate = await buildSystemPrompt(
        config,
        undefined,
        undefined,
        mcpContext ?? undefined,
      );
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

  let aiResults = aiEnabled
    ? await auditFilesWithConcurrency(
        sanitizedFiles,
        config,
        maxConcurrency,
        indexContext ?? undefined,
        mcpContext ?? undefined,
      )
    : undefined;

  // Deterministic accuracy passes on AI findings ONLY (before merging, so
  // deterministic/rule-pack findings keep their configured severities):
  // category severity ceilings first, then evidence verification.
  if (aiResults && aiResults.length > 0) {
    const hygiene = filterSelfNegatedFindings(aiResults);
    if (hygiene.dropped > 0 || hygiene.downgraded > 0) {
      log.info(
        `Hygiene: ${hygiene.dropped} self-negated finding(s) dropped, ${hygiene.downgraded} downgraded.`,
      );
    }
    const xssCheck = downgradeUnsinkedXssClaims(hygiene.results);
    if (xssCheck.downgraded > 0) {
      log.info(`Hygiene: ${xssCheck.downgraded} XSS claim(s) without a sink downgraded.`);
    }
    aiResults = xssCheck.results;

    const guardCheck = downgradeDefensiveXssClaims(aiResults);
    if (guardCheck.downgraded > 0) {
      log.info(
        `Hygiene: ${guardCheck.downgraded} XSS claim(s) downgraded (evidence is a guard/sanitizer).`,
      );
    }
    aiResults = guardCheck.results;

    const randomCheck = reclassifyWeakRandomFindings(aiResults);
    if (randomCheck.reclassified > 0) {
      log.info(
        `Hygiene: ${randomCheck.reclassified} Math.random finding(s) reclassified (non-security use).`,
      );
    }
    aiResults = randomCheck.results;

    const verbCheck = flagVerbMismatchClaims(aiResults);
    if (verbCheck.downgraded > 0) {
      log.info(
        `Hygiene: ${verbCheck.downgraded} finding(s) downgraded (claim contradicts the verb in its evidence).`,
      );
    }
    aiResults = verbCheck.results;

    const barrelCheck = downgradeBarrelExportClaims(aiResults);
    if (barrelCheck.downgraded > 0) {
      log.info(
        `Hygiene: ${barrelCheck.downgraded} 'not exported by barrel' claim(s) downgraded (unverifiable from diff).`,
      );
    }
    aiResults = barrelCheck.results;

    const buildBreakCheck = downgradeBuildBreakClaims(aiResults);
    if (buildBreakCheck.downgraded > 0) {
      log.info(
        `Hygiene: ${buildBreakCheck.downgraded} 'breaks the build/syntax error' CRITICAL(s) downgraded (verified by typecheck/CI, not AI).`,
      );
    }
    aiResults = buildBreakCheck.results;

    const clampOutcome = clampSeverities(aiResults, config.ai?.severityCeilings);
    if (clampOutcome.clamped > 0) {
      log.info(`Severity clamp: ${clampOutcome.clamped} finding(s) capped by category ceiling.`);
    }
    const evidenceOutcome = await verifyEvidence(clampOutcome.results);
    if (evidenceOutcome.downgraded > 0) {
      log.info(
        `Evidence check: ${evidenceOutcome.downgraded} CRITICAL finding(s) downgraded (evidence not found).`,
      );
    }
    const importCheck = verifyImportClaims(evidenceOutcome.results);
    if (importCheck.downgraded > 0) {
      log.info(
        `Import check: ${importCheck.downgraded} CRITICAL finding(s) downgraded (import target exists).`,
      );
    }
    const selfImportCheck = verifySelfImportClaims(importCheck.results);
    if (selfImportCheck.downgraded > 0) {
      log.info(
        `Self-import check: ${selfImportCheck.downgraded} CRITICAL finding(s) downgraded (not actually a self-import).`,
      );
    }
    const versionCheck = verifyVersionClaims(selfImportCheck.results);
    if (versionCheck.downgraded > 0) {
      log.info(
        `Version check: ${versionCheck.downgraded} unverified version claim(s) downgraded (confirm against installed version).`,
      );
    }
    const relocation = await relocateFindingLines(versionCheck.results);
    if (relocation.relocated > 0) {
      log.info(`Line relocation: corrected ${relocation.relocated} finding line number(s).`);
    }
    aiResults = relocation.results;
  }

  let auditResults = runDeterministicReview(sanitizedFiles, redactionReport, aiResults);

  // Rule-pack evaluators (deterministic, dependency-gated) — previously CI
  // review only, leaving local mode without react/tailwind/typescript-strict
  // evaluator findings (field-tested gap). Mirrors the CI path: read
  // package.json deps so dependency/version-gated packs activate; a read
  // failure is non-fatal (packs fall back to language gating).
  let rulePackDeps: Record<string, string> = {};
  try {
    const manifest = await readPackageManifest(process.cwd());
    rulePackDeps = { ...manifest.dependencies, ...manifest.devDependencies };
  } catch {
    rulePackDeps = {};
  }
  const rulePackResults = runRulePackEvaluators(
    sanitizedFiles,
    config.ai?.rulePackSeverity,
    rulePackDeps,
    config.createSkills?.policies as Record<string, unknown> | undefined,
  );
  if (rulePackResults.length > 0) {
    const rulePackFiles = rulePackResults.map((r) => {
      const issues = r.result.issues ?? [];
      return {
        path: r.filePath,
        issues,
        localSeverityCounts: {
          critical: issues.filter((i) => i.severity === "CRITICAL").length,
          warning: issues.filter((i) => i.severity === "WARNING").length,
          info: issues.filter((i) => i.severity === "INFO").length,
        },
      };
    });
    const rulePackCritical = rulePackFiles.reduce((s, f) => s + f.localSeverityCounts.critical, 0);
    auditResults = mergeFindings(
      {
        totalCritical: rulePackCritical,
        totalWarning: rulePackFiles.reduce((s, f) => s + f.localSeverityCounts.warning, 0),
        totalInfo: rulePackFiles.reduce((s, f) => s + f.localSeverityCounts.info, 0),
        hasCriticalFindings: rulePackCritical > 0,
        files: rulePackFiles,
      },
      auditResults,
      new Set(),
    );
  }

  // ESLint adapter (opt-in, fail-open) — merge the project's own ESLint
  // findings, then collapse exact duplicates across all finding sources.
  const eslintFindings = await runESLintAdapter(
    sanitizedFiles.map((f) => f.path),
    config,
  );
  if (eslintFindings) {
    auditResults = mergeFindings(eslintFindings, auditResults, new Set());
  }

  // Unused-import backstop — ESLint verifies usage across the whole file, so
  // where it ran it overrides the AI's diff-only "unused import" guesses
  // (dropped); elsewhere those claims are demoted to INFO (unverifiable).
  const unusedReconcile = reconcileUnusedImportFindings(auditResults, {
    eslintRan: eslintFindings !== null,
    isFileLinted: isLintableFile,
  });
  if (unusedReconcile.suppressed > 0 || unusedReconcile.downgraded > 0) {
    log.info(
      `Unused-import check: ${unusedReconcile.suppressed} AI finding(s) dropped (ESLint authority), ${unusedReconcile.downgraded} downgraded to INFO (unverifiable).`,
    );
  }
  auditResults = unusedReconcile.results;

  // Deterministic false-positive backstops (lodash subpath imports wrongly
  // called whole-package; hooks wrongly flagged as outside a hooks/ directory;
  // rendered JSX elements wrongly flagged as "unused").
  const fileContentMap = new Map(sanitizedFiles.map((f) => [f.path, f.content]));
  const lodashReconcile = reconcileLodashBundleFindings(auditResults, {
    fileContents: fileContentMap,
  });
  const hookReconcile = reconcileHookPlacementFindings(lodashReconcile.results);
  const jsxReconcile = reconcileUnusedJsxFindings(hookReconcile.results, {
    fileContents: fileContentMap,
  });
  const iconReconcile = reconcileAntdIconImportFindings(jsxReconcile.results, {
    fileContents: fileContentMap,
  });
  if (
    lodashReconcile.suppressed +
      hookReconcile.suppressed +
      jsxReconcile.suppressed +
      iconReconcile.suppressed >
    0
  ) {
    log.info(
      `False-positive backstop: dropped ${lodashReconcile.suppressed} lodash bundle-size + ${hookReconcile.suppressed} hook-placement + ${jsxReconcile.suppressed} unused-JSX + ${iconReconcile.suppressed} antd-icon AI finding(s).`,
    );
  }
  auditResults = iconReconcile.results;
  auditResults = dedupeFindings(auditResults).results;
  const crossDedupe = dedupeCrossCategoryFindings(auditResults);
  if (crossDedupe.removed > 0) {
    log.info(
      `Cross-category dedupe: merged ${crossDedupe.removed} same-line duplicate finding(s).`,
    );
  }
  auditResults = crossDedupe.results;

  // Per-file noise budget — cap non-CRITICAL findings per file (CRITICALs
  // always kept). Off by default; opt in via review.maxFindingsPerFile.
  const capOutcome = capFindingsPerFile(auditResults, config.review?.maxFindingsPerFile ?? 0);
  if (capOutcome.hidden > 0) {
    log.info(
      `Noise budget: ${capOutcome.hidden} lower-severity finding(s) hidden by per-file cap.`,
    );
  }
  auditResults = capOutcome.results;

  // Print summary — honor severity threshold (CLI flag > branch override > config baseline)
  const threshold = resolveSeverityThreshold({
    ...(values["severity-threshold"] && { cliFlag: values["severity-threshold"] }),
    config,
    currentBranch,
  });
  const auditDuration = performance.now() - startTime;

  // Build human-readable target string (mirrors AI review's "Target" row)
  const targetLabel = commitSha
    ? `commit (${commitSha.slice(0, 7)})`
    : isBranchDiffMode
      ? `branch-diff (${currentBranch} vs ${compareBranch})`
      : `local (${commitsToReview.length} commit${commitsToReview.length === 1 ? "" : "s"})`;

  // Changed-line count for the report's Diff lines metric. Computed for
  // branch-diff via a single numstat over the compare range, summed across the
  // files actually reviewed. 0 (unavailable) renders as N/A downstream.
  const totalChangedLines = isBranchDiffMode
    ? await sumChangedLines(
        `${compareBranch}..HEAD`,
        sanitizedFiles.map((f) => f.path),
      )
    : 0;

  let allPassed: boolean;
  if (wantsJson) {
    // Structured path: emit a ReviewReport as JSON-only stdout, optionally
    // writing the markdown report (logged to stderr) when --output is set.
    allPassed = await emitLocalJsonReport({
      auditResults,
      skipped: filterResult.rejected,
      aiEnabled,
      threshold,
      startTime,
      commits: commitsToReview,
      compareBranch: reportCompareBranch,
      targetLabel,
      totalChangedLines,
      ...(values.output ? { outputPath: values.output } : {}),
    });
  } else {
    allPassed = printResultsSummary(auditResults, auditDuration, threshold, {
      target: targetLabel,
      aiEnabled,
      skipped: filterResult.rejected.map(({ path, reason }) => ({ path, reason })),
      commits: commitsToReview,
    });

    // --output: write a clean markdown report (no ANSI codes) for MR attachment.
    if (values.output) {
      await writeLocalMarkdownReport({
        outputPath: values.output,
        auditResults,
        skipped: filterResult.rejected,
        aiEnabled,
        threshold,
        startTime,
        commits: commitsToReview,
        compareBranch: reportCompareBranch,
        targetLabel,
        totalChangedLines,
      });
    }
  }

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

interface LocalMarkdownReportOptions {
  outputPath: string;
  auditResults: FileAuditResult[];
  skipped: Array<{ path: string; reason: string }>;
  aiEnabled: boolean;
  threshold: SeverityThreshold;
  startTime: number;
  commits: CommitInfo[];
  compareBranch: string;
  /** Human-readable target label for the report. */
  targetLabel?: string;
  /** Changed-line count (0 = unavailable -> rendered as N/A). */
  totalChangedLines?: number;
}

/**
 * Build a ReviewReport from local-mode results (reusing the CI report
 * builder) and write it as clean markdown — no ANSI codes, MR-attachable.
 * Fail-open: an unwritable path logs a warning, never fails the review.
 */
const writeLocalMarkdownReport = async (options: LocalMarkdownReportOptions): Promise<void> => {
  const { outputPath, auditResults, skipped, aiEnabled, threshold, startTime, commits } = options;
  try {
    const report = buildReport(
      { mode: "range", value: options.compareBranch },
      aiEnabled,
      DEFAULT_PROMPT_VERSION,
      auditResults,
      skipped,
      [],
      options.totalChangedLines ?? 0,
      startTime,
      undefined,
      undefined,
      { threshold },
    );
    if (commits.length > 0) report.commits = commits;
    if (options.targetLabel) report.targetLabel = options.targetLabel;
    await writeFile(resolve(process.cwd(), outputPath), formatMarkdownReport(report));
    log.info(`Markdown report written to ${outputPath}`);
  } catch (error) {
    log.warning(
      `Failed to write report to ${outputPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

/**
 * Sum changed lines (additions + deletions) for `range` across the reviewed
 * files. Best-effort: returns 0 if git can't produce stats (rendered as N/A).
 */
const sumChangedLines = async (range: string, files: readonly string[]): Promise<number> => {
  try {
    const stats = await getChangeStatsForTarget({ mode: "range", value: range }, process.cwd());
    const reviewed = new Set(files);
    let total = 0;
    for (const [path, lines] of stats) {
      if (reviewed.has(path)) total += lines;
    }
    return total;
  } catch {
    return 0;
  }
};

interface LocalJsonReportOptions {
  auditResults: FileAuditResult[];
  skipped: Array<{ path: string; reason: string }>;
  aiEnabled: boolean;
  threshold: SeverityThreshold;
  startTime: number;
  commits: CommitInfo[];
  compareBranch: string;
  /** Human-readable target label for the report. */
  targetLabel?: string;
  /** Changed-line count (0 = unavailable -> rendered as N/A). */
  totalChangedLines?: number;
  /** When set, also write the markdown report (logged to stderr, never stdout). */
  outputPath?: string;
}

/**
 * Print an empty (PASS) ReviewReport to stdout. Used by every JSON-mode early
 * return — no commits differ/match, no changed files, all ignored — so stdout
 * always carries a parseable report rather than going blank.
 */
const emitEmptyLocalJsonReport = (compareBranch: string, startTime: number): void => {
  const report = buildReport(
    { mode: "range", value: compareBranch },
    false,
    DEFAULT_PROMPT_VERSION,
    [],
    [],
    [],
    0,
    startTime,
  );
  console.log(JSON.stringify(report, null, 2));
};

/**
 * Build a ReviewReport from local-mode results (reusing the CI report builder)
 * and print it as JSON to stdout, keeping stdout machine-readable. Returns
 * whether the review passed (status === "PASS"). Any markdown side-output is
 * written to disk and announced on stderr so stdout stays JSON-only.
 */
const emitLocalJsonReport = async (options: LocalJsonReportOptions): Promise<boolean> => {
  const report = buildReport(
    { mode: "range", value: options.compareBranch },
    options.aiEnabled,
    DEFAULT_PROMPT_VERSION,
    options.auditResults,
    options.skipped,
    [],
    options.totalChangedLines ?? 0,
    options.startTime,
    undefined,
    undefined,
    { threshold: options.threshold },
  );
  if (options.commits.length > 0) report.commits = options.commits;
  if (options.targetLabel) report.targetLabel = options.targetLabel;

  if (options.outputPath) {
    try {
      await writeFile(resolve(process.cwd(), options.outputPath), formatMarkdownReport(report));
      log.infoStderr(`Markdown report written to ${options.outputPath}`);
    } catch (error) {
      log.warningStderr(
        `Failed to write report to ${options.outputPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // stdout is reserved for the machine-readable report.
  console.log(JSON.stringify(report, null, 2));
  return report.status === "PASS";
};

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
 * Sort commits chronologically (oldest first). `git log` emits newest-first;
 * report consumers misread that order as oldest-first, inverting "fixed by a
 * later commit" reasoning. Sorting by commit date (hash order as tiebreaker)
 * makes ordering explicit everywhere commits are displayed or emitted.
 */
export const sortCommitsChronologically = (commits: readonly CommitInfo[]): CommitInfo[] =>
  [...commits].sort((a, b) => {
    const timeA = Date.parse(a.date);
    const timeB = Date.parse(b.date);
    if (Number.isNaN(timeA) || Number.isNaN(timeB)) return a.hash.localeCompare(b.hash);
    return timeA - timeB;
  });

/**
 * Print formatted list of commits to be reviewed (oldest → newest)
 */
const printCommitList = (commits: CommitInfo[]): void => {
  console.log();
  log.info(`📋 Commits to review (${commits.length}, oldest → newest):`);
  commits.forEach((commit, index) => {
    console.log(
      `   #${index + 1} ${commit.hash.slice(0, 7)} | ${commit.date} | ${commit.author} | ${commit.message}`,
    );
  });
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
  log.plain(""); // quiet-aware blank line; suppressed for machine formats

  return hasErrors;
};
