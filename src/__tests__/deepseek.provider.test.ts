import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { DeepSeekProvider } from "../services/ai/providers/deepseek.provider.js";
import type { AIResponseSchema } from "../services/ai/types.js";

// Mock the global fetch
const mockFetch = jest.fn() as jest.Mock<any>;
global.fetch = mockFetch;

const schema: AIResponseSchema = {
  name: "audit",
  schema: { type: "object" },
};

describe("DeepSeekProvider", () => {
  const mockConfig = {
    provider: "deepseek" as const,
    apiKey: "test-deepseek-key",
    model: "deepseek-v4-pro",
    temperature: 0,
    maxTokens: 8192,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.DEEPSEEK_BASE_URL;
    delete process.env.DEEPSEEK_THINKING;
  });

  describe("constructor", () => {
    it("initializes with given config", () => {
      const provider = new DeepSeekProvider(mockConfig);
      expect(provider.isAvailable()).toBe(true);
    });

    it("falls back to defaults when temperature/maxTokens omitted", () => {
      const provider = new DeepSeekProvider({
        provider: "deepseek",
        apiKey: "k",
        model: "deepseek-v4-pro",
      });
      expect(provider.isAvailable()).toBe(true);
    });
  });

  describe("generate", () => {
    it("POSTs to the default chat-completions endpoint with auth", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '{"status":"PASS"}' } }] }),
      });

      const provider = new DeepSeekProvider(mockConfig);
      const result = await provider.generate("system", "user");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.deepseek.com/chat/completions");
      expect((init.headers as Record<string, string>).Authorization).toBe(
        "Bearer test-deepseek-key",
      );
      expect(result.text).toBe('{"status":"PASS"}');
    });

    it("sends temperature 0 and enables thinking with headroom by default", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "{}" } }] }),
      });

      await new DeepSeekProvider(mockConfig).generate("system", "user");

      const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
      expect(body.temperature).toBe(0);
      expect(body.thinking).toEqual({ type: "enabled" });
      // thinking mode floors max_tokens so the reasoning trace can't starve the answer
      expect(body.max_tokens).toBe(16000);
    });

    it("disables thinking when DEEPSEEK_THINKING=disabled (uses configured max_tokens)", async () => {
      process.env.DEEPSEEK_THINKING = "disabled";
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "{}" } }] }),
      });

      await new DeepSeekProvider(mockConfig).generate("system", "user");

      const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
      expect(body.thinking).toEqual({ type: "disabled" });
      expect(body.max_tokens).toBe(8192);
    });

    it("enables json_object mode only when a response schema is provided", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ choices: [{ message: { content: "{}" } }] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ choices: [{ message: { content: "{}" } }] }),
        });

      const provider = new DeepSeekProvider(mockConfig);

      await provider.generate("system", "user", schema);
      const withSchema = JSON.parse(
        (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string,
      );
      expect(withSchema.response_format).toEqual({ type: "json_object" });

      await provider.generate("system", "user");
      const withoutSchema = JSON.parse(
        (mockFetch.mock.calls[1] as [string, RequestInit])[1].body as string,
      );
      expect(withoutSchema.response_format).toBeUndefined();
    });

    it("never sends a seed (DeepSeek has no seed parameter)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "{}" } }] }),
      });

      await new DeepSeekProvider({ ...mockConfig, seed: 42 }).generate("system", "user");

      const body = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
      expect(body.seed).toBeUndefined();
    });

    it("honors DEEPSEEK_BASE_URL and normalizes to the completions path", async () => {
      process.env.DEEPSEEK_BASE_URL = "https://proxy.example.com/v1";
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "{}" } }] }),
      });

      await new DeepSeekProvider(mockConfig).generate("system", "user");

      expect((mockFetch.mock.calls[0] as [string])[0]).toBe(
        "https://proxy.example.com/v1/chat/completions",
      );
    });

    it("throws a descriptive error on non-ok responses", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => "bad key",
      });

      await expect(new DeepSeekProvider(mockConfig).generate("s", "u")).rejects.toThrow(
        "DeepSeek API error: 401 Unauthorized bad key",
      );
    });
  });

  describe("isAvailable", () => {
    it("returns false when apiKey is empty", () => {
      expect(new DeepSeekProvider({ ...mockConfig, apiKey: "" }).isAvailable()).toBe(false);
    });
  });
});
