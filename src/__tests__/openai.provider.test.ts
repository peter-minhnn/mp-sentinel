/**
 * Unit tests for OpenAIProvider (Responses API).
 * Mocks fetch to verify endpoint, request body, response parsing, and error handling.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import {
  OpenAIProvider,
  resolveOpenAIResponsesURL,
} from "../services/ai/providers/openai.provider.js";
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

  // ── Custom endpoint resolution (OPENAI_BASE_URL) ───────────────────

  it("resolves the Responses URL from custom bases, defaulting to OpenAI", () => {
    expect(resolveOpenAIResponsesURL()).toBe("https://api.openai.com/v1/responses");
    expect(resolveOpenAIResponsesURL("")).toBe("https://api.openai.com/v1/responses");
    expect(resolveOpenAIResponsesURL("https://proxy.example.com")).toBe(
      "https://proxy.example.com/v1/responses",
    );
    expect(resolveOpenAIResponsesURL("https://proxy.example.com/v1")).toBe(
      "https://proxy.example.com/v1/responses",
    );
    expect(resolveOpenAIResponsesURL("https://proxy.example.com/v1/responses/")).toBe(
      "https://proxy.example.com/v1/responses",
    );
  });

  it("posts to the custom base URL when config.baseUrl is set", async () => {
    mockFetchOnce({ output_text: "ok" });
    const provider = new OpenAIProvider(
      makeConfig({ baseUrl: "https://proxy.example.com/v1", model: "gpt-4o" }),
    );
    await provider.generateContent("sys", "prompt");
    expect(mockFetch.mock.calls[0]?.[0]).toBe("https://proxy.example.com/v1/responses");
  });

  it("isAvailable returns true when API key is set", () => {
    const provider = new OpenAIProvider(makeConfig({ apiKey: "valid-key" }));
    expect(provider.isAvailable()).toBe(true);
  });

  it("isAvailable returns false when API key is empty", () => {
    const provider = new OpenAIProvider(makeConfig({ apiKey: "" }));
    expect(provider.isAvailable()).toBe(false);
  });

  // ── Request timeout defaults (reasoning models are slow) ───────────

  const timeoutOf = (p: OpenAIProvider): number =>
    (p as unknown as { timeoutMs: number }).timeoutMs;

  it("defaults reasoning models to a long timeout and chat models to 30s", () => {
    delete process.env.AI_TIMEOUT_MS;
    expect(timeoutOf(new OpenAIProvider(makeConfig({ model: "gpt-5.5" })))).toBe(180000);
    expect(timeoutOf(new OpenAIProvider(makeConfig({ model: "o3-mini" })))).toBe(180000);
    expect(timeoutOf(new OpenAIProvider(makeConfig({ model: "gpt-4o" })))).toBe(30000);
  });

  it("lets AI_TIMEOUT_MS override the default for any model", () => {
    process.env.AI_TIMEOUT_MS = "90000";
    expect(timeoutOf(new OpenAIProvider(makeConfig({ model: "gpt-5.5" })))).toBe(90000);
    expect(timeoutOf(new OpenAIProvider(makeConfig({ model: "gpt-4o" })))).toBe(90000);
    delete process.env.AI_TIMEOUT_MS;
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
    // gpt-5.2 is a reasoning model: max_output_tokens is floored to 4096 so the
    // hidden reasoning doesn't starve the visible answer (configured 1024 here).
    expect(body["max_output_tokens"]).toBe(4096);
    expect(body["store"]).toBe(false);
  });

  it("uses the configured max_output_tokens for non-reasoning models", async () => {
    mockFetchOnce({ output_text: "ok" });
    const provider = new OpenAIProvider(makeConfig({ model: "gpt-4o", maxTokens: 1024 }));
    await provider.generateContent("sys", "prompt");
    const body = JSON.parse(getRequestInit()["body"] as string) as Record<string, unknown>;
    expect(body["max_output_tokens"]).toBe(1024);
  });

  // ── Reasoning vs. non-reasoning sampling parameters ────────────────

  it("omits temperature and sends reasoning.effort for GPT-5.x reasoning models", async () => {
    mockFetchOnce({ output_text: "ok" });

    const provider = new OpenAIProvider(
      makeConfig({ model: "gpt-5.2", temperature: 0.5, reasoningEffort: "high" }),
    );
    await provider.generateContent("sys", "prompt");

    const body = JSON.parse(getRequestInit()["body"] as string) as Record<string, unknown>;
    expect(body["temperature"]).toBeUndefined();
    expect(body["reasoning"]).toEqual({ effort: "high" });
  });

  it("defaults reasoning.effort to medium when not configured", async () => {
    mockFetchOnce({ output_text: "ok" });

    const provider = new OpenAIProvider(makeConfig({ model: "o3-mini" }));
    await provider.generateContent("sys", "prompt");

    const body = JSON.parse(getRequestInit()["body"] as string) as Record<string, unknown>;
    expect(body["temperature"]).toBeUndefined();
    expect(body["reasoning"]).toEqual({ effort: "medium" });
  });

  it("sends temperature (not reasoning) for non-reasoning models", async () => {
    mockFetchOnce({ output_text: "ok" });

    const provider = new OpenAIProvider(makeConfig({ model: "gpt-4o", temperature: 0.5 }));
    await provider.generateContent("sys", "prompt");

    const body = JSON.parse(getRequestInit()["body"] as string) as Record<string, unknown>;
    expect(body["temperature"]).toBe(0.5);
    expect(body["reasoning"]).toBeUndefined();
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
      output: [{ type: "message", content: [{ type: "output_text", text: "nested text" }] }],
    });

    const provider = new OpenAIProvider(makeConfig());
    const result = await provider.generateContent("sys", "prompt");
    expect(result).toBe("nested text");
  });

  it("extracts the message item for reasoning models (reasoning item precedes it)", async () => {
    // GPT-5.x / o-series responses emit a `reasoning` item FIRST, then the
    // `message` item. The old code read output[0] and got the (text-less)
    // reasoning item → empty string → "Failed to parse AI response".
    mockFetchOnce({
      output: [
        { type: "reasoning", id: "rs_1", summary: [] },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: '{"status":"PASS"}' }],
        },
      ],
      status: "completed",
    });

    const provider = new OpenAIProvider(makeConfig({ model: "gpt-5.2" }));
    const result = await provider.generateContent("sys", "prompt");
    expect(result).toBe('{"status":"PASS"}');
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
