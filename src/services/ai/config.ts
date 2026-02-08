/**
 * AI Configuration Management
 * Handles environment variables and provider selection
 */

import type { AIModelConfig, AIProvider } from './types.js';
import { AIProviderFactory } from './factory.js';

export class AIConfig {
  /**
   * Get AI configuration from environment variables
   * Priority: AI_PROVIDER > GEMINI_API_KEY (backward compatibility)
   */
  static fromEnvironment(): AIModelConfig {
    const provider = (process.env.AI_PROVIDER?.toLowerCase() as AIProvider) || 'gemini';
    const model = process.env.AI_MODEL || AIProviderFactory.getDefaultModel(provider);
    
    const apiKey = this.getApiKey(provider);
    if (!apiKey) {
      throw new Error(
        `API key not found for provider: ${provider}. ` +
        `Set ${this.getApiKeyEnvName(provider)} environment variable.`
      );
    }

    return {
      provider,
      model,
      apiKey,
      temperature: parseFloat(process.env.AI_TEMPERATURE || '0.2'),
      maxTokens: parseInt(process.env.AI_MAX_TOKENS || '8192', 10),
    };
  }

  /**
   * Get API key for specific provider
   */
  private static getApiKey(provider: AIProvider): string | undefined {
    switch (provider) {
      case 'gemini':
        return process.env.GEMINI_API_KEY;
      case 'openai':
        return process.env.OPENAI_API_KEY;
      case 'anthropic':
        return process.env.ANTHROPIC_API_KEY;
      default:
        return undefined;
    }
  }

  /**
   * Get environment variable name for API key
   */
  private static getApiKeyEnvName(provider: AIProvider): string {
    const names: Record<AIProvider, string> = {
      gemini: 'GEMINI_API_KEY',
      openai: 'OPENAI_API_KEY',
      anthropic: 'ANTHROPIC_API_KEY',
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
