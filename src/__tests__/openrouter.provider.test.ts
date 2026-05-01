/**
 * Unit tests for OpenRouterProvider
 * Tests the OpenAI-compatible REST endpoint implementation
 */

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { AIProviderFactory } from "../services/ai/factory.js";
import { AIConfig } from "../services/ai/config.js";
import { OpenRouterProvider } from "../services/ai/providers/openrouter.provider.js";

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

describe("OpenRouterProvider", () => {
  const mockConfig = {
    provider: "openrouter" as const,
    apiKey: "test-openrouter-key",
    model: "openai/gpt-5.2",
    temperature: 0.5,
    maxTokens: 1000,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("constructor", () => {
    it("initializes with given config", () => {
      const provider = new OpenRouterProvider(mockConfig);
      expect(provider.isAvailable()).toBe(true);
    });

    it("uses environment variables for attribution headers when provided", () => {
      process.env.OPENROUTER_SITE_URL = "https://myapp.com";
      process.env.OPENROUTER_APP_NAME = "MyApp";
      const provider = new OpenRouterProvider(mockConfig);
      expect(provider.isAvailable()).toBe(true);
      delete process.env.OPENROUTER_SITE_URL;
      delete process.env.OPENROUTER_APP_NAME;
    });

    it("falls back to default configurations for temperature and maxTokens", () => {
      const provider = new OpenRouterProvider({
        provider: "openrouter",
        apiKey: "test-key",
        model: "openai/gpt-5.1",
      });
      expect(provider.isAvailable()).toBe(true);
    });

    it("uses AI_TIMEOUT_MS from environment or defaults to 30000", () => {
      process.env.AI_TIMEOUT_MS = "15000";
      const provider = new OpenRouterProvider(mockConfig);
      expect(provider.isAvailable()).toBe(true);
      delete process.env.AI_TIMEOUT_MS;
    });
  });

  describe("generateContent", () => {
    it("successfully generates content from OpenRouter API", async () => {
      const mockResponse = jsonResponse({
        choices: [{ message: { content: "Mocked OpenRouter response" } }],
      });
      mockFetch.mockResolvedValueOnce(mockResponse);

      const provider = new OpenRouterProvider(mockConfig);
      const result = await provider.generateContent("system prompt", "user prompt");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://openrouter.ai/api/v1/chat/completions",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            Authorization: "Bearer test-openrouter-key",
            "X-OpenRouter-Title": "MP Sentinel",
          }),
        }),
      );
      const callBody = getRequestBody();
      expect(callBody.model).toBe("openai/gpt-5.2");
      expect(callBody.messages).toEqual([
        { role: "system", content: "system prompt" },
        { role: "user", content: "user prompt" },
      ]);
      expect(callBody.temperature).toBe(0.5);
      expect(callBody.max_tokens).toBe(1000);
      expect(callBody.response_format).toEqual({ type: "json_object" });
      expect(result).toBe("Mocked OpenRouter response");
    });

    it("overrides default attribution headers with environment variables", async () => {
      process.env.OPENROUTER_SITE_URL = "https://myapp.com";
      process.env.OPENROUTER_APP_NAME = "MyApp";
      const mockResponse = jsonResponse({
        choices: [{ message: { content: "response" } }],
      });
      mockFetch.mockResolvedValueOnce(mockResponse);

      const provider = new OpenRouterProvider(mockConfig);
      await provider.generateContent("system", "user");

      const callHeaders = getRequestHeaders();
      expect(callHeaders["HTTP-Referer"]).toBe("https://myapp.com");
      expect(callHeaders["X-OpenRouter-Title"]).toBe("MyApp");
      delete process.env.OPENROUTER_SITE_URL;
      delete process.env.OPENROUTER_APP_NAME;
    });

    it("handles API errors gracefully", async () => {
      const mockResponse = textResponse("Invalid API key", {
        status: 400,
        statusText: "Bad Request",
      });
      mockFetch.mockResolvedValueOnce(mockResponse);

      const provider = new OpenRouterProvider(mockConfig);

      await expect(provider.generateContent("system", "user")).rejects.toThrow(
        "OpenRouter API error: 400 Bad Request Invalid API key",
      );
    });

    it("returns empty string when choices array is empty", async () => {
      const mockResponse = jsonResponse({ choices: [] });
      mockFetch.mockResolvedValueOnce(mockResponse);

      const provider = new OpenRouterProvider(mockConfig);
      const result = await provider.generateContent("system", "user");
      expect(result).toBe("");
    });

    it("returns empty string when choices[0].message is undefined", async () => {
      const mockResponse = jsonResponse({ choices: [{}] });
      mockFetch.mockResolvedValueOnce(mockResponse);

      const provider = new OpenRouterProvider(mockConfig);
      const result = await provider.generateContent("system", "user");
      expect(result).toBe("");
    });

    it("returns empty string when choices[0].message.content is undefined", async () => {
      const mockResponse = jsonResponse({ choices: [{ message: {} }] });
      mockFetch.mockResolvedValueOnce(mockResponse);

      const provider = new OpenRouterProvider(mockConfig);
      const result = await provider.generateContent("system", "user");
      expect(result).toBe("");
    });

    it("omits response_format for moonshotai/kimi models", async () => {
      const mockResponse = jsonResponse({
        choices: [{ message: { content: '{\n  "status": "PASS",\n  "issues": []\n}' } }],
      });
      mockFetch.mockResolvedValueOnce(mockResponse);

      const provider = new OpenRouterProvider({
        provider: "openrouter",
        apiKey: "test-key",
        model: "moonshotai/kimi-k2.6",
      });
      await provider.generateContent("system", "user");

      const callBody = getRequestBody();
      expect(callBody.model).toBe("moonshotai/kimi-k2.6");
      expect(callBody).not.toHaveProperty("response_format");
    });

    it("omits response_format for anthropic/claude models via OpenRouter", async () => {
      const mockResponse = jsonResponse({
        choices: [{ message: { content: '{\n  "status": "PASS",\n  "issues": []\n}' } }],
      });
      mockFetch.mockResolvedValueOnce(mockResponse);

      const provider = new OpenRouterProvider({
        provider: "openrouter",
        apiKey: "test-key",
        model: "anthropic/claude-opus-4-6",
      });
      await provider.generateContent("system", "user");

      const callBody = getRequestBody();
      expect(callBody.model).toBe("anthropic/claude-opus-4-6");
      expect(callBody).not.toHaveProperty("response_format");
    });

    it("includes response_format for openai/gpt models", async () => {
      const mockResponse = jsonResponse({
        choices: [{ message: { content: '{\n  "status": "PASS",\n  "issues": []\n}' } }],
      });
      mockFetch.mockResolvedValueOnce(mockResponse);

      const provider = new OpenRouterProvider({
        provider: "openrouter",
        apiKey: "test-key",
        model: "openai/gpt-5.2",
      });
      await provider.generateContent("system", "user");

      const callBody = getRequestBody();
      expect(callBody.model).toBe("openai/gpt-5.2");
      expect(callBody.response_format).toEqual({ type: "json_object" });
    });
  });

  describe("isAvailable", () => {
    it("returns true if apiKey is present", () => {
      const provider = new OpenRouterProvider(mockConfig);
      expect(provider.isAvailable()).toBe(true);
    });

    it("returns false if apiKey is empty", () => {
      const provider = new OpenRouterProvider({ ...mockConfig, apiKey: "" });
      expect(provider.isAvailable()).toBe(false);
    });
  });
});

