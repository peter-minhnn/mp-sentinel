/**
 * Audit Results Summary
 * Formats and prints audit results for CLI output using the shared
 * terminal UI theme (same look as the review console report).
 */

import type { CommitInfo, FileAuditResult, SeverityThreshold } from "../types/index.js";
import { formatDuration, log } from "../utils/logger.js";
import { getToolVersion } from "../utils/version.js";
import { printConsoleFindings, printRecurringIssues } from "../formatters/report.js";
import {
  DEFAULT_SEVERITY_THRESHOLD,
  activeIssues,
  issuesFailThreshold,
} from "../utils/severity.js";
import {
  appHeader,
  bold,
  countToken,
  dim,
  dot,
  keyValueRow,
  paint,
  sectionHeader,
  statusBadge,
} from "../utils/terminal-ui.js";

export interface ResultsSummaryContext {
  /** Human-readable target description, e.g. "local (3 commits)" or "branch-diff (origin/main)". */
  target?: string;
  /** Whether AI review was enabled for this run. */
  aiEnabled?: boolean;
  /** Files skipped due to ignore rules. */
  skipped?: Array<{ path: string; reason: string }>;
  /** Runtime error messages to display at the bottom. */
  errors?: string[];
  /**
   * Commits covered by this run, in CHRONOLOGICAL order (index 0 = oldest).
   * Rendered with explicit ordering labels so downstream report writers can
   * never misread which commit supersedes which.
   */
  commits?: CommitInfo[];
}

/** Render the reviewed-commits section (oldest → newest, explicitly labeled). */
const printCommitsSection = (commits: CommitInfo[]): void => {
  for (const line of sectionHeader(`Commits reviewed (${commits.length}, oldest → newest)`)) {
    console.log(line);
  }
  commits.forEach((commit, index) => {
    const date = commit.date ? ` ${dim(commit.date)}` : "";
    log.plain(`  #${index + 1} ${bold(commit.hash.slice(0, 7))}${date} ${commit.message}`);
  });
};

/** Count ACTIVE issues only — resolved-at-head findings are informational. */
const countIssues = (results: FileAuditResult[], severity: string): number =>
  results.reduce(
    (acc, r) => acc + activeIssues(r.result.issues).filter((i) => i.severity === severity).length,
    0,
  );

/**
 * Print audit results summary and return whether all checks passed.
 *
 * @param threshold - Issues below this severity are not counted as failures.
 *                    Defaults to WARNING (the historical behavior).
 * @param ctx       - Optional extra context (target, AI status, skipped, errors)
 *                    rendered to match the AI review console report layout.
 * @returns true if no issues meet-or-exceed the threshold and no runtime errors occurred.
 */
export const printResultsSummary = (
  results: FileAuditResult[],
  totalDuration: number,
  threshold: SeverityThreshold = DEFAULT_SEVERITY_THRESHOLD,
  ctx: ResultsSummaryContext = {},
): boolean => {
  const passed = results.filter((r) => r.result.status === "PASS");
  const failed = results.filter((r) => r.result.status === "FAIL");
  const errored = results.filter((r) => r.result.status === "ERROR");
  const criticalIssues = countIssues(results, "CRITICAL");
  const warningIssues = countIssues(results, "WARNING");
  const infoIssues = countIssues(results, "INFO");

  const hasThresholdViolations = results.some((r) =>
    issuesFailThreshold(r.result.issues, threshold),
  );
  const hasFailWithoutIssues = failed.some((r) => !r.result.issues || r.result.issues.length === 0);
  const allPassed = errored.length === 0 && !hasThresholdViolations && !hasFailWithoutIssues;
  const status = errored.length > 0 ? "ERROR" : allPassed ? "PASS" : "FAIL";

  const subtitleParts = [statusBadge(status)];
  if (ctx.target) subtitleParts.push(ctx.target);
  subtitleParts.push(formatDuration(totalDuration));
  for (const line of appHeader(getToolVersion(), subtitleParts.join(dot()))) {
    console.log(line);
  }

  for (const line of sectionHeader("Overview")) {
    console.log(line);
  }
  console.log(keyValueRow("Status", statusBadge(status)));
  if (ctx.target) {
    console.log(keyValueRow("Target", ctx.target));
  }
  if (ctx.aiEnabled !== undefined) {
    console.log(
      keyValueRow("AI review", ctx.aiEnabled ? paint("enabled", "green") : dim("disabled")),
    );
  }
  console.log(
    keyValueRow(
      "Files",
      `${results.length} audited` +
        dot() +
        [
          countToken(passed.length, "passed", "green"),
          countToken(failed.length, "failed", "red"),
          ...(errored.length > 0 ? [countToken(errored.length, "errors", "magenta")] : []),
        ].join(dot()),
    ),
  );
  console.log(
    keyValueRow(
      "Findings",
      [
        countToken(criticalIssues, "critical", "red"),
        countToken(warningIssues, "warning", "yellow"),
        countToken(infoIssues, "info", "blue"),
      ].join(dot()),
    ),
  );
  console.log(keyValueRow("Duration", formatDuration(totalDuration)));

  if (ctx.commits && ctx.commits.length > 0) {
    printCommitsSection(ctx.commits);
  }

  printRecurringIssues(results);
  printConsoleFindings(results);

  const skipped = ctx.skipped ?? [];
  if (skipped.length > 0) {
    for (const line of sectionHeader(`Skipped (${skipped.length})`)) {
      console.log(line);
    }
    for (const item of skipped) {
      log.plain(`  ${item.path} ${dim(`— ${item.reason}`)}`);
    }
  }

  const errors = ctx.errors ?? [];
  if (errors.length > 0) {
    console.log();
    log.critical(bold(`Runtime errors (${errors.length})`));
    for (const error of errors) {
      log.file(error);
    }
  }

  return allPassed;
};
