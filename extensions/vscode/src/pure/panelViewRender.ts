/**
 * Pure HTML rendering for the side panel. Consumes the view-model and the
 * inline asset strings; everything user-derived is HTML-escaped, and the only
 * script/style are injected under the per-render nonce (strict CSP).
 */

import type { Severity } from "mp-sentinel-extension-core";

import { COMMAND_IDS } from "./commandIds.js";
import { PANEL_SCRIPT, PANEL_STYLE } from "./panelViewAssets.js";
import {
  groupFindingsByFile,
  type PanelFinding,
  type PanelResult,
  type PanelState,
} from "./panelViewModel.js";

const PRIMARY_ACTIONS: { command: string; label: string }[] = [
  { command: COMMAND_IDS.reviewStaged, label: "Review Staged" },
  { command: COMMAND_IDS.reviewCurrentFile, label: "Review Current File" },
  { command: COMMAND_IDS.reviewSelectedFiles, label: "Review Selected Files" },
  { command: COMMAND_IDS.reviewRange, label: "Review Git Range" },
  { command: COMMAND_IDS.reviewBranchDiff, label: "Review Branch vs Base" },
  { command: COMMAND_IDS.dryRunPreview, label: "Dry-Run Preview" },
];

const MAINT_ACTIONS: { command: string; label: string }[] = [
  { command: COMMAND_IDS.explainContext, label: "Explain Context" },
  { command: COMMAND_IDS.indexHealth, label: "Index Health" },
  { command: COMMAND_IDS.rebuildIndex, label: "Rebuild Index" },
  { command: COMMAND_IDS.skillsCheck, label: "Skills Check" },
  { command: COMMAND_IDS.generateSkills, label: "Generate Skills" },
  { command: COMMAND_IDS.selectProvider, label: "Configure AI" },
  { command: COMMAND_IDS.checkAiConnection, label: "Check AI Connection" },
  { command: COMMAND_IDS.setupCredentials, label: "Set Credential" },
  { command: COMMAND_IDS.clearCredential, label: "Clear Credential" },
];

const SEVERITY_GLYPH: Record<Severity, string> = {
  CRITICAL: "error",
  WARNING: "warning",
  INFO: "info",
};

const SEVERITY_FILTERS: { sev: string; label: string }[] = [
  { sev: "error", label: "Critical" },
  { sev: "warning", label: "Warning" },
  { sev: "info", label: "Info" },
];

