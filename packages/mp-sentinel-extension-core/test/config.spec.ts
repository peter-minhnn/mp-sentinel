import { strict as assert } from "node:assert";
import { test } from "node:test";

import { assertConfigHasNoSecrets, ConfigSecretError, defaultConfig } from "../src/config.js";

test("clean project config passes", () => {
  assert.doesNotThrow(() => assertConfigHasNoSecrets(defaultConfig()));
});

test("nested config passes", () => {
  assert.doesNotThrow(() =>
    assertConfigHasNoSecrets({
      indexing: { enabled: true },
      mcp: { servers: [{ name: "ref", url: "https://x" }] },
    }),
  );
});

test("flags a stored API key", () => {
  assert.throws(
    () => assertConfigHasNoSecrets({ ANTHROPIC_API_KEY: "sk-123" }),
    ConfigSecretError,
  );
});

test("flags a credential-shaped key with a scalar value", () => {
  assert.throws(() => assertConfigHasNoSecrets({ githubToken: "ghp_xxx" }), ConfigSecretError);
});

test("does not flag a credential-shaped key whose value is a nested object", () => {
  // e.g. an `mcp.token` *section* rather than a literal token string
  assert.doesNotThrow(() => assertConfigHasNoSecrets({ tokenSettings: { rotate: true } }));
});
