/**
 * Audit Results Summary
 * Formats and prints audit results for CLI output
 */

import type { FileAuditResult } from "../types/index.js";
import { log, formatDuration } from "../utils/logger.js";

/**
 * Print audit results summary and return whether all checks passed
 *
 * @returns `true` if no critical issues or system errors were found
 */
export const printResultsSummary = (results: FileAuditResult[], totalDuration: number): boolean => {
  const passed = results.filter((r) => r.result.status === "PASS");
  const failed = results.filter((r) => r.result.status === "FAIL");
  const errored = results.filter((r) => r.result.status === "ERROR");
  const criticalFiles = results.filter((r) =>
    r.result.issues?.some((i) => i.severity === "CRITICAL"),
  );

  log.divider();
  console.log();
  console.log(`📊 Audit Summary`);
  console.log(`   Total files:    ${results.length}`);
  console.log(`   ✅ Passed:       ${passed.length}`);
  console.log(`   ❌ Failed:       ${failed.length}`);
  console.log(`   💥 Errors:       ${errored.length}`);
  console.log(`   🚨 Critical:     ${criticalFiles.length}`);
  console.log(`   ⏱️  Duration:     ${formatDuration(totalDuration)}`);
  console.log();

  // Check for system errors (failed status but no issues logged)
  const systemErrors = results.filter(
    (r) =>
      (r.result.status === "FAIL" || r.result.status === "ERROR") &&
      (!r.result.issues || r.result.issues.length === 0),
  );

  // Print detailed issues
  for (const result of [...failed, ...errored]) {
    console.log(`❌ ${result.filePath}:`);

    if (result.result.issues && result.result.issues.length > 0) {
      for (const issue of result.result.issues) {
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

  // Fail if there are any FAIL/ERROR results
  return failed.length === 0 && errored.length === 0;
};
