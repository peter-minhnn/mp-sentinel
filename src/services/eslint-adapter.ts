/**
 * ESLint adapter (fail-open).
 *
 * Runs the *reviewed project's own* ESLint installation against the files in
 * the review scope and maps the JSON output into the same `RiskAnalysisResult`
 * shape the risk analyzer produces, so callers merge findings via the existing
 * `mergeFindings` pipeline (dedupe by category + line is preserved).
 *
 * Behavioral contract:
 * - Opt-in via `eslint.enabled` in `.mp-sentinelrc.json` (default: disabled).
 * - Fail-open: missing ESLint binary/config, process timeout, or malformed
 *   JSON output never fail the review — the adapter logs a warning and
 *   returns `null` so the pipeline continues unchanged.
 * - ESLint exit code 1 means "lint findings exist" and is a SUCCESS for the
 *   adapter (stdout still contains the JSON report). Only exit code 2 /
 *   spawn errors are treated as unavailability.
 * - Severity mapping: per-rule overrides from config win, then a small
 *   crash-prone whitelist maps to CRITICAL, then ESLint severity 2 → WARNING
 *   and 1 → INFO.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AuditIssue, ESLintAdapterConfig, ProjectConfig } from "../types/index.js";
import type { FileAnalysis, RiskAnalysisResult } from "./risk-analyzer/index.js";
import { log } from "../utils/logger.js";

const execAsync = promisify(exec);

/** Subset of an ESLint JSON-formatter message we consume. */
export interface ESLintMessage {
  ruleId: string | null;
  /** ESLint severity: 1 = warn, 2 = error */
  severity: number;
  message: string;
  line?: number;
}

/** Subset of an ESLint JSON-formatter file entry we consume. */
export interface ESLintFileResult {
  filePath: string;
  messages: ESLintMessage[];
}

/** Minimal exec contract — injectable for tests. */
export type ESLintExec = (
  command: string,
  options: { cwd: string; timeout: number; maxBuffer: number },
) => Promise<{ stdout: string }>;

/** File extensions ESLint is asked to lint. */
const LINTABLE_FILE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i;

/**
 * True when ESLint is asked to lint a path (by extension). Exported so the
 * unused-import reconciler can tell which files ESLint actually covered and
 * therefore where ESLint may be treated as the authority on unused symbols.
 */
export const isLintableFile = (path: string): boolean => LINTABLE_FILE_RE.test(path);

/** Rules whose violations are crash-prone enough to warrant CRITICAL. */
const CRITICAL_RULE_IDS = new Set<string>([
  "react-hooks/rules-of-hooks",
  "@typescript-eslint/no-floating-promises",
]);

/** Exact ruleId → rubric category. Checked before the prefix fallback. */
const CATEGORY_BY_RULE_ID: Record<string, string> = {
  "react-hooks/rules-of-hooks": "runtime-crash",
  "react-hooks/exhaustive-deps": "performance",
  "@typescript-eslint/no-floating-promises": "runtime-crash",
  "@typescript-eslint/no-misused-promises": "runtime-crash",
  "no-await-in-loop": "performance",
  "no-debugger": "maintainability",
};

/** Legacy + flat ESLint config file names probed before spawning. */
const ESLINT_CONFIG_FILES = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  "eslint.config.mts",
  "eslint.config.cts",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.json",
  ".eslintrc.yaml",
  ".eslintrc.yml",
  ".eslintrc",
];

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 50 * 1024 * 1024;
/** Conservative arg-length budget per spawned ESLint process. */
const MAX_COMMAND_CHARS = 6_000;

/** POSIX-safe single-quote escaping (mirrors `shellEscape` in utils/git.ts). */
const shellEscape = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

/** Map an ESLint ruleId to the audit rubric category. */
export const categoryForRule = (ruleId: string): string => {
  const exact = CATEGORY_BY_RULE_ID[ruleId];
  if (exact) return exact;
  if (ruleId.startsWith("react-hooks/")) return "runtime-crash";
  if (ruleId.startsWith("security/")) return "security";
  return "maintainability";
};

/** Resolve the final severity for one message (override > whitelist > level). */
const severityForMessage = (
  ruleId: string,
  eslintSeverity: number,
  overrides: Record<string, AuditIssue["severity"]>,
): AuditIssue["severity"] => {
  const override = overrides[ruleId];
  if (override) return override;
  if (CRITICAL_RULE_IDS.has(ruleId)) return "CRITICAL";
  return eslintSeverity === 2 ? "WARNING" : "INFO";
};

/**
 * Pure mapping from ESLint JSON output to a RiskAnalysisResult.
 * `absoluteToRelative` maps ESLint's absolute file paths back to the
 * repo-relative paths the rest of the pipeline uses.
 */
