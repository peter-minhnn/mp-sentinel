/**
 * Unit tests for GeminiProvider (@google/genai SDK).
 * Mocks the SDK to verify request shape, config passthrough, and error handling.
 */

// Minimal mock type for the generateContent function.
// Using Record<string, unknown> avoids any casts on mock call args.
const mockGenContent =
  jest.fn<(systemPrompt: string, userPrompt: string) => Promise<{ text: string | null }>>();

jest.unstable_mockModule("@google/genai", () => ({
  GoogleGenAI: jest.fn(() => ({
    models: { generateContent: mockGenContent },
  })),
}));

import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import type { IAIProvider, AIModelConfig } from "../services/ai/types.js";

const { GeminiProvider } = await import("../services/ai/providers/gemini.provider.js");

const makeConfig = (overrides: Partial<AIModelConfig> = {}): AIModelConfig => ({
  provider: "gemini",
  model: "gemini-2.5-flash",
  apiKey: "test-key",
  temperature: 0.3,
  maxTokens: 4096,
  ...overrides,
});

describe("GeminiProvider", () => {
  beforeEach(() => {
    mockGenContent.mockReset();
  });

  // ── Constructor / isAvailable ──────────────────────────────────────

  it("isAvailable returns true when API key is set", () => {
    const provider = new (GeminiProvider as new (config: AIModelConfig) => IAIProvider)(
      makeConfig({ apiKey: "valid-key" }),
    );
    expect(provider.isAvailable()).toBe(true);
  });

  it("isAvailable returns false when API key is empty", () => {
    const provider = new (GeminiProvider as new (config: AIModelConfig) => IAIProvider)(
      makeConfig({ apiKey: "" }),
    );
    expect(provider.isAvailable()).toBe(false);
  });

  // ── generateContent request shape ──────────────────────────────────

  it("passes model, contents, systemInstruction, temperature, and maxOutputTokens", async () => {
    mockGenContent.mockResolvedValue({ text: "response text" });

    const provider = new (GeminiProvider as new (config: AIModelConfig) => IAIProvider)(
      makeConfig({ temperature: 0.5, maxTokens: 2048 }),
    );
    await provider.generateContent("You are a code reviewer", "const x = 1;");

    expect(mockGenContent).toHaveBeenCalledTimes(1);
    const callArg = mockGenContent.mock.calls[0]?.[0] as unknown as Record<string, unknown>;
    expect(callArg?.model).toBe("gemini-2.5-flash");
    expect(callArg?.contents).toBe("const x = 1;");
    expect(callArg?.config).toMatchObject({
      systemInstruction: "You are a code reviewer",
      temperature: 0.5,
      maxOutputTokens: 2048,
    });
  });

  it("passes abortSignal in config when timeout is set", async () => {
    mockGenContent.mockResolvedValue({ text: "done" });

    const provider = new (GeminiProvider as new (config: AIModelConfig) => IAIProvider)(
      makeConfig(),
    );
    await provider.generateContent("sys", "prompt");

    const callArg = mockGenContent.mock.calls[0]?.[0] as unknown as Record<string, unknown>;
    const config = callArg?.config as Record<string, unknown>;
    expect(config?.abortSignal).toBeInstanceOf(AbortSignal);
  });

  // ── Response parsing ───────────────────────────────────────────────

  it("returns result.text when present", async () => {
    mockGenContent.mockResolvedValue({ text: "audit result" });

    const provider = new (GeminiProvider as new (config: AIModelConfig) => IAIProvider)(
      makeConfig(),
    );
    const result = await provider.generateContent("sys", "prompt");
    expect(result).toBe("audit result");
  });

  it("returns empty string when result.text is null or undefined", async () => {
    // eslint-disable-next-line @typescript-eslint/no-loss-of-precision
    mockGenContent.mockResolvedValue({ text: null });

    const provider = new (GeminiProvider as new (config: AIModelConfig) => IAIProvider)(
      makeConfig(),
    );
    const result = await provider.generateContent("sys", "prompt");
    expect(result).toBe("");
  });

  // ── Error handling ─────────────────────────────────────────────────

  it("throws when the underlying SDK call rejects", async () => {
    mockGenContent.mockRejectedValue(new Error("API error"));

    const provider = new (GeminiProvider as new (config: AIModelConfig) => IAIProvider)(
      makeConfig(),
    );
    await expect(provider.generateContent("sys", "prompt")).rejects.toThrow("API error");
  });
});