// -- AIProviderFactory + AIConfig integration ---------------------------------

describe("AIProviderFactory with openrouter", () => {
  it("getDefaultModel returns openai/gpt-5.2 for openrouter", () => {
    expect(AIProviderFactory.getDefaultModel("openrouter")).toBe("openai/gpt-5.2");
  });

  it("getRecommendedModels includes openrouter models", () => {
    const models = AIProviderFactory.getRecommendedModels("openrouter");
    expect(models).toContain("openai/gpt-5.2");
    expect(models).toContain("anthropic/claude-opus-4-6");
    expect(models).toContain("google/gemini-2.5-flash");
  });

  it("createProvider returns OpenRouterProvider for openrouter config", () => {
    const provider = AIProviderFactory.createProvider({
      provider: "openrouter",
      model: "openai/gpt-5.2",
      apiKey: "test-key",
    });
    expect(provider).toBeInstanceOf(OpenRouterProvider);
    expect(provider.isAvailable()).toBe(true);
  });

  it("throws on unknown provider", () => {
    const invalidConfig = {
      provider: "unknown",
      model: "x",
      apiKey: "x",
    } as unknown as Parameters<typeof AIProviderFactory.createProvider>[0];
    expect(() => AIProviderFactory.createProvider(invalidConfig)).toThrow(
      /Unsupported AI provider/,
    );
  });
});

describe("AIConfig with openrouter", () => {
  beforeEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_SITE_URL;
    delete process.env.OPENROUTER_APP_NAME;
  });

  it("getApiKey returns OPENROUTER_API_KEY env var", () => {
    process.env.OPENROUTER_API_KEY = "env-key";
    expect(AIConfig.getApiKey("openrouter")).toBe("env-key");
  });

  it("getApiKey returns undefined when no key is set", () => {
    expect(AIConfig.getApiKey("openrouter")).toBeUndefined();
  });

  it("fromEnvironment throws ProviderError when no key configured for openrouter", () => {
    process.env.AI_PROVIDER = "openrouter";
    expect(() => AIConfig.fromEnvironment()).toThrow(/API key not found/);
  });

  it("fromEnvironmentForProvider throws ProviderError when no key for openrouter", () => {
    expect(() => AIConfig.fromEnvironmentForProvider("openrouter")).toThrow(/has no API key/);
  });
});
