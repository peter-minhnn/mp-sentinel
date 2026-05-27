/**
 * Unit tests for token usage capture in providers and the aggregator.
 */

import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { AnthropicProvider } from "../services/ai/providers/anthropic.provider.js";
import { OpenAIProvider } from "../services/ai/providers/openai.provider.js";
import { GrokProvider } from "../services/ai/providers/grok.provider.js";
import { OpenRouterProvider } from "../services/ai/providers/openrouter.provider.js";
import { summarizeUsage } from "../services/ai/index.js";
import type { FileAuditResult } from "../types/index.js";

const mockFetch = jest.fn<typeof fetch>();
globalThis.fetch = mockFetch;

const jsonResponse = (body: unknown): Response => new Response(JSON.stringify(body));

beforeEach(() => {
  jest.clearAllMocks();
});

describe("AnthropicProvider.generate", () => {
  it("returns text + usage + finishReason from response", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        content: [{ type: "text", text: '{"status":"PASS","issues":[]}' }],
        usage: { input_tokens: 1234, output_tokens: 56 },
        stop_reason: "end_turn",
      }),
    );
    const provider = new AnthropicProvider({
      provider: "anthropic",
      apiKey: "k",
      model: "claude-sonnet-4-6",
    });
    const result = await provider.generate("sys", "user");
    expect(result.text).toBe('{"status":"PASS","issues":[]}');
    expect(result.usage).toEqual({ inputTokens: 1234, outputTokens: 56 });
    expect(result.finishReason).toBe("stop");
  });

  it("omits usage when the provider doesn't return token counts", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        content: [{ type: "text", text: "x" }],
        // no usage field
      }),
    );
    const provider = new AnthropicProvider({
      provider: "anthropic",
      apiKey: "k",
      model: "claude-sonnet-4-6",
    });
    const result = await provider.generate("s", "u");
    expect(result.usage).toBeUndefined();
  });
});

describe("OpenAIProvider.generate", () => {
  it("returns usage from OpenAI Responses API response", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        output_text: '{"status":"PASS","issues":[]}',
        usage: { input_tokens: 42, output_tokens: 7 },
        status: "completed",
      }),
    );
    const provider = new OpenAIProvider({ provider: "openai", apiKey: "k", model: "gpt-5.2" });
    const result = await provider.generate("s", "u");
    expect(result.usage).toEqual({ inputTokens: 42, outputTokens: 7 });
    expect(result.finishReason).toBe("stop");
  });
});

describe("GrokProvider.generate", () => {
  it("returns usage from chat-completions style response", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        choices: [{ message: { content: "x" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      }),
    );
    const provider = new GrokProvider({ provider: "grok", apiKey: "k", model: "grok-4" });
    const result = await provider.generate("s", "u");
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 2 });
  });
});

describe("OpenRouterProvider.generate", () => {
  it("returns usage from chat-completions style response", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        choices: [{ message: { content: "y" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 25 },
      }),
    );
    const provider = new OpenRouterProvider({
      provider: "openrouter",
      apiKey: "k",
      model: "openai/gpt-5.2",
    });
    const result = await provider.generate("s", "u");
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 25 });
  });
});

describe("summarizeUsage", () => {
  const mkResult = (inputTokens: number, outputTokens: number): FileAuditResult => ({
    filePath: "f.ts",
    result: {
      status: "PASS",
      issues: [],
      usage: { inputTokens, outputTokens },
    },
    duration: 0,
  });

  it("aggregates token counts across files with usage", () => {
    const summary = summarizeUsage([mkResult(10, 5), mkResult(20, 8)], "openai", "gpt-5.2");
    expect(summary).toBeDefined();
    expect(summary?.inputTokens).toBe(30);
    expect(summary?.outputTokens).toBe(13);
    expect(summary?.callCount).toBe(2);
    expect(typeof summary?.estimatedCostUsd).toBe("number");
  });

  it("ignores cached / no-usage results in callCount", () => {
    const cachedHit: FileAuditResult = {
      filePath: "a.ts",
      result: { status: "PASS", issues: [] },
      duration: 0,
      cached: true,
    };
    const summary = summarizeUsage([cachedHit, mkResult(10, 5)], "openai", "gpt-5.2");
    expect(summary?.callCount).toBe(1);
    expect(summary?.inputTokens).toBe(10);
  });

  it("returns undefined when no file reported usage", () => {
    const cachedOnly: FileAuditResult = {
      filePath: "a.ts",
      result: { status: "PASS", issues: [] },
      duration: 0,
      cached: true,
    };
    expect(summarizeUsage([cachedOnly], "openai", "gpt-5.2")).toBeUndefined();
  });

  it("omits estimatedCostUsd when model is unknown", () => {
    const summary = summarizeUsage([mkResult(100, 50)], "openai", "totally-made-up-model-x");
    expect(summary?.estimatedCostUsd).toBeUndefined();
    expect(summary?.callCount).toBe(1);
  });
});
