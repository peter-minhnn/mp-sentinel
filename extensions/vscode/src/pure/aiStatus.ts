/**
 * Pure helpers for AI provider configuration: the provider→credential mapping
 * and a compact, secret-free status string for the side panel.
 *
 * No `vscode` import (type-only from core) so it is unit-testable. The status
 * string never contains a credential value — only whether one is configured.
 */

import type { AiSelection } from "mp-sentinel-extension-core";

export type AiProviderId = "gemini" | "openai" | "anthropic" | "grok" | "openrouter";

export const AI_PROVIDER_IDS: readonly AiProviderId[] = [
  "gemini",
  "openai",
  "anthropic",
  "grok",
  "openrouter",
];

/** Credential env var(s) each provider reads, primary first. */
export const PROVIDER_SECRET_KEYS: Record<AiProviderId, readonly string[]> = {
  gemini: ["GEMINI_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"],
  grok: ["GROK_API_KEY", "XAI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
};

export function isAiProviderId(value: string): value is AiProviderId {
  return (AI_PROVIDER_IDS as readonly string[]).includes(value);
}

export interface AiStatusInput {
  ai: AiSelection;
  /** Whether a credential for the selected provider is stored. */
  keyConfigured: boolean;
}

/**
 * Compact one-liner for the panel, e.g.
 * `AI: anthropic / claude-sonnet-4-6 · key: configured · endpoint: custom`.
 * Never includes a secret value.
 */
export function formatAiStatus(input: AiStatusInput): string {
  const { ai, keyConfigured } = input;
  const provider = ai.provider ?? "default";
  const model = ai.model ?? ai.modelTier ?? "auto";
  const key = keyConfigured ? "configured" : "none";
  const endpoint = ai.anthropicBaseUrl ? "custom" : "official";
  return `AI: ${provider} / ${model} · key: ${key} · endpoint: ${endpoint}`;
}
