/**
 * AI Configuration Management
 * Handles environment variables and provider selection
 */

import type { AIModelConfig, AIProvider, ModelTier, ReasoningEffort } from "./types.js";
import { AIProviderFactory } from "./factory.js";
import { ProviderError } from "../../utils/errors.js";
import { normalizeAnthropicBaseUrl, isValidHttpUrl } from "./anthropic-utils.js";

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
   * Resolve model name with the following precedence:
   *   1. explicit model name (options.model or AI_MODEL env)
   *   2. AI_MODEL_TIER env var
   *   3. options.modelTier
   *   4. provider default model
   */
  private static resolveModel(
    provider: AIProvider,
    options: { model?: string | undefined; modelTier?: ModelTier | undefined },
  ): string {
    // 1. Explicit model wins (options.model or AI_MODEL env)
    const explicitModel = options.model ?? process.env.AI_MODEL ?? undefined;
    if (explicitModel) return explicitModel;

    // 2. AI_MODEL_TIER env
    const envTier = process.env.AI_MODEL_TIER;
    if (envTier === "premium" || envTier === "balanced" || envTier === "budget") {
      return AIProviderFactory.getModelForTier(provider, envTier);
    }

    // 3. Config-provided tier
    if (options.modelTier) {
      return AIProviderFactory.getModelForTier(provider, options.modelTier);
    }

    // 4. Provider default
    return AIProviderFactory.getDefaultModel(provider);
  }

  /**
   * Get AI configuration from environment variables
   * Priority: AI_PROVIDER > GEMINI_API_KEY (backward compatibility)
   */
  static fromEnvironment(options: { modelTier?: ModelTier | undefined } = {}): AIModelConfig {
    const probe = this.probeEnvironment(options);
    if (probe.status !== "ready") {
      throw new ProviderError(probe.reason);
    }
    return probe.config;
  }

  /**
   * Get AI configuration for a specific provider (used for fallback chains).
   * Throws ProviderError if the API key for that provider is not set.
   */
  static fromEnvironmentForProvider(
    provider: AIProvider,
    options: { modelTier?: ModelTier | undefined } = {},
  ): AIModelConfig {
    const model = this.resolveModel(provider, { modelTier: options.modelTier });
    const apiKey = this.getApiKey(provider);
    if (!apiKey) {
      throw new ProviderError(
        `Fallback provider "${provider}" has no API key. ` +
          `Set ${this.getApiKeyEnvName(provider)} environment variable.`,
      );
    }

    const config: AIModelConfig = {
      provider,
      model,
      apiKey,
      temperature: parseFloat(process.env.AI_TEMPERATURE || "0.2"),
      maxTokens: parseInt(process.env.AI_MAX_TOKENS || "2048", 10),
      reasoningEffort: this.resolveReasoningEffort(),
    };

    // Read ANTHROPIC_BASE_URL only for anthropic provider
    if (provider === "anthropic") {
      const envUrl = process.env.ANTHROPIC_BASE_URL;
      if (envUrl) {
        if (!isValidHttpUrl(envUrl)) {
          throw new ProviderError(
            `Invalid ANTHROPIC_BASE_URL "${envUrl}". Must be a valid http:// or https:// URL.`,
          );
        }
        config.baseUrl = normalizeAnthropicBaseUrl(envUrl);
      }
    }

    return config;
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
    options: {
      provider?: string | undefined;
      model?: string | undefined;
      modelTier?: ModelTier | undefined;
    } = {},
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
    const model = this.resolveModel(provider, {
      model: options.model,
      modelTier: options.modelTier,
    });
    if (!model || model.trim().length === 0) {
      return {
        status: "unavailable",
        provider,
        model,
        apiKeyPresent: Boolean(this.getApiKey(provider)),
        reason: `AI model is required for provider "${provider}". Set AI_MODEL or ${this.getApiKeyEnvName(provider)}.`,
      };
    }

    // Read ANTHROPIC_BASE_URL only for anthropic provider
    let baseUrl: string | undefined;
    if (provider === "anthropic") {
      const envUrl = process.env.ANTHROPIC_BASE_URL;
      if (envUrl) {
        if (!isValidHttpUrl(envUrl)) {
          return {
            status: "unavailable",
            provider,
            model,
            apiKeyPresent: Boolean(this.getApiKey(provider)),
            reason: `Invalid ANTHROPIC_BASE_URL "${envUrl}". Must be a valid http:// or https:// URL.`,
          };
        }
        baseUrl = normalizeAnthropicBaseUrl(envUrl);
      }
    }

    // When a valid custom base URL is set for anthropic, bypass model whitelist
    if (!baseUrl && !this.isSupportedModel(provider, model)) {
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

    const config: AIModelConfig = {
      provider,
      model,
      apiKey,
      temperature: parseFloat(process.env.AI_TEMPERATURE || "0.2"),
      maxTokens: parseInt(process.env.AI_MAX_TOKENS || "2048", 10),
      reasoningEffort: this.resolveReasoningEffort(),
    };
    if (baseUrl) {
      config.baseUrl = baseUrl;
    }

    return {
      status: "ready",
      config,
    };
  }

  /**
   * Resolve the reasoning effort hint for OpenAI reasoning models from
   * AI_REASONING_EFFORT. Falls back to "medium" for unset/invalid values.
   * Only meaningful for OpenAI reasoning models; ignored elsewhere.
   */
  private static resolveReasoningEffort(): ReasoningEffort {
    const raw = (process.env.AI_REASONING_EFFORT || "").trim().toLowerCase();
    if (raw === "minimal" || raw === "low" || raw === "medium" || raw === "high") {
      return raw;
    }
    return "medium";
  }

  private static isProvider(provider: string): provider is AIProvider {
    return (this.VALID_PROVIDERS as readonly string[]).includes(provider);
  }

  private static isSupportedModel(provider: AIProvider, model: string): boolean {
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
