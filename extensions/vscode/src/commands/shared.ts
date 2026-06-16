import * as vscode from "vscode";
import { CliRuntimeError } from "mp-sentinel-extension-core";

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

/** Path relative to a workspace folder, for CLI --files arguments. */
export function relativePath(folder: vscode.WorkspaceFolder, uri: vscode.Uri): string {
  return vscode.workspace.asRelativePath(uri, false).replace(/\\/g, "/");
}

/**
 * Runs an operation inside a cancellable progress notification and converts a
 * CLI runtime error (exit 2) into a user-facing message with redacted detail.
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
    if (error instanceof CliRuntimeError) {
      deps.output.appendRedacted(error.stderr);
      deps.output.show();
      void vscode.window.showErrorMessage(
        "MP Sentinel: the CLI reported a runtime error. See the MP Sentinel output for details.",
      );
    } else {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`MP Sentinel: ${message}`);
    }
    return undefined;
  }
}
