/**
 * Stable review command implementation.
 */

import type {
  AuditIssue,
  EvidenceSummary,
  ExplainContextOutput,
  FileAuditResult,
  MCPContextSummary,
  MCPDiagnostics,
  ProjectConfig,
  ReviewFormat,
  ReviewIntelligenceSignal,
  ReviewReport,
  ReviewTarget,
  SkillProfile,
  RelationType,
  TechProfile,
} from "../types/index.js";
import type { CLIValues } from "./args.js";
import { log } from "../utils/logger.js";
import { bold, dim, paint } from "../utils/terminal-ui.js";
import { UserError } from "../utils/errors.js";
import { collectReviewInput, getCommitsForRange, listFilesForTarget } from "../utils/git.js";
import { FileHandler } from "../services/file-handler/index.js";
import { configureSecurityService, getSecurityService } from "../services/security/index.js";
import { auditFilesWithConcurrency, summarizeUsage } from "../services/ai/index.js";
import { configureCacheBackend } from "../services/ai/cache.js";
import { formatMarkdownReport, printConsoleReport } from "../formatters/report.js";
import { stringifySarif } from "../formatters/sarif.js";
import { DEFAULT_PROMPT_VERSION } from "../config/prompts.js";
import { generatePayloadSummary, resolveTokenLimit } from "../utils/tokens.js";
import { buildSystemPrompt } from "../config/prompts.js";
import { detectTechProfile } from "../services/tech-profile.js";
import { readPackageManifest } from "../services/source-index/manifest.js";
import { AIConfig } from "../services/ai/index.js";
import { buildReviewContext } from "../services/source-index/context-builder.js";
import { readIndex } from "../services/source-index/storage.js";
import { resolve as resolvePath } from "node:path";
import { readFile as readFileAsync, writeFile as writeFileAsync } from "node:fs/promises";
import { gatherMCPContextDetails } from "../services/mcp/index.js";
import { generateMCPDiagnostics } from "../services/mcp/diagnostics.js";
import { runDeterministicReview, runRulePackEvaluators } from "./deterministic-review.js";
import { mergeFindings } from "../services/risk-analyzer/index.js";
import { dedupeFindings } from "../utils/dedupe-findings.js";
import { capFindingsPerFile } from "../utils/cap-findings.js";
import { clampSeverities } from "../utils/severity-clamp.js";
import { verifyEvidence } from "../utils/verify-evidence.js";
import { reconcileFindings } from "../utils/reconcile-findings.js";
import { verifyImportClaims } from "../utils/verify-import-claims.js";
import { relocateFindingLines } from "../utils/relocate-lines.js";
import { downgradeUnsinkedXssClaims, filterSelfNegatedFindings } from "../utils/finding-hygiene.js";
import {
  DEFAULT_BASELINE_PATH,
  filterAgainstBaseline,
  loadBaseline,
  writeBaseline,
} from "../services/baseline.js";
import {
  DEFAULT_SEVERITY_THRESHOLD,
  activeIssues,
  issuesFailThreshold,
  resolveSeverityThreshold,
} from "../utils/severity.js";
import { getCurrentBranch } from "../utils/git.js";
import type { SeverityThreshold } from "../types/index.js";

export interface ReviewRunOptions {
  values: CLIValues;
  commandPositionals: string[];
  config: ProjectConfig;
  targetBranch: string;
  maxConcurrency: number;
  startTime: number;
  /** When true, run deterministic non-AI review (secret redaction + risk analyzer) with token preview */
  dryRun?: boolean;
  /** When true, force per-file output during dry run */
  verboseDryRun?: boolean;
  /** Override the provider context-window token limit */
  tokenLimitOverride?: number;
}

const parseBooleanEnv = (value: string | undefined): boolean | undefined => {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
};

const resolveFormat = (raw: string): ReviewFormat => {
  if (raw === "console" || raw === "json" || raw === "markdown" || raw === "sarif") {
    return raw;
  }
  throw new UserError(
    `Unsupported format "${raw}". Expected one of: console, json, markdown, sarif.`,
  );
};

const resolveTarget = (
  values: CLIValues,
  commandPositionals: string[],
  targetBranch: string,
): ReviewTarget => {
  const explicitFiles = [...(values.files ?? []), ...commandPositionals];
  const modes = [
    values.staged ? "staged" : null,
    values.commit ? "commit" : null,
    values.range ? "range" : null,
    explicitFiles.length > 0 ? "files" : null,
  ].filter((v): v is "staged" | "commit" | "range" | "files" => !!v);

  if (modes.length > 1) {
    throw new UserError("Use only one target selector among --staged, --commit, --range, --files.");
  }

  if (values.staged) {
    return { mode: "staged" };
  }
  if (values.commit) {
    return { mode: "commit", value: values.commit };
  }
  if (values.range) {
    return { mode: "range", value: values.range };
  }
  if (explicitFiles.length > 0) {
    return { mode: "files", files: explicitFiles };
  }

  return { mode: "range", value: `${targetBranch}...HEAD` };
};

