import * as vscode from "vscode";
import {
  CliExecError,
  normalizeFindings,
  userMessageForFailure,
  type ReviewReport,
} from "mp-sentinel-extension-core";

import { workspaceRelativePath } from "../pure/paths.js";
import { toPanelFindings, type PanelResult } from "../pure/panelView.js";
import { makeStreamingExtras, type StreamingExtras } from "../pure/streaming.js";
import type { OutputLog } from "../core/output.js";
import type { DiagnosticsManager } from "../features/diagnostics.js";
import type { StatusBar } from "../features/statusBar.js";
import type { SecretStore } from "../secrets/secretStore.js";
import type { PanelStateStore } from "../state/panelStateStore.js";

export interface CommandDeps {
  secretStore: SecretStore;
  diagnostics: DiagnosticsManager;
  statusBar: StatusBar;
  output: OutputLog;
  panel: PanelStateStore;
}

/** Picks the workspace folder for a resource, the active editor, or prompts. */
export async function resolveFolder(
  resource?: vscode.Uri,
): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    void vscode.window.showErrorMessage("MP Sentinel: open a folder or workspace first.");
    return undefined;
  }
  if (resource) {
    const match = vscode.workspace.getWorkspaceFolder(resource);
    if (match) return match;
  }
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active) {
    const match = vscode.workspace.getWorkspaceFolder(active);
    if (match) return match;
  }
  if (folders.length === 1) return folders[0];

  const picked = await vscode.window.showWorkspaceFolderPick();
  return picked;
}

/**
 * Path relative to a *specific* workspace folder, for CLI --files arguments.
 * Returns `undefined` when the file lies outside the folder (e.g. a multi-root
 * mismatch) so callers can refuse rather than send a bad path to the CLI.
 */
export function relativePath(folder: vscode.WorkspaceFolder, uri: vscode.Uri): string | undefined {
  return workspaceRelativePath(folder.uri.fsPath, uri.fsPath) ?? undefined;
}

/**
 * True for an on-disk file URI we can review. Excludes untitled buffers and
 * virtual documents (git diffs, output channels, settings, etc.), which have no
 * path the CLI can resolve.
 */
export function isReviewableFile(document: vscode.TextDocument): boolean {
  return !document.isUntitled && document.uri.scheme === "file";
}

/**
 * Runs an operation inside a cancellable progress notification and maps a typed
 * CLI failure to the right UX: silent on cancellation, a hint on spawn/timeout,
 * and the (redacted) output channel on runtime/parse errors.
 */
export interface WithProgressOptions {
  /** When true, the run already streamed stderr live — don't re-append it on error. */
  streamed?: boolean;
}

export async function withProgress<T>(
  title: string,
  deps: CommandDeps,
  task: (token: vscode.CancellationToken) => Promise<T>,
  opts: WithProgressOptions = {},
): Promise<T | undefined> {
  try {
    return await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title, cancellable: true },
      (_progress, token) => task(token),
    );
  } catch (error) {
    handleCommandError(error, deps, opts);
    return undefined;
  }
}

/**
 * Pushes a review/dry-run report into the side-panel store: summary counters and
 * the flattened findings (respecting the INFO-severity setting), scoped to the
 * folder so click-through can resolve absolute paths.
 */
export function publishReviewToPanel(
  deps: CommandDeps,
  folder: vscode.WorkspaceFolder,
  report: ReviewReport,
  kind: "review" | "dry-run",
  includeInfo: boolean,
): void {
  const normalized = normalizeFindings(report);
  const surfaced = includeInfo ? normalized : normalized.filter((f) => f.severity !== "INFO");
  const s = report.summary;
  const result: PanelResult = {
    kind,
    status: report.status,
    critical: s.criticalIssues,
    warning: s.warningIssues,
    info: s.infoIssues,
    auditedFiles: s.auditedFiles,
    totalFiles: s.totalFiles,
  };
  deps.panel.publishResult(result, toPanelFindings(surfaced), folder.uri.fsPath);
}

/**
 * Per-run extras that stream CLI progress (stderr) live into the Output tab.
 * Thin adapter over the pure {@link makeStreamingExtras}.
 */
export function streamingRunExtras(deps: CommandDeps): StreamingExtras {
  return makeStreamingExtras((chunk) => deps.output.appendRedactedRaw(chunk));
}

/** Centralized, secret-safe error presentation for command handlers. */
export function handleCommandError(
  error: unknown,
  deps: CommandDeps,
  opts: WithProgressOptions = {},
): void {
  if (error instanceof CliExecError) {
    if (error.kind === "aborted") return; // user cancelled — stay quiet
    // Skip re-appending stderr that was already streamed live this run.
    if (error.stderr && !opts.streamed) {
      deps.output.appendRedacted(error.stderr);
      deps.output.show();
    }
    void vscode.window.showErrorMessage(`MP Sentinel: ${userMessageForFailure(error.kind)}`);
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  void vscode.window.showErrorMessage(`MP Sentinel: ${message}`);
}
