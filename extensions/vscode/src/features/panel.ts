import { randomBytes } from "node:crypto";
import * as path from "node:path";
import * as vscode from "vscode";

import { ALL_COMMAND_IDS } from "../pure/commandIds.js";
import { renderPanelHtml } from "../pure/panelView.js";
import type { PanelStateStore } from "../state/panelStateStore.js";
import type { DiagnosticsManager } from "./diagnostics.js";
import type { OutputLog } from "../core/output.js";

export interface PanelProviderDeps {
  store: PanelStateStore;
  output: OutputLog;
  diagnostics: DiagnosticsManager;
}

type InboundMessage =
  | { type: "command"; command: string }
  | { type: "open"; file: string; line: number }
  | { type: "output" }
  | { type: "clearDiagnostics" };

function parseMessage(raw: unknown): InboundMessage | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const msg = raw as Record<string, unknown>;
  switch (msg["type"]) {
    case "command":
      return typeof msg["command"] === "string"
        ? { type: "command", command: msg["command"] }
        : undefined;
    case "open":
      return typeof msg["file"] === "string" && typeof msg["line"] === "number"
        ? { type: "open", file: msg["file"], line: msg["line"] }
        : undefined;
    case "output":
      return { type: "output" };
    case "clearDiagnostics":
      return { type: "clearDiagnostics" };
    default:
      return undefined;
  }
}

/** Renders the MP Sentinel side panel and bridges its actions to commands. */
export class MpSentinelPanelProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private unsubscribe: (() => void) | undefined;

  constructor(private readonly deps: PanelProviderDeps) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [] };

    this.render();
    this.unsubscribe = this.deps.store.subscribe(() => this.render());

    webviewView.webview.onDidReceiveMessage((raw: unknown) => {
      const message = parseMessage(raw);
      if (message) void this.handleMessage(message);
    });

    webviewView.onDidDispose(() => {
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      this.view = undefined;
    });
  }

  private render(): void {
    if (!this.view) return;
    const nonce = randomBytes(16).toString("base64");
    this.view.webview.html = renderPanelHtml(this.deps.store.get(), {
      nonce,
      cspSource: this.view.webview.cspSource,
    });
  }

  private async handleMessage(message: InboundMessage): Promise<void> {
    switch (message.type) {
      case "command":
        // Only dispatch ids the extension actually registers.
        if ((ALL_COMMAND_IDS as readonly string[]).includes(message.command)) {
          await vscode.commands.executeCommand(message.command);
        }
        return;
      case "open":
        await this.openFinding(message.file, message.line);
        return;
      case "output":
        this.deps.output.show();
        return;
      case "clearDiagnostics":
        this.deps.diagnostics.clear();
        this.deps.store.clearFindings();
        return;
    }
  }

  private async openFinding(file: string, line: number): Promise<void> {
    const root = this.deps.store.get().workspaceRoot;
    if (!root) return;
    const uri = vscode.Uri.file(path.join(root, file));
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc);
      const target = Math.max(0, line - 1);
      const range = new vscode.Range(target, 0, target, 0);
      editor.selection = new vscode.Selection(range.start, range.start);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    } catch {
      void vscode.window.showErrorMessage(`MP Sentinel: couldn't open ${file}.`);
    }
  }
}