const resolveAIEnabled = (
  values: CLIValues,
  target: ReviewTarget,
  config: ProjectConfig,
): boolean => {
  const fromFlag = values.ai;
  const fromEnv = parseBooleanEnv(process.env.MP_SENTINEL_AI);
  const fromConfig = config.ai?.enabled;
  const defaultValue = target.mode !== "staged";
  return fromFlag ?? fromEnv ?? fromConfig ?? defaultValue;
};

export { createSecurityOnlyResults } from "./deterministic-review.js";

const emitFallbackNotice = (message: string, format: ReviewFormat): void => {
  if (format === "console") {
    log.warning(message);
    return;
  }
  process.stderr.write(`[warn] ${message}\n`);
};

interface BuildReportContext {
  /** Resolved severity threshold for this run (default WARNING). */
  threshold: SeverityThreshold;
}

export const buildReport = (
  target: ReviewTarget,
  aiEnabled: boolean,
  promptVersion: string,
  results: FileAuditResult[],
  skipped: Array<{ path: string; reason: string }>,
  errors: string[],
  totalChangedLines: number,
  startTime: number,
  mcpSummary?: MCPContextSummary,
  tokenUsage?: ReviewReport["summary"]["tokenUsage"],
  context: BuildReportContext = { threshold: DEFAULT_SEVERITY_THRESHOLD },
): ReviewReport => {
  // Severity counts cover ACTIVE issues only — findings reconciled as
  // resolved-at-head stay in the report body but no longer count or fail.
  const criticalIssues = results.reduce(
    (acc, result) =>
      acc + activeIssues(result.result.issues).filter((i) => i.severity === "CRITICAL").length,
    0,
  );
  const warningIssues = results.reduce(
    (acc, result) =>
      acc + activeIssues(result.result.issues).filter((i) => i.severity === "WARNING").length,
    0,
  );
  const infoIssues = results.reduce(
    (acc, result) =>
      acc + activeIssues(result.result.issues).filter((i) => i.severity === "INFO").length,
    0,
  );

  const hasRuntimeErrors =
    errors.length > 0 || results.some((result) => result.result.status === "ERROR");
  // Threshold-aware FAIL: an issue fails the review only if its severity
  // meets-or-exceeds the resolved threshold. Runtime errors are an
  // independent path and always escalate to ERROR.
  const hasFindings = results.some((result) =>
    issuesFailThreshold(result.result.issues, context.threshold),
  );
  // Edge case: AI returned status="FAIL" without listing any issues.
  // Treat as a failure regardless of threshold — the AI explicitly said
  // FAIL and we have nothing to filter against.
  const hasFailWithoutIssues = results.some(
    (r) => r.result.status === "FAIL" && (!r.result.issues || r.result.issues.length === 0),
  );

  const status: ReviewReport["status"] = hasRuntimeErrors
    ? "ERROR"
    : hasFindings || hasFailWithoutIssues
      ? "FAIL"
      : "PASS";

  const durationMs = performance.now() - startTime;
  const hasActionable = (entry: FileAuditResult): boolean =>
    issuesFailThreshold(entry.result.issues, context.threshold);
  const passedFiles = results.filter((r) => r.result.status === "PASS" && !hasActionable(r)).length;
  const failedFiles = results.filter((r) => r.result.status !== "PASS" || hasActionable(r)).length;

  const report: ReviewReport = {
    schemaVersion: "1.0",
    status,
    target,
    aiEnabled,
    promptVersion,
    summary: {
      totalFiles: results.length + skipped.length,
      auditedFiles: results.length,
      passedFiles,
      failedFiles,
      criticalIssues,
      warningIssues,
      infoIssues,
      durationMs,
      totalChangedLines,
      ...(tokenUsage && { tokenUsage }),
    },
    results,
    skipped,
    errors,
    generatedAt: new Date().toISOString(),
  };

  if (mcpSummary && mcpSummary.enabled) {
    report.mcp = mcpSummary;
  }

  return report;
};

