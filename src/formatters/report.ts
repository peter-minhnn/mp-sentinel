/**
 * Report formatters for console/json/markdown outputs.
 */

import type { ReviewReport } from "../types/index.js";
import { formatDuration, log } from "../utils/logger.js";

const statusIcon = (status: ReviewReport["status"]): string => {
  if (status === "PASS") return "✅";
  if (status === "FAIL") return "❌";
  return "💥";
};

export const printConsoleReport = (report: ReviewReport): void => {
  log.divider();
  console.log(`📊 Review Summary`);
  console.log(`   Status:         ${statusIcon(report.status)} ${report.status}`);
  console.log(
    `   Target:         ${report.target.mode}${report.target.value ? ` (${report.target.value})` : ""}`,
  );
  console.log(`   AI Enabled:     ${report.aiEnabled ? "yes" : "no"}`);
  console.log(`   Total files:    ${report.summary.totalFiles}`);
  console.log(`   Audited files:  ${report.summary.auditedFiles}`);
  console.log(`   ✅ Passed:       ${report.summary.passedFiles}`);
  console.log(`   ❌ Failed:       ${report.summary.failedFiles}`);
  console.log(`   🚨 Critical:     ${report.summary.criticalIssues}`);
  console.log(`   ⚠️  Warning:      ${report.summary.warningIssues}`);
  console.log(`   ℹ️  Info:         ${report.summary.infoIssues}`);
  console.log(`   ⏱️  Duration:     ${formatDuration(report.summary.durationMs)}`);
  console.log(`   🔢 Diff lines:   ${report.summary.totalChangedLines}`);

  if (report.skipped.length > 0) {
    console.log();
    log.warning(`Skipped ${report.skipped.length} file(s):`);
    for (const item of report.skipped) {
      log.file(`${item.path}: ${item.reason}`);
    }
  }

  const failedOrErrored = report.results.filter(
    (entry) => entry.result.status === "FAIL" || entry.result.status === "ERROR",
  );

  if (failedOrErrored.length > 0) {
    console.log();
    for (const result of failedOrErrored) {
      const marker = result.result.status === "ERROR" ? "💥" : "❌";
      console.log(`${marker} ${result.filePath}${result.cached ? " (cached)" : ""}`);
      if (result.result.issues && result.result.issues.length > 0) {
        for (const issue of result.result.issues) {
          log.issue(issue.severity, issue.line, issue.message);
          if (issue.suggestion) {
            log.file(`💡 ${issue.suggestion}`);
          }
        }
      } else {
        log.error(result.result.message || "Unknown runtime error");
      }
      console.log();
    }
  }

  if (report.errors.length > 0) {
    log.critical("Runtime errors:");
    for (const error of report.errors) {
      log.file(error);
    }
  }
};

export const formatMarkdownReport = (report: ReviewReport): string => {
  const lines: string[] = [];

  lines.push(`# MP Sentinel Review Report`);
  lines.push("");
  lines.push(`- Status: **${report.status}**`);
  lines.push(
    `- Target: \`${report.target.mode}${report.target.value ? `:${report.target.value}` : ""}\``,
  );
  lines.push(`- AI Enabled: \`${report.aiEnabled}\``);
  lines.push(`- Generated At: \`${report.generatedAt}\``);
  lines.push("");
  lines.push(`## Summary`);
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Total files | ${report.summary.totalFiles} |`);
  lines.push(`| Audited files | ${report.summary.auditedFiles} |`);
  lines.push(`| Passed files | ${report.summary.passedFiles} |`);
  lines.push(`| Failed files | ${report.summary.failedFiles} |`);
  lines.push(`| Critical issues | ${report.summary.criticalIssues} |`);
  lines.push(`| Warning issues | ${report.summary.warningIssues} |`);
  lines.push(`| Info issues | ${report.summary.infoIssues} |`);
  lines.push(`| Duration (ms) | ${Math.round(report.summary.durationMs)} |`);
  lines.push(`| Diff lines | ${report.summary.totalChangedLines} |`);

  if (report.skipped.length > 0) {
    lines.push("");
    lines.push(`## Skipped Files`);
    lines.push("");
    for (const skipped of report.skipped) {
      lines.push(`- \`${skipped.path}\`: ${skipped.reason}`);
    }
  }

  const failedOrErrored = report.results.filter(
    (entry) => entry.result.status === "FAIL" || entry.result.status === "ERROR",
  );
  if (failedOrErrored.length > 0) {
    lines.push("");
    lines.push(`## Findings`);
    lines.push("");
    for (const result of failedOrErrored) {
      lines.push(`### \`${result.filePath}\``);
      if (result.result.issues && result.result.issues.length > 0) {
        for (const issue of result.result.issues) {
          lines.push(
            `- **${issue.severity}** (line ${issue.line}): ${issue.message}${issue.suggestion ? ` — _${issue.suggestion}_` : ""}`,
          );
        }
      } else {
        lines.push(`- **ERROR**: ${result.result.message || "Unknown runtime error"}`);
      }
      lines.push("");
    }
  }

  if (report.errors.length > 0) {
    lines.push("## Runtime Errors");
    lines.push("");
    for (const error of report.errors) {
      lines.push(`- ${error}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
};
