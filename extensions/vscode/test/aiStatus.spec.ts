import { strict as assert } from "node:assert";
import { test } from "node:test";

import { formatAiStatus, isAiProviderId, PROVIDER_SECRET_KEYS } from "../src/pure/aiStatus.js";

test("formats a full anthropic status with a custom endpoint", () => {
  const status = formatAiStatus({
    ai: { provider: "anthropic", model: "claude-sonnet-4-6", anthropicBaseUrl: "https://x" },
    keyConfigured: true,
  });
  assert.equal(status, "AI: anthropic / claude-sonnet-4-6 · key: configured · endpoint: custom");
});

test("falls back to tier, then auto, and reports official endpoint + no key", () => {
  assert.equal(
    formatAiStatus({ ai: { provider: "openai", modelTier: "balanced" }, keyConfigured: false }),
    "AI: openai / balanced · key: none · endpoint: official",
  );
  assert.equal(
    formatAiStatus({ ai: {}, keyConfigured: false }),
    "AI: default / auto · key: none · endpoint: official",
  );
});

test("never includes a secret value", () => {
  const status = formatAiStatus({
    ai: { provider: "anthropic", model: "m" },
    keyConfigured: true,
  });
  assert.ok(!status.includes("sk-"));
  assert.ok(status.includes("key: configured"));
});

test("provider id guard accepts known providers only", () => {
  assert.ok(isAiProviderId("anthropic"));
  assert.ok(!isAiProviderId("nope"));
});

test("every provider maps to at least one credential env var", () => {
  for (const keys of Object.values(PROVIDER_SECRET_KEYS)) {
    assert.ok(keys.length > 0);
  }
  assert.ok(PROVIDER_SECRET_KEYS.anthropic.includes("ANTHROPIC_API_KEY"));
});
