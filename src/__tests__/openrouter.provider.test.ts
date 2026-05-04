/**
 * Unit tests for OpenRouterProvider
 * Tests the OpenAI-compatible REST endpoint implementation
 */

import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
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
    expect(models).toContain("anthropic/claude-opus-4-7");
    expect(models).toContain("google/gemini-3.1-pro-preview");
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

  it("probeEnvironment returns unavailable for malformed OpenRouter model ID", () => {
    process.env.OPENROUTER_API_KEY = "valid-key";
    const probe = AIConfig.probeEnvironment({
      provider: "openrouter",
      model: "bad/model/shape",
    });
    expect(probe.status).toBe("unavailable");
    expect(probe.status === "unavailable" ? probe.reason : "").toContain("Unsupported AI model");
  });

  it("probeEnvironment returns ready for valid OpenRouter ID with key", () => {
    process.env.OPENROUTER_API_KEY = "valid-key";
    const probe = AIConfig.probeEnvironment({
      provider: "openrouter",
      model: "openai/gpt-5.2",
    });
    expect(probe.status).toBe("ready");
  });

  it("probeEnvironment returns ready for OpenRouter model with :free suffix", () => {
    process.env.OPENROUTER_API_KEY = "valid-key";
    const probe = AIConfig.probeEnvironment({
      provider: "openrouter",
      model: "meta-llama/llama-3.2-3b-instruct:free",
    });
    expect(probe.status).toBe("ready");
  });
});

describe("AIConfig environment probing", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.AI_PROVIDER;
    delete process.env.AI_MODEL;
    delete process.env.AI_MODEL_TIER;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("getApiKey falls back to ANTHROPIC_AUTH_TOKEN", () => {
    process.env.ANTHROPIC_AUTH_TOKEN = "auth-token";
    expect(AIConfig.getApiKey("anthropic")).toBe("auth-token");
  });

  it("fromEnvironment accepts ANTHROPIC_AUTH_TOKEN for Anthropic", () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.AI_MODEL = "claude-sonnet-4-6";
    process.env.ANTHROPIC_AUTH_TOKEN = "auth-token";

    const config = AIConfig.fromEnvironment();
    expect(config.provider).toBe("anthropic");
    expect(config.model).toBe("claude-sonnet-4-6");
    expect(config.apiKey).toBe("auth-token");
  });

  it("probeEnvironment rejects unsupported provider models before API calls", () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.AI_MODEL = "not-a-real-model";
    process.env.ANTHROPIC_AUTH_TOKEN = "auth-token";

    const probe = AIConfig.probeEnvironment();
    expect(probe.status).toBe("unavailable");
    if (probe.status !== "unavailable") {
      throw new Error("Expected AI environment to be unavailable");
    }
    expect(probe.provider).toBe("anthropic");
    expect(probe.model).toBe("not-a-real-model");
    expect(probe.apiKeyPresent).toBe(true);
    expect(probe.reason).toContain("Unsupported AI model");
    expect(() => AIConfig.fromEnvironment()).toThrow(/Unsupported AI model/);
  });

  it("ANTHROPIC_API_KEY takes priority over ANTHROPIC_AUTH_TOKEN", () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.AI_MODEL = "claude-sonnet-4-6";
    process.env.ANTHROPIC_API_KEY = "primary-key";
    process.env.ANTHROPIC_AUTH_TOKEN = "fallback-token";

    const config = AIConfig.fromEnvironment();
    expect(config.provider).toBe("anthropic");
    expect(config.apiKey).toBe("primary-key");

    const probe = AIConfig.probeEnvironment();
    if (probe.status !== "ready") {
      throw new Error("Expected AI environment to be ready");
    }
    expect(probe.config.apiKey).toBe("primary-key");
  });

  it("probeEnvironment accepts any provider/model format for OpenRouter", () => {
    process.env.AI_PROVIDER = "openrouter";
    process.env.AI_MODEL = "moonshotai/kimi-k2.6";
    process.env.OPENROUTER_API_KEY = "test-key";

    const probe = AIConfig.probeEnvironment();
    expect(probe.status).toBe("ready");
    if (probe.status !== "ready") {
      throw new Error("Expected AI environment to be ready");
    }
    expect(probe.config.provider).toBe("openrouter");
    expect(probe.config.model).toBe("moonshotai/kimi-k2.6");
  });

  it("probeEnvironment rejects OpenRouter model without provider prefix", () => {
    process.env.AI_PROVIDER = "openrouter";
    process.env.AI_MODEL = "gpt-5.2";
    process.env.OPENROUTER_API_KEY = "test-key";

    const probe = AIConfig.probeEnvironment();
    expect(probe.status).toBe("unavailable");
    if (probe.status !== "unavailable") {
      throw new Error("Expected AI environment to be unavailable");
    }
    expect(probe.reason).toContain("Unsupported AI model");
  });

  // ── Model tier resolution tests ────────────────────────────────────

  it("probeEnvironment resolves model from tier when no explicit AI_MODEL is set", () => {
    process.env.AI_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "test-key";
    // No AI_MODEL set — tier selects first premium model
    const probe = AIConfig.probeEnvironment({ modelTier: "premium" });
    expect(probe.status).toBe("ready");
    if (probe.status !== "ready") throw new Error("Expected ready");
    expect(probe.config.model).toBe("gemini-3.1-pro-preview");
  });

  it("AI_MODEL overrides tier selection", () => {
    process.env.AI_PROVIDER = "gemini";
    process.env.AI_MODEL = "gemini-2.5-flash";
    process.env.GEMINI_API_KEY = "test-key";
    // Even with premium tier requested, explicit AI_MODEL wins
    const probe = AIConfig.probeEnvironment({ modelTier: "premium" });
    expect(probe.status).toBe("ready");
    if (probe.status !== "ready") throw new Error("Expected ready");
    expect(probe.config.model).toBe("gemini-2.5-flash");
  });

  it("AI_MODEL_TIER env var overrides config-provided modelTier", () => {
    process.env.AI_PROVIDER = "openai";
    process.env.AI_MODEL_TIER = "premium";
    process.env.OPENAI_API_KEY = "test-key";
    // config-provided tier is "budget" but env var "premium" wins
    const probe = AIConfig.probeEnvironment({ modelTier: "budget" });
    expect(probe.status).toBe("ready");
    if (probe.status !== "ready") throw new Error("Expected ready");
    expect(probe.config.model).toBe("gpt-5.5");
  });

  it("fromEnvironmentForProvider resolves model from tier when no explicit AI_MODEL", () => {
    process.env.AI_MODEL_TIER = "budget";
    process.env.GEMINI_API_KEY = "test-key";
    const config = AIConfig.fromEnvironmentForProvider("gemini");
    expect(config.model).toBe("gemini-3.1-flash-lite-preview");
  });

  it("fromEnvironmentForProvider uses default model when no tier or AI_MODEL set", () => {
    process.env.GEMINI_API_KEY = "test-key";
    const config = AIConfig.fromEnvironmentForProvider("gemini");
    expect(config.model).toBe("gemini-2.5-flash");
  });
});
