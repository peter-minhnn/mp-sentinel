/**
 * Unit tests for AIProviderFactory model tier catalog.
 * Verifies tier definitions, recommended ordering, and model validation.
 */

import { describe, it, expect } from "@jest/globals";
import { AIProviderFactory } from "../services/ai/factory.js";
import type { AIProvider } from "../services/ai/types.js";

type ModelTiers = {
  premium: string[];
  balanced: string[];
  budget: string[];
};

const allProviders: AIProvider[] = ["gemini", "openai", "anthropic", "grok", "openrouter"];

const directProviders: AIProvider[] = ["gemini", "openai", "anthropic", "grok"];

describe("AIProviderFactory model tiers", () => {
  // ── Tier structure tests ───────────────────────────────────────────────

  it.each(allProviders)(
    "getModelTiers(%s) returns premium, balanced, and budget arrays",
    (provider) => {
      const tiers = AIProviderFactory.getModelTiers(provider) as ModelTiers;
      expect(Array.isArray(tiers.premium)).toBe(true);
      expect(Array.isArray(tiers.balanced)).toBe(true);
      expect(Array.isArray(tiers.budget)).toBe(true);
    },
  );

  it.each(allProviders)("getModelTiers(%s) has at least one balanced model", (provider) => {
    const tiers = AIProviderFactory.getModelTiers(provider) as ModelTiers;
    expect(tiers.balanced.length).toBeGreaterThanOrEqual(1);
  });

  it.each(allProviders)("getPremiumModels(%s) returns the premium array", (provider) => {
    const premium = AIProviderFactory.getPremiumModels(provider);
    const tiers = AIProviderFactory.getModelTiers(provider) as ModelTiers;
    expect(premium).toEqual(tiers.premium);
  });

  it.each(allProviders)("getPremiumModels(%s) has at least one model", (provider) => {
    const premium = AIProviderFactory.getPremiumModels(provider);
    expect(premium.length).toBeGreaterThanOrEqual(1);
  });

  // ── Default is included in its tier catalog ────────────────────────────

  it.each(allProviders)(
    "getDefaultModel(%s) is included in its provider's tier catalog",
    (provider) => {
      const defaultModel = AIProviderFactory.getDefaultModel(provider);
      const tiers = AIProviderFactory.getModelTiers(provider) as ModelTiers;
      const allModels = [...tiers.premium, ...tiers.balanced, ...tiers.budget];
      expect(allModels).toContain(defaultModel);
    },
  );

  // ── Recommended order: premium before balanced before budget ───────────

  it.each(allProviders)(
    "getRecommendedModels(%s) lists premium first, then balanced, then budget",
    (provider) => {
      const recommended = AIProviderFactory.getRecommendedModels(provider);
      const tiers = AIProviderFactory.getModelTiers(provider) as ModelTiers;

      // Build the expected flattened order
      const expected = [...tiers.premium, ...tiers.balanced, ...tiers.budget];
      expect(recommended).toEqual(expected);
    },
  );

  // ── isSupportedModel: direct providers accept catalog models ───────────

  it.each(directProviders)(
    "isSupportedModel(%s) accepts every model in its catalog",
    (provider) => {
      const tiers = AIProviderFactory.getModelTiers(provider) as ModelTiers;
      const allModels = [...tiers.premium, ...tiers.balanced, ...tiers.budget];
      for (const model of allModels) {
        expect(AIProviderFactory.isSupportedModel(provider, model)).toBe(true);
      }
    },
  );

  it.each(directProviders)("isSupportedModel(%s) rejects unknown models", (provider) => {
    expect(AIProviderFactory.isSupportedModel(provider, "unknown-model-v42")).toBe(false);
    expect(AIProviderFactory.isSupportedModel(provider, "")).toBe(false);
  });

  // ── isSupportedModel: OpenRouter accepts slash-form ────────────────────

  it("isSupportedModel(openrouter) accepts slash-form models", () => {
    expect(AIProviderFactory.isSupportedModel("openrouter", "openai/gpt-5.2")).toBe(true);
    expect(AIProviderFactory.isSupportedModel("openrouter", "anthropic/claude-opus-4-7")).toBe(
      true,
    );
    expect(AIProviderFactory.isSupportedModel("openrouter", "google/gemini-3.1-pro-preview")).toBe(
      true,
    );
    expect(AIProviderFactory.isSupportedModel("openrouter", "x-ai/grok-4.3")).toBe(true);
  });

  it("isSupportedModel(openrouter) rejects non-slash-form models", () => {
    expect(AIProviderFactory.isSupportedModel("openrouter", "gpt-5.2")).toBe(false);
    expect(AIProviderFactory.isSupportedModel("openrouter", "claude-opus-4-7")).toBe(false);
    expect(AIProviderFactory.isSupportedModel("openrouter", "")).toBe(false);
  });

  // ── OpenRouter malformed ID rejection ─────────────────────────────────

  it("isSupportedModel(openrouter) rejects leading slash", () => {
    expect(AIProviderFactory.isSupportedModel("openrouter", "/gpt-5.2")).toBe(false);
  });

  it("isSupportedModel(openrouter) rejects trailing slash", () => {
    expect(AIProviderFactory.isSupportedModel("openrouter", "openai/")).toBe(false);
  });

  it("isSupportedModel(openrouter) rejects whitespace in model ID", () => {
    expect(AIProviderFactory.isSupportedModel("openrouter", "openai/gpt 5")).toBe(false);
  });

  it("isSupportedModel(openrouter) rejects multiple slashes", () => {
    expect(AIProviderFactory.isSupportedModel("openrouter", "openai/gpt/5")).toBe(false);
  });

  it("isSupportedModel(openrouter) accepts valid model with :free suffix", () => {
    expect(
      AIProviderFactory.isSupportedModel("openrouter", "meta-llama/llama-3.2-3b-instruct:free"),
    ).toBe(true);
  });

  it("isSupportedModel(openrouter) rejects empty variant suffix (trailing colon)", () => {
    expect(AIProviderFactory.isSupportedModel("openrouter", "openai/gpt-5.2:")).toBe(false);
  });

  it("isSupportedModel(openrouter) rejects multiple colons in model portion", () => {
    expect(AIProviderFactory.isSupportedModel("openrouter", "openai/gpt-5.2:a:b")).toBe(false);
  });

  // ── Mutation safety ─────────────────────────────────────────────────

  it("mutating an array from getModelTiers() does not affect subsequent calls", () => {
    const tiersA = AIProviderFactory.getModelTiers("openai") as ModelTiers;
    const tiersB = AIProviderFactory.getModelTiers("openai") as ModelTiers;

    // Mutate tiersA
    tiersA.premium.push("mutation-test");
    tiersA.balanced.length = 0;
    tiersA.budget.splice(0);

    // tiersB should be unchanged
    expect(tiersB.premium).not.toContain("mutation-test");
    expect(tiersB.balanced.length).toBeGreaterThanOrEqual(1);
    expect(tiersB.budget).not.toHaveLength(0);
  });

  it("mutating array from getPremiumModels() does not affect getRecommendedModels()", () => {
    const premium = AIProviderFactory.getPremiumModels("anthropic");
    const before = AIProviderFactory.getRecommendedModels("anthropic");

    // Mutate the returned array
    premium.push("not-a-real-model");

    const after = AIProviderFactory.getRecommendedModels("anthropic");
    expect(after).toEqual(before);
  });

  // ── Non-empty tiers (every provider must have all three) ──────────────

  it.each(allProviders)("%s has non-empty premium tier", (provider) => {
    const tiers = AIProviderFactory.getModelTiers(provider) as ModelTiers;
    expect(tiers.premium.length).toBeGreaterThanOrEqual(1);
  });

  it.each(allProviders)("%s has non-empty balanced tier", (provider) => {
    const tiers = AIProviderFactory.getModelTiers(provider) as ModelTiers;
    expect(tiers.balanced.length).toBeGreaterThanOrEqual(1);
  });

  it.each(allProviders)("%s has non-empty budget tier", (provider) => {
    const tiers = AIProviderFactory.getModelTiers(provider) as ModelTiers;
    expect(tiers.budget.length).toBeGreaterThanOrEqual(1);
  });

  // ── getModelForTier ────────────────────────────────────────────────

  it.each(allProviders)(
    "getModelForTier(%s, premium) returns the first premium model",
    (provider) => {
      const expected = AIProviderFactory.getModelTiers(provider).premium[0];
      expect(AIProviderFactory.getModelForTier(provider, "premium")).toBe(expected);
    },
  );

  it.each(allProviders)(
    "getModelForTier(%s, balanced) returns the first balanced model",
    (provider) => {
      const expected = AIProviderFactory.getModelTiers(provider).balanced[0];
      expect(AIProviderFactory.getModelForTier(provider, "balanced")).toBe(expected);
    },
  );

  it.each(allProviders)(
    "getModelForTier(%s, budget) returns the first budget model",
    (provider) => {
      const expected = AIProviderFactory.getModelTiers(provider).budget[0];
      expect(AIProviderFactory.getModelForTier(provider, "budget")).toBe(expected);
    },
  );

  it("getModelForTier(openrouter, budget) returns google/gemini-2.5-flash", () => {
    expect(AIProviderFactory.getModelForTier("openrouter", "budget")).toBe(
      "google/gemini-2.5-flash",
    );
  });
});
