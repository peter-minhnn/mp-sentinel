import * as vscode from "vscode";

import { registerCommands } from "./commands/index.js";
import { OutputLog } from "./core/output.js";
import { buildContext, buildService } from "./core/serviceFactory.js";
import { DiagnosticsManager } from "./features/diagnostics.js";
import { StatusBar } from "./features/statusBar.js";
import { SecretStore } from "./secrets/secretStore.js";
import type { CommandDeps } from "./commands/shared.js";

export function activate(context: vscode.ExtensionContext): void {
  const output = new OutputLog();
  const secretStore = new SecretStore(context.secrets);
  const diagnostics = new DiagnosticsManager();
  const statusBar = new StatusBar();

  context.subscriptions.push(output, diagnostics, statusBar);

  const deps: CommandDeps = { secretStore, diagnostics, statusBar, output };
  registerCommands(context, deps);

  // Best-effort initial index-health probe so the status bar reflects state on
  // open. Failures are silent — the CLI may not be installed yet.
  void refreshIndexHealthBadge(deps);

  output.info("MP Sentinel extension activated.");
}

export function deactivate(): void {
  // Disposables are cleaned up via context.subscriptions.
}

async function refreshIndexHealthBadge(deps: CommandDeps): Promise<void> {
  const folder = (vscode.workspace.workspaceFolders ?? [])[0];
  if (!folder) return;
  try {
    const service = buildService(folder);
    const ctx = await buildContext(folder, deps.secretStore);
    const health = await service.indexHealth(ctx);
    deps.statusBar.showIndexHealth(health);
  } catch {
    // Silent: CLI not installed / not a project yet.
  }
}
