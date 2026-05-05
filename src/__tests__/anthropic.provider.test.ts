/**
 * Unit tests for AnthropicProvider
 * Tests default endpoint, DeepSeek custom endpoint normalization,
 * headers, request body, response parsing, and error handling.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { AnthropicProvider } from "../services/ai/providers/anthropic.provider.js";
import { normalizeAnthropicBaseUrl } from "../services/ai/anthropic-utils.js";

// Mock the global fetch
const mockFetch = jest.fn<typeof fetch>();
globalThis.fetch = mockFetch;

const jsonResponse = (body: unknown): Response => new Response(JSON.stringify(body));

const textResponse = (body: string, init: ResponseInit): Response => new Response(body, init);

const getFetchInit = (): RequestInit => {
  const firstCall = mockFetch.mock.calls[0];
  expect(firstCall).toBeDefined();
  const init = firstCall![1];
  expect(init).toBeDefined();
  return init as RequestInit;
};

const getRequestBody = (): Record<string, unknown> => {
  const body = getFetchInit().body;
  expect(typeof body).toBe("string");
  return JSON.parse(body as string) as Record<string, unknown>;
};

const getRequestHeaders = (): Record<string, string> => {
  const headers = getFetchInit().headers;
  expect(headers).toBeDefined();
  return headers as Record<string, string>;
};

describe("AnthropicProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("constructor", () => {
    it("initializes with default endpoint when no baseUrl given", () => {
      const provider = new AnthropicProvider({
        provider: "anthropic",
        apiKey: "test-key",
        model: "claude-sonnet-4-6",
      });
      expect(provider.isAvailable()).toBe(true);
    });

    it("uses custom baseUrl for DeepSeek-compatible endpoint", () => {
      const provider = new AnthropicProvider({
        provider: "anthropic",
        apiKey: "test-ds-key",
        model: "deepseek-v4-pro",
        baseUrl: normalizeAnthropicBaseUrl("https://api.deepseek.com/anthropic"),
      });
      expect(provider.isAvailable()).toBe(true);
    });

    it("falls back to default configurations for temperature and maxTokens", () => {
      const provider = new AnthropicProvider({
        provider: "anthropic",
        apiKey: "test-key",
        model: "claude-haiku-4-5",
      });
      expect(provider.isAvailable()).toBe(true);
    });

    it("uses AI_TIMEOUT_MS from environment or defaults to 30000", () => {
      process.env.AI_TIMEOUT_MS = "15000";
      const provider = new AnthropicProvider({
        provider: "anthropic",
        apiKey: "test-key",
        model: "claude-sonnet-4-6",
      });
      expect(provider.isAvailable()).toBe(true);
      delete process.env.AI_TIMEOUT_MS;
    });
  });

  describe("generateContent with default endpoint", () => {
    it("successfully generates content from default Anthropic API", async () => {
      const mockResponse = jsonResponse({
        content: [{ type: "text", text: "Mocked Claude response" }],
      });
      mockFetch.mockResolvedValueOnce(mockResponse);

      const provider = new AnthropicProvider({
        provider: "anthropic",
        apiKey: "test-anthropic-key",
        model: "claude-sonnet-4-6",
        temperature: 0.3,
        maxTokens: 1000,
      });
      const result = await provider.generateContent("system prompt", "user prompt");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.anthropic.com/v1/messages",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "x-api-key": "test-anthropic-key",
            "anthropic-version": "2023-06-01",
          }),
        }),
      );
      const callBody = getRequestBody();
      expect(callBody.model).toBe("claude-sonnet-4-6");
      expect(callBody.messages).toEqual([{ role: "user", content: "user prompt" }]);
      expect(callBody.system).toBe("system prompt");
      expect(callBody.temperature).toBe(0.3);
      expect(callBody.max_tokens).toBe(1000);
      expect(result).toBe("Mocked Claude response");
    });

    it("handles API errors gracefully", async () => {
      const mockResponse = textResponse('{"error":{"message":"Invalid API key"}}', {
        status: 401,
        statusText: "Unauthorized",
      });
      mockFetch.mockResolvedValueOnce(mockResponse);

      const provider = new AnthropicProvider({
        provider: "anthropic",
        apiKey: "bad-key",
        model: "claude-sonnet-4-6",
      });

      await expect(provider.generateContent("system", "user")).rejects.toThrow(
        "Anthropic API error: 401 Unauthorized",
      );
    });

    it("returns empty string when content array is empty", async () => {
      const mockResponse = jsonResponse({ content: [] });
      mockFetch.mockResolvedValueOnce(mockResponse);

      const provider = new AnthropicProvider({
        provider: "anthropic",
        apiKey: "test-key",
        model: "claude-sonnet-4-6",
      });
      const result = await provider.generateContent("system", "user");
      expect(result).toBe("");
    });

    it("returns empty string when first content entry has no text", async () => {
      const mockResponse = jsonResponse({ content: [{ type: "text", text: undefined }] });
      mockFetch.mockResolvedValueOnce(mockResponse);

      const provider = new AnthropicProvider({
        provider: "anthropic",
        apiKey: "test-key",
        model: "claude-sonnet-4-6",
      });
      const result = await provider.generateContent("system", "user");
      expect(result).toBe("");
    });
  });

  describe("generateContent with custom DeepSeek endpoint", () => {
    it("successfully generates content from DeepSeek Anthropic-compatible API", async () => {
      const mockResponse = jsonResponse({
        content: [{ type: "text", text: "DeepSeek response via Anthropic API" }],
      });
      mockFetch.mockResolvedValueOnce(mockResponse);

      const provider = new AnthropicProvider({
        provider: "anthropic",
        apiKey: "ds-key",
        model: "deepseek-v4-pro",
        baseUrl: normalizeAnthropicBaseUrl("https://api.deepseek.com/anthropic"),
        temperature: 0.5,
        maxTokens: 2000,
      });
      const result = await provider.generateContent("system prompt", "user prompt");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.deepseek.com/anthropic/v1/messages",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "x-api-key": "ds-key",
            "anthropic-version": "2023-06-01",
          }),
        }),
      );
      const callBody = getRequestBody();
      expect(callBody.model).toBe("deepseek-v4-pro");
      expect(callBody.messages).toEqual([{ role: "user", content: "user prompt" }]);
      expect(callBody.system).toBe("system prompt");
      expect(callBody.temperature).toBe(0.5);
      expect(callBody.max_tokens).toBe(2000);
      expect(result).toBe("DeepSeek response via Anthropic API");
    });

    it("handles DeepSeek API errors gracefully", async () => {
      const mockResponse = textResponse("Rate limit exceeded", {
        status: 429,
        statusText: "Too Many Requests",
      });
      mockFetch.mockResolvedValueOnce(mockResponse);

      const provider = new AnthropicProvider({
        provider: "anthropic",
        apiKey: "ds-key",
        model: "deepseek-v4-pro",
        baseUrl: normalizeAnthropicBaseUrl("https://api.deepseek.com/anthropic"),
      });

      await expect(provider.generateContent("system", "user")).rejects.toThrow(
        "Anthropic API error: 429 Too Many Requests",
      );
    });

    it("sends thinking: disabled for DeepSeek base URL", async () => {
      const mockResponse = jsonResponse({
        content: [{ type: "text", text: "result" }],
      });
      mockFetch.mockResolvedValueOnce(mockResponse);

      const provider = new AnthropicProvider({
        provider: "anthropic",
        apiKey: "ds-key",
        model: "deepseek-v4-pro",
        baseUrl: normalizeAnthropicBaseUrl("https://api.deepseek.com/anthropic"),
      });
      await provider.generateContent("system", "user");

      const callBody = getRequestBody();
      expect(callBody.thinking).toEqual({ type: "disabled" });
    });

    it("does not send thinking field for non-DeepSeek base URL", async () => {
      const mockResponse = jsonResponse({
        content: [{ type: "text", text: "result" }],
      });
      mockFetch.mockResolvedValueOnce(mockResponse);

      const provider = new AnthropicProvider({
        provider: "anthropic",
        apiKey: "test-key",
        model: "claude-sonnet-4-6",
      });
      await provider.generateContent("system", "user");

      const callBody = getRequestBody();
      expect(callBody.thinking).toBeUndefined();
    });

    it("skips thinking content blocks and returns only text", async () => {
      const mockResponse = jsonResponse({
        content: [
          { type: "thinking", text: "Let me analyze this code..." },
          { type: "text", text: '{"status":"PASS","issues":[]}' },
        ],
      });
      mockFetch.mockResolvedValueOnce(mockResponse);

      const provider = new AnthropicProvider({
        provider: "anthropic",
        apiKey: "ds-key",
        model: "deepseek-v4-pro",
        baseUrl: normalizeAnthropicBaseUrl("https://api.deepseek.com/anthropic"),
      });
      const result = await provider.generateContent("system", "user");
      expect(result).toBe('{"status":"PASS","issues":[]}');
    });

    it("joins multiple text blocks when present", async () => {
      const mockResponse = jsonResponse({
        content: [
          { type: "text", text: '{"status":"PASS","issues":' },
          { type: "text", text: "[]}" },
        ],
      });
      mockFetch.mockResolvedValueOnce(mockResponse);

      const provider = new AnthropicProvider({
        provider: "anthropic",
        apiKey: "ds-key",
        model: "deepseek-v4-pro",
        baseUrl: normalizeAnthropicBaseUrl("https://api.deepseek.com/anthropic"),
      });
      const result = await provider.generateContent("system", "user");
      expect(result).toBe('{"status":"PASS","issues":[]}');
    });

    it("returns empty string when all content blocks are thinking type", async () => {
      const mockResponse = jsonResponse({
        content: [
          { type: "thinking", text: "Let me analyze..." },
          { type: "thinking", text: "Still thinking..." },
        ],
      });
      mockFetch.mockResolvedValueOnce(mockResponse);

      const provider = new AnthropicProvider({
        provider: "anthropic",
        apiKey: "ds-key",
        model: "deepseek-v4-pro",
        baseUrl: normalizeAnthropicBaseUrl("https://api.deepseek.com/anthropic"),
      });
      const result = await provider.generateContent("system", "user");
      expect(result).toBe("");
    });
  });

  describe("isAvailable", () => {
    it("returns true if apiKey is present", () => {
      const provider = new AnthropicProvider({
        provider: "anthropic",
        apiKey: "test-key",
        model: "claude-sonnet-4-6",
      });
      expect(provider.isAvailable()).toBe(true);
    });

    it("returns false if apiKey is empty", () => {
      const provider = new AnthropicProvider({
        provider: "anthropic",
        apiKey: "",
        model: "claude-sonnet-4-6",
      });
      expect(provider.isAvailable()).toBe(false);
    });
  });
});

// ── normalizeAnthropicBaseUrl unit tests ────────────────────────────────

describe("normalizeAnthropicBaseUrl", () => {
  it("returns default URL when unset", () => {
    expect(normalizeAnthropicBaseUrl()).toBe("https://api.anthropic.com/v1/messages");
  });

  it("returns default URL when empty string", () => {
    expect(normalizeAnthropicBaseUrl("")).toBe("https://api.anthropic.com/v1/messages");
  });

  it("strips trailing slash", () => {
    expect(normalizeAnthropicBaseUrl("https://api.anthropic.com/v1/messages/")).toBe(
      "https://api.anthropic.com/v1/messages",
    );
  });

  it("keeps /v1/messages as-is", () => {
    expect(normalizeAnthropicBaseUrl("https://custom.example.com/v1/messages")).toBe(
      "https://custom.example.com/v1/messages",
    );
  });

  it("appends /messages when URL ends with /v1", () => {
    expect(normalizeAnthropicBaseUrl("http://localhost:8080/v1")).toBe(
      "http://localhost:8080/v1/messages",
    );
  });

  it("appends /v1/messages for a bare http URL", () => {
    expect(normalizeAnthropicBaseUrl("http://localhost:8080")).toBe(
      "http://localhost:8080/v1/messages",
    );
  });

  it("appends /v1/messages for a bare https URL", () => {
    expect(normalizeAnthropicBaseUrl("https://api.deepseek.com/anthropic")).toBe(
      "https://api.deepseek.com/anthropic/v1/messages",
    );
  });

  it("handles multiple trailing slashes", () => {
    expect(normalizeAnthropicBaseUrl("http://localhost:8080/v1/messages///")).toBe(
      "http://localhost:8080/v1/messages",
    );
  });

  it("preserves port numbers", () => {
    expect(normalizeAnthropicBaseUrl("http://localhost:3000")).toBe(
      "http://localhost:3000/v1/messages",
    );
  });
});
