/**
 * Secret handling for MP Sentinel extensions.
 *
 * Hard rule (see the V1 plan / test plan): API keys and tokens are NEVER written
 * to `.mp-sentinelrc.json`, NEVER passed as command-line arguments, and NEVER
 * logged. They are injected into the child process environment only, sourced
 * from the host editor's secret store (e.g. VS Code `SecretStorage`).
 *
 * This module owns the canonical list of secret-bearing environment variable
 * names and the redaction helpers the rest of the core relies on.
 */

/**
 * Environment variables that carry provider credentials or tokens. These are
 * the only keys allowed to flow from the secret store into the child env, and
 * the keys that {@link redactSecrets} masks in any log/diagnostic string.
 */
export const SECRET_ENV_KEYS = [
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "GROK_API_KEY",
  "XAI_API_KEY",
  "OPENROUTER_API_KEY",
  "GITHUB_TOKEN",
  "GITLAB_TOKEN",
  "CI_JOB_TOKEN",
] as const;

export type SecretEnvKey = (typeof SECRET_ENV_KEYS)[number];

const SECRET_ENV_KEY_SET: ReadonlySet<string> = new Set(SECRET_ENV_KEYS);

/** A map of secret env var name -> value, as retrieved from the host secret store. */
export type SecretBundle = Partial<Record<SecretEnvKey, string>>;

/** True when `name` is a recognised secret-bearing environment variable. */
export function isSecretEnvKey(name: string): name is SecretEnvKey {
  return SECRET_ENV_KEY_SET.has(name);
}

/**
 * Returns a copy of `bundle` containing only recognised secret keys with
 * non-empty values. Guards against an upstream store handing us blank strings
 * (which would otherwise shadow a key resolved from the ambient environment).
 */
export function sanitizeSecretBundle(bundle: Readonly<Record<string, string | undefined>>): SecretBundle {
  const out: SecretBundle = {};
  for (const key of SECRET_ENV_KEYS) {
    const value = bundle[key];
    if (typeof value === "string" && value.length > 0) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Masks any secret values found in `text`. Used before writing to an output
 * channel or surfacing CLI stderr to the user. Both the literal secret values
 * (from `bundle`) and `KEY=value` assignments for known secret keys are masked.
 */
export function redactSecrets(text: string, bundle?: SecretBundle): string {
  let result = text;

  if (bundle) {
    for (const value of Object.values(bundle)) {
      if (value && value.length >= 4) {
        result = result.split(value).join("***REDACTED***");
      }
    }
  }

  // Mask `SECRET_KEY=...` and `SECRET_KEY: ...` assignments defensively, even if
  // the exact value wasn't supplied in the bundle.
  for (const key of SECRET_ENV_KEYS) {
    const assignment = new RegExp(`(${key}\\s*[:=]\\s*)(\\S+)`, "g");
    result = result.replace(assignment, "$1***REDACTED***");
  }

  return result;
}

/**
 * Asserts that none of the supplied secret values appear anywhere in `args`.
 * Throws if a leak is detected. Call this in the runner before spawning so a
 * programming error can never ship a credential on the command line.
 */
export function assertNoSecretsInArgs(args: readonly string[], bundle?: SecretBundle): void {
  if (!bundle) return;
  const values = Object.values(bundle).filter((v): v is string => typeof v === "string" && v.length > 0);
  if (values.length === 0) return;

  for (const arg of args) {
    for (const value of values) {
      if (arg.includes(value)) {
        throw new Error("Refusing to spawn: a secret value was found in command arguments.");
      }
    }
  }
}
