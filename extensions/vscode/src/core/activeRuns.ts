import * as vscode from "vscode";

/**
 * Tracks in-flight cancellable runs so a single "Stop Review" command can abort
 * whatever is currently running, independent of which progress notification
 * owns it.
 *
 * Each run registers a {@link vscode.CancellationTokenSource}; cancelling it
 * propagates through the command's context signal down to the CLI runner, which
 * tears down the child process tree. Registration is reference-counted via the
 * returned untrack function, called from a `finally` when the run settles.
 */
const activeRuns = new Set<vscode.CancellationTokenSource>();

/** Register a run. Returns an idempotent untrack callback for the `finally`. */
export function registerRun(cts: vscode.CancellationTokenSource): () => void {
  activeRuns.add(cts);
  return () => {
    activeRuns.delete(cts);
  };
}

/** True while at least one cancellable run is in flight. */
export function hasActiveRuns(): boolean {
  return activeRuns.size > 0;
}

/**
 * Cancel every in-flight run. Returns the number cancelled so the caller can
 * tailor its message (e.g. stay quiet when nothing was running).
 */
export function cancelAllRuns(): number {
  const count = activeRuns.size;
  for (const cts of activeRuns) cts.cancel();
  activeRuns.clear();
  return count;
}
