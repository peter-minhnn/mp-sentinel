import * as vscode from "vscode";
import {
  buildEnv,
  buildInitArgs,
  CliRunner,
  SECRET_ENV_KEYS,
  type SecretEnvKey,
} from "mp-sentinel-extension-core";

import { readSettings } from "../config/settings.js";
import { resolveFolder, withProgress, type CommandDeps } from "./shared.js";

export async function setupCredentials(deps: CommandDeps): Promise<void> {
  const key = (await vscode.window.showQuickPick([...SECRET_ENV_KEYS], {
    title: "MP Sentinel: which credential do you want to store?",
    placeHolder: "Select the environment variable to set",
  })) as SecretEnvKey | undefined;
  if (!key) return;

  const value = await vscode.window.showInputBox({
    title: `MP Sentinel: value for ${key}`,
    prompt: "Stored securely in VS Code Secret Storage — never written to settings or config.",
    password: true,
    ignoreFocusOut: true,
  });
  if (value === undefined || value.length === 0) return;

  await deps.secretStore.set(key, value);
  void vscode.window.showInformationMessage(`MP Sentinel: stored ${key} securely.`);
}

export async function clearCredential(deps: CommandDeps): Promise<void> {
  const configured = await deps.secretStore.listConfigured();
  if (configured.length === 0) {
    void vscode.window.showInformationMessage("MP Sentinel: no stored credentials.");
    return;
  }
  const key = (await vscode.window.showQuickPick(configured, {
    title: "MP Sentinel: clear which credential?",
  })) as SecretEnvKey | undefined;
  if (!key) return;
  await deps.secretStore.clear(key);
  void vscode.window.showInformationMessage(`MP Sentinel: cleared ${key}.`);
}

export async function selectProvider(): Promise<void> {
  const folder = (vscode.workspace.workspaceFolders ?? [])[0];
  const provider = await vscode.window.showQuickPick(
    ["gemini", "openai", "anthropic", "grok", "openrouter"],
    { title: "MP Sentinel: select AI provider" },
  );
  if (!provider) return;

  const tier = await vscode.window.showQuickPick(["premium", "balanced", "budget"], {
    title: "MP Sentinel: select model tier",
  });

  const target = folder
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  const cfg = vscode.workspace.getConfiguration("mpSentinel", folder?.uri ?? null);
  await cfg.update("ai.provider", provider, target);
  if (tier) await cfg.update("ai.modelTier", tier, target);

  void vscode.window.showInformationMessage(
    `MP Sentinel: provider set to ${provider}${tier ? ` (${tier})` : ""}.`,
  );
}

export async function initConfig(deps: CommandDeps): Promise<void> {
  const folder = await resolveFolder();
  if (!folder) return;

  const configUri = vscode.Uri.joinPath(folder.uri, ".mp-sentinelrc.json");
  try {
    await vscode.workspace.fs.stat(configUri);
    const overwrite = await vscode.window.showWarningMessage(
      "MP Sentinel: .mp-sentinelrc.json already exists. Overwrite?",
      "Overwrite",
      "Cancel",
    );
    if (overwrite !== "Overwrite") return;
  } catch {
    // File does not exist — proceed.
  }

  const settings = readSettings(folder.uri);
  const runner = new CliRunner({ command: settings.cli.command, baseArgs: settings.cli.baseArgs });

  const result = await withProgress("MP Sentinel: creating config", deps, async (token) => {
    const controller = new AbortController();
    token.onCancellationRequested(() => controller.abort());
    return runner.run({
      args: buildInitArgs({ force: true }),
      cwd: folder.uri.fsPath,
      env: buildEnv({ baseEnv: process.env }),
      timeoutMs: settings.cli.timeoutMs,
      signal: controller.signal,
    });
  });
  if (!result) return;

  if (result.exitCode === 2) {
    deps.output.appendRedacted(result.stderr);
    deps.output.show();
    void vscode.window.showErrorMessage("MP Sentinel: failed to create config. See output.");
    return;
  }
  const doc = await vscode.workspace.openTextDocument(configUri);
  await vscode.window.showTextDocument(doc);
}
