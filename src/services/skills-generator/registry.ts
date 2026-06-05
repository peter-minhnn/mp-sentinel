import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentAdapter, AgentAdapterId, ExplainAgentEntry } from "../../types/index.js";
import { claudeAdapter } from "./adapters/claude.adapter.js";
import { cursorAdapter } from "./adapters/cursor.adapter.js";
import { codexAdapter } from "./adapters/codex.adapter.js";
import { windsurfAdapter } from "./adapters/windsurf.adapter.js";
import { antigravityAdapter } from "./adapters/antigravity.adapter.js";
import { clineAdapter } from "./adapters/cline.adapter.js";
import { aiderAdapter } from "./adapters/aider.adapter.js";
import { continueAdapter } from "./adapters/continue.adapter.js";
import { rooAdapter } from "./adapters/roo.adapter.js";
import { copilotAdapter } from "./adapters/copilot.adapter.js";
import { zedAdapter } from "./adapters/zed.adapter.js";
import { jetbrainsAdapter } from "./adapters/jetbrains.adapter.js";
import { genericAdapter } from "./adapters/generic.adapter.js";

/** Ordered list of all supported adapters (generic last — it's always a fallback). */
export const ADAPTER_REGISTRY: AgentAdapter[] = [
  claudeAdapter,
  cursorAdapter,
  codexAdapter,
  windsurfAdapter,
  antigravityAdapter,
  clineAdapter,
  // Phase 4.2 -- additional adapters
  aiderAdapter,
  continueAdapter,
  rooAdapter,
  copilotAdapter,
  zedAdapter,
  jetbrainsAdapter,
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

/**
 * Collect per-path detection signals for an adapter.
 * Each signal is a human-readable string like ".claude/ exists".
 */
function getDetectionSignals(projectRoot: string, adapter: AgentAdapter): string[] {
  const signals: string[] = [];
  const exists = (p: string): boolean => existsSync(join(projectRoot, p));

  switch (adapter.id) {
    case "claude":
      if (exists(".claude")) signals.push(".claude/ exists");
      break;
    case "codex":
      if (exists(".codex")) signals.push(".codex/ exists");
      if (exists(".agents")) signals.push(".agents/ exists");
      break;
    case "antigravity":
      if (exists(".antigravity")) signals.push(".antigravity/ exists");
      if (exists(".agent")) signals.push(".agent/ exists");
      break;
    case "cline":
      if (exists(".cline")) signals.push(".cline/ exists");
      if (exists(".clinerules")) signals.push(".clinerules/ exists");
      break;
    case "cursor":
      if (exists(".cursor")) signals.push(".cursor/ exists");
      break;
    case "windsurf":
      if (exists(".windsurf")) signals.push(".windsurf/ exists");
      break;
    // Phase 4.2 -- additional adapters
    case "aider":
      if (exists(".aider.conf.yml")) signals.push(".aider.conf.yml exists");
      if (exists("CONVENTIONS.md")) signals.push("CONVENTIONS.md exists");
      break;
    case "continue":
      if (exists(".continue")) signals.push(".continue/ exists");
      if (exists(".continuerc.json")) signals.push(".continuerc.json exists");
      break;
    case "roo":
      if (exists(".roo")) signals.push(".roo/ exists");
      if (exists(".roorules")) signals.push(".roorules exists");
      break;
    case "copilot":
      if (exists(".github/copilot-instructions.md")) {
        signals.push(".github/copilot-instructions.md exists");
      } else if (exists(".github")) {
        signals.push(".github/ exists");
      }
      break;
    case "zed":
      if (exists(".zed")) signals.push(".zed/ exists");
      if (exists(".rules")) signals.push(".rules exists");
      break;
    case "jetbrains":
      if (exists(".junie")) signals.push(".junie/ exists");
      if (exists(".idea")) signals.push(".idea/ exists");
      break;
    // generic is never auto-detected
  }
  return signals;
}

/**
 * Resolve the concrete output path for an adapter by substituting {projectName}
 * into the workspacePath template and appending the primary required file for
 * skill-type adapters.
 */
function resolveOutputPath(adapter: AgentAdapter, projectName: string): string {
  const resolved = adapter.spec.workspacePath.replace(/\{projectName\}/g, projectName);
  if (adapter.spec.outputKind === "skill" && adapter.spec.requiredFiles[0]) {
    return `${resolved}${adapter.spec.requiredFiles[0]}`;
  }
  return resolved;
}

/**
 * Build explain-agents diagnostic output for all adapters.
 * Computes detection signals, default selection, and resolved output paths
 * without modifying any files or requiring a source index.
 */
export function explainAgentDetection(
  projectRoot: string,
  projectName: string,
): { entries: ExplainAgentEntry[]; defaultSelection: AgentAdapterId[] } {
  const adapters = ADAPTER_REGISTRY.filter((a) => a.id !== "generic");
  const entries: ExplainAgentEntry[] = [];

  for (const adapter of adapters) {
    const detectionSignals = getDetectionSignals(projectRoot, adapter);
    const detected = adapter.detect(projectRoot);

    entries.push({
      id: adapter.id,
      label: adapter.label,
      detected,
      selected: false, // filled in after computing defaultSelection
      detectionSignals,
      outputKind: adapter.spec.outputKind,
      workspacePath: adapter.spec.workspacePath,
      resolvedOutput: resolveOutputPath(adapter, projectName),
      officialDocsUrl: adapter.spec.officialDocsUrl,
    });
  }

  // Default selection: detected adapters, or [claude, generic] as fallback
  const detectedAdapters = entries.filter((e) => e.detected);
  let defaultSelection: AgentAdapterId[];
  if (detectedAdapters.length > 0) {
    defaultSelection = detectedAdapters.map((e) => e.id);
  } else {
    defaultSelection = ["claude", "generic"];
  }

  // Mark selected entries
  const selectedSet = new Set(defaultSelection);
  for (const entry of entries) {
    entry.selected = selectedSet.has(entry.id);
  }

  return { entries, defaultSelection };
}
