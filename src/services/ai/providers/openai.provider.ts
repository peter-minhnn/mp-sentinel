/**
 * OpenAI GPT Provider (Responses API)
 * Uses the POST /v1/responses endpoint.
 * Reference: https://platform.openai.com/docs/api-reference/responses
 */

import type { IAIProvider, AIModelConfig } from "../types.js";

interface OpenAIResponseOutputContent {
  text?: string;
}

interface OpenAIResponseOutput {
  content?: OpenAIResponseOutputContent[];
}

interface OpenAIResponse {
  output_text?: string;
  output?: OpenAIResponseOutput[];
}

export class OpenAIProvider implements IAIProvider {
  private apiKey: string;
  private model: string;
  private temperature: number;
  private maxTokens: number;
  private timeoutMs: number;
  private baseURL = "https://api.openai.com/v1/responses";

  constructor(config: AIModelConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.temperature = config.temperature ?? 0.2;
    this.maxTokens = config.maxTokens ?? 2048;
    this.timeoutMs = parseInt(process.env.AI_TIMEOUT_MS || "30000", 10);
  }

  async generateContent(systemPrompt: string, userPrompt: string): Promise<string> {
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
          instructions: systemPrompt,
          input: userPrompt,
          max_output_tokens: this.maxTokens,
          temperature: this.temperature,
          store: false,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText} ${errorBody}`);
      }

      const data = (await response.json()) as OpenAIResponse;
      // Prefer top-level output_text; fall back to nested output[].content[].text
      if (data.output_text) return data.output_text;
      if (data.output?.[0]?.content?.[0]?.text) {
        return data.output[0].content[0].text;
      }
      return "";
    } finally {
      clearTimeout(timeoutId);
    }
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }
}
