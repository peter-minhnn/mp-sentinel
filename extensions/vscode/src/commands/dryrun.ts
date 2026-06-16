import * as vscode from "vscode";
import {
  buildDryRunArgs,
  buildEnv,
  CliRunner,
  parseReviewReport,
  summarizeReport,
} from "mp-sentinel-extension-core";

import { readSettings } from "../config/settings.js";
import { resolveFolder, withProgress, type CommandDeps } from "./shared.js";

/**
 * Security-only dry run (no AI, no token spend). Surfaces deterministic
 * findings as diagnostics so the user can preview before a full review.
 */
export async function dryRunPreview(deps: CommandDeps): Promise<void> {
  const folder = await resolveFolder();
  if (!folder) return;
  const settings = readSettings(folder.uri);
  const runner = new CliRunner({ command: settings.cli.command, baseArgs: settings.cli.baseArgs });

  const report = await withProgress("MP Sentinel: dry-run preview", deps, async (token) => {
    const controller = new AbortController();
    token.onCancellationRequested(() => controller.abort());
    const result = await runner.run({
      args: buildDryRunArgs({ kind: "staged" }),
      cwd: folder.uri.fsPath,
      env: buildEnv({ baseEnv: process.env }),
      timeoutMs: settings.cli.timeoutMs,
      signal: controller.signal,
    });
    if (result.exitCode === 2) {
      deps.output.appendRedacted(result.stderr);
      deps.output.show();
      throw new Error("dry-run failed (exit 2)");
    }
    return parseReviewReport(result.stdout);
  });
  if (!report) return;

  deps.diagnostics.applyReport(report, folder, {
    includeInfo: settings.review.includeInfoSeverity,
  });
  deps.output.info(`Dry-run: ${summarizeReport(report)}`);
  void vscode.window.showInformationMessage(`MP Sentinel dry-run: ${summarizeReport(report)}`);
}
