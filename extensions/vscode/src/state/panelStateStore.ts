/**
 * Session-only state for the side panel. Holds the latest UI snapshot and
 * notifies subscribers (the webview provider) on change. Nothing is persisted —
 * reloading the window resets to {@link INITIAL_PANEL_STATE}.
 *
 * No `vscode` import: command handlers push already-derived, pure data in, and
 * the provider renders it out, keeping this layer testable and decoupled.
 */

import {
  INITIAL_PANEL_STATE,
  type PanelFinding,
  type PanelResult,
  type PanelState,
} from "../pure/panelView.js";

type Listener = (state: PanelState) => void;

export class PanelStateStore {
  private state: PanelState = INITIAL_PANEL_STATE;
  private readonly listeners = new Set<Listener>();

  get(): PanelState {
    return this.state;
  }

  /** Subscribe to state changes; returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private commit(next: PanelState): void {
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }

  /** Marks a long-running operation as in progress. */
  setBusy(label: string): void {
    this.commit({ ...this.state, phase: "running", busyLabel: label });
  }

  /** Returns to idle without disturbing the latest results. */
  setIdle(statusLine?: string): void {
    const next: PanelState = { ...this.state, phase: "idle" };
    delete next.busyLabel;
    if (statusLine !== undefined) next.statusLine = statusLine;
    this.commit(next);
  }

  /** Publishes a review / dry-run summary and its flattened findings. */
  publishResult(result: PanelResult, findings: PanelFinding[], workspaceRoot: string): void {
    const verb = result.kind === "dry-run" ? "Dry-run" : "Review";
    const next: PanelState = {
      ...this.state,
      phase: "idle",
      statusLine: `${verb}: ${result.status} — ${result.critical} critical, ${result.warning} warning, ${result.info} info`,
      result,
      findings,
      workspaceRoot,
    };
    delete next.busyLabel;
    this.commit(next);
  }

  /** Updates the compact status line (e.g. an explain-context summary). */
  publishStatusLine(statusLine: string): void {
    const next: PanelState = { ...this.state, phase: "idle", statusLine };
    delete next.busyLabel;
    this.commit(next);
  }

  /** Records the latest source-index health status. */
  publishIndexHealth(status: string): void {
    this.commit({ ...this.state, indexHealth: status });
  }

  /** Records the latest agent-skills check status. */
  publishSkills(status: string): void {
    this.commit({ ...this.state, skillsStatus: status });
  }

  /** Records the compact, secret-free AI configuration status. */
  publishAiStatus(status: string): void {
    this.commit({ ...this.state, aiStatus: status });
  }

  /** Clears findings + result (mirrors "Clear Findings"). */
  clearFindings(): void {
    const next: PanelState = { ...this.state, findings: [] };
    delete next.result;
    this.commit(next);
  }
}
