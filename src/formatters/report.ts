/**
 * Report formatters for console/json/markdown outputs.
 */

import type { ReviewReport } from "../types/index.js";
import { formatDuration, log } from "../utils/logger.js";
import { sortIssues, sortFileResults, printBanner } from "../utils/display.js";

// ── Evidence display helpers ─────────────────────────────────────────────

const EVIDENCE_MAX_LENGTH = 160;

const formatEvidence = (evidence: string): string => {
  const collapsed = evidence.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  if (collapsed.length <= EVIDENCE_MAX_LENGTH) return collapsed;
  return collapsed.slice(0, EVIDENCE_MAX_LENGTH - 3) + "...";
};

const metadataTag = (category?: string, confidence?: "low" | "medium" | "high"): string => {
  if (category && confidence) return `[${category}/${confidence}] `;
  return "";
};

const statusIcon = (status: ReviewReport["status"]): string => {
  if (status === "PASS") return "✅";
  if (status === "FAIL") return "❌";
  return "💥";
};

// ── Summary row helpers ───────────────────────────────────────────────────

interface SummaryRow {
  icon: string;
  label: string;
  value: string;
}

const formatCostUsd = (cost: number): string => {
  // Show 4 decimal places under $1 for sub-cent accuracy; 2 for higher.
  if (cost < 1) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
};

const buildSummaryRows = (report: ReviewReport): SummaryRow[] => {
  const rows: SummaryRow[] = [
    { icon: "", label: "Status", value: `${statusIcon(report.status)} ${report.status}` },
    {
      icon: "",
      label: "Target",
      value: `${report.target.mode}${report.target.value ? ` (${report.target.value})` : ""}`,
    },
    { icon: "", label: "AI Enabled", value: report.aiEnabled ? "yes" : "no" },
    { icon: "", label: "Total files", value: String(report.summary.totalFiles) },
    { icon: "", label: "Audited files", value: String(report.summary.auditedFiles) },
    { icon: "✅", label: "Passed", value: String(report.summary.passedFiles) },
    { icon: "❌", label: "Failed", value: String(report.summary.failedFiles) },
    { icon: "🚨", label: "Critical", value: String(report.summary.criticalIssues) },
    { icon: "⚠️ ", label: "Warning", value: String(report.summary.warningIssues) },
    { icon: "ℹ️ ", label: "Info", value: String(report.summary.infoIssues) },
    { icon: "⏱️ ", label: "Duration", value: formatDuration(report.summary.durationMs) },
    { icon: "🔢", label: "Diff lines", value: String(report.summary.totalChangedLines) },
  ];

  const usage = report.summary.tokenUsage;
  if (usage) {
    rows.push({
      icon: "🪙",
      label: "Tokens",
      value: `in=${usage.inputTokens.toLocaleString()}, out=${usage.outputTokens.toLocaleString()} (${usage.callCount} call${usage.callCount === 1 ? "" : "s"})`,
    });
    if (typeof usage.estimatedCostUsd === "number") {
      rows.push({
        icon: "💵",
        label: "Est. cost",
        value: formatCostUsd(usage.estimatedCostUsd),
      });
    }
  }

  return rows;
};

const dividerLine = "─".repeat(50);

// ── Console report ────────────────────────────────────────────────────────

export const printConsoleReport = (report: ReviewReport): void => {
  // ASCII banner
  printBanner();

  // Summary table — clean two-column layout with icons
  console.log(`📊 Review Summary`);
  console.log(`  ${dividerLine}`);
  for (const row of buildSummaryRows(report)) {
    if (row.icon) {
      console.log(`  ${row.icon} ${row.label.padEnd(18)}${row.value}`);
    } else {
      console.log(`  ${row.label.padEnd(21)}${row.value}`);
    }
  }

  // Skipped files
  if (report.skipped.length > 0) {
    console.log();
    log.warning(`Skipped ${report.skipped.length} file(s):`);
    for (const item of report.skipped) {
      log.file(`${item.path}: ${item.reason}`);
    }
  }

  // Filter findings: ERROR, FAIL, or results with CRITICAL/WARNING issues
  const findingResults = report.results.filter(
    (entry) =>
      entry.result.status === "FAIL" ||
      entry.result.status === "ERROR" ||
      (entry.result.issues?.some((i) => i.severity === "CRITICAL" || i.severity === "WARNING") ??
        false),
  );

  if (findingResults.length > 0) {
    const sorted = sortFileResults(findingResults);
    console.log();
    for (const result of sorted) {
      const marker = result.result.status === "ERROR" ? "💥" : "❌";
      console.log(`${marker} ${result.filePath}${result.cached ? " (cached)" : ""}`);
      if (result.result.issues && result.result.issues.length > 0) {
        const sortedIssues = sortIssues(result.result.issues);
        for (const issue of sortedIssues) {
          const meta = metadataTag(issue.category, issue.confidence);
          log.issue(issue.severity, issue.line, `${meta}${issue.message}`);
          if (issue.evidence) {
            log.file(formatEvidence(issue.evidence));
          }
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

// ── Markdown report ───────────────────────────────────────────────────────

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
  lines.push(`| Icon | Metric | Value |`);
  lines.push(`| --- | --- | --- |`);

  const iconMap: Record<string, string> = {
    Status: statusIcon(report.status),
    Target: "🎯",
    "AI Enabled": "🤖",
    "Total files": "📄",
    "Audited files": "🔍",
    Passed: "✅",
    Failed: "❌",
    Critical: "🚨",
    Warning: "⚠️",
    Info: "ℹ️",
    Duration: "⏱️",
    "Diff lines": "🔢",
    Tokens: "🪙",
    "Est. cost": "💵",
  };

  for (const row of buildSummaryRows(report)) {
    const icon = iconMap[row.label] || "";
    lines.push(`| ${icon} | ${row.label} | ${row.value} |`);
  }

  if (report.skipped.length > 0) {
    lines.push("");
    lines.push(`## Skipped Files`);
    lines.push("");
    for (const skipped of report.skipped) {
      lines.push(`- \`${skipped.path}\`: ${skipped.reason}`);
    }
  }

  // Filter findings: ERROR, FAIL, or results with CRITICAL/WARNING issues
  const findingResults = report.results.filter(
    (entry) =>
      entry.result.status === "FAIL" ||
      entry.result.status === "ERROR" ||
      (entry.result.issues?.some((i) => i.severity === "CRITICAL" || i.severity === "WARNING") ??
        false),
  );

  if (findingResults.length > 0) {
    const sorted = sortFileResults(findingResults);
    lines.push("");
    lines.push(`## Findings`);
    lines.push("");
    for (const result of sorted) {
      lines.push(`### \`${result.filePath}\``);
      if (result.result.issues && result.result.issues.length > 0) {
        const sortedIssues = sortIssues(result.result.issues);
        for (const issue of sortedIssues) {
          const meta = metadataTag(issue.category, issue.confidence);
          let evidenceLine = "";
          if (issue.evidence) {
            evidenceLine = `\n    - _Evidence: ${formatEvidence(issue.evidence)}_`;
          }
          lines.push(
            `- **${issue.severity}** (line ${issue.line}): ${meta}${issue.message}${issue.suggestion ? ` — _${issue.suggestion}_` : ""}${evidenceLine}`,
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
