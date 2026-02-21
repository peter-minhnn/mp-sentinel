/**
 * OpenAI GPT Provider
 * Best models for code: gpt-4.1, gpt-4o, gpt-4-turbo
 * Reference: https://openai.com/index/gpt-4-1/
 */

import type { IAIProvider, AIModelConfig } from "../types.js";

interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

export class OpenAIProvider implements IAIProvider {
  private apiKey: string;
  private model: string;
  private temperature: number;
  private maxTokens: number;
  private timeoutMs: number;
  private baseURL = "https://api.openai.com/v1/chat/completions";

  constructor(config: AIModelConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.temperature = config.temperature ?? 0.2;
    this.maxTokens = config.maxTokens ?? 2048;
    this.timeoutMs = parseInt(process.env.AI_TIMEOUT_MS || "30000", 10);
  }

  async generateContent(systemPrompt: string, userPrompt: string): Promise<string> {
    const messages: OpenAIMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    const response = await fetch(this.baseURL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: this.temperature,
        max_tokens: this.maxTokens,
      }),
    }).finally(() => clearTimeout(timeoutId));

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText} ${errorBody}`);
    }

    const data = (await response.json()) as OpenAIResponse;
    return data.choices[0]?.message?.content || "";
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }
}
