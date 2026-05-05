/**
 * AI Provider types and interfaces
 */

export type AIProvider = "gemini" | "openai" | "anthropic" | "grok" | "openrouter";

/**
 * Model tier selector — controls which model from the provider's tier
 * catalog is used when no explicit AI_MODEL is set.
 * - premium: best / newest models for hard reviews (security, architecture)
 * - balanced: default / stable models for everyday CI
 * - budget: cheap / fast models for bulk review
 */
export type ModelTier = "premium" | "balanced" | "budget";

export interface AIModelConfig {
  provider: AIProvider;
  model: string;
  apiKey: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface IAIProvider {
  generateContent(systemPrompt: string, userPrompt: string): Promise<string>;
  isAvailable(): boolean;
}

export interface AIProviderFactory {
  createProvider(config: AIModelConfig): IAIProvider;
}
