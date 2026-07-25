/**
 * Report formatters for console/json/markdown outputs.
 */

import type {
  AuditIssue,
  FileAuditResult,
  ReviewProvenance,
  ReviewReport,
} from "../types/index.js";
import { activeIssues } from "../utils/severity.js";
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

/** Prefer the human-readable label; fall back to the machine target mode/value. */
const targetDescription = (report: ReviewReport): string =>
  report.targetLabel ??
  `${report.target.mode}${report.target.value ? ` (${report.target.value})` : ""}`;

/**
 * Changed-line count for display. Show `N/A` rather than `0` when the metric
 * wasn't computed but files were audited (avoids a misleading "0 diff lines"
 * on a real review).
 */
const formatDiffLines = (summary: ReviewReport["summary"]): string => {
  if (summary.totalChangedLines > 0) return String(summary.totalChangedLines);
  return summary.auditedFiles > 0 ? "N/A" : "0";
};

const buildSummaryRows = (report: ReviewReport): SummaryRow[] => {
  const rows: SummaryRow[] = [
    { icon: "", label: "Status", value: `${statusIcon(report.status)} ${report.status}` },
    {
      icon: "",
      label: "Target",
      value: targetDescription(report),
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
    { icon: "🔢", label: "Diff lines", value: formatDiffLines(report.summary) },
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
  console.log(keyValueRow("Diff lines", formatDiffLines(s)));
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

// ── Recurring-issue grouping ──────────────────────────────────────────────

export interface RecurringIssueGroup {
  /** Representative message (shortest variant in the group). */
  label: string;
  severity: AuditIssue["severity"];
  category: string;
  count: number;
  fileCount: number;
}

const RECURRING_MIN_COUNT = 3;
const RECURRING_TOP_N = 5;
const RECURRING_PREFIX_WORDS = 7;

/** The noise-budget cap notice is a synthetic summary, not a real issue —
 * it must not pollute the recurring-issues table. */
const isSyntheticSummary = (issue: AuditIssue): boolean =>
  /hidden by review\.maxFindingsPerFile/.test(issue.message);

const recurringKey = (issue: AuditIssue): string | null => {
  if (!issue.category) return null;
  if (isSyntheticSummary(issue)) return null;
  const prefix = issue.message
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, RECURRING_PREFIX_WORDS)
    .join(" ");
  if (prefix.length === 0) return null;
  return `${issue.category}|${issue.severity}|${prefix}`;
};

/**
 * Group repeated findings (same category/severity/message-prefix) across
 * files so a 400-warning report opens with "what to fix first" instead of a
 * wall of repetition. Only ACTIVE groups seen >= 3 times qualify; top 5 by
 * count are returned.
 */
export const computeRecurringIssues = (results: FileAuditResult[]): RecurringIssueGroup[] => {
  const groups = new Map<
    string,
    {
      label: string;
      severity: AuditIssue["severity"];
      category: string;
      count: number;
      files: Set<string>;
    }
  >();

  for (const entry of results) {
    for (const issue of activeIssues(entry.result.issues)) {
      const key = recurringKey(issue);
      if (!key) continue;
      const existing = groups.get(key);
      if (existing) {
        existing.count += 1;
        existing.files.add(entry.filePath);
        if (issue.message.length < existing.label.length) existing.label = issue.message;
      } else {
        groups.set(key, {
          label: issue.message,
          severity: issue.severity,
          category: issue.category ?? "",
          count: 1,
          files: new Set([entry.filePath]),
        });
      }
    }
  }

  return [...groups.values()]
    .filter((g) => g.count >= RECURRING_MIN_COUNT)
    .sort((a, b) => b.count - a.count)
    .slice(0, RECURRING_TOP_N)
    .map((g) => ({
      label: g.label,
      severity: g.severity,
      category: g.category,
      count: g.count,
      fileCount: g.files.size,
    }));
};

const RECURRING_LABEL_MAX = 110;

/** Console renderer for the recurring-issues section (no-op when empty). */
export const printRecurringIssues = (results: FileAuditResult[]): void => {
  const groups = computeRecurringIssues(results);
  if (groups.length === 0) return;
  for (const line of sectionHeader("Top recurring issues")) {
    console.log(line);
  }
  for (const group of groups) {
    const label =
      group.label.length > RECURRING_LABEL_MAX
        ? group.label.slice(0, RECURRING_LABEL_MAX - 3) + "..."
        : group.label;
    log.plain(
      `  ${bold(`${group.count}×`)} ${dim(`(${group.fileCount} file${group.fileCount === 1 ? "" : "s"})`)} ${severityBadge(group.severity)} ${dim(`[${group.category}]`)} ${label}`,
    );
  }
  console.log();
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
  printRecurringIssues(report.results);
  printConsoleFindings(report.results);
  printSkippedSection(report.skipped);
  printRuntimeErrorsSection(report.errors);
};

// ── Markdown report ───────────────────────────────────────────────────────

/**
 * Render the reproduce/provenance block as a `## Reproduce` section. Returns an
 * empty list when no provenance was recorded (older reports stay unchanged).
 * The `gitHeadSha` row is the drift detector: if it no longer matches HEAD, the
 * report predates later commits and its scope counts are stale.
 */
const provenanceSection = (provenance: ReviewProvenance | undefined): string[] => {
  if (!provenance) return [];
  const rows: Array<[string, string | undefined]> = [
    ["Command", provenance.command ? `\`${provenance.command}\`` : undefined],
    ["Compare branch", provenance.compareBranch ? `\`${provenance.compareBranch}\`` : undefined],
    ["Threshold", provenance.threshold],
    ["Provider", provenance.provider],
    ["Model", provenance.model ? `\`${provenance.model}\`` : undefined],
    ["Cache", provenance.cache],
    [
      "Include uncommitted",
      provenance.includeUncommitted === undefined
        ? undefined
        : String(provenance.includeUncommitted),
    ],
    ["Git HEAD", provenance.gitHeadSha ? `\`${provenance.gitHeadSha}\`` : undefined],
    ["Index hash", provenance.indexHash ? `\`${provenance.indexHash}\`` : undefined],
  ];
  const present = rows.filter((r): r is [string, string] => r[1] !== undefined && r[1] !== "");
  if (present.length === 0) return [];

  const out: string[] = ["", "## Reproduce", "", "| Field | Value |", "| --- | --- |"];
  for (const [label, value] of present) out.push(`| ${label} | ${value} |`);
  return out;
};

export const formatMarkdownReport = (report: ReviewReport): string => {
  const lines: string[] = [];

  lines.push(`# MP Sentinel Review Report`);
  lines.push("");
  lines.push(`- Status: **${report.status}**`);
  lines.push(`- Target: ${targetDescription(report)}`);
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

  for (const line of provenanceSection(report.provenance)) lines.push(line);

  const recurring = computeRecurringIssues(report.results);
  if (recurring.length > 0) {
    lines.push("");
    lines.push(`## Top Recurring Issues`);
    lines.push("");
    lines.push(`| Count | Files | Severity | Category | Issue |`);
    lines.push(`| --- | --- | --- | --- | --- |`);
    for (const group of recurring) {
      lines.push(
        `| ${group.count} | ${group.fileCount} | ${group.severity} | ${group.category} | ${group.label} |`,
      );
    }
  }

  if (report.commits && report.commits.length > 0) {
    lines.push("");
    lines.push(`## Commits Reviewed (${report.commits.length}, oldest → newest)`);
    lines.push("");
    lines.push(`| # | SHA | Date | Author | Message |`);
    lines.push(`| --- | --- | --- | --- | --- |`);
    report.commits.forEach((commit, index) => {
      lines.push(
        `| ${index + 1} | \`${commit.hash.slice(0, 7)}\` | ${commit.date} | ${commit.author} | ${commit.message} |`,
      );
    });
  }

  if (report.skipped.length > 0) {
    lines.push("");
    lines.push(`## Skipped Files`);
    lines.push("");
    for (const skipped of report.skipped) {
      lines.push(`- \`${skipped.path}\`: ${skipped.reason}`);
    }
  }

  // Filter findings: ERROR, FAIL, or any file with ACTIVE issues (including
  // INFO-only). INFO findings count toward the summary, so they must also
  // appear in `## Findings` — otherwise summary and body disagree.
  const findingResults = report.results.filter(
    (entry) =>
      entry.result.status === "FAIL" ||
      entry.result.status === "ERROR" ||
      activeIssues(entry.result.issues).length > 0,
  );

  const renderIssueLine = (issue: AuditIssue): string => {
    const meta = metadataTag(issue.category, issue.confidence);
    let evidenceLine = "";
    if (issue.evidence) {
      evidenceLine = `\n    - _Evidence: ${formatEvidence(issue.evidence)}_`;
    }
    return `- **${issue.severity}** (line ${issue.line}): ${meta}${issue.message}${issue.suggestion ? ` — _${issue.suggestion}_` : ""}${evidenceLine}`;
  };

  const resolvedFindings: Array<{ filePath: string; issue: AuditIssue }> = [];
  for (const entry of report.results) {
    for (const issue of entry.result.issues ?? []) {
      if (issue.resolution === "resolved-at-head") {
        resolvedFindings.push({ filePath: entry.filePath, issue });
      }
    }
  }

  if (findingResults.length > 0) {
    const sorted = sortFileResults(findingResults);
    lines.push("");
    lines.push(`## Findings`);
    lines.push("");
    for (const result of sorted) {
      lines.push(`### \`${result.filePath}\``);
      const active = activeIssues(result.result.issues);
      if (active.length > 0) {
        for (const issue of sortIssues(active)) {
          lines.push(renderIssueLine(issue));
        }
      } else if (!result.result.issues || result.result.issues.length === 0) {
        lines.push(`- **ERROR**: ${result.result.message || "Unknown runtime error"}`);
      }
      lines.push("");
    }
  }

  if (resolvedFindings.length > 0) {
    lines.push("");
    lines.push(`## Resolved During Branch (informational — not actionable)`);
    lines.push("");
    lines.push(
      `_These findings were detected at the reviewed commit but their evidence no longer exists at HEAD; git history attributes the fix to the listed commit. They do not affect pass/fail._`,
    );
    lines.push("");
    for (const { filePath, issue } of resolvedFindings) {
      lines.push(`- \`${filePath}\` (line ${issue.line}, ${issue.severity}): ${issue.message}`);
    }
    lines.push("");
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
