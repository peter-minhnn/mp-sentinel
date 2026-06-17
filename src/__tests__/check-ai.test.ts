/**
 * Unit tests for the `check-ai` command. Verifies the JSON contract, in
 * particular that provider/model are reported even when the credential is
 * missing (so the caller can show what was attempted).
 */

import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { runCheckAiCommand } from "../commands/check-ai.js";

describe("check-ai", () => {
  const originalEnv = { ...process.env };
  let logSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    process.env = { ...originalEnv };
  });

  const lastJson = (): Record<string, unknown> => {
    const calls = logSpy.mock.calls;
    const payload = calls[calls.length - 1]?.[0];
    return JSON.parse(String(payload)) as Record<string, unknown>;
  };

  it("reports provider and model even when the API key is missing", async () => {
    delete process.env["ANTHROPIC_API_KEY"];
    delete process.env["ANTHROPIC_AUTH_TOKEN"];
    process.env["AI_PROVIDER"] = "anthropic";
    process.env["AI_MODEL"] = "claude-sonnet-4-6";

    const code = await runCheckAiCommand();

    expect(code).toBe(2);
    const out = lastJson();
    expect(out["status"]).toBe("error");
    expect(out["provider"]).toBe("anthropic");
    expect(out["model"]).toBe("claude-sonnet-4-6");
    expect(typeof out["error"]).toBe("string");
  });
});
