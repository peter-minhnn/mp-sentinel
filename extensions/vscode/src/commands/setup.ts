import * as vscode from "vscode";
import {
  buildEnv,
  buildInitArgs,
  CliRunner,
  SECRET_ENV_KEYS,
  type SecretEnvKey,
} from "mp-sentinel-extension-core";

import { buildContext, buildService } from "../core/serviceFactory.js";
import { readSettings } from "../config/settings.js";
import {
  AI_PROVIDER_IDS,
  formatAiStatus,
  isAiProviderId,
  PROVIDER_SECRET_KEYS,
  type AiProviderId,
} from "../pure/aiStatus.js";
import { resolveFolder, withProgress, type CommandDeps } from "./shared.js";

/** Suggested exact models per provider (a custom id can always be entered). */
const MODEL_SUGGESTIONS: Record<AiProviderId, string[]> = {
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash"],
  openai: ["gpt-5.2", "o4-mini"],
  anthropic: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  grok: ["grok-4", "grok-4-fast"],
  openrouter: ["anthropic/claude-sonnet-4-6", "openai/gpt-5.2"],
};

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

const USE_TIER = "Use a model tier instead";
const CUSTOM_MODEL = "Custom model…";

/**
 * Configure AI Provider wizard: provider → exact model or tier (mutually
 * exclusive) → optional provider endpoint/attribution → optional credential.
 * All non-secret choices go to VS Code settings; the credential goes to Secret
 * Storage only. Never reads or writes `.env`.
 */
export async function selectProvider(deps: CommandDeps): Promise<void> {
  const folder = (vscode.workspace.workspaceFolders ?? [])[0];
  const picked = await vscode.window.showQuickPick([...AI_PROVIDER_IDS], {
    title: "Configure AI: select provider",
  });
  if (!picked || !isAiProviderId(picked)) return;
  const provider: AiProviderId = picked;

  const target = folder ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  const cfg = vscode.workspace.getConfiguration("mpSentinel", folder?.uri ?? null);
  await cfg.update("ai.provider", provider, target);

  await configureModelOrTier(cfg, target, provider);
  await configureProviderEndpoint(cfg, target, provider);
  await maybeStoreCredential(deps, provider);

  await publishAiStatus(deps, folder?.uri);
  void vscode.window.showInformationMessage(`MP Sentinel: AI provider configured (${provider}).`);
}

/** Prompts for an exact model or a tier and clears the other (they're exclusive). */
async function configureModelOrTier(
  cfg: vscode.WorkspaceConfiguration,
  target: vscode.ConfigurationTarget,
  provider: AiProviderId,
): Promise<void> {
  const choice = await vscode.window.showQuickPick(
    [...MODEL_SUGGESTIONS[provider], CUSTOM_MODEL, USE_TIER],
    { title: `Configure AI: model for ${provider}` },
  );
  if (choice === undefined) return;

  if (choice === USE_TIER) {
    const tier = await vscode.window.showQuickPick(["premium", "balanced", "budget"], {
      title: "Configure AI: model tier",
    });
    if (!tier) return;
    await cfg.update("ai.modelTier", tier, target);
    await cfg.update("ai.model", "", target); // exact model and tier are exclusive
    return;
  }

  let model = choice;
  if (choice === CUSTOM_MODEL) {
    const custom = await vscode.window.showInputBox({
      title: "Configure AI: exact model id",
      prompt: "e.g. claude-sonnet-4-6",
      ignoreFocusOut: true,
    });
    if (!custom) return;
    model = custom.trim();
  }
  await cfg.update("ai.model", model, target);
  await cfg.update("ai.modelTier", "", target); // clear tier so the exact model wins
}

