/**
 * Audit Results Summary
 * Formats and prints audit results for CLI output
 */

import type { FileAuditResult } from "../types/index.js";
import { log, formatDuration } from "../utils/logger.js";
import { printBanner, sortIssues, sortFileResults } from "../utils/display.js";

const dividerLine = "─".repeat(50);

/**
 * Print audit results summary and return whether all checks passed
 *
 * @returns `true` if no critical issues or system errors were found
 */
export const printResultsSummary = (results: FileAuditResult[], totalDuration: number): boolean => {
  const passed = results.filter((r) => r.result.status === "PASS");
  const failed = results.filter((r) => r.result.status === "FAIL");
  const errored = results.filter((r) => r.result.status === "ERROR");
  const criticalIssues = results.reduce(
    (acc, r) => acc + (r.result.issues?.filter((i) => i.severity === "CRITICAL").length ?? 0),
    0,
  );
  const warningIssues = results.reduce(
    (acc, r) => acc + (r.result.issues?.filter((i) => i.severity === "WARNING").length ?? 0),
    0,
  );
  const infoIssues = results.reduce(
    (acc, r) => acc + (r.result.issues?.filter((i) => i.severity === "INFO").length ?? 0),
    0,
  );

  printBanner();
  console.log(`📊 Audit Summary`);
  console.log(`  ${dividerLine}`);
  console.log(`  Total files        ${results.length}`);
  console.log(`  ✅ Passed           ${passed.length}`);
  console.log(`  ❌ Failed           ${failed.length}`);
  console.log(`  💥 Errors           ${errored.length}`);
  console.log(`  🚨 Critical         ${criticalIssues}`);
  console.log(`  ⚠️  Warning         ${warningIssues}`);
  console.log(`  ℹ️  Info            ${infoIssues}`);
  console.log(`  ⏱️  Duration        ${formatDuration(totalDuration)}`);

  // Print detailed issues — sorted by severity
  const findingResults = results.filter(
    (r) =>
      r.result.status === "FAIL" ||
      r.result.status === "ERROR" ||
      (r.result.issues?.some((i) => i.severity === "CRITICAL" || i.severity === "WARNING") ??
        false),
  );

  if (findingResults.length > 0) {
    console.log();
    const sorted = sortFileResults(findingResults);
    for (const result of sorted) {
      const marker = result.result.status === "ERROR" ? "💥" : "❌";
      console.log(`${marker} ${result.filePath}:`);

      if (result.result.issues && result.result.issues.length > 0) {
        const sortedIssues = sortIssues(result.result.issues);
        for (const issue of sortedIssues) {
          log.issue(issue.severity, issue.line, issue.message);
          if (issue.suggestion) {
            log.file(`💡 ${issue.suggestion}`);
          }
        }
      } else {
        log.error(result.result.message || "Unknown error occurred during audit");
      }
      console.log();
    }
  }

  // Fail if there are any FAIL/ERROR results
  return failed.length === 0 && errored.length === 0;
};
