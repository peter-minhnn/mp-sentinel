import * as vscode from "vscode";

import type { CommandDeps } from "./shared.js";
import { dryRunPreview } from "./dryrun.js";
import { indexHealth, rebuildIndex } from "./indexing.js";
import {
  explainContext,
  reviewCurrentFile,
  reviewRange,
  reviewSelectedFiles,
  reviewStaged,
} from "./review.js";
import { clearCredential, initConfig, selectProvider, setupCredentials } from "./setup.js";
import { generateSkills, skillsCheck } from "./skills.js";

/** Registers every contributed command and returns the disposables. */
export function registerCommands(context: vscode.ExtensionContext, deps: CommandDeps): void {
  const register = (id: string, handler: (...args: unknown[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  };

  register("mpSentinel.setupCredentials", () => setupCredentials(deps));
  register("mpSentinel.clearCredential", () => clearCredential(deps));
  register("mpSentinel.selectProvider", () => selectProvider());
  register("mpSentinel.initConfig", () => initConfig(deps));

  register("mpSentinel.reviewStaged", () => reviewStaged(deps));
  register("mpSentinel.reviewCurrentFile", () => reviewCurrentFile(deps));
  register("mpSentinel.reviewSelectedFiles", (resource, selected) =>
    reviewSelectedFiles(deps, resource as vscode.Uri | undefined, selected as vscode.Uri[] | undefined),
  );
  register("mpSentinel.reviewRange", () => reviewRange(deps));
  register("mpSentinel.dryRunPreview", () => dryRunPreview(deps));
  register("mpSentinel.explainContext", () => explainContext(deps));

  register("mpSentinel.indexHealth", () => indexHealth(deps));
  register("mpSentinel.rebuildIndex", () => rebuildIndex(deps));

  register("mpSentinel.skillsCheck", () => skillsCheck(deps));
  register("mpSentinel.generateSkills", () => generateSkills(deps));

  register("mpSentinel.clearDiagnostics", () => deps.diagnostics.clear());
}
