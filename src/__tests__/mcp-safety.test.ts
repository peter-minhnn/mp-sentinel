/**
 * MCP safety tests — env sanitization, error handling, timeout behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { sanitizeEnv } from "../services/mcp/sanitizer.js";

describe("sanitizeEnv", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.TEST_TOKEN = "secret123";
    process.env.TEST_OTHER = "other456";
    process.env.TEST_EMPTY = "";
  });

  afterEach(() => {
    // Restore only our test keys
    delete process.env.TEST_TOKEN;
    delete process.env.TEST_OTHER;
    delete process.env.TEST_EMPTY;
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("MP_SENTINEL_MCP_TEST_")) {
        delete process.env[key];
      }
    }
  });

  it("only includes explicitly named env vars", () => {
    const envMap = { GITHUB_TOKEN: "TEST_TOKEN" };
    const result = sanitizeEnv(envMap);
    expect(result).toEqual({ GITHUB_TOKEN: "secret123" });
    expect("TEST_OTHER" in result).toBe(false);
  });

  it("excludes env vars not in the map", () => {
    const envMap = { MY_VAR: "TEST_TOKEN" };
    const result = sanitizeEnv(envMap);
    expect(result).toEqual({ MY_VAR: "secret123" });
    // TEST_OTHER should not be in the result
    const values = Object.values(result);
    expect(values).not.toContain("other456");
  });

  it("handles missing process.env values", () => {
    const envMap = { TOKEN: "NONEXISTENT_ENV_VAR" };
    const result = sanitizeEnv(envMap);
    expect(result).toEqual({});
  });

  it("with empty input map returns empty object", () => {
    const result = sanitizeEnv({});
    expect(result).toEqual({});
  });

  it("handles empty string env values", () => {
    const envMap = { TOKEN: "TEST_EMPTY" };
    const result = sanitizeEnv(envMap);
    expect(result).toEqual({ TOKEN: "" });
  });

  it("never exposes the full process.env", () => {
    const result = sanitizeEnv({ GITHUB_TOKEN: "TEST_TOKEN" });
    const resultKeys = Object.keys(result);
    // Only the explicitly named keys should be present
    expect(resultKeys).toHaveLength(1);
    expect(resultKeys).toEqual(["GITHUB_TOKEN"]);
    // Should NOT have process.env keys like PATH, HOME, etc.
    expect("PATH" in result).toBe(false);
  });

  it("forwards multiple env vars when all exist", () => {
    const envMap = { TOKEN: "TEST_TOKEN", OTHER: "TEST_OTHER" };
    const result = sanitizeEnv(envMap);
    expect(result).toEqual({ TOKEN: "secret123", OTHER: "other456" });
  });

  it("partially forwards when some env vars are missing", () => {
    const envMap = {
      TOKEN: "TEST_TOKEN",
      MISSING: "NONEXISTENT_VAR",
      OTHER: "TEST_OTHER",
    };
    const result = sanitizeEnv(envMap);
    expect(result).toEqual({ TOKEN: "secret123", OTHER: "other456" });
  });
});