/** Escapes the five HTML-significant characters. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderActionButtons(actions: { command: string; label: string }[]): string {
  return actions
    .map(
      (a) =>
        `<button class="act" data-command="${escapeHtml(a.command)}">${escapeHtml(a.label)}</button>`,
    )
    .join("");
}

function renderStatus(state: PanelState): string {
  if (state.phase === "running") {
    const label = escapeHtml(state.busyLabel ?? "Working…");
    return `<div class="status running"><span class="spinner">⟳</span> ${label}</div>`;
  }
  const meta: string[] = [];
  if (state.indexHealth === "ok") meta.push("index: ok");
  if (state.skillsStatus) meta.push(`skills: ${escapeHtml(state.skillsStatus)}`);
  const metaLine = meta.length > 0 ? `<div class="meta">${meta.join(" · ")}</div>` : "";
  // Stale/missing index degrades review context — surface it clearly, but never
  // block the review.
  const unhealthyIndex = state.indexHealth !== undefined && state.indexHealth !== "ok";
  const indexWarn = unhealthyIndex
    ? `<div class="warn-banner">⚠ Index ${escapeHtml(state.indexHealth ?? "")} — rebuild recommended before review</div>`
    : "";
  const aiLine = state.aiStatus ? `<div class="meta ai">${escapeHtml(state.aiStatus)}</div>` : "";
  return `<div class="status idle">${escapeHtml(state.statusLine)}</div>${indexWarn}${metaLine}${aiLine}`;
}

function renderCounters(result: PanelResult): string {
  const statusClass = result.status === "PASS" ? "ok" : result.status === "FAIL" ? "bad" : "warn";
  return `
    <div class="counters">
      <span class="pill status-${statusClass}">${escapeHtml(result.status)}</span>
      <span class="pill crit">${result.critical} critical</span>
      <span class="pill warn">${result.warning} warning</span>
      <span class="pill info">${result.info} info</span>
      <span class="pill files">${result.auditedFiles}/${result.totalFiles} files</span>
    </div>`;
}

function renderFindingDetail(f: PanelFinding): string {
  const rows: string[] = [];
  if (f.evidence)
    rows.push(`<div class="d-evidence"><b>Evidence:</b> ${escapeHtml(f.evidence)}</div>`);
  if (f.suggestion)
    rows.push(`<div class="d-suggestion"><b>Suggestion:</b> ${escapeHtml(f.suggestion)}</div>`);
  if (f.codeSuggestion)
    rows.push(
      `<div class="d-fix"><b>Proposed fix:</b><pre>${escapeHtml(f.codeSuggestion)}</pre></div>`,
    );
  if (f.cached) rows.push(`<div class="d-cached">served from cache</div>`);
  if (rows.length === 0) return "";
  return `<div class="finding-detail">${rows.join("")}</div>`;
}

function renderFinding(f: PanelFinding): string {
  const sev = SEVERITY_GLYPH[f.severity];
  const tagBits: string[] = [];
  if (f.category) tagBits.push(escapeHtml(f.category));
  if (f.confidence) tagBits.push(escapeHtml(f.confidence));
  const tag = tagBits.length > 0 ? `<span class="tag">${tagBits.join("/")}</span>` : "";
  return `
      <div class="finding sev-${sev}" data-sev="${sev}">
        <div class="finding-row">
          <span class="sev sev-${sev}" aria-label="${f.severity}"></span>
          <span class="loc">:${f.line}</span>
          ${tag}
          <span class="msg">${escapeHtml(f.message)}</span>
          <a class="open" role="button" tabindex="0" data-file="${escapeHtml(f.filePath)}" data-line="${f.line}">Open</a>
        </div>
        ${renderFindingDetail(f)}
      </div>`;
}

function renderFilters(): string {
  const checks = SEVERITY_FILTERS.map(
    (s) =>
      `<label class="sev-toggle"><input type="checkbox" class="sev-filter" data-sev="${s.sev}" checked /> ${s.label}</label>`,
  ).join("");
  return `
    <div class="filters">
      <div class="sev-toggles">${checks}</div>
      <div class="group-actions">
        <a id="expand-all" role="button" tabindex="0">Expand All</a>
        <a id="collapse-all" role="button" tabindex="0">Collapse All</a>
      </div>
    </div>`;
}

/** Fixed-header part of the results: counters + (when there are findings) filters. */
function renderResultsHeader(state: PanelState): string {
  const counters = state.result ? renderCounters(state.result) : "";
  const filters = state.findings.length > 0 ? renderFilters() : "";
  return `${counters}${filters}`;
}

/** Scrollable part of the results: the empty hint or the file groups. */
function renderResultsBody(state: PanelState): string {
  if (state.findings.length === 0) {
    const empty =
      state.result && state.result.status === "PASS"
        ? "No findings — clean."
        : "No findings yet. Run a review to see results here.";
    return `<div class="empty">${escapeHtml(empty)}</div>`;
  }
  return groupFindingsByFile(state.findings)
    .map(
      (g) => `
    <div class="file-group" data-file="${escapeHtml(g.filePath)}">
      <button class="file-head" aria-expanded="true">
        <span class="caret">▾</span> ${escapeHtml(g.filePath)} <span class="count">(${g.findings.length})</span>
      </button>
      <div class="file-body">
        ${g.findings.map(renderFinding).join("")}
      </div>
    </div>`,
    )
    .join("");
}

export interface RenderOptions {
  /** Per-render nonce; the only value allowed to run inline script/style. */
  nonce: string;
  /** `webview.cspSource` for the host. */
  cspSource: string;
}

/** Renders the full webview document for the given state. */
export function renderPanelHtml(state: PanelState, opts: RenderOptions): string {
  const { nonce, cspSource } = opts;
  const csp = [
    "default-src 'none'",
    `style-src 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
    `img-src ${cspSource}`,
  ].join("; ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style nonce="${nonce}">${PANEL_STYLE}</style>
</head>
<body>
<div class="panel">
  <div class="top">
    ${renderStatus(state)}
    <section class="actions">${renderActionButtons(PRIMARY_ACTIONS)}</section>
    <section class="actions maint">${renderActionButtons(MAINT_ACTIONS)}</section>
    ${renderResultsHeader(state)}
  </div>
  <section class="results scroll">${renderResultsBody(state)}</section>
  <footer>
    <a id="show-output" role="button" tabindex="0">Show Output</a>
    <a id="clear-findings" role="button" tabindex="0">Clear Findings</a>
  </footer>
</div>
<script nonce="${nonce}">${PANEL_SCRIPT}</script>
</body>
</html>`;
}
