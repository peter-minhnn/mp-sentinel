import * as vscode from "vscode";

import { COMMAND_IDS } from "../pure/commandIds.js";
import { buildContext, buildService } from "../core/serviceFactory.js";
import { readSettings } from "../config/settings.js";
import { resolveFolder, withProgress, type CommandDeps } from "./shared.js";

export async function skillsCheck(deps: CommandDeps): Promise<void> {
  const folder = await resolveFolder();
  if (!folder) return;
  const agents = readSettings(folder.uri).skillsAgents;
  const service = buildService(folder);

  const result = await withProgress("MP Sentinel: checking agent skills", deps, async (token) => {
    const ctx = await buildContext(folder, deps.secretStore, token);
    return service.createSkillsCheck(agents.length > 0 ? agents : "all", ctx);
  });
  if (!result) return;

  deps.panel.publishSkills(result.status);
  const stale = result.check.filter((r) => r.status !== "up-to-date");
  for (const row of result.check) deps.output.info(`  ${row.status}: ${row.outputPath}`);

  if (result.status === "ok") {
    void vscode.window.showInformationMessage("MP Sentinel: agent skills are up to date.");
  } else {
    void vscode.window
      .showWarningMessage(`MP Sentinel: ${stale.length} skill file(s) stale or missing.`, "Generate Now")
      .then((choice) => {
        if (choice) void vscode.commands.executeCommand(COMMAND_IDS.generateSkills);
      });
  }
}

export async function generateSkills(deps: CommandDeps): Promise<void> {
  const folder = await resolveFolder();
  if (!folder) return;
  const agents = readSettings(folder.uri).skillsAgents;
  const service = buildService(folder);

  const result = await withProgress("MP Sentinel: generating agent skills", deps, async (token) => {
    const ctx = await buildContext(folder, deps.secretStore, token);
    return service.createSkills(
      { operation: { kind: "generate", force: true }, agents: agents.length > 0 ? agents : "all" },
      ctx,
    );
  });
  if (!result) return;

  if (result.exitCode === 0) {
    void vscode.window.showInformationMessage("MP Sentinel: agent skills generated.");
  } else {
    deps.output.appendRedacted(result.stderr);
    deps.output.show();
    void vscode.window.showWarningMessage("MP Sentinel: skill generation finished with warnings.");
  }
}
