/**
 * Pure formatters for the status bar and the index-health report.
 *
 * Keeping the presentation logic here (free of any `vscode` runtime import,
 * using only type-only imports from the core package) means the tricky bits —
 * which icon, when to clear a stale tooltip, which action buttons to offer — are
 * unit-tested instead of hidden inside UI glue.
 */

import type { IndexHealthOutput, ReviewStatus } from "mp-sentinel-extension-core";

export interface StatusDisplay {
  text: string;
  tooltip: string;
  /** "error" → error background; "none" → clear any background. */
  background: "error" | "none";
}

/** The neutral, idle status-bar appearance. */
export const IDLE_STATUS: StatusDisplay = {
  text: "$(shield) MP Sentinel",
  tooltip: "Run an MP Sentinel review",
  background: "none",
};

/** Status-bar appearance for a completed review. */
export function formatReviewStatus(status: ReviewStatus, summaryLine: string): StatusDisplay {
  const icon = status === "PASS" ? "$(pass)" : status === "FAIL" ? "$(error)" : "$(warning)";
  return {
    text: `${icon} MP Sentinel`,
    tooltip: summaryLine,
    background: status === "FAIL" ? "error" : "none",
  };
}

export interface IndexHealthDisplay {
  /** True when the index status is "ok". */
  healthy: boolean;
  /** Status-bar tooltip; the idle tooltip when healthy so stale state clears. */
  tooltip: string;
  /** "warning" → warning background; "none" → clear it. */
  background: "warning" | "none";
  /** Lines for the output channel, most-significant first. */
  lines: string[];
  /** Notification action button labels, in display order. */
  actions: string[];
}

/**
 * Builds the full presentation for an index-health result: status-bar state,
 * output-channel lines (including parse-error and recovered-file debt), and the
 * action buttons to offer ("Rebuild Index" / "Show Output").
 *
 * A healthy result returns the idle tooltip so a previously-shown stale tooltip
 * is cleared rather than left lingering.
 */
export function formatIndexHealth(health: IndexHealthOutput): IndexHealthDisplay {
  const healthy = health.status === "ok";
  const hasDebt = (health.parseErrorCount ?? 0) > 0 || (health.recoveredFiles ?? 0) > 0;

  const lines: string[] = [`Source index health: ${health.status}`];
  if (health.totalFiles !== undefined) lines.push(`  files: ${health.totalFiles}`);
  if (health.parseErrorCount) lines.push(`  parse errors: ${health.parseErrorCount}`);
  if (health.recoveredFiles) lines.push(`  recovered files: ${health.recoveredFiles}`);
  if (health.staleReasons?.length) lines.push(`  stale: ${health.staleReasons.join(", ")}`);
  if (health.suggestedCommands?.length) {
    lines.push(`  suggested: ${health.suggestedCommands.join(" | ")}`);
  }

  const actions: string[] = [];
  if (!healthy) actions.push("Rebuild Index");
  if (!healthy || hasDebt) actions.push("Show Output");

  if (healthy) {
    return {
      healthy,
      tooltip: IDLE_STATUS.tooltip,
      background: "none",
      lines,
      actions,
    };
  }

  const reasons = health.staleReasons?.join(", ") ?? health.status;
  return {
    healthy,
    tooltip: `Source index: ${health.status} (${reasons}). Click to rebuild.`,
    background: "warning",
    lines,
    actions,
  };
}
