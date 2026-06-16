import * as vscode from "vscode";
import { summarizeReport, type ReviewScope } from "mp-sentinel-extension-core";

import { buildContext, buildService } from "../core/serviceFactory.js";
import { readSettings } from "../config/settings.js";
import { relativePath, resolveFolder, withProgress, type CommandDeps } from "./shared.js";

async function runReviewScope(
  deps: CommandDeps,
  folder: vscode.WorkspaceFolder,
  scope: ReviewScope,
  title: string,
): Promise<void> {
  const settings = readSettings(folder.uri);
  const service = buildService(folder);

  deps.statusBar.busy("Reviewing");
  const report = await withProgress(title, deps, async (token) => {
    const ctx = await buildContext(folder, deps.secretStore, token);
    const reviewOpts =
      settings.review.targetBranch !== undefined
        ? { scope, targetBranch: settings.review.targetBranch }
        : { scope };
    return service.review(reviewOpts, ctx);
  });

  if (!report) {
    deps.statusBar.reset();
    return;
  }

  const count = deps.diagnostics.applyReport(report, folder, {
    includeInfo: settings.review.includeInfoSeverity,
  });
  deps.statusBar.showReview(report);
  deps.output.info(summarizeReport(report));
  if (report.errors.length > 0) deps.output.appendRedacted(report.errors.join("\n"));

  const summary = summarizeReport(report);
  if (count > 0) {
    void vscode.window.showInformationMessage(`MP Sentinel: ${summary}`, "Show Problems").then((choice) => {
      if (choice) void vscode.commands.executeCommand("workbench.actions.view.problems");
    });
  } else {
    void vscode.window.showInformationMessage(`MP Sentinel: ${summary}`);
  }
}

export async function reviewStaged(deps: CommandDeps): Promise<void> {
  const folder = await resolveFolder();
  if (!folder) return;
  await runReviewScope(deps, folder, { kind: "staged" }, "MP Sentinel: reviewing staged changes");
}

export async function reviewCurrentFile(deps: CommandDeps): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showErrorMessage("MP Sentinel: no active file to review.");
    return;
  }
  const folder = await resolveFolder(editor.document.uri);
  if (!folder) return;
  const file = relativePath(folder, editor.document.uri);
  await runReviewScope(deps, folder, { kind: "files", files: [file] }, "MP Sentinel: reviewing current file");
}

export async function reviewSelectedFiles(
  deps: CommandDeps,
  resource?: vscode.Uri,
  selected?: vscode.Uri[],
): Promise<void> {
  const uris = selected && selected.length > 0 ? selected : resource ? [resource] : [];
  if (uris.length === 0) {
    void vscode.window.showErrorMessage("MP Sentinel: no files selected.");
    return;
  }
  const firstUri = uris[0];
  if (!firstUri) return;
  const folder = await resolveFolder(firstUri);
  if (!folder) return;
  const files = uris.map((u) => relativePath(folder, u));
  await runReviewScope(deps, folder, { kind: "files", files }, "MP Sentinel: reviewing selected files");
}

export async function reviewRange(deps: CommandDeps): Promise<void> {
  const folder = await resolveFolder();
  if (!folder) return;
  const range = await vscode.window.showInputBox({
    title: "MP Sentinel: review git range",
    prompt: "Enter a git range, e.g. origin/main..HEAD",
    value: "origin/main..HEAD",
  });
  if (!range) return;
  await runReviewScope(deps, folder, { kind: "range", range }, `MP Sentinel: reviewing ${range}`);
}

export async function explainContext(deps: CommandDeps): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showErrorMessage("MP Sentinel: open a file to explain its review context.");
    return;
  }
  const folder = await resolveFolder(editor.document.uri);
  if (!folder) return;
  const file = relativePath(folder, editor.document.uri);
  const service = buildService(folder);

  const result = await withProgress("MP Sentinel: explaining context", deps, async (token) => {
    const ctx = await buildContext(folder, deps.secretStore, token);
    return service.explainContext([file], ctx);
  });
  if (!result) return;

  deps.output.info(`\nContext for ${file}`);
  deps.output.info(`  status: ${result.status}`);
  if (result.profile) deps.output.info(`  profile: ${result.profile}`);
  if (typeof result.budgetChars === "number") deps.output.info(`  budgetChars: ${result.budgetChars}`);
  if (typeof result.relatedFileCount === "number") deps.output.info(`  relatedFiles: ${result.relatedFileCount}`);
  if (result.includedFiles?.length) deps.output.info(`  included: ${result.includedFiles.join(", ")}`);
  if (result.reason) deps.output.info(`  reason: ${result.reason}`);
  deps.output.show();
}
