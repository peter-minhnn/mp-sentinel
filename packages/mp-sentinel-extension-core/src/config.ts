/**
 * Helpers for the project config file (`.mp-sentinelrc.json`).
 *
 * Critical invariant: this file is PROJECT configuration only — rules, limits,
 * indexing, review behavior, create-skills settings, MCP config. It must NEVER
 * contain API keys or tokens; those live in the host secret store and are
 * injected via the environment at runtime.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { SECRET_ENV_KEYS } from "./secrets.js";

export const CONFIG_FILENAME = ".mp-sentinelrc.json";

/** Loosely-typed project config — the CLI owns the authoritative schema. */
export type ProjectConfig = Record<string, unknown>;

/** Substrings that, if present in a config key, indicate a credential leak. */
const SECRET_KEY_HINTS = ["apikey", "api_key", "secret", "token", "password", "credential"];

export class ConfigSecretError extends Error {
  readonly key: string;
  constructor(key: string) {
    super(
      `Refusing to use config: key "${key}" looks like a credential. ` +
        `Secrets must be stored in the editor secret store, not ${CONFIG_FILENAME}.`,
    );
    this.name = "ConfigSecretError";
    this.key = key;
  }
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, "");
}

/**
 * Walks a parsed config object and throws {@link ConfigSecretError} if any key
 * is a known secret env var or matches a credential-shaped hint.
 */
export function assertConfigHasNoSecrets(config: unknown, path = ""): void {
  if (Array.isArray(config)) {
    config.forEach((item, i) => assertConfigHasNoSecrets(item, `${path}[${i}]`));
    return;
  }
  if (typeof config !== "object" || config === null) return;

  const secretEnvNormalized = new Set(SECRET_ENV_KEYS.map(normalizeKey));

  for (const [key, value] of Object.entries(config)) {
    const norm = normalizeKey(key);
    if (secretEnvNormalized.has(norm) || SECRET_KEY_HINTS.some((hint) => norm.includes(hint))) {
      // `mcp` server *names* could innocently include "token"; only flag scalar
      // values that look like a stored secret, not nested config objects.
      if (typeof value === "string" && value.trim().length > 0) {
        throw new ConfigSecretError(path ? `${path}.${key}` : key);
      }
    }
    assertConfigHasNoSecrets(value, path ? `${path}.${key}` : key);
  }
}

export interface LoadConfigResult {
  exists: boolean;
  config?: ProjectConfig;
  path: string;
}

/** Reads and parses `.mp-sentinelrc.json` from `projectRoot`, if present. */
export async function loadConfig(projectRoot: string): Promise<LoadConfigResult> {
  const path = resolve(projectRoot, CONFIG_FILENAME);
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return { exists: false, path };
  }

  const config = JSON.parse(raw) as ProjectConfig;
  assertConfigHasNoSecrets(config);
  return { exists: true, config, path };
}

/** A minimal, secret-free default config for scaffolding. */
export function defaultConfig(): ProjectConfig {
  return {
    rules: [],
    commitFormat: "<type>(<scope>): <subject>",
    maxConcurrency: 5,
    indexing: { enabled: true, maxRelatedFiles: 3 },
    localReview: { enabled: true, commitCount: 3 },
  };
}
