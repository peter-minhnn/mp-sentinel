import * as vscode from "vscode";
import { MpSentinelService, type ServiceContext } from "mp-sentinel-extension-core";

import { readSettings } from "../config/settings.js";
import type { SecretStore } from "../secrets/secretStore.js";

/** Builds a service bound to the CLI configuration for a workspace folder. */
export function buildService(folder: vscode.WorkspaceFolder): MpSentinelService {
  const settings = readSettings(folder.uri);
  return new MpSentinelService({
    command: settings.cli.command,
    baseArgs: settings.cli.baseArgs,
  });
}

/**
 * Builds the per-run context: cwd, AI selection, secrets, timeout, and a
 * cancellation signal bridged from a VS Code CancellationToken.
 */
export async function buildContext(
  folder: vscode.WorkspaceFolder,
  secretStore: SecretStore,
  token?: vscode.CancellationToken,
): Promise<ServiceContext> {
  const settings = readSettings(folder.uri);
  const secrets = await secretStore.getBundle();

  const ctx: ServiceContext = {
    cwd: folder.uri.fsPath,
    ai: settings.ai,
    secrets,
    timeoutMs: settings.cli.timeoutMs,
  };

  if (token) {
    const controller = new AbortController();
    token.onCancellationRequested(() => controller.abort());
    ctx.signal = controller.signal;
  }

  return ctx;
}
