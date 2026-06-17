/**
 * Runtime environment injection for the `mp-sentinel` child process.
 *
 * The extension injects three classes of variables, all at runtime only:
 *   1. Non-secret AI selection: AI_PROVIDER, AI_MODEL, AI_MODEL_TIER (+ a few
 *      optional non-secret provider settings).
 *   2. Secret provider credentials/tokens, sourced from the host secret store.
 *   3. MCP-related variables, when the user has configured them.
 *
 * Nothing here is ever persisted to disk or passed as a CLI argument.
 */

import { sanitizeSecretBundle, type SecretBundle } from "./secrets.js";

export type AiModelTier = "premium" | "balanced" | "budget";

/** Non-secret AI selection, typically mirrored from editor settings. */
export interface AiSelection {
  provider?: string;
  model?: string;
  modelTier?: AiModelTier;
  /** Optional non-secret provider settings (e.g. custom Anthropic-compatible base URL). */
  anthropicBaseUrl?: string;
  openrouterSiteUrl?: string;
  openrouterAppName?: string;
}

export interface BuildEnvInput {
  /** The ambient environment to extend (usually `process.env`). */
  baseEnv?: Readonly<Record<string, string | undefined>>;
  /** Non-secret AI selection from settings. */
  ai?: AiSelection;
  /** Secret credentials from the host secret store. */
  secrets?: SecretBundle;
  /** Extra non-secret MCP env vars the user configured (e.g. server URLs). */
  mcpEnv?: Readonly<Record<string, string>>;
  /**
   * Extra non-secret env vars the adapter sets per run (e.g. an internal
   * progress flag). Applied after MCP env and before secrets, so it can never
   * override a credential.
   */
  extraEnv?: Readonly<Record<string, string>>;
}

function assignIfPresent(
  target: Record<string, string>,
  key: string,
  value: string | undefined,
): void {
  if (typeof value === "string" && value.length > 0) {
    target[key] = value;
  }
}

/**
 * Builds the environment map to hand to the child process. Returns a plain
 * object suitable for `spawn`'s `env` option. The base environment is copied
 * first so the CLI still sees PATH etc., then overlaid with our injections.
 */
export function buildEnv(input: BuildEnvInput = {}): Record<string, string> {
  const { baseEnv = {}, ai = {}, secrets, mcpEnv, extraEnv } = input;

  const env: Record<string, string> = {};

  // 1. Copy the ambient environment (defined values only).
  for (const [key, value] of Object.entries(baseEnv)) {
    if (typeof value === "string") env[key] = value;
  }

  // 2. Non-secret AI selection.
  assignIfPresent(env, "AI_PROVIDER", ai.provider);
  assignIfPresent(env, "AI_MODEL", ai.model);
  assignIfPresent(env, "AI_MODEL_TIER", ai.modelTier);
  assignIfPresent(env, "ANTHROPIC_BASE_URL", ai.anthropicBaseUrl);
  assignIfPresent(env, "OPENROUTER_SITE_URL", ai.openrouterSiteUrl);
  assignIfPresent(env, "OPENROUTER_APP_NAME", ai.openrouterAppName);

  // 3. MCP env (non-secret config only — secrets must come via the bundle).
  if (mcpEnv) {
    for (const [key, value] of Object.entries(mcpEnv)) {
      assignIfPresent(env, key, value);
    }
  }

  // 3b. Per-run extra env (non-secret, e.g. internal progress flag).
  if (extraEnv) {
    for (const [key, value] of Object.entries(extraEnv)) {
      assignIfPresent(env, key, value);
    }
  }

  // 4. Secret credentials, last so they win over any stale ambient values.
  if (secrets) {
    const clean = sanitizeSecretBundle(secrets);
    for (const [key, value] of Object.entries(clean)) {
      assignIfPresent(env, key, value);
    }
  }

  // Stable, parseable JSON: never let the CLI colorize stdout.
  env["NO_COLOR"] = "1";

  return env;
}
