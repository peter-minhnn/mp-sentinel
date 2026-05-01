/**
 * AI Provider Factory
 * Creates appropriate provider based on configuration
 */

import type { IAIProvider, AIModelConfig, AIProvider } from "./types.js";
import { GeminiProvider } from "./providers/gemini.provider.js";
import { OpenAIProvider } from "./providers/openai.provider.js";
import { AnthropicProvider } from "./providers/anthropic.provider.js";
import { GrokProvider } from "./providers/grok.provider.js";
import { OpenRouterProvider } from "./providers/openrouter.provider.js";

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
      openai: "gpt-5.3-codex",
      anthropic: "claude-sonnet-4-6",
      grok: "grok-4-1-fast-reasoning",
      openrouter: "openai/gpt-5.2",
    };
    return defaults[provider];
  }

  static getRecommendedModels(provider: AIProvider): string[] {
    const recommendations: Record<AIProvider, string[]> = {
      gemini: [
        "gemini-3.1-pro-preview",
        "gemini-3-pro-preview",
        "gemini-2.5-pro",
        "gemini-2.5-flash",
      ],
      openai: ["gpt-5.3-codex", "gpt-5.2", "gpt-5.2-pro", "gpt-5-mini"],
      anthropic: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"],
      grok: ["grok-4", "grok-4-1-fast-reasoning", "grok-code-fast-1"],
      openrouter: [
        "openai/gpt-5.2",
        "openai/gpt-5.1",
        "anthropic/claude-opus-4-6",
        "google/gemini-2.5-flash",
      ],
    };
    return recommendations[provider];
  }
}