const renderReport = (report: ReviewReport, format: ReviewFormat): void => {
  if (format === "json") {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (format === "markdown") {
    console.log(formatMarkdownReport(report));
    return;
  }

  if (format === "sarif") {
    console.log(stringifySarif(report));
    return;
  }

  printConsoleReport(report);
};

const postGitProviderComments = async (
  results: FileAuditResult[],
  dryRun: boolean,
  format: ReviewFormat,
): Promise<void> => {
  if (dryRun) return;

  const hasActionableFindings = results.some(
    (entry) =>
      entry.result.status === "FAIL" &&
      entry.result.issues?.some(
        (issue) => issue.severity === "CRITICAL" || issue.severity === "WARNING",
      ) === true,
  );
  if (!hasActionableFindings) return;

  const { postGitProviderComments: postComments } = await import("../services/git-provider.js");
  // For machine-readable formats, stdout is reserved for the report — route
  // comment-posting progress/success logs to stderr.
  await postComments(results, { logToStderr: format !== "console" });
};

/**
 * Build contextual information from source index to enrich the AI prompt
 * Deprecated: Use buildReviewContext from context-builder.ts instead.
 */
export async function buildIndexContext(
  config: ProjectConfig,
  diffFiles: Array<{ path: string }>,
  projectRoot: string,
): Promise<string | null> {
  // Delegate to the new context builder service
  const indexingEnabled = config.indexing?.enabled !== false;
  if (!indexingEnabled) {
    log.debug("Source indexing disabled in config");
    return null;
  }

  const cachePath = resolvePath(
    projectRoot,
    config.indexing?.cachePath ?? ".mp-sentinel-cache/source-index.json",
  );
  const index = await readIndex(cachePath, { hydrate: "calls" });

  if (!index) {
    log.debug("No source index found for context enrichment");
    return null;
  }

  // Validate index - skip if too many parse errors
  const totalFiles = index.files.length;
  const filesWithErrors = index.files.filter(
    (f) => f.parseErrors && f.parseErrors.length > 0,
  ).length;
  if (totalFiles > 0 && filesWithErrors / totalFiles > 0.5) {
    log.warning(
      `Source index has ${filesWithErrors}/${totalFiles} files with parse errors - skipping context`,
    );
    return null;
  }

  const maxRelatedFiles = config.indexing?.maxRelatedFiles ?? 3;
  const result = await buildReviewContext(index, diffFiles, {
    maxRelatedFiles,
    budgetChars: 12000,
  });

  return result.context || null;
}

export const runReview = async (options: ReviewRunOptions): Promise<number> => {
  const {
    values,
    commandPositionals,
    config,
    targetBranch,
    maxConcurrency,
    startTime,
    dryRun: dryRunStr = false,
    verboseDryRun = false,
    tokenLimitOverride,
  } = options;
  const dryRun = dryRunStr || verboseDryRun;

  // --no-cache: bypass the AI response cache for this run (pre-merge gates
  // should never serve findings from a previous prompt/file state).
  if (values["no-cache"]) {
    config.cacheEnabled = false;
    log.info("AI response cache bypassed for this run (--no-cache).");
  }

  const formatRaw = values.format ?? process.env.MP_SENTINEL_FORMAT ?? "console";
  const format = resolveFormat(formatRaw);
  const target = resolveTarget(values, commandPositionals, targetBranch);
  // In dry-run mode, AI is always disabled
  const aiRequested = dryRun ? false : resolveAIEnabled(values, target, config);
  const aiAvailability = aiRequested
    ? AIConfig.probeEnvironment({ modelTier: config.ai?.modelTier })
    : null;
  const aiEnabled = aiRequested && aiAvailability?.status === "ready";

  const maxFiles = Math.max(1, config.ai?.maxFiles ?? 15);
  const maxDiffLines = Math.max(100, config.ai?.maxDiffLines ?? 1200);
  const maxCharsPerFile = Math.max(1000, config.ai?.maxCharsPerFile ?? 12000);
  const promptVersion = config.ai?.promptVersion || DEFAULT_PROMPT_VERSION;

  if (dryRun) {
    log.warning(
      "DRY-RUN mode: deterministic non-AI review (secret redaction + risk analyzer) — AI calls skipped.",
    );
  }
  log.info(`Target: ${bold(`${target.mode}${target.value ? ` (${target.value})` : ""}`)}`);
  if (aiRequested && aiAvailability && aiAvailability.status !== "ready") {
    emitFallbackNotice(
      `AI review unavailable: ${aiAvailability.reason} Falling back to deterministic non-AI review (secret redaction + risk analyzer; not a full AI substitute).`,
      format,
    );
  }

  log.info(`AI review: ${aiEnabled ? paint("enabled", "green") : dim("disabled")}`);
  log.info(
    `Guardrails: ${dim(
      `maxFiles=${maxFiles}, maxDiffLines=${maxDiffLines}, maxCharsPerFile=${maxCharsPerFile}`,
    )}`,
  );

  const candidateFiles = await listFilesForTarget(target);
  if (candidateFiles.length === 0) {
    const emptyReport = buildReport(target, aiEnabled, promptVersion, [], [], [], 0, startTime);
    renderReport(emptyReport, format);
    return 0;
  }

  const fileHandler = new FileHandler();
  const filterResult = await fileHandler.filterPathsWithIgnores(candidateFiles);
  const skipped = filterResult.rejected.map((entry) => ({
    path: entry.path,
    reason: entry.reason,
  }));

  const diffResult = await collectReviewInput({
    target,
    filePaths: filterResult.accepted,
    maxFiles,
    maxDiffLines,
    maxCharsPerFile,
  });

  skipped.push(...diffResult.skipped);

  if (diffResult.files.length === 0) {
    // Diagnostic: emit a single stderr line when verbose so empty diffs in
    // explicit-files mode (the most likely bug surface) are visible.
    if (values.verbose || process.env.MP_SENTINEL_DEBUG_EMPTY_DIFF === "1") {
      process.stderr.write(
        `[mp-sentinel:debug] diffResult.files is empty for target=${target.mode}` +
          ` candidates=${JSON.stringify(candidateFiles)}` +
          ` accepted=${JSON.stringify(filterResult.accepted)}` +
          ` rejected=${JSON.stringify(skipped)}` +
          ` cwd=${process.cwd()}\n`,
      );
    }

    // Explicit `--files` mode: the user named these files, so an empty diff
    // is a bug (file unreadable, git path mismatch, etc.) — not "nothing to
    // review". Read each accepted file directly and produce a deterministic
    // pseudo-diff so downstream sanitizer + risk-analyzer can still run.
    // This matches the contract that review-fallback.test.ts asserts.
    if (target.mode === "files" && filterResult.accepted.length > 0) {
      const rebuilt: Array<{
        path: string;
        patch: string;
        additions: number;
        deletions: number;
        changedLines: number;
      }> = [];
      for (const path of filterResult.accepted) {
        try {
          const absPath = resolvePath(process.cwd(), path);
          const content = await readFileAsync(absPath, "utf-8");
          const lines = content.split("\n").slice(0, 400);
          const body = lines.map((l) => `+${l}`).join("\n");
          const patch = [
            `diff --git a/${path} b/${path}`,
            `--- a/${path}`,
            `+++ b/${path}`,
            `@@ -0,0 +1,${lines.length} @@`,
            body,
          ].join("\n");
          const additions = lines.length;
          rebuilt.push({ path, patch, additions, deletions: 0, changedLines: additions });
        } catch {
          // File unreadable — skip silently. The deterministic pipeline can
          // still produce a report for the readable subset.
        }
      }
      if (rebuilt.length > 0) {
        diffResult.files = rebuilt;
        diffResult.totalChangedLines = rebuilt.reduce((s, f) => s + f.changedLines, 0);
        // Fall through to the normal pipeline below.
      }
    }
  }

  if (diffResult.files.length === 0) {
    const emptyReport = buildReport(
      target,
      aiEnabled,
      promptVersion,
      [],
      skipped,
      [],
      diffResult.totalChangedLines,
      startTime,
    );
    renderReport(emptyReport, format);
    return 0;
  }

  // Phase 2.1: apply user security config (entropy, custom patterns,
  // allowlists) BEFORE constructing the SecurityService instance.
  configureSecurityService(config.security);
  // Phase 3.3: select the cache backend (fs default; http for shared CI).
  configureCacheBackend(config.cache);
  const securityService = getSecurityService();
  const { sanitizedFiles, redactionReport } = securityService.sanitizeFiles(
    diffResult.files.map((file) => ({ path: file.path, content: file.patch })),
  );

  // Load source index context for AI if available
  const indexContext = await buildIndexContext(
    config,
    diffResult.files.map((f) => ({ path: f.path })),
    process.cwd(),
  );

  // Detect tech profile for stack-aware review cues (works without source index)
  const techProfile = await detectTechProfile(config);

  // Read package.json dependencies so dependency-gated rule packs (react,
  // antd, tanstack-query, …) activate in the deterministic rule-pack pass.
  // A read failure is non-fatal — packs simply fall back to language gating.
  let rulePackDeps: Record<string, string> = {};
  try {
    const manifest = await readPackageManifest(process.cwd());
    rulePackDeps = { ...manifest.dependencies, ...manifest.devDependencies };
  } catch {
    rulePackDeps = {};
  }

  // Gather MCP external context if enabled (only when AI will use it)
  let mcpContext: string | null = null;
  let mcpSummary: MCPContextSummary | undefined;
  if (aiEnabled) {
    const mcpResult = await gatherMCPContextDetails(
      config,
      diffResult.files.map((f) => f.path),
      process.cwd(),
    );
    mcpContext = mcpResult.context;
    mcpSummary = mcpResult.summary;
  }

  const runtimeErrors: string[] = [];
  let auditResults: FileAuditResult[] = [];

  if (aiEnabled || dryRun) {
    // Resolve provider-specific token limit (priority: CLI flag > env > config > provider default)
    let providerName: string | undefined;
    try {
      const providerConfig = AIConfig.fromEnvironment({ modelTier: config.ai?.modelTier });
      providerName = providerConfig.provider;
    } catch {
      // No API key configured — use default limit
    }
    const cliLimit = tokenLimitOverride ?? 0;
    const envLimit = Number(process.env.MP_SENTINEL_TOKEN_LIMIT) || 0;
    const tokenLimit = resolveTokenLimit(
      providerName,
      cliLimit || envLimit || config.ai?.tokenLimit,
    );

    // Build system prompt for token accounting
    let systemPromptForEstimate: string | undefined;
    try {
      systemPromptForEstimate = await buildSystemPrompt(
        config,
        indexContext ?? undefined,
        techProfile,
        mcpContext ?? undefined,
      );
    } catch {
      // Non-critical — skip system prompt in estimate
    }

    // User prompt prefix added per file: "Code to review:\n"
    const userPromptPrefix = "Code to review:\n";

    const { exceeded, total, perFile } = await generatePayloadSummary(
      sanitizedFiles.map((f) => ({ path: f.path, content: f.content })),
      tokenLimit,
      systemPromptForEstimate,
      userPromptPrefix,
      values.verbose || verboseDryRun,
    );

    if (dryRun) {
      // In dry-run mode: show full per-file token breakdown + deterministic findings
      log.info(
        `DRY-RUN preview: ${bold(String(sanitizedFiles.length))} file(s), ~${bold(
          total.toLocaleString(),
        )} estimated tokens ${dim(`(limit: ${tokenLimit.toLocaleString()})`)}`,
      );
      if (perFile.length > 0) {
        log.info("Per-file token breakdown:");
        const sorted = [...perFile].sort((a, b) => b.tokens - a.tokens);
        for (const f of sorted) {
          log.file(`${f.path}: ~${f.tokens.toLocaleString()} tokens`);
        }
      }
    } else if (exceeded) {
      log.warning(
        "Aborting AI review to prevent truncated results. " +
          "Reduce maxFiles or maxCharsPerFile in your config.",
      );
      process.exitCode = 2;
      return 2;
    } else {
      try {
        auditResults = await auditFilesWithConcurrency(
          sanitizedFiles.map((file) => ({ path: file.path, content: file.content })),
          config,
          maxConcurrency,
          indexContext ?? undefined,
          mcpContext ?? undefined,
        );
      } catch (error) {
        runtimeErrors.push(error instanceof Error ? error.message : "Unknown AI runtime error");
      }
    }
  }

  // Deterministic accuracy passes on AI findings ONLY (before merging, so
  // deterministic/rule-pack findings keep their configured severities).
  if (auditResults.length > 0) {
    const hygiene = filterSelfNegatedFindings(auditResults);
    if (hygiene.dropped > 0 || hygiene.downgraded > 0) {
      log.info(
        `Hygiene: ${hygiene.dropped} self-negated finding(s) dropped, ${hygiene.downgraded} downgraded.`,
      );
    }
    const xssCheck = downgradeUnsinkedXssClaims(hygiene.results);
    if (xssCheck.downgraded > 0) {
      log.info(`Hygiene: ${xssCheck.downgraded} XSS claim(s) without a sink downgraded.`);
    }
    auditResults = xssCheck.results;

    const clampOutcome = clampSeverities(auditResults, config.ai?.severityCeilings);
    if (clampOutcome.clamped > 0) {
      log.info(`Severity clamp: ${clampOutcome.clamped} finding(s) capped by category ceiling.`);
    }
    auditResults = clampOutcome.results;

    if (target.mode === "commit") {
      // Historical-commit review: the diff reflects an OLD file state, so a
      // missing evidence quote may mean "fixed by a later commit" rather than
      // "hallucinated". Reconcile against HEAD + git history instead of the
      // plain evidence check.
      const reconcileOutcome = await reconcileFindings(auditResults);
      if (reconcileOutcome.resolved > 0) {
        log.info(
          `Reconciliation: ${reconcileOutcome.resolved} finding(s) already resolved at HEAD (excluded from pass/fail).`,
        );
      }
      if (reconcileOutcome.unverified > 0) {
        log.info(
          `Reconciliation: ${reconcileOutcome.unverified} finding(s) downgraded (evidence not found in file or history).`,
        );
      }
      auditResults = reconcileOutcome.results;
    } else {
      // Diff endpoints at HEAD (range/staged/files/branch): evidence must
      // exist in the current file — a CRITICAL whose quoted evidence cannot
      // be found is downgraded instead of shipping as a false positive.
      const evidenceOutcome = await verifyEvidence(auditResults);
      if (evidenceOutcome.downgraded > 0) {
        log.info(
          `Evidence check: ${evidenceOutcome.downgraded} CRITICAL finding(s) downgraded (evidence not found).`,
        );
      }
      auditResults = evidenceOutcome.results;
    }

    // Import-existence backstop: a CRITICAL claiming an import target is
    // missing is downgraded when the file actually resolves on disk.
    const importCheck = verifyImportClaims(auditResults);
    if (importCheck.downgraded > 0) {
      log.info(
        `Import check: ${importCheck.downgraded} CRITICAL finding(s) downgraded (import target exists).`,
      );
    }
    auditResults = importCheck.results;

    // Evidence-based line relocation: recover the real line for findings the
    // model anchored at line 1 (or a stale line) using their evidence snippet.
    const relocation = await relocateFindingLines(auditResults);
    if (relocation.relocated > 0) {
      log.info(`Line relocation: corrected ${relocation.relocated} finding line number(s).`);
    }
    auditResults = relocation.results;
  }

  const deterministicResults = runDeterministicReview(
    sanitizedFiles,
    redactionReport,
    aiEnabled && auditResults.length > 0 ? auditResults : undefined,
  );

  // Run rule-pack evaluators (deterministic, language-specific checks)
  const rulePackResults = runRulePackEvaluators(
    sanitizedFiles,
    config.ai?.rulePackSeverity,
    rulePackDeps,
  );

  // Extract AuditIssue[] from rule-pack FileAuditResult[] for mergeFindings
  const rulePackFileAnalyses: Array<{
    path: string;
    issues: AuditIssue[];
    localSeverityCounts: { critical: number; warning: number; info: number };
  }> = [];
  for (const r of rulePackResults) {
    const issues = r.result.issues ?? [];
    if (issues.length > 0) {
      let critical = 0;
      let warning = 0;
      let info = 0;
      for (const i of issues) {
        if (i.severity === "CRITICAL") critical++;
        else if (i.severity === "WARNING") warning++;
        else info++;
      }
      rulePackFileAnalyses.push({
        path: r.filePath,
        issues,
        localSeverityCounts: { critical, warning, info },
      });
    }
  }
  const rulePackCritical = rulePackFileAnalyses.reduce(
    (s, f) => s + f.localSeverityCounts.critical,
    0,
  );
  const rulePackWarning = rulePackFileAnalyses.reduce(
    (s, f) => s + f.localSeverityCounts.warning,
    0,
  );

  // Merge rule-pack findings into final results
  const mergedResults = mergeFindings(
    {
      totalCritical: rulePackCritical,
      totalWarning: rulePackWarning,
      totalInfo: 0,
      hasCriticalFindings: rulePackCritical > 0,
      files: rulePackFileAnalyses,
    },
    deterministicResults,
    new Set(),
  );

  // Collapse exact-duplicate findings (e.g. the model repeating itself) so the
  // report's signal-to-noise stays high. Distinct issues are never merged.
  const { results: dedupedFinal, removed: duplicatesRemoved } = dedupeFindings(mergedResults);
  if (duplicatesRemoved > 0) {
    log.info(`Removed ${duplicatesRemoved} duplicate finding(s).`);
  }

  // Per-file noise budget — cap non-CRITICAL findings per file (CRITICALs
  // always kept). Off by default; opt in via review.maxFindingsPerFile.
  const { results: finalResults, hidden: cappedFindings } = capFindingsPerFile(
    dedupedFinal,
    config.review?.maxFindingsPerFile ?? 0,
  );
  if (cappedFindings > 0) {
    log.info(`Noise budget: ${cappedFindings} lower-severity finding(s) hidden by per-file cap.`);
  }

  // Baseline / ratchet handling. `--update-baseline` records the current
  // findings and exits 0 (accept current state). Otherwise, when a baseline is
  // requested, suppress already-accepted findings so only NEW ones can fail.
  const baselineRequested = values.baseline !== undefined || values["update-baseline"] === true;
  const baselinePath =
    typeof values.baseline === "string" && values.baseline.length > 0
      ? values.baseline
      : DEFAULT_BASELINE_PATH;

  if (values["update-baseline"]) {
    const written = writeBaseline(baselinePath, finalResults);
    const recorded = Object.values(written.fingerprints).reduce((a, b) => a + b, 0);
    log.info(`Baseline written to ${baselinePath} (${recorded} finding(s) recorded).`);
    return 0;
  }

  let effectiveResults = finalResults;
  if (baselineRequested) {
    const baseline = loadBaseline(baselinePath);
    if (baseline) {
      const { results: filtered, suppressed } = filterAgainstBaseline(finalResults, baseline);
      effectiveResults = filtered;
      if (suppressed > 0) {
        log.info(`Baseline: suppressed ${suppressed} known finding(s) from ${baselinePath}.`);
      }
    } else {
      log.warning(
        `Baseline file ${baselinePath} not found or invalid — reviewing without suppression. Run with --update-baseline to create it.`,
      );
    }
  }

  // Aggregate token usage from raw AI audit results. Provider/model lookup
  // is wrapped in try/catch so a missing API key after the run started
  // (very unlikely) still produces a valid report.
  let tokenUsage: ReviewReport["summary"]["tokenUsage"] | undefined;
  if (aiEnabled && auditResults.length > 0) {
    try {
      const cfg = AIConfig.fromEnvironment({
        ...(config.ai?.modelTier && { modelTier: config.ai.modelTier }),
      });
      tokenUsage = summarizeUsage(auditResults, cfg.provider, cfg.model);
    } catch {
      // Ignore — report stays without tokenUsage.
    }
  }

  // Resolve threshold once per run. The CLI flag wins, then branch
  // override, then config baseline, then default WARNING.
  let currentBranch: string | undefined;
  try {
    currentBranch = await getCurrentBranch();
  } catch {
    // Detached HEAD or non-git path — fall through with currentBranch undefined.
  }
  const threshold = resolveSeverityThreshold({
    ...(values["severity-threshold"] && { cliFlag: values["severity-threshold"] }),
    config,
    ...(currentBranch && { currentBranch }),
  });

  const report = buildReport(
    target,
    aiEnabled,
    promptVersion,
    effectiveResults,
    skipped,
    runtimeErrors,
    diffResult.totalChangedLines,
    startTime,
    mcpSummary,
    tokenUsage,
    { threshold },
  );

  // Attach reviewed-commit metadata (chronological, oldest first) so report
  // consumers can reason about commit order without re-deriving it.
  if ((target.mode === "range" || target.mode === "commit") && target.value) {
    const rangeCommits = await getCommitsForRange(
      target.mode === "commit" ? `${target.value}~1..${target.value}` : target.value,
    );
    if (rangeCommits.length > 0) {
      report.commits = rangeCommits;
    }
  }

  await postGitProviderComments(report.results, dryRun, format);

  renderReport(report, format);

  // --output: always write a clean markdown report file alongside whatever
  // console format was requested (ANSI-free, attachable to an MR).
  if (values.output) {
    try {
      await writeFileAsync(resolvePath(process.cwd(), values.output), formatMarkdownReport(report));
      log.info(`Markdown report written to ${values.output}`);
    } catch (error) {
      log.warning(
        `Failed to write report to ${values.output}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Verbose MCP summary (console only — JSON already includes it in the report)
  if ((values.verbose || verboseDryRun) && format !== "json" && report.mcp) {
    const s = report.mcp;
    console.log(`\n--- MCP context summary ---`);
    console.log(`  Servers: ${s.serverCount}`);
    console.log(
      `  Calls: ${s.attemptedCallCount} (${s.cachedCallCount} cached, ${s.freshCallCount} fresh, ${s.failedCallCount} failed)`,
    );
    console.log(`  Context chars: ${s.contextChars}${s.truncated ? " (truncated)" : ""}`);
    if (s.warnings.length > 0) {
      console.log(`  Warnings: ${s.warnings.join(", ")}`);
    }
  }

  if (report.status === "PASS") return 0;
  if (report.status === "FAIL") return 1;
  return 2;
};

/**
 * Explain Context Mode — diagnostic output showing context building details without AI calls.
 * Exported for use from src/index.ts.
 */
export async function renderExplainContext(opts: {
  values: CLIValues;
  config: ProjectConfig;
  targetBranch: string;
  maxConcurrency: number;
  startTime: number;
}): Promise<void> {
  const { values, config, targetBranch } = opts;
  const requestedFormat = values.format ?? process.env.MP_SENTINEL_FORMAT ?? "console";
  const format = resolveFormat(requestedFormat);

  // Build the target (diff) like normal review
  const target = resolveTarget(values, [], targetBranch);

  // List files for target
  const allFiles = await listFilesForTarget(target);

  // File filtering (use filterPathsWithIgnores)
  const fileHandler = new FileHandler();
  const filterResult = await fileHandler.filterPathsWithIgnores(allFiles);
  const acceptedFiles = filterResult.accepted;

  // Build list of changed files (just paths)
  const changedFiles = acceptedFiles.map((path) => ({ path }));

  // Try to build context from source index efficiently (read once, build once)
  const indexingEnabled = config.indexing?.enabled !== false;
  const cachePath = resolvePath(
    process.cwd(),
    config.indexing?.cachePath ?? ".mp-sentinel-cache/source-index.json",
  );

  let contextString: string | null = null;
  let indexUsed = false;
  let indexStatus: "available" | "unavailable" = "unavailable";
  let unavailableReason: string | undefined;
  let profile: SkillProfile = "library";
  let truncated = false;
  let relatedFileCount = 0;
  let relationTypes: RelationType[] = [];
  let includedFiles: string[] = [];
  let includedSignals: string[] | undefined;
  let intelligenceSignals: ReviewIntelligenceSignal[] | undefined;
  let evidenceSummary: EvidenceSummary[] | undefined;
  let suggestedCommands: string[] | undefined;
  const budgetChars = 12000;

  try {
    if (!indexingEnabled) {
      unavailableReason = "Indexing disabled in configuration (indexing.enabled = false).";
    } else {
      const index = await readIndex(cachePath, { hydrate: "calls" });
      if (!index) {
        unavailableReason = "No source index found. Run 'mp-sentinel indexing' to build it.";
      } else {
        // Build context and metadata in a single call
        const result = await buildReviewContext(index, changedFiles, {
          maxRelatedFiles: config.indexing?.maxRelatedFiles ?? 3,
          budgetChars,
        });
        contextString = result.context;
        if (result.context) {
          indexUsed = true;
          indexStatus = "available";
          profile = result.metadata.profile;
          truncated = result.metadata.truncated;
          relatedFileCount = result.metadata.relatedFileCount;
          relationTypes = result.metadata.relationTypes;
          includedFiles = result.metadata.includedFiles;
          includedSignals = result.metadata.includedSignals;
          intelligenceSignals = result.metadata.intelligenceSignals;
          evidenceSummary = result.metadata.evidenceSummary;
          suggestedCommands = result.metadata.suggestedCommands;
        } else {
          unavailableReason = "Source index found but context generation produced no content.";
        }
      }
    }
  } catch (error) {
    unavailableReason =
      error instanceof Error ? error.message : "Failed to read source index (corrupt or missing).";
  }

  // Detect tech profile fallback (always available — works without source index)
  let fallbackProfile: SkillProfile = "library";
  try {
    const tp = await detectTechProfile(config);
    fallbackProfile = tp.profile;
  } catch {
    // Non-critical — keep default
  }

  // Generate MCP diagnostics (read-only, no spawn)
  let mcpDiagnostics: MCPDiagnostics | undefined;
  try {
    const mcpCfg = config.mcp;
    if (mcpCfg) {
      mcpDiagnostics = generateMCPDiagnostics(mcpCfg);
    }
  } catch {
    // Non-critical — MCP diagnostics failure shouldn't block explain-context
  }

  // Build typed output object
  const output: ExplainContextOutput = {
    status: indexStatus,
  };
  if (unavailableReason) {
    output.reason = unavailableReason;
    output.profile = fallbackProfile;
  } else {
    output.profile = profile;
    output.budgetChars = budgetChars;
    output.truncated = truncated;
    output.relatedFileCount = relatedFileCount;
    output.relationTypes = relationTypes;
    output.includedFiles = includedFiles;
    output.contextPreview = contextString ? contextString.substring(0, 500) : "";
    output.indexUsed = indexUsed;
    if (includedSignals && includedSignals.length > 0) {
      output.includedSignals = includedSignals;
    }
    if (intelligenceSignals && intelligenceSignals.length > 0) {
      output.intelligenceSignals = intelligenceSignals;
    }
    if (evidenceSummary && evidenceSummary.length > 0) {
      output.evidenceSummary = evidenceSummary;
    }
    if (suggestedCommands && suggestedCommands.length > 0) {
      output.suggestedCommands = suggestedCommands;
    }
  }

  // MCP diagnostics can appear regardless of index status
  if (mcpDiagnostics) {
    output.mcp = mcpDiagnostics;
  }

  // Output
  if (format === "json") {
    console.log(JSON.stringify(output, null, 2));
  } else {
    // Console output — ASCII only, no emoji (avoids mojibake on Windows)
    console.log("\nExplain Context Mode\n");
    console.log(`Status: ${output.status}`);
    if (output.reason) {
      console.log(`Reason: ${output.reason}`);
      console.log(`Profile: ${output.profile ?? "library"}`);
    } else {
      console.log(`Profile: ${output.profile}`);
      console.log(`Budget: ${output.budgetChars} chars`);
      console.log(`Truncated: ${output.truncated ? "yes" : "no"}`);
      console.log(`Related files: ${output.relatedFileCount}`);
      console.log(`Relation types: ${output.relationTypes?.join(", ") || "none"}`);
      if (output.includedSignals && output.includedSignals.length > 0) {
        console.log(`Intelligence signals: ${output.includedSignals.join(", ")}`);
      }
      if (output.intelligenceSignals && output.intelligenceSignals.length > 0) {
        const countByType = new Map<string, number>();
        for (const s of output.intelligenceSignals) {
          countByType.set(s.type, (countByType.get(s.type) ?? 0) + 1);
        }
        const typeSummary = [...countByType.entries()].map(([t, c]) => `${t}(${c})`).join(", ");
        console.log(`Signal details: ${typeSummary}`);
      }
      if (output.evidenceSummary && output.evidenceSummary.length > 0) {
        console.log(`Evidence summary: ${output.evidenceSummary.length} entries`);
        for (const e of output.evidenceSummary) {
          console.log(`  [${e.signalType}] ${e.sourceFile} - ${e.evidence}`);
        }
      }
      console.log("\nIncluded files:");
      for (const file of output.includedFiles || []) {
        console.log(`  - ${file}`);
      }
      if (output.suggestedCommands && output.suggestedCommands.length > 0) {
        console.log("\nSuggested commands:");
        for (const cmd of output.suggestedCommands) {
          console.log(`  ${cmd}`);
        }
      }
      if (output.mcp) {
        console.log("\nMCP diagnostics:");
        console.log(`  Enabled: ${output.mcp.enabled ? "yes" : "no"}`);
        console.log(`  Servers: ${output.mcp.serverCount}`);
        if (output.mcp.cacheSettings) {
          console.log(
            `  Cache: ${output.mcp.cacheSettings.enabled ? "enabled" : "disabled"} (TTL: ${output.mcp.cacheSettings.ttlMs}ms)`,
          );
        }
        for (const srv of output.mcp.servers) {
          const flag = srv.status === "ready" ? "[OK]" : `[${srv.status}]`;
          const srcTag = srv.source === "preset" ? "[preset]" : "[explicit]";
          console.log(`    ${flag} ${srv.id} ${srcTag}: ${srv.command} (${srv.toolCount} calls)`);
          if (srv.missingVars && srv.missingVars.length > 0) {
            console.log(`      missing env: ${srv.missingVars.join(", ")}`);
          }
          if (srv.recommendedActions && srv.recommendedActions.length > 0) {
            for (const action of srv.recommendedActions) {
              console.log(`      => ${action}`);
            }
          }
        }
      }
      console.log("\nContext preview:");
      console.log("=== Start of context ===\n");
      console.log(output.contextPreview || "");
      if ((output.contextPreview?.length || 0) >= 500) {
        console.log("\n... (truncated)");
      } else {
        console.log("\n=== End of preview ===");
      }
    }
  }

  // Exit code: 0 for success (even if index unavailable), runtime errors throw
  process.exitCode = 0;
}
