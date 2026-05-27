/**
 * Unit tests for AI provider pricing lookup and cost estimation.
 */

import { describe, expect, it } from "@jest/globals";
import { estimateCost, getModelPrice } from "../services/ai/pricing.js";

describe("getModelPrice", () => {
  it("returns exact price for known anthropic model", () => {
    const price = getModelPrice("anthropic", "claude-sonnet-4-6");
    expect(price).toEqual({ inputPerMillion: 3.0, outputPerMillion: 15.0 });
  });

  it("returns exact price for known openai model", () => {
    const price = getModelPrice("openai", "gpt-5.2");
    expect(price).toEqual({ inputPerMillion: 2.5, outputPerMillion: 10.0 });
  });

  it("falls back to family prefix for preview variants", () => {
    const price = getModelPrice("gemini", "gemini-2.5-flash-preview");
    expect(price).toEqual({ inputPerMillion: 0.3, outputPerMillion: 2.5 });
  });

  it("strips openrouter provider prefix before lookup", () => {
    const price = getModelPrice("openrouter", "anthropic/claude-opus-4-6");
    expect(price).toEqual({ inputPerMillion: 15.0, outputPerMillion: 75.0 });
  });

  it("returns undefined for unknown model", () => {
    expect(getModelPrice("openai", "totally-made-up-model-x")).toBeUndefined();
  });
});

describe("estimateCost", () => {
  it("computes USD cost from input/output tokens", () => {
    // gpt-5.2 = $2.5 in / $10 out per 1M
    // 1000 in @ 2.5 = 0.0025 ; 500 out @ 10 = 0.005 ; total = 0.0075
    const cost = estimateCost("openai", "gpt-5.2", {
      inputTokens: 1_000,
      outputTokens: 500,
    });
    expect(cost).toBeCloseTo(0.0075, 6);
  });

  it("returns undefined when usage is undefined", () => {
    expect(estimateCost("openai", "gpt-5.2", undefined)).toBeUndefined();
  });

  it("returns undefined when model is not in pricing table", () => {
    expect(
      estimateCost("openai", "totally-made-up-model-x", {
        inputTokens: 1000,
        outputTokens: 500,
      }),
    ).toBeUndefined();
  });

  it("computes zero cost for zero tokens", () => {
    expect(
      estimateCost("anthropic", "claude-sonnet-4-6", { inputTokens: 0, outputTokens: 0 }),
    ).toBe(0);
  });
});
