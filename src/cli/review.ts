/**
 * Stable review command implementation.
 */

import type {
  FileAuditResult,
  ProjectConfig,
  ReviewFormat,
  ReviewReport,
  ReviewTarget,
} from "../types/index.js";
import type { CLIValues } from "./args.js";
import { log } from "../utils/logger.js";
import { UserError } from "../utils/errors.js";
import { collectReviewInput, listFilesForTarget } from "../utils/git.js";
import { FileHandler } from "../services/file-handler/index.js";
import { getSecurityService } from "../services/security/index.js";
import { auditFilesWithConcurrency } from "../services/ai/index.js";
import { formatMarkdownReport, printConsoleReport } from "../formatters/report.js";
import { DEFAULT_PROMPT_VERSION } from "../config/prompts.js";
import { generatePayloadSummary, resolveTokenLimit } from "../utils/tokens.js";
import { buildSystemPrompt } from "../config/prompts.js";
import { AIConfig } from "../services/ai/index.js";

export interface ReviewRunOptions {
  values: CLIValues;
  commandPositionals: string[];
  config: ProjectConfig;
  targetBranch: string;
  maxConcurrency: number;
  startTime: number;
  /** When true, run security scan only — skip AI calls and print a preview */
  dryRun?: boolean;
}

const parseBooleanEnv = (value: string | undefined): boolean | undefined => {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
};

const resolveFormat = (raw: string): ReviewFormat => {
  if (raw === "console" || raw === "json" || raw === "markdown") {
    return raw;
  }
  throw new UserError(`Unsupported format "${raw}". Expected one of: console, json, markdown.`);
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

const createSecurityOnlyResults = (
  files: Array<{ path: string; content: string }>,
  redactionReport: Array<{
    path: string;
    redactedCount: number;
    matchedPatterns: string[];
  }>,
): FileAuditResult[] => {
  const redactedMap = new Map(redactionReport.map((entry) => [entry.path, entry]));

  return files.map((file) => {
    const redaction = redactedMap.get(file.path);
    if (!redaction) {
      return {
        filePath: file.path,
        duration: 0,
        result: {
          status: "PASS",
          issues: [],
          message: "AI disabled",
        },
      };
    }

    return {
      filePath: file.path,
      duration: 0,
      result: {
        status: "FAIL",
        issues: [
          {
            line: 1,
            severity: "CRITICAL",
            message: `Potential secret detected (${redaction.redactedCount} redaction(s))`,
            suggestion:
              "Remove secrets from the diff and use environment variables or secret managers.",
          },
        ],
        message: `Matched patterns: ${redaction.matchedPatterns.join(", ")}`,
      },
    };
  });
};

const buildReport = (
  target: ReviewTarget,
  aiEnabled: boolean,
  promptVersion: string,
  results: FileAuditResult[],
  skipped: Array<{ path: string; reason: string }>,
  errors: string[],
  totalChangedLines: number,
  startTime: number,
): ReviewReport => {
  const criticalIssues = results.reduce(
    (acc, result) =>
      acc + (result.result.issues?.filter((issue) => issue.severity === "CRITICAL").length ?? 0),
    0,
  );
  const warningIssues = results.reduce(
    (acc, result) =>
      acc + (result.result.issues?.filter((issue) => issue.severity === "WARNING").length ?? 0),
    0,
  );
  const infoIssues = results.reduce(
    (acc, result) =>
      acc + (result.result.issues?.filter((issue) => issue.severity === "INFO").length ?? 0),
    0,
  );

  const hasRuntimeErrors =
    errors.length > 0 || results.some((result) => result.result.status === "ERROR");
  const hasFindings =
    results.some((result) => result.result.status === "FAIL") ||
    criticalIssues > 0 ||
    warningIssues > 0;

  const status: ReviewReport["status"] = hasRuntimeErrors ? "ERROR" : hasFindings ? "FAIL" : "PASS";

  const durationMs = performance.now() - startTime;
  const passedFiles = results.filter((r) => r.result.status === "PASS").length;
  const failedFiles = results.filter((r) => r.result.status !== "PASS").length;

  return {
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
    },
    results,
    skipped,
    errors,
    generatedAt: new Date().toISOString(),
  };
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

  printConsoleReport(report);
};

