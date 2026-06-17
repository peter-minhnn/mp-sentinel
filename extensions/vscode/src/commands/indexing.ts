import * as vscode from "vscode";

import { COMMAND_IDS } from "../pure/commandIds.js";
import { formatIndexHealth } from "../pure/statusFormat.js";
import { buildContext, buildService } from "../core/serviceFactory.js";
import { resolveFolder, withProgress, type CommandDeps } from "./shared.js";

/** Routes a notification action button to its command / behaviour. */
function runHealthAction(choice: string | undefined, deps: CommandDeps): void {
  if (choice === "Rebuild Index") {
    void vscode.commands.executeCommand(COMMAND_IDS.rebuildIndex);
  } else if (choice === "Show Output") {
    deps.output.show();
  }
}

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
  deps.panel.publishIndexHealth(health.status);
  const display = formatIndexHealth(health);
  deps.output.info("");
  for (const line of display.lines) deps.output.info(line);

  if (display.healthy && display.actions.length === 0) {
    void vscode.window.showInformationMessage("MP Sentinel: source index is healthy.");
    return;
  }
  if (display.healthy) {
    void vscode.window
      .showInformationMessage(
        "MP Sentinel: source index is healthy, with recoverable parser debt.",
        ...display.actions,
      )
      .then((choice) => runHealthAction(choice, deps));
    return;
  }
  void vscode.window
    .showWarningMessage(`MP Sentinel: source index is ${health.status}.`, ...display.actions)
    .then((choice) => runHealthAction(choice, deps));
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
