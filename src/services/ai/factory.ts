/**
 * AI Provider Factory
 * Creates appropriate provider based on configuration
 */

import type { IAIProvider, AIModelConfig, AIProvider, ModelTier } from "./types.js";
import { GeminiProvider } from "./providers/gemini.provider.js";
import { OpenAIProvider } from "./providers/openai.provider.js";
import { AnthropicProvider } from "./providers/anthropic.provider.js";
import { GrokProvider } from "./providers/grok.provider.js";
import { OpenRouterProvider } from "./providers/openrouter.provider.js";

/**
 * Model tier catalog for each AI provider.
 * - premium: best / newest models for hard reviews (security, architecture, crashes)
 * - balanced: default / stable models for everyday CI
 * - budget: cheap / fast models for bulk review
 */
export interface ModelTiers {
  premium: string[];
  balanced: string[];
  budget: string[];
}

const modelTiers: Record<AIProvider, ModelTiers> = {
  gemini: {
    premium: ["gemini-3.1-pro-preview", "gemini-3-flash-preview", "gemini-2.5-pro"],
    balanced: ["gemini-2.5-flash"],
    budget: ["gemini-3.1-flash-lite-preview", "gemini-2.5-flash-lite"],
  },
  openai: {
    premium: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"],
    balanced: ["gpt-5.2", "gpt-5.2-pro"],
    budget: ["gpt-5-mini"],
  },
  anthropic: {
    premium: ["claude-opus-4-7", "claude-opus-4-6"],
    balanced: ["claude-sonnet-4-6"],
    budget: ["claude-haiku-4-5"],
  },
  grok: {
    premium: ["grok-4.3", "grok-4"],
    balanced: ["grok-4-1-fast-reasoning"],
    budget: ["grok-code-fast-1"],
  },
  openrouter: {
    premium: [
      "openai/gpt-5.5",
      "anthropic/claude-opus-4-7",
      "google/gemini-3.1-pro-preview",
      "x-ai/grok-4.3",
    ],
    balanced: ["openai/gpt-5.2"],
    budget: ["google/gemini-2.5-flash"],
  },
};

export class AIProviderFactory {
  static createProvider(config: AIModelConfig): IAIProvider {
    switch (config.provider) {
      case "gemini":
        return new GeminiProvider(config);
      case "openai":
        return new OpenAIProvider(config);
      case "anthropic":
        return new AnthropicProvider(config);
      case "grok":
        return new GrokProvider(config);
      case "openrouter":
        return new OpenRouterProvider(config);
      default:
        throw new Error(`Unsupported AI provider: ${config.provider}`);
    }
  }

  static getDefaultModel(provider: AIProvider): string {
    const defaults: Record<AIProvider, string> = {
      gemini: "gemini-2.5-flash",
      openai: "gpt-5.2",
      anthropic: "claude-sonnet-4-6",
      grok: "grok-4-1-fast-reasoning",
      openrouter: "openai/gpt-5.2",
    };
    return defaults[provider];
  }

  /**
   * Validate an OpenRouter model ID.
   * Accepted: `provider/model` or `provider/model:variant`
   * Rejected: empty, no slash, leading/trailing slash, whitespace, multiple slashes,
   *           empty parts, multiple colons in the model portion.
   */
  private static isValidOpenRouterModelId(model: string): boolean {
    if (!model) return false;
    if (model.includes(" ")) return false;
    if (model.startsWith("/") || model.endsWith("/")) return false;

    const slashParts = model.split("/");
    if (slashParts.length !== 2) return false;

    const id = slashParts[1];
    if (!id) return false;

    // id may have optional :variant suffix, but at most one colon
    const colonCount = (id.match(/:/g) || []).length;
    if (colonCount > 1) return false;
    if (colonCount === 1) {
      const suffix = id.split(":")[1];
      if (!suffix) return false;
    }

    return true;
  }

  /**
   * Return a copy of the provider's model tiers.
   * The caller cannot mutate the internal catalog through the returned object.
   */
  static getModelTiers(provider: AIProvider): ModelTiers {
    const tiers = modelTiers[provider];
    return {
      premium: [...tiers.premium],
      balanced: [...tiers.balanced],
      budget: [...tiers.budget],
    };
  }

  /**
   * Return a copy of the provider's premium model list.
   */
  static getPremiumModels(provider: AIProvider): string[] {
    return [...modelTiers[provider].premium];
  }

  /**
   * Resolve the first model for a given provider and tier.
   * Every provider has at least one model in each tier.
   */
  static getModelForTier(provider: AIProvider, tier: ModelTier): string {
    const tierModels = modelTiers[provider][tier];
    return tierModels[0]!;
  }

  static getRecommendedModels(provider: AIProvider): string[] {
    const tiers = modelTiers[provider];
    return [...tiers.premium, ...tiers.balanced, ...tiers.budget];
  }

  static isSupportedModel(provider: AIProvider, model: string): boolean {
    if (provider === "openrouter") {
      return this.isValidOpenRouterModelId(model);
    }
    return this.getRecommendedModels(provider).includes(model);
  }
}
