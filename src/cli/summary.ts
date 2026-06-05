/**
 * Audit Results Summary
 * Formats and prints audit results for CLI output using the shared
 * terminal UI theme (same look as the review console report).
 */

import type { FileAuditResult, SeverityThreshold } from "../types/index.js";
import { formatDuration } from "../utils/logger.js";
import { getToolVersion } from "../utils/version.js";
import { printConsoleFindings } from "../formatters/report.js";
import { DEFAULT_SEVERITY_THRESHOLD, issuesFailThreshold } from "../utils/severity.js";
import {
  appHeader,
  countToken,
  dot,
  keyValueRow,
  sectionHeader,
  statusBadge,
} from "../utils/terminal-ui.js";

const countIssues = (results: FileAuditResult[], severity: string): number =>
  results.reduce(
    (acc, r) => acc + (r.result.issues?.filter((i) => i.severity === severity).length ?? 0),
    0,
  );

/**
 * Print audit results summary and return whether all checks passed
 *
 * @param threshold — Issues below this severity are not counted as failures.
 *                    Defaults to WARNING (the historical behavior).
 * @returns `true` if no issues meet-or-exceed the threshold and no runtime
 *          errors occurred.
 */
export const printResultsSummary = (
  results: FileAuditResult[],
  totalDuration: number,
  threshold: SeverityThreshold = DEFAULT_SEVERITY_THRESHOLD,
): boolean => {
  const passed = results.filter((r) => r.result.status === "PASS");
  const failed = results.filter((r) => r.result.status === "FAIL");
  const errored = results.filter((r) => r.result.status === "ERROR");
  const criticalIssues = countIssues(results, "CRITICAL");
  const warningIssues = countIssues(results, "WARNING");
  const infoIssues = countIssues(results, "INFO");

  // Fail if any result reports an error, an issue at-or-above the threshold,
  // OR a status === "FAIL" with no issues (edge case where AI explicitly
  // marks FAIL without listing findings).
  const hasThresholdViolations = results.some((r) =>
    issuesFailThreshold(r.result.issues, threshold),
  );
  const hasFailWithoutIssues = failed.some((r) => !r.result.issues || r.result.issues.length === 0);
  const allPassed = errored.length === 0 && !hasThresholdViolations && !hasFailWithoutIssues;
  const status = errored.length > 0 ? "ERROR" : allPassed ? "PASS" : "FAIL";

  const subtitle = [
    statusBadge(status),
    `${results.length} file${results.length === 1 ? "" : "s"}`,
    formatDuration(totalDuration),
  ].join(dot());
  for (const line of appHeader(getToolVersion(), subtitle)) {
    console.log(line);
  }

  for (const line of sectionHeader("Overview")) {
    console.log(line);
  }
  console.log(keyValueRow("Status", statusBadge(status)));
  console.log(
    keyValueRow(
      "Files",
      `${results.length} total` +
        dot() +
        [
          countToken(passed.length, "passed", "green"),
          countToken(failed.length, "failed", "red"),
          countToken(errored.length, "errors", "magenta"),
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

  // Detailed findings — same layout as the review console report
  printConsoleFindings(results);

  return allPassed;
};
