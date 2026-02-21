/**
 * AI Provider Factory
 * Creates appropriate provider based on configuration
 */

import type { IAIProvider, AIModelConfig, AIProvider } from "./types.js";
import { GeminiProvider } from "./providers/gemini.provider.js";
import { OpenAIProvider } from "./providers/openai.provider.js";
import { AnthropicProvider } from "./providers/anthropic.provider.js";

export class AIProviderFactory {
  static createProvider(config: AIModelConfig): IAIProvider {
    switch (config.provider) {
      case "gemini":
        return new GeminiProvider(config);
      case "openai":
        return new OpenAIProvider(config);
      case "anthropic":
        return new AnthropicProvider(config);
      default:
        throw new Error(`Unsupported AI provider: ${config.provider}`);
    }
  }

  static getDefaultModel(provider: AIProvider): string {
    const defaults: Record<AIProvider, string> = {
      gemini: "gemini-2.5-flash",
      openai: "gpt-4o",
      anthropic: "claude-sonnet-4.5",
    };
    return defaults[provider];
  }

  static getRecommendedModels(provider: AIProvider): string[] {
    const recommendations: Record<AIProvider, string[]> = {
      gemini: ["gemini-2.5-flash", "gemini-2.0-flash-exp", "gemini-1.5-pro"],
      openai: ["gpt-4.1", "gpt-4o", "gpt-4-turbo"],
      anthropic: ["claude-sonnet-4.5", "claude-opus-4", "claude-3-5-sonnet"],
    };
    return recommendations[provider];
  }
}
