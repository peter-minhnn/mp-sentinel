/**
 * AI Configuration Management
 * Handles environment variables and provider selection
 */

import type { AIModelConfig, AIProvider } from "./types.js";
import { AIProviderFactory } from "./factory.js";
import { ProviderError } from "../../utils/errors.js";

export interface AIEnvironmentReady {
  status: "ready";
  config: AIModelConfig;
}

export interface AIEnvironmentUnavailable {
  status: "unavailable";
  provider?: string | undefined;
  model?: string | undefined;
  apiKeyPresent: boolean;
  reason: string;
}

export type AIEnvironmentProbe = AIEnvironmentReady | AIEnvironmentUnavailable;

export class AIConfig {
  private static readonly VALID_PROVIDERS = [
    "gemini",
    "openai",
    "anthropic",
    "grok",
    "openrouter",
  ] as const;

  /**
   * Get AI configuration from environment variables
   * Priority: AI_PROVIDER > GEMINI_API_KEY (backward compatibility)
   */
  static fromEnvironment(): AIModelConfig {
    const probe = this.probeEnvironment();
    if (probe.status !== "ready") {
      throw new ProviderError(probe.reason);
    }
    return probe.config;
  }

  /**
   * Get AI configuration for a specific provider (used for fallback chains).
   * Throws ProviderError if the API key for that provider is not set.
   */
  static fromEnvironmentForProvider(provider: AIProvider): AIModelConfig {
    const model = AIProviderFactory.getDefaultModel(provider);
    const apiKey = this.getApiKey(provider);
    if (!apiKey) {
      throw new ProviderError(
        `Fallback provider "${provider}" has no API key. ` +
          `Set ${this.getApiKeyEnvName(provider)} environment variable.`,
      );
    }
    return {
      provider,
      model,
      apiKey,
      temperature: parseFloat(process.env.AI_TEMPERATURE || "0.2"),
      maxTokens: parseInt(process.env.AI_MAX_TOKENS || "2048", 10),
    };
  }

  /**
   * Get API key for specific provider.
   */
  static getApiKey(provider: AIProvider): string | undefined {
    switch (provider) {
      case "gemini":
        return process.env.GEMINI_API_KEY;
      case "openai":
        return process.env.OPENAI_API_KEY;
      case "anthropic":
        return process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
      case "grok":
        return process.env.GROK_API_KEY || process.env.XAI_API_KEY;
      case "openrouter":
        return process.env.OPENROUTER_API_KEY;
      default:
        return undefined;
    }
  }

  static probeEnvironment(
    options: { provider?: string | undefined; model?: string | undefined } = {},
  ): AIEnvironmentProbe {
    const providerRaw = (options.provider ?? process.env.AI_PROVIDER ?? "gemini").toLowerCase();
    if (!this.isProvider(providerRaw)) {
      return {
        status: "unavailable",
        provider: providerRaw,
        model: options.model ?? process.env.AI_MODEL,
        apiKeyPresent: false,
        reason: `Unsupported AI provider "${providerRaw}". Supported: ${this.VALID_PROVIDERS.join(", ")}.`,
      };
    }

    const provider = providerRaw;
    const model =
      options.model ?? process.env.AI_MODEL ?? AIProviderFactory.getDefaultModel(provider);
    if (!model || model.trim().length === 0) {
      return {
        status: "unavailable",
        provider,
        model,
        apiKeyPresent: Boolean(this.getApiKey(provider)),
        reason: `AI model is required for provider "${provider}". Set AI_MODEL or ${this.getApiKeyEnvName(provider)}.`,
      };
    }

    if (!this.isSupportedModel(provider, model)) {
      return {
        status: "unavailable",
        provider,
        model,
        apiKeyPresent: Boolean(this.getApiKey(provider)),
        reason: `Unsupported AI model "${model}" for provider "${provider}". Supported models: ${AIProviderFactory.getRecommendedModels(provider).join(", ")}.`,
      };
    }

    const apiKey = this.getApiKey(provider);
    if (!apiKey) {
      return {
        status: "unavailable",
        provider,
        model,
        apiKeyPresent: false,
        reason: `API key not found for provider "${provider}". Set ${this.getApiKeyEnvName(provider)} environment variable.`,
      };
    }

    return {
      status: "ready",
      config: {
        provider,
        model,
        apiKey,
        temperature: parseFloat(process.env.AI_TEMPERATURE || "0.2"),
        maxTokens: parseInt(process.env.AI_MAX_TOKENS || "2048", 10),
      },
    };
  }

  private static isProvider(provider: string): provider is AIProvider {
    return (this.VALID_PROVIDERS as readonly string[]).includes(provider);
  }

  private static isSupportedModel(provider: AIProvider, model: string): boolean {
    // OpenRouter is a router — any valid provider/model string is accepted.
    // Other providers validate against a known model allowlist.
    if (provider === "openrouter") {
      return model.includes("/");
    }
    return AIProviderFactory.isSupportedModel(provider, model);
  }

  /**
   * Get environment variable name for API key
   */
  private static getApiKeyEnvName(provider: AIProvider): string {
    const names: Record<AIProvider, string> = {
      gemini: "GEMINI_API_KEY",
      openai: "OPENAI_API_KEY",
      anthropic: "ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN",
      grok: "XAI_API_KEY",
      openrouter: "OPENROUTER_API_KEY",
    };
    return names[provider];
  }

  /**
   * Validate configuration
   */
  static validate(config: AIModelConfig): void {
    if (!config.apiKey) {
      throw new Error(`API key is required for ${config.provider}`);
    }
    if (!config.model) {
      throw new Error(`Model name is required for ${config.provider}`);
    }
  }
}
