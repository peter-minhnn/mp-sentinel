import * as vscode from "vscode";
import { summarizeReport, type IndexHealthOutput, type ReviewReport } from "mp-sentinel-extension-core";

/** A single status-bar item reflecting the latest review / index state. */
export class StatusBar {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = "mpSentinel.reviewStaged";
    this.reset();
    this.item.show();
  }

  reset(): void {
    this.item.text = "$(shield) MP Sentinel";
    this.item.tooltip = "Run an MP Sentinel review";
    this.item.backgroundColor = undefined;
  }

  busy(label: string): void {
    this.item.text = `$(sync~spin) ${label}`;
    this.item.backgroundColor = undefined;
  }

  showReview(report: ReviewReport): void {
    const icon = report.status === "PASS" ? "$(pass)" : report.status === "FAIL" ? "$(error)" : "$(warning)";
    this.item.text = `${icon} MP Sentinel`;
    this.item.tooltip = summarizeReport(report);
    this.item.backgroundColor =
      report.status === "FAIL"
        ? new vscode.ThemeColor("statusBarItem.errorBackground")
        : undefined;
  }

  showIndexHealth(health: IndexHealthOutput): void {
    if (health.status === "ok") return; // don't nag when healthy
    const reasons = health.staleReasons?.join(", ") ?? health.status;
    this.item.tooltip = `Source index: ${health.status} (${reasons}). Click to rebuild.`;
  }

  dispose(): void {
    this.item.dispose();
  }
}
