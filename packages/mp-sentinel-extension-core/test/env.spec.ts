import { strict as assert } from "node:assert";
import { test } from "node:test";

import { buildEnv } from "../src/env.js";

test("injects non-secret AI selection and forces NO_COLOR", () => {
  const env = buildEnv({
    baseEnv: { PATH: "/usr/bin" },
    ai: { provider: "anthropic", model: "claude-sonnet-4-6", modelTier: "balanced" },
  });
  assert.equal(env["PATH"], "/usr/bin");
  assert.equal(env["AI_PROVIDER"], "anthropic");
  assert.equal(env["AI_MODEL"], "claude-sonnet-4-6");
  assert.equal(env["AI_MODEL_TIER"], "balanced");
  assert.equal(env["NO_COLOR"], "1");
});

test("secrets win over stale ambient values and blanks are dropped", () => {
  const env = buildEnv({
    baseEnv: { ANTHROPIC_API_KEY: "stale" },
    secrets: { ANTHROPIC_API_KEY: "fresh", OPENAI_API_KEY: "" },
  });
  assert.equal(env["ANTHROPIC_API_KEY"], "fresh");
  assert.ok(!("OPENAI_API_KEY" in env), "blank secret should not be injected");
});

test("mcp env is merged but never carries secret precedence over the bundle", () => {
  const env = buildEnv({
    mcpEnv: { MCP_SERVER_URL: "https://mcp.example" },
    secrets: { GEMINI_API_KEY: "g" },
  });
  assert.equal(env["MCP_SERVER_URL"], "https://mcp.example");
  assert.equal(env["GEMINI_API_KEY"], "g");
});

test("empty selection only sets NO_COLOR", () => {
  const env = buildEnv();
  assert.deepEqual(Object.keys(env), ["NO_COLOR"]);
});
