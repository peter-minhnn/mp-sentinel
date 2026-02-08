/**
 * Anthropic Claude Provider
 * Best models for code: claude-sonnet-4.5, claude-opus-4, claude-3-5-sonnet
 * Reference: https://docs.anthropic.com/en/docs/about-claude/models
 */

import type { IAIProvider, AIModelConfig } from '../types.js';

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AnthropicResponse {
  content: Array<{
    type: string;
    text: string;
  }>;
}

export class AnthropicProvider implements IAIProvider {
  private apiKey: string;
  private model: string;
  private temperature: number;
  private maxTokens: number;
  private baseURL = 'https://api.anthropic.com/v1/messages';
  private apiVersion = '2023-06-01';

  constructor(config: AIModelConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.temperature = config.temperature ?? 0.2;
    this.maxTokens = config.maxTokens ?? 8192;
  }

  async generateContent(systemPrompt: string, userPrompt: string): Promise<string> {
    const messages: AnthropicMessage[] = [
      { role: 'user', content: userPrompt },
    ];

    const response = await fetch(this.baseURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': this.apiVersion,
      },
      body: JSON.stringify({
        model: this.model,
        system: systemPrompt,
        messages,
        temperature: this.temperature,
        max_tokens: this.maxTokens,
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as AnthropicResponse;
    return data.content[0]?.text || '';
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }
}
