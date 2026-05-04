/**
 * Unit tests for OpenAIProvider (Responses API).
 * Mocks fetch to verify endpoint, request body, response parsing, and error handling.
 */

import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { OpenAIProvider } from "../services/ai/providers/openai.provider.js";
import type { IAIProvider, AIModelConfig } from "../services/ai/types.js";

const makeConfig = (overrides: Partial<AIModelConfig> = {}): AIModelConfig => ({
  provider: "openai",
  model: "gpt-5.2",
  apiKey: "test-key",
  temperature: 0.3,
  maxTokens: 2048,
  ...overrides,
});

const mockFetchOnce = (responseBody: unknown, ok = true) => {
  const mockRes = {
    ok,
    status: ok ? 200 : 429,
    statusText: ok ? "OK" : "Too Many Requests",
    json: jest.fn<() => Promise<unknown>>().mockResolvedValue(responseBody),
    text: jest.fn<() => Promise<string>>().mockResolvedValue(JSON.stringify(responseBody)),
  } satisfies Partial<Response>;
  return jest.spyOn(globalThis, "fetch").mockResolvedValue(mockRes as unknown as Response);
};

type FetchSpy = ReturnType<typeof jest.spyOn>;

describe("OpenAIProvider", () => {
  let fetchSpy: FetchSpy | null = null;

  afterEach(() => {
    if (fetchSpy) {
      fetchSpy.mockRestore();
      fetchSpy = null;
    }
  });

  // ── Constructor / isAvailable ──────────────────────────────────────

  it("isAvailable returns true when API key is set", () => {
    const provider = new OpenAIProvider(makeConfig({ apiKey: "valid-key" }));
    expect(provider.isAvailable()).toBe(true);
  });

  it("isAvailable returns false when API key is empty", () => {
    const provider = new OpenAIProvider(makeConfig({ apiKey: "" }));
    expect(provider.isAvailable()).toBe(false);
  });

  // ── Endpoint and request body ──────────────────────────────────────

  it("sends POST to /v1/responses with correct body shape", async () => {
    fetchSpy = mockFetchOnce({ output_text: "ok" });

    const provider = new OpenAIProvider(makeConfig({ temperature: 0.5, maxTokens: 1024 }));
    await provider.generateContent("You are a helper", "Hello");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = fetchSpy.mock.calls[0]?.[0];
    expect(url).toBe("https://api.openai.com/v1/responses");

    const opts = fetchSpy.mock.calls[0]?.[1] as Record<string, unknown>;
    const body = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(body.model).toBe("gpt-5.2");
    expect(body.instructions).toBe("You are a helper");
    expect(body.input).toBe("Hello");
    expect(body.max_output_tokens).toBe(1024);
    expect(body.temperature).toBe(0.5);
    expect(body.store).toBe(false);
  });

  it("sets the Authorization header with the API key", async () => {
    fetchSpy = mockFetchOnce({ output_text: "ok" });

    const provider = new OpenAIProvider(makeConfig({ apiKey: "sk-secret" }));
    await provider.generateContent("sys", "prompt");

    const opts = fetchSpy.mock.calls[0]?.[1] as Record<string, unknown>;
    const headers = opts.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-secret");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  // ── Response parsing: output_text ──────────────────────────────────

  it("returns output_text when present", async () => {
    fetchSpy = mockFetchOnce({ output_text: "review result" });

    const provider = new OpenAIProvider(makeConfig());
    const result = await provider.generateContent("sys", "prompt");
    expect(result).toBe("review result");
  });

  // ── Response parsing: nested output fallback ───────────────────────

  it("falls back to nested output[0].content[0].text when output_text is absent", async () => {
    fetchSpy = mockFetchOnce({
      output: [{ content: [{ type: "output_text", text: "nested text" }] }],
    });

    const provider = new OpenAIProvider(makeConfig());
    const result = await provider.generateContent("sys", "prompt");
    expect(result).toBe("nested text");
  });

  it("returns empty string when both output_text and nested content are absent", async () => {
    fetchSpy = mockFetchOnce({ output: [] });

    const provider = new OpenAIProvider(makeConfig());
    const result = await provider.generateContent("sys", "prompt");
    expect(result).toBe("");
  });

  it("returns empty string when output is undefined", async () => {
    fetchSpy = mockFetchOnce({});

    const provider = new OpenAIProvider(makeConfig());
    const result = await provider.generateContent("sys", "prompt");
    expect(result).toBe("");
  });

  // ── Error handling ─────────────────────────────────────────────────

  it("throws with status text and body for non-ok response", async () => {
    fetchSpy = mockFetchOnce({ error: { message: "Insufficient quota" } }, false);

    const provider = new OpenAIProvider(makeConfig());
    await expect(provider.generateContent("sys", "prompt")).rejects.toThrow(
      /OpenAI API error: 429.*Insufficient quota/,
    );
  });
});
