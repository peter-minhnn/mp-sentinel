import * as vscode from "vscode";

import { COMMAND_IDS } from "../pure/commandIds.js";
import { cancelAllRuns } from "../core/activeRuns.js";
import type { CommandDeps } from "./shared.js";
import { dryRunPreview } from "./dryrun.js";
import { indexHealth, rebuildIndex } from "./indexing.js";
import {
  explainContext,
  reviewBranchDiff,
  reviewCurrentFile,
  reviewRange,
  reviewSelectedFiles,
  reviewStaged,
} from "./review.js";
import {
  checkAiConnection,
  clearCredential,
  initConfig,
  selectProvider,
  setupCredentials,
} from "./setup.js";
import { generateSkills, skillsCheck } from "./skills.js";

/** Registers every contributed command and returns the disposables. */
export function registerCommands(context: vscode.ExtensionContext, deps: CommandDeps): void {
  const register = (id: string, handler: (...args: unknown[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  };

  register(COMMAND_IDS.setupCredentials, () => setupCredentials(deps));
  register(COMMAND_IDS.clearCredential, () => clearCredential(deps));
  register(COMMAND_IDS.selectProvider, () => selectProvider(deps));
  register(COMMAND_IDS.checkAiConnection, () => checkAiConnection(deps));
  register(COMMAND_IDS.initConfig, () => initConfig(deps));

  register(COMMAND_IDS.reviewStaged, () => reviewStaged(deps));
  register(COMMAND_IDS.reviewCurrentFile, () => reviewCurrentFile(deps));
  register(COMMAND_IDS.reviewSelectedFiles, (resource, selected) =>
    reviewSelectedFiles(
      deps,
      resource as vscode.Uri | undefined,
      selected as vscode.Uri[] | undefined,
    ),
  );
  register(COMMAND_IDS.reviewRange, () => reviewRange(deps));
  register(COMMAND_IDS.reviewBranchDiff, () => reviewBranchDiff(deps));
  register(COMMAND_IDS.stopReview, () => {
    const cancelled = cancelAllRuns();
    if (cancelled > 0) {
      deps.statusBar.reset();
      deps.panel.setIdle("Review cancelled.");
      deps.output.info("Review cancelled by user.");
      void vscode.window.showInformationMessage("MP Sentinel: review cancelled.");
    } else {
      void vscode.window.showInformationMessage("MP Sentinel: no review is running.");
    }
  });
  register(COMMAND_IDS.dryRunPreview, () => dryRunPreview(deps));
  register(COMMAND_IDS.explainContext, () => explainContext(deps));

  register(COMMAND_IDS.indexHealth, () => indexHealth(deps));
  register(COMMAND_IDS.rebuildIndex, () => rebuildIndex(deps));

  register(COMMAND_IDS.skillsCheck, () => skillsCheck(deps));
  register(COMMAND_IDS.generateSkills, () => generateSkills(deps));

  register(COMMAND_IDS.clearDiagnostics, () => deps.diagnostics.clear());
}