/** Prompts for the provider's optional non-secret endpoint/attribution settings. */
async function configureProviderEndpoint(
  cfg: vscode.WorkspaceConfiguration,
  target: vscode.ConfigurationTarget,
  provider: AiProviderId,
): Promise<void> {
  if (provider === "anthropic") {
    const baseUrl = await vscode.window.showInputBox({
      title: "Configure AI: Anthropic base URL (optional)",
      prompt:
        "Custom Anthropic-compatible endpoint (e.g. https://api.deepseek.com/anthropic). Leave blank for the official API.",
      value: cfg.get<string>("ai.anthropicBaseUrl") ?? "",
      ignoreFocusOut: true,
    });
    if (baseUrl !== undefined) await cfg.update("ai.anthropicBaseUrl", baseUrl.trim(), target);
    return;
  }
  if (provider === "openrouter") {
    const site = await vscode.window.showInputBox({
      title: "Configure AI: OpenRouter site URL (optional)",
      value: cfg.get<string>("ai.openrouterSiteUrl") ?? "",
      ignoreFocusOut: true,
    });
    if (site !== undefined) await cfg.update("ai.openrouterSiteUrl", site.trim(), target);
    const app = await vscode.window.showInputBox({
      title: "Configure AI: OpenRouter app name (optional)",
      value: cfg.get<string>("ai.openrouterAppName") ?? "",
      ignoreFocusOut: true,
    });
    if (app !== undefined) await cfg.update("ai.openrouterAppName", app.trim(), target);
  }
}

/** Offers to store the provider's primary credential in Secret Storage. */
async function maybeStoreCredential(deps: CommandDeps, provider: AiProviderId): Promise<void> {
  const primaryKey = PROVIDER_SECRET_KEYS[provider][0] as SecretEnvKey;
  const want = await vscode.window.showQuickPick(["Store / update API key now", "Skip"], {
    title: `Configure AI: credential for ${provider} (${primaryKey})`,
  });
  if (want !== "Store / update API key now") return;
  const value = await vscode.window.showInputBox({
    title: `MP Sentinel: value for ${primaryKey}`,
    prompt: "Stored securely in VS Code Secret Storage — never written to settings or config.",
    password: true,
    ignoreFocusOut: true,
  });
  if (value === undefined || value.length === 0) return;
  await deps.secretStore.set(primaryKey, value);
}

/**
 * Runs the CLI AI connectivity probe and reports the result. Surfaces a 403,
 * invalid base URL, or unknown model before a large review. Secret-safe: the
 * CLI emits no credentials and stderr is redacted by the service layer.
 */
export async function checkAiConnection(deps: CommandDeps): Promise<void> {
  const folder = await resolveFolder();
  if (!folder) return;
  const service = buildService(folder);

  const result = await withProgress("MP Sentinel: checking AI connection", deps, async (token) => {
    const ctx = await buildContext(folder, deps.secretStore, token);
    return service.checkAi(ctx);
  });
  if (!result) return;

  await publishAiStatus(deps, folder.uri);

  if (result.status === "ok") {
    void vscode.window.showInformationMessage(
      `MP Sentinel: AI reachable (${result.provider ?? "?"} / ${result.model ?? "?"}).`,
    );
    return;
  }
  if (result.error) {
    deps.output.appendRedacted(result.error);
    deps.output.show();
  }
  const where = result.provider ? ` (${result.provider})` : "";
  void vscode.window.showErrorMessage(
    `MP Sentinel: AI connection check failed${where}. See the MP Sentinel output for details.`,
  );
}

/**
 * Computes the compact, secret-free AI status for the given scope and publishes
 * it to the panel. Best-effort: callers may ignore failures.
 */
export async function publishAiStatus(deps: CommandDeps, scope?: vscode.Uri): Promise<void> {
  const { ai } = readSettings(scope);
  let keyConfigured = false;
  if (ai.provider && isAiProviderId(ai.provider)) {
    const configured = (await deps.secretStore.listConfigured()) as readonly string[];
    keyConfigured = PROVIDER_SECRET_KEYS[ai.provider].some((k) => configured.includes(k));
  }
  deps.panel.publishAiStatus(formatAiStatus({ ai, keyConfigured }));
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
