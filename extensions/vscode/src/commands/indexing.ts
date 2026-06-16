import * as vscode from "vscode";

import { buildContext, buildService } from "../core/serviceFactory.js";
import { resolveFolder, withProgress, type CommandDeps } from "./shared.js";

export async function indexHealth(deps: CommandDeps): Promise<void> {
  const folder = await resolveFolder();
  if (!folder) return;
  const service = buildService(folder);

  const health = await withProgress("MP Sentinel: checking index health", deps, async (token) => {
    const ctx = await buildContext(folder, deps.secretStore, token);
    return service.indexHealth(ctx);
  });
  if (!health) return;

  deps.statusBar.showIndexHealth(health);
  deps.output.info(`\nSource index health: ${health.status}`);
  if (health.totalFiles !== undefined) deps.output.info(`  files: ${health.totalFiles}`);
  if (health.staleReasons?.length) deps.output.info(`  stale: ${health.staleReasons.join(", ")}`);
  if (health.parseErrorCount) deps.output.info(`  parse errors: ${health.parseErrorCount}`);
  if (health.suggestedCommands?.length) {
    deps.output.info(`  suggested: ${health.suggestedCommands.join(" | ")}`);
  }

  if (health.status === "ok") {
    void vscode.window.showInformationMessage("MP Sentinel: source index is healthy.");
  } else {
    void vscode.window
      .showWarningMessage(`MP Sentinel: source index is ${health.status}.`, "Rebuild Index")
      .then((choice) => {
        if (choice) void vscode.commands.executeCommand("mpSentinel.rebuildIndex");
      });
  }
}

export async function rebuildIndex(deps: CommandDeps): Promise<void> {
  const folder = await resolveFolder();
  if (!folder) return;
  const service = buildService(folder);

  const result = await withProgress("MP Sentinel: rebuilding source index", deps, async (token) => {
    const ctx = await buildContext(folder, deps.secretStore, token);
    return service.rebuildIndex(ctx, true);
  });
  if (!result) return;

  if (result.exitCode === 0) {
    void vscode.window.showInformationMessage("MP Sentinel: source index rebuilt.");
  } else {
    deps.output.appendRedacted(result.stderr);
    deps.output.show();
    void vscode.window.showWarningMessage("MP Sentinel: index rebuild finished with warnings.");
  }
}