export const mapESLintOutput = (
  eslintResults: ESLintFileResult[],
  absoluteToRelative: Map<string, string>,
  overrides: Record<string, AuditIssue["severity"]> = {},
): RiskAnalysisResult => {
  const files: FileAnalysis[] = [];
  let totalCritical = 0;
  let totalWarning = 0;
  let totalInfo = 0;

  for (const entry of eslintResults) {
    const relativePath = absoluteToRelative.get(entry.filePath) ?? entry.filePath;
    const issues: AuditIssue[] = [];
    let critical = 0;
    let warning = 0;
    let info = 0;

    for (const msg of entry.messages) {
      // ruleId === null means a fatal parse/config problem for that file —
      // skip rather than blame the code under review (fail-open spirit).
      if (!msg.ruleId) continue;

      const severity = severityForMessage(msg.ruleId, msg.severity, overrides);
      issues.push({
        line: msg.line ?? 1,
        severity,
        category: categoryForRule(msg.ruleId),
        confidence: "high",
        evidence: `eslint:${msg.ruleId}`,
        message: `[ESLint] ${msg.message} (${msg.ruleId})`,
        suggestion: `Fix the ${msg.ruleId} violation — see the project ESLint config for rationale.`,
      });

      if (severity === "CRITICAL") critical++;
      else if (severity === "WARNING") warning++;
      else info++;
    }

    if (issues.length > 0) {
      files.push({
        path: relativePath,
        issues,
        localSeverityCounts: { critical, warning, info },
      });
      totalCritical += critical;
      totalWarning += warning;
      totalInfo += info;
    }
  }

  return {
    files,
    totalCritical,
    totalWarning,
    totalInfo,
    hasCriticalFindings: totalCritical > 0,
  };
};

/** True when the reviewed project has an ESLint config we can run against. */
const hasESLintConfig = (cwd: string): boolean =>
  ESLINT_CONFIG_FILES.some((name) => existsSync(join(cwd, name)));

/** Prefer the project-local binary; fall back to npx without installing. */
const resolveESLintCommand = (cwd: string): string => {
  const localBin = join(cwd, "node_modules", ".bin", "eslint");
  if (existsSync(localBin) || existsSync(`${localBin}.cmd`)) {
    return shellEscape(localBin);
  }
  return "npx --no-install eslint";
};

/** Split file args into batches that respect the command-length budget. */
const batchFiles = (files: string[]): string[][] => {
  const batches: string[][] = [];
  let current: string[] = [];
  let currentLength = 0;

  for (const file of files) {
    const cost = file.length + 3; // quotes + separator
    if (current.length > 0 && currentLength + cost > MAX_COMMAND_CHARS) {
      batches.push(current);
      current = [];
      currentLength = 0;
    }
    current.push(file);
    currentLength += cost;
  }
  if (current.length > 0) batches.push(current);
  return batches;
};

/**
 * Parse ESLint JSON stdout defensively. Returns null on malformed output.
 */
const parseESLintJson = (stdout: string): ESLintFileResult[] | null => {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (!Array.isArray(parsed)) return null;
    return parsed as ESLintFileResult[];
  } catch {
    return null;
  }
};

/**
 * Run the project's ESLint over the given repo-relative file paths.
 *
 * Returns `null` when the adapter is disabled, unavailable, or fails —
 * callers must treat `null` as "no ESLint findings" and continue.
 */
export const runESLintAdapter = async (
  filePaths: string[],
  config: ProjectConfig,
  cwd: string = process.cwd(),
  execImpl: ESLintExec = execAsync,
): Promise<RiskAnalysisResult | null> => {
  const eslintConfig: ESLintAdapterConfig = config.eslint ?? {};
  if (eslintConfig.enabled !== true) return null;

  const lintableFiles = filePaths.filter((p) => LINTABLE_FILE_RE.test(p));
  if (lintableFiles.length === 0) return null;

  if (!hasESLintConfig(cwd)) {
    log.warning("ESLint adapter enabled but no ESLint config found — skipping ESLint findings.");
    return null;
  }

  const command = resolveESLintCommand(cwd);
  const timeout = eslintConfig.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const absoluteToRelative = new Map<string, string>(
    lintableFiles.map((p) => [resolve(cwd, p), p]),
  );

  const allResults: ESLintFileResult[] = [];

  for (const batch of batchFiles(lintableFiles)) {
    const fileArgs = batch.map(shellEscape).join(" ");
    const fullCommand = `${command} --format json --no-error-on-unmatched-pattern ${fileArgs}`;

    let stdout: string | null = null;
    try {
      const result = await execImpl(fullCommand, {
        cwd,
        timeout,
        maxBuffer: MAX_OUTPUT_BYTES,
      });
      stdout = result.stdout;
    } catch (err) {
      // Exit code 1 = findings exist; the JSON report is still on stdout.
      const maybeStdout = (err as { stdout?: unknown }).stdout;
      if (typeof maybeStdout === "string" && maybeStdout.trim().length > 0) {
        stdout = maybeStdout;
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        log.warning(
          `ESLint adapter unavailable (${msg.slice(0, 200)}) — skipping ESLint findings.`,
        );
        return null;
      }
    }

    const parsed = parseESLintJson(stdout);
    if (!parsed) {
      log.warning("ESLint adapter returned malformed JSON — skipping ESLint findings.");
      return null;
    }
    allResults.push(...parsed);
  }

  const mapped = mapESLintOutput(allResults, absoluteToRelative, eslintConfig.severityOverrides);
  const totalFindings = mapped.totalCritical + mapped.totalWarning + mapped.totalInfo;
  if (totalFindings > 0) {
    log.info(
      `ESLint adapter: ${totalFindings} finding(s) across ${mapped.files.length} file(s) merged into review.`,
    );
  }
  return mapped;
};
