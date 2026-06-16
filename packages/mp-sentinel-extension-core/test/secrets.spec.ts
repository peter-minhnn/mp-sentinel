import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  assertNoSecretsInArgs,
  isSecretEnvKey,
  redactSecrets,
  sanitizeSecretBundle,
} from "../src/secrets.js";

test("isSecretEnvKey recognises credential vars", () => {
  assert.ok(isSecretEnvKey("ANTHROPIC_API_KEY"));
  assert.ok(isSecretEnvKey("GITHUB_TOKEN"));
  assert.ok(!isSecretEnvKey("AI_PROVIDER"));
});

test("sanitizeSecretBundle keeps only known, non-empty secrets", () => {
  const bundle = sanitizeSecretBundle({
    ANTHROPIC_API_KEY: "abc",
    OPENAI_API_KEY: "",
    NOT_A_SECRET: "x",
  });
  assert.deepEqual(bundle, { ANTHROPIC_API_KEY: "abc" });
});

test("assertNoSecretsInArgs throws when a secret value appears in argv", () => {
  assert.throws(
    () => assertNoSecretsInArgs(["--token", "supersecret"], { GITHUB_TOKEN: "supersecret" }),
    /secret value was found in command arguments/,
  );
});

test("assertNoSecretsInArgs passes for clean argv", () => {
  assert.doesNotThrow(() =>
    assertNoSecretsInArgs(["--staged", "--format", "json"], { GITHUB_TOKEN: "supersecret" }),
  );
});

test("redactSecrets masks literal values and KEY=value assignments", () => {
  const masked = redactSecrets("using key sk-12345 and ANTHROPIC_API_KEY=sk-12345", {
    ANTHROPIC_API_KEY: "sk-12345",
  });
  assert.ok(!masked.includes("sk-12345"));
  assert.ok(masked.includes("***REDACTED***"));
});

test("redactSecrets masks known assignments even without a bundle", () => {
  const masked = redactSecrets("OPENAI_API_KEY=leaky-value-here");
  assert.ok(!masked.includes("leaky-value-here"));
});
