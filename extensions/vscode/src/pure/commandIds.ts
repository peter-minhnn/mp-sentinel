/**
 * Single source of truth for the extension's command identifiers.
 *
 * The manifest (`package.json` → `contributes.commands`) and the runtime
 * registration (`commands/index.ts`) must stay in lock-step: a command
 * contributed but not registered fails silently when invoked, and one
 * registered but not contributed is unreachable from the palette. A unit test
 * diffs the manifest against {@link COMMAND_IDS} so drift is caught in CI.
 *
 * This module is intentionally free of any `vscode` dependency so it can be
 * imported by both the extension bundle and the Node test runner.
 */

export const COMMAND_IDS = {
  setupCredentials: "mpSentinel.setupCredentials",
  clearCredential: "mpSentinel.clearCredential",
  selectProvider: "mpSentinel.selectProvider",
  initConfig: "mpSentinel.initConfig",
  reviewStaged: "mpSentinel.reviewStaged",
  reviewCurrentFile: "mpSentinel.reviewCurrentFile",
  reviewSelectedFiles: "mpSentinel.reviewSelectedFiles",
  reviewRange: "mpSentinel.reviewRange",
  dryRunPreview: "mpSentinel.dryRunPreview",
  explainContext: "mpSentinel.explainContext",
  indexHealth: "mpSentinel.indexHealth",
  rebuildIndex: "mpSentinel.rebuildIndex",
  skillsCheck: "mpSentinel.skillsCheck",
  generateSkills: "mpSentinel.generateSkills",
  clearDiagnostics: "mpSentinel.clearDiagnostics",
} as const;

export type CommandKey = keyof typeof COMMAND_IDS;
export type CommandId = (typeof COMMAND_IDS)[CommandKey];

/** Every command id the extension registers, sorted for stable comparisons. */
export const ALL_COMMAND_IDS: readonly CommandId[] = Object.values(COMMAND_IDS)
  .slice()
  .sort() as CommandId[];
