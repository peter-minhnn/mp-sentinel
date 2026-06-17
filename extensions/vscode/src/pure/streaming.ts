/**
 * Pure helper for live review progress. Builds the per-run extras — the internal
 * progress env flag and an output callback that forwards only stderr chunks to a
 * sink — so the wiring is unit-testable without `vscode`. stdout is never
 * forwarded (it carries the JSON report).
 */

import type { CliOutputEvent } from "mp-sentinel-extension-core";

/** Internal env flag that tells the CLI to stream progress to stderr. */
export const VSCODE_PROGRESS_ENV = "MP_SENTINEL_VSCODE_PROGRESS";

export interface StreamingExtras {
  extraEnv: Record<string, string>;
  onOutput: (event: CliOutputEvent) => void;
}

/**
 * @param appendStderr sink for redacted stderr chunks (e.g. the Output channel).
 */
export function makeStreamingExtras(appendStderr: (chunk: string) => void): StreamingExtras {
  return {
    extraEnv: { [VSCODE_PROGRESS_ENV]: "1" },
    onOutput: (event: CliOutputEvent) => {
      if (event.stream === "stderr") appendStderr(event.chunk);
    },
  };
}
