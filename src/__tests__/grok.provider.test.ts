import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { GrokProvider } from "../services/ai/providers/grok.provider.js";

// Mock the global fetch
const mockFetch = jest.fn() as jest.Mock<any>;
global.fetch = mockFetch;

describe("GrokProvider", () => {
  const mockConfig = {
    provider: "grok" as const,
    apiKey: "test-grok-key",
    model: "grok-4-1-fast-reasoning",
    temperature: 0.5,
    maxTokens: 1000,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("constructor", () => {
    it("initializes with given config", () => {
      const provider = new GrokProvider(mockConfig);
      expect(provider.isAvailable()).toBe(true);
    });

    it("falls back to default configurations", () => {
      const provider = new GrokProvider({ provider: "grok", apiKey: "test-key", model: "grok-4" });
      expect(provider.isAvailable()).toBe(true);
    });
  });

  describe("generateContent", () => {
    it("successfully generates content from Grok API", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Mocked Grok response" } }],
        }),
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      const provider = new GrokProvider(mockConfig);
      const result = await provider.generateContent("system prompt", "user prompt");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.x.ai/v1/chat/completions",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer test-grok-key",
          },
        }),
      );
      expect(result).toBe("Mocked Grok response");
    });

    it("handles API errors gracefully", async () => {
      const mockResponse = {
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: async () => "Invalid model name",
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      const provider = new GrokProvider(mockConfig);

      await expect(provider.generateContent("system", "user")).rejects.toThrow(
        "Grok API error: 400 Bad Request Invalid model name",
      );
    });
  });

  describe("isAvailable", () => {
    it("returns true if apiKey is present", () => {
      const provider = new GrokProvider(mockConfig);
      expect(provider.isAvailable()).toBe(true);
    });

    it("returns false if apiKey is empty", () => {
      const provider = new GrokProvider({ ...mockConfig, apiKey: "" });
      expect(provider.isAvailable()).toBe(false);
    });
  });
});
