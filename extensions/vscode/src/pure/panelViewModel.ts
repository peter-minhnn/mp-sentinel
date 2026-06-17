/**
 * Side-panel view-model: types, identifiers, and pure derivations (grouping,
 * counts, normalized->panel projection). No `vscode` import (type-only from
 * core) so it stays unit-testable.
 */

import type { Severity } from "mp-sentinel-extension-core";

/** Activity Bar container + view identifiers — kept beside the command registry. */
export const PANEL_CONTAINER_ID = "mpSentinel";
export const PANEL_VIEW_ID = "mpSentinel.panel";

export type PanelPhase = "idle" | "running";

export type Confidence = "low" | "medium" | "high";

export interface PanelFinding {
  /** Workspace-relative path as emitted by the CLI. */
  filePath: string;
  line: number;
  severity: Severity;
  message: string;
  category?: string;
  confidence?: Confidence;
  suggestion?: string;
  evidence?: string;
  codeSuggestion?: string;
  /** True when this file's audit was served from cache. */
  cached?: boolean;
}

export interface PanelResult {
  kind: "review" | "dry-run";
  status: string;
  critical: number;
  warning: number;
  info: number;
  auditedFiles: number;
  totalFiles: number;
}

export interface PanelState {
  phase: PanelPhase;
  /** Compact status line for the top section. */
  statusLine: string;
  /** Label shown while running. */
  busyLabel?: string;
  /** Latest review or dry-run summary. */
  result?: PanelResult;
  /** Flattened findings for the results section. */
  findings: PanelFinding[];
  /** Absolute folder root the findings resolve against (for click-through). */
  workspaceRoot?: string;
  /** Latest index-health status string (e.g. "ok", "stale"). */
  indexHealth?: string;
  /** Latest skills-check status string (e.g. "ok", "stale"). */
  skillsStatus?: string;
  /** Compact, secret-free AI configuration status line. */
  aiStatus?: string;
}

export const INITIAL_PANEL_STATE: PanelState = {
  phase: "idle",
  statusLine: "Idle — ready to review.",
  findings: [],
};

export interface SeverityCounts {
  critical: number;
  warning: number;
  info: number;
}

/** Tallies findings by severity. */
export function countBySeverity(findings: readonly PanelFinding[]): SeverityCounts {
  const counts: SeverityCounts = { critical: 0, warning: 0, info: 0 };
  for (const f of findings) {
    if (f.severity === "CRITICAL") counts.critical++;
    else if (f.severity === "WARNING") counts.warning++;
    else counts.info++;
  }
  return counts;
}

export interface FileGroup {
  filePath: string;
  findings: PanelFinding[];
}

/** Groups findings by file, preserving first-seen order. */
export function groupFindingsByFile(findings: readonly PanelFinding[]): FileGroup[] {
  const groups = new Map<string, PanelFinding[]>();
  for (const f of findings) {
    const list = groups.get(f.filePath);
    if (list) list.push(f);
    else groups.set(f.filePath, [f]);
  }
  return [...groups.entries()].map(([filePath, list]) => ({ filePath, findings: list }));
}

/** Minimal shape shared with core's NormalizedFinding — keeps this module pure. */
export interface FindingLike {
  filePath: string;
  line: number;
  severity: Severity;
  message: string;
  category?: string;
  confidence?: Confidence;
  suggestion?: string;
  evidence?: string;
  codeSuggestion?: string;
  cached?: boolean;
}

/** Projects normalized findings to the panel shape, carrying optional metadata. */
export function toPanelFindings(findings: readonly FindingLike[]): PanelFinding[] {
  return findings.map((f) => {
    const out: PanelFinding = {
      filePath: f.filePath,
      line: f.line,
      severity: f.severity,
      message: f.message,
    };
    if (f.category !== undefined) out.category = f.category;
    if (f.confidence !== undefined) out.confidence = f.confidence;
    if (f.suggestion !== undefined) out.suggestion = f.suggestion;
    if (f.evidence !== undefined) out.evidence = f.evidence;
    if (f.codeSuggestion !== undefined) out.codeSuggestion = f.codeSuggestion;
    if (f.cached !== undefined) out.cached = f.cached;
    return out;
  });
}
