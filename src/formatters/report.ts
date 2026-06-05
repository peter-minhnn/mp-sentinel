/**
 * Report formatters for console/json/markdown outputs.
 */

import type { AuditIssue, FileAuditResult, ReviewReport } from "../types/index.js";
import { formatDuration, log } from "../utils/logger.js";
import { sortIssues, sortFileResults } from "../utils/display.js";
import { getToolVersion } from "../utils/version.js";
import {
  appHeader,
  bold,
  countToken,
  dim,
  dot,
  keyValueRow,
  paint,
  sectionHeader,
  severityBadge,
  statusBadge,
} from "../utils/terminal-ui.js";

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

// ── Console report ────────────────────────────────────────────────────────

const ISSUE_INDENT = "    ";
const ISSUE_DETAIL_INDENT = `${ISSUE_INDENT}  `;

const targetDescription = (report: ReviewReport): string =>
  `${report.target.mode}${report.target.value ? ` (${report.target.value})` : ""}`;

const printReportHeader = (report: ReviewReport): void => {
  const subtitle = [
    statusBadge(report.status),
    targetDescription(report),
    formatDuration(report.summary.durationMs),
  ].join(dot());
  for (const line of appHeader(getToolVersion(), subtitle)) {
    console.log(line);
  }
};

const printOverviewSection = (report: ReviewReport): void => {
  for (const line of sectionHeader("Overview")) {
    console.log(line);
  }
  const s = report.summary;
  console.log(keyValueRow("Status", statusBadge(report.status)));
  console.log(keyValueRow("Target", targetDescription(report)));
  console.log(
    keyValueRow("AI review", report.aiEnabled ? paint("enabled", "green") : dim("disabled")),
  );
  console.log(
    keyValueRow(
      "Files",
      `${s.auditedFiles} audited / ${s.totalFiles} total` +
        dot() +
        [
          countToken(s.passedFiles, "passed", "green"),
          countToken(s.failedFiles, "failed", "red"),
        ].join(dot()),
    ),
  );
  console.log(
    keyValueRow(
      "Findings",
      [
        countToken(s.criticalIssues, "critical", "red"),
        countToken(s.warningIssues, "warning", "yellow"),
        countToken(s.infoIssues, "info", "blue"),
      ].join(dot()),
    ),
  );
  console.log(keyValueRow("Diff lines", String(s.totalChangedLines)));
  console.log(keyValueRow("Duration", formatDuration(s.durationMs)));

  const usage = s.tokenUsage;
  if (usage) {
    console.log(
      keyValueRow(
        "Tokens",
        `in=${usage.inputTokens.toLocaleString()}, out=${usage.outputTokens.toLocaleString()} ` +
          dim(`(${usage.callCount} call${usage.callCount === 1 ? "" : "s"})`),
      ),
    );
    if (typeof usage.estimatedCostUsd === "number") {
      console.log(keyValueRow("Est. cost", formatCostUsd(usage.estimatedCostUsd)));
    }
  }
};

/** Findings filter shared by console renderers: actionable results only. */
const filterActionableResults = (results: FileAuditResult[]): FileAuditResult[] =>
  results.filter(
    (entry) =>
      entry.result.status === "FAIL" ||
      entry.result.status === "ERROR" ||
      (entry.result.issues?.some((i) => i.severity === "CRITICAL" || i.severity === "WARNING") ??
        false),
  );

const printIssueLines = (issue: AuditIssue): void => {
  const meta = metadataTag(issue.category, issue.confidence);
  log.plain(
    `${ISSUE_INDENT}${severityBadge(issue.severity)} ${dim(`L${issue.line}`)}  ${meta ? dim(meta) : ""}${issue.message}`,
  );
  if (issue.evidence) {
    log.plain(`${ISSUE_DETAIL_INDENT}${dim(`↳ evidence: ${formatEvidence(issue.evidence)}`)}`);
  }
  if (issue.suggestion) {
    log.plain(`${ISSUE_DETAIL_INDENT}${dim("↳ suggestion:")} ${issue.suggestion}`);
  }
};

/**
 * Print the findings section (grouped by file, severity-sorted) when any
 * actionable results exist. Shared by the review report and the legacy
 * review summary so both render the same console UI.
 */
export const printConsoleFindings = (results: FileAuditResult[]): void => {
  const findingResults = filterActionableResults(results);
  if (findingResults.length === 0) return;

  for (const line of sectionHeader("Findings")) {
    console.log(line);
  }
  for (const result of sortFileResults(findingResults)) {
    const cachedTag = result.cached ? dim(" (cached)") : "";
    console.log(`  ${bold(result.filePath)}${cachedTag}`);
    if (result.result.issues && result.result.issues.length > 0) {
      for (const issue of sortIssues(result.result.issues)) {
        printIssueLines(issue);
      }
    } else {
      log.error(result.result.message || "Unknown runtime error");
    }
    console.log();
  }
};

const printSkippedSection = (skipped: ReviewReport["skipped"]): void => {
  if (skipped.length === 0) return;
  for (const line of sectionHeader(`Skipped (${skipped.length})`)) {
    console.log(line);
  }
  for (const item of skipped) {
    log.plain(`  ${item.path} ${dim(`— ${item.reason}`)}`);
  }
};

const printRuntimeErrorsSection = (errors: string[]): void => {
  if (errors.length === 0) return;
  console.log();
  log.critical(bold(`Runtime errors (${errors.length})`));
  for (const error of errors) {
    log.file(error);
  }
};

export const printConsoleReport = (report: ReviewReport): void => {
  printReportHeader(report);
  printOverviewSection(report);
  printConsoleFindings(report.results);
  printSkippedSection(report.skipped);
  printRuntimeErrorsSection(report.errors);
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
