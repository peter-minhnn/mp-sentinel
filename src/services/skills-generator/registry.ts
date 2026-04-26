import type { AgentAdapter, AgentAdapterId } from "../../types/index.js";
import { claudeAdapter } from "./adapters/claude.adapter.js";
import { cursorAdapter } from "./adapters/cursor.adapter.js";
import { codexAdapter } from "./adapters/codex.adapter.js";
import { windsurfAdapter } from "./adapters/windsurf.adapter.js";
import { antigravityAdapter } from "./adapters/antigravity.adapter.js";
import { clineAdapter } from "./adapters/cline.adapter.js";
import { genericAdapter } from "./adapters/generic.adapter.js";

/** Ordered list of all supported adapters (generic last — it's always a fallback). */
export const ADAPTER_REGISTRY: AgentAdapter[] = [
  claudeAdapter,
  cursorAdapter,
  codexAdapter,
  windsurfAdapter,
  antigravityAdapter,
  clineAdapter,
  genericAdapter,
];

/** Look up an adapter by id. Returns undefined if the id is unknown. */
export function getAdapter(id: AgentAdapterId): AgentAdapter | undefined {
  return ADAPTER_REGISTRY.find((a) => a.id === id);
}

/** Parse a comma-separated --agent string into validated adapter list. */
export function parseAgentFlag(raw: string): AgentAdapter[] {
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const adapters: AgentAdapter[] = [];
  const unknown: string[] = [];

  for (const id of ids) {
    const adapter = getAdapter(id as AgentAdapterId);
    if (adapter) {
      adapters.push(adapter);
    } else {
      unknown.push(id);
    }
  }

  if (unknown.length > 0) {
    const valid = ADAPTER_REGISTRY.map((a) => a.id).join(", ");
    throw new Error(`Unknown agent(s): ${unknown.join(", ")}. Valid options: ${valid}`);
  }

  return adapters;
}

/** Auto-detect which adapters are relevant based on existing project folders. */
export function detectAdapters(projectRoot: string): AgentAdapter[] {
  return ADAPTER_REGISTRY.filter((a) => a.detect(projectRoot));
}
