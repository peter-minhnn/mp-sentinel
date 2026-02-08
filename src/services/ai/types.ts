/**
 * AI Provider types and interfaces
 */

export type AIProvider = 'gemini' | 'openai' | 'anthropic';

export interface AIModelConfig {
  provider: AIProvider;
  model: string;
  apiKey: string;
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
