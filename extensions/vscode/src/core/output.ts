import * as vscode from "vscode";
import { redactSecrets, type SecretBundle } from "mp-sentinel-extension-core";

/**
 * A single output channel for the extension. All CLI stderr and diagnostics
 * pass through {@link OutputLog.appendRedacted} so a credential can never reach
 * the panel even if the CLI were to echo one.
 */
export class OutputLog {
  private readonly channel: vscode.OutputChannel;

  constructor() {
    this.channel = vscode.window.createOutputChannel("MP Sentinel");
  }

  info(message: string): void {
    this.channel.appendLine(message);
  }

  /** Begin a fresh run: clear, reveal the tab, and write a header line. */
  startRun(title: string): void {
    this.channel.clear();
    this.channel.show(true);
    this.channel.appendLine(title);
  }

  appendRedacted(text: string, secrets?: SecretBundle): void {
    if (!text) return;
    this.channel.appendLine(redactSecrets(text, secrets));
  }

  /**
   * Append a live output chunk (already redacted by the runner; redacted again
   * defensively). Preserves the CLI's own newlines and normalizes stray CR so
   * progress lines stay readable in the Output tab.
   */
  appendRedactedRaw(text: string, secrets?: SecretBundle): void {
    if (!text) return;
    this.channel.append(redactSecrets(text, secrets).replace(/\r(?!\n)/g, "\n"));
  }

  show(): void {
    this.channel.show(true);
  }

  dispose(): void {
    this.channel.dispose();
  }
}
