import * as vscode from "vscode";
import { summarizeReport, type IndexHealthOutput, type ReviewReport } from "mp-sentinel-extension-core";

import { COMMAND_IDS } from "../pure/commandIds.js";
import {
  formatIndexHealth,
  formatReviewStatus,
  IDLE_STATUS,
  type StatusDisplay,
} from "../pure/statusFormat.js";

/** A single status-bar item reflecting the latest review / index state. */
export class StatusBar {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = COMMAND_IDS.reviewStaged;
    this.reset();
    this.item.show();
  }

  reset(): void {
    this.apply(IDLE_STATUS);
  }

  busy(label: string): void {
    // While a run is in flight the item becomes a one-click "stop": clicking it
    // cancels the active review (also reachable via the command palette and the
    // progress notification's cancel button).
    this.item.command = COMMAND_IDS.stopReview;
    this.item.text = `$(sync~spin) ${label} $(stop-circle)`;
    this.item.tooltip = `${label} — click to stop`;
    this.item.backgroundColor = undefined;
  }

  showReview(report: ReviewReport): void {
    this.apply(formatReviewStatus(report.status, summarizeReport(report)));
  }

  showIndexHealth(health: IndexHealthOutput): void {
    const display = formatIndexHealth(health);
    if (display.healthy) {
      // Healthy → clear any lingering stale tooltip/background.
      this.reset();
      return;
    }
    this.item.tooltip = display.tooltip;
    this.item.backgroundColor =
      display.background === "warning"
        ? new vscode.ThemeColor("statusBarItem.warningBackground")
        : undefined;
  }

  private apply(display: StatusDisplay): void {
    // Any non-busy state makes the item trigger a staged review again.
    this.item.command = COMMAND_IDS.reviewStaged;
    this.item.text = display.text;
    this.item.tooltip = display.tooltip;
    this.item.backgroundColor =
      display.background === "error"
        ? new vscode.ThemeColor("statusBarItem.errorBackground")
        : undefined;
  }

  dispose(): void {
    this.item.dispose();
  }
}