export const runReview = async (options: ReviewRunOptions): Promise<number> => {
  const {
    values,
    commandPositionals,
    config,
    targetBranch,
    maxConcurrency,
    startTime,
    dryRun = false,
  } = options;

  const formatRaw = values.format ?? process.env.MP_SENTINEL_FORMAT ?? "console";
  const format = resolveFormat(formatRaw);
  const target = resolveTarget(values, commandPositionals, targetBranch);
  // In dry-run mode, AI is always disabled
  const aiEnabled = dryRun ? false : resolveAIEnabled(values, target, config);

  const maxFiles = Math.max(1, config.ai?.maxFiles ?? 15);
  const maxDiffLines = Math.max(100, config.ai?.maxDiffLines ?? 1200);
  const maxCharsPerFile = Math.max(1000, config.ai?.maxCharsPerFile ?? 12000);
  const promptVersion = config.ai?.promptVersion || DEFAULT_PROMPT_VERSION;

  log.header("MP Sentinel Review");
  if (dryRun) {
    log.warning("DRY-RUN mode: security scan only — AI calls skipped.");
  }
  log.info(`Target: ${target.mode}${target.value ? ` (${target.value})` : ""}`);
  log.info(`AI review: ${aiEnabled ? "enabled" : "disabled"}`);
  log.info(
    `Guardrails: maxFiles=${maxFiles}, maxDiffLines=${maxDiffLines}, maxCharsPerFile=${maxCharsPerFile}`,
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

  const securityService = getSecurityService();
  const { sanitizedFiles, redactionReport } = securityService.sanitizeFiles(
    diffResult.files.map((file) => ({ path: file.path, content: file.patch })),
  );

  const runtimeErrors: string[] = [];
  let auditResults: FileAuditResult[] = [];

  if (aiEnabled || dryRun) {
    // Resolve provider-specific token limit
    let providerName: string | undefined;
    try {
      const providerConfig = AIConfig.fromEnvironment();
      providerName = providerConfig.provider;
    } catch {
      // No API key configured — use default limit
    }
    const envLimit = Number(process.env.MP_SENTINEL_TOKEN_LIMIT) || 0;
    const tokenLimit = resolveTokenLimit(providerName, envLimit || config.ai?.tokenLimit);

    // Build system prompt for token accounting
    let systemPromptForEstimate: string | undefined;
    try {
      systemPromptForEstimate = await buildSystemPrompt(config);
    } catch {
      // Non-critical — skip system prompt in estimate
    }

    const { exceeded, total } = await generatePayloadSummary(
      sanitizedFiles.map((f) => ({ path: f.path, content: f.content })),
      tokenLimit,
      systemPromptForEstimate,
    );

    if (dryRun) {
      // In dry-run mode: show security results + token preview, then exit
      log.info(
        `DRY-RUN preview: ${sanitizedFiles.length} file(s), ~${total.toLocaleString()} estimated tokens (limit: ${tokenLimit.toLocaleString()})`,
      );
      auditResults = createSecurityOnlyResults(sanitizedFiles, redactionReport);
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
        );
      } catch (error) {
        runtimeErrors.push(error instanceof Error ? error.message : "Unknown AI runtime error");
      }
    }
  } else {
    auditResults = createSecurityOnlyResults(sanitizedFiles, redactionReport);
  }

  const report = buildReport(
    target,
    aiEnabled,
    promptVersion,
    auditResults,
    skipped,
    runtimeErrors,
    diffResult.totalChangedLines,
    startTime,
  );

  renderReport(report, format);

  if (report.status === "PASS") return 0;
  if (report.status === "FAIL") return 1;
  return 2;
};
