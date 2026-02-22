/**
 * xAI Grok API Provider
 * Reference: https://docs.x.ai/developers/quickstart
 * Uses OpenAI-compatible chat completions endpoint.
 */

import type { IAIProvider, AIModelConfig } from "../types.js";

interface GrokMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface GrokResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

export class GrokProvider implements IAIProvider {
  private apiKey: string;
  private model: string;
  private temperature: number;
  private maxTokens: number;
  private timeoutMs: number;
  private baseURL = "https://api.x.ai/v1/chat/completions";

  constructor(config: AIModelConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.temperature = config.temperature ?? 0.2;
    this.maxTokens = config.maxTokens ?? 2048;
    this.timeoutMs = parseInt(process.env.AI_TIMEOUT_MS || "30000", 10);
  }

  async generateContent(systemPrompt: string, userPrompt: string): Promise<string> {
    const messages: GrokMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
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
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Grok API error: ${response.status} ${response.statusText} ${errorBody}`);
      }

      const data = (await response.json()) as GrokResponse;
      return data.choices[0]?.message?.content || "";
    } finally {
      clearTimeout(timeoutId);
    }
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }
}
