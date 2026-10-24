/**
 * MCP handler for the task-context capsule.
 */

import { loadCachedIndex } from "./index-cache.js";
import {
  buildTaskContext,
  DEFAULT_TASK_MAX_FILES,
  DEFAULT_TASK_TOKEN_BUDGET,
  MAX_TASK_FILES,
} from "../source-index/task-context.js";

export async function getTaskContext(
  projectRoot: string,
  prompt: string,
  options: { maxFiles?: number; tokenBudget?: number } = {},
): Promise<Record<string, unknown>> {
  const loaded = await loadCachedIndex(projectRoot, "none");
  if (!loaded) return { status: "error", message: "No source index found" };

  try {
    const result = await buildTaskContext(
      loaded.index,
      prompt,
      {
        ...(options.maxFiles !== undefined ? { maxFiles: options.maxFiles } : {}),
        ...(options.tokenBudget !== undefined ? { tokenBudget: options.tokenBudget } : {}),
        emitEnvelope: { status: "ok" },
      },
      loaded.cachePath,
    );
    return { status: "ok", ...result };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export const TASK_CONTEXT_DEFAULTS = {
  maxFiles: DEFAULT_TASK_MAX_FILES,
  maxFilesCap: MAX_TASK_FILES,
  tokenBudget: DEFAULT_TASK_TOKEN_BUDGET,
} as const;
