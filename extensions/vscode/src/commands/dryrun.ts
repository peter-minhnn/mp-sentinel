import * as vscode from "vscode";
import {
  buildDryRunArgs,
  buildEnv,
  CliRunner,
  parseReviewReport,
  summarizeReport,
} from "mp-sentinel-extension-core";

import { readSettings } from "../config/settings.js";
import {
  publishReviewToPanel,
  resolveFolder,
  streamingRunExtras,
  withProgress,
  type CommandDeps,
} from "./shared.js";

/**
 * Security-only dry run (no AI, no token spend). Surfaces deterministic
 * findings as diagnostics so the user can preview before a full review.
 */
export async function dryRunPreview(deps: CommandDeps): Promise<void> {
  const folder = await resolveFolder();
  if (!folder) return;
  const settings = readSettings(folder.uri);
  const runner = new CliRunner({ command: settings.cli.command, baseArgs: settings.cli.baseArgs });

  const title = "MP Sentinel: dry-run preview";
  deps.output.startRun(title);
  deps.panel.setBusy("Dry-run preview");
  const extras = streamingRunExtras(deps);
  const report = await withProgress(
    title,
    deps,
    async (token) => {
      const controller = new AbortController();
      token.onCancellationRequested(() => controller.abort());
      const result = await runner.run({
        args: buildDryRunArgs({ kind: "staged" }),
        cwd: folder.uri.fsPath,
        env: buildEnv({ baseEnv: process.env, extraEnv: extras.extraEnv }),
        timeoutMs: settings.cli.timeoutMs,
        signal: controller.signal,
        onOutput: extras.onOutput,
      });
      if (result.exitCode === 2) {
        // stderr already streamed live; just signal failure.
        throw new Error("dry-run failed (exit 2)");
      }
      return parseReviewReport(result.stdout);
    },
    { streamed: true },
  );
  if (!report) {
    deps.panel.setIdle("Dry-run cancelled or failed — see output.");
    return;
  }

  deps.diagnostics.applyReport(report, folder, {
    includeInfo: settings.review.includeInfoSeverity,
  });
  publishReviewToPanel(deps, folder, report, "dry-run", settings.review.includeInfoSeverity);
  deps.output.info(`Dry-run: ${summarizeReport(report)}`);
  void vscode.window.showInformationMessage(`MP Sentinel dry-run: ${summarizeReport(report)}`);
}
