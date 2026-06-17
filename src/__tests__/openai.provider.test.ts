/**
 * Unit tests for OpenAIProvider (Responses API).
 * Mocks fetch to verify endpoint, request body, response parsing, and error handling.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { OpenAIProvider } from "../services/ai/providers/openai.provider.js";
import type { AIModelConfig } from "../services/ai/types.js";

// Mock the global fetch (matches anthropic/openrouter provider tests).
const mockFetch = jest.fn<typeof fetch>();
globalThis.fetch = mockFetch;

const makeConfig = (overrides: Partial<AIModelConfig> = {}): AIModelConfig => ({
  provider: "openai",
  model: "gpt-5.2",
  apiKey: "test-key",
  temperature: 0.3,
  maxTokens: 2048,
  ...overrides,
});

const mockFetchOnce = (responseBody: unknown, ok = true): void => {
  const res = new Response(JSON.stringify(responseBody), {
    status: ok ? 200 : 429,
    statusText: ok ? "OK" : "Too Many Requests",
  });
  mockFetch.mockResolvedValueOnce(res);
};

const getRequestInit = (): Record<string, unknown> => {
  const firstCall = mockFetch.mock.calls[0];
  expect(firstCall).toBeDefined();
  return firstCall![1] as unknown as Record<string, unknown>;
};

describe("OpenAIProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    mockFetchOnce({ output_text: "ok" });

    const provider = new OpenAIProvider(makeConfig({ temperature: 0.5, maxTokens: 1024 }));
    await provider.generateContent("You are a helper", "Hello");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = mockFetch.mock.calls[0]?.[0];
    expect(url).toBe("https://api.openai.com/v1/responses");

    const opts = getRequestInit();
    const body = JSON.parse(opts["body"] as string) as Record<string, unknown>;
    expect(body["model"]).toBe("gpt-5.2");
    expect(body["instructions"]).toBe("You are a helper");
    expect(body["input"]).toBe("Hello");
    expect(body["max_output_tokens"]).toBe(1024);
    expect(body["temperature"]).toBe(0.5);
    expect(body["store"]).toBe(false);
  });

  it("sets the Authorization header with the API key", async () => {
    mockFetchOnce({ output_text: "ok" });

    const provider = new OpenAIProvider(makeConfig({ apiKey: "sk-secret" }));
    await provider.generateContent("sys", "prompt");

    const headers = getRequestInit()["headers"] as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-secret");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  // ── Response parsing: output_text ──────────────────────────────────

  it("returns output_text when present", async () => {
    mockFetchOnce({ output_text: "review result" });

    const provider = new OpenAIProvider(makeConfig());
    const result = await provider.generateContent("sys", "prompt");
    expect(result).toBe("review result");
  });

  // ── Response parsing: nested output fallback ───────────────────────

  it("falls back to nested output[0].content[0].text when output_text is absent", async () => {
    mockFetchOnce({
      output: [{ content: [{ type: "output_text", text: "nested text" }] }],
    });

    const provider = new OpenAIProvider(makeConfig());
    const result = await provider.generateContent("sys", "prompt");
    expect(result).toBe("nested text");
  });

  it("returns empty string when both output_text and nested content are absent", async () => {
    mockFetchOnce({ output: [] });

    const provider = new OpenAIProvider(makeConfig());
    const result = await provider.generateContent("sys", "prompt");
    expect(result).toBe("");
  });

  it("returns empty string when output is undefined", async () => {
    mockFetchOnce({});

    const provider = new OpenAIProvider(makeConfig());
    const result = await provider.generateContent("sys", "prompt");
    expect(result).toBe("");
  });

  // ── Error handling ─────────────────────────────────────────────────

  it("throws with status text and body for non-ok response", async () => {
    mockFetchOnce({ error: { message: "Insufficient quota" } }, false);

    const provider = new OpenAIProvider(makeConfig());
    await expect(provider.generateContent("sys", "prompt")).rejects.toThrow(
      /OpenAI API error: 429.*Insufficient quota/,
    );
  });
});
