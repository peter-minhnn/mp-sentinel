import * as vscode from "vscode";
import { CliExecError, userMessageForFailure } from "mp-sentinel-extension-core";

import { workspaceRelativePath } from "../pure/paths.js";
import type { OutputLog } from "../core/output.js";
import type { DiagnosticsManager } from "../features/diagnostics.js";
import type { StatusBar } from "../features/statusBar.js";
import type { SecretStore } from "../secrets/secretStore.js";

export interface CommandDeps {
  secretStore: SecretStore;
  diagnostics: DiagnosticsManager;
  statusBar: StatusBar;
  output: OutputLog;
}

/** Picks the workspace folder for a resource, the active editor, or prompts. */
export async function resolveFolder(resource?: vscode.Uri): Promise<vscode.WorkspaceFolder | undefined> {
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
export async function withProgress<T>(
  title: string,
  deps: CommandDeps,
  task: (token: vscode.CancellationToken) => Promise<T>,
): Promise<T | undefined> {
  try {
    return await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title, cancellable: true },
      (_progress, token) => task(token),
    );
  } catch (error) {
    handleCommandError(error, deps);
    return undefined;
  }
}

/** Centralized, secret-safe error presentation for command handlers. */
export function handleCommandError(error: unknown, deps: CommandDeps): void {
  if (error instanceof CliExecError) {
    if (error.kind === "aborted") return; // user cancelled — stay quiet
    if (error.stderr) {
      deps.output.appendRedacted(error.stderr);
      deps.output.show();
    }
    void vscode.window.showErrorMessage(`MP Sentinel: ${userMessageForFailure(error.kind)}`);
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  void vscode.window.showErrorMessage(`MP Sentinel: ${message}`);
}
