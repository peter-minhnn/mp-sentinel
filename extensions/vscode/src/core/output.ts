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

  appendRedacted(text: string, secrets?: SecretBundle): void {
    if (!text) return;
    this.channel.appendLine(redactSecrets(text, secrets));
  }

  show(): void {
    this.channel.show(true);
  }

  dispose(): void {
    this.channel.dispose();
  }
}
