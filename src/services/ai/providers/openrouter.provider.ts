/**
 * OpenRouter Provider
 * Uses OpenAI-compatible REST endpoint
 * Reference: https://openrouter.ai/docs/api/reference/overview
 */

import type { IAIProvider, AIModelConfig } from "../types.js";

interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenRouterResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

/**
 * Model families known to support response_format: { type: "json_object" }.
 * Other models ignore or mishandle the parameter — omit it so the parser
 * (which already handles markdown-wrapped JSON) can do its job.
 */
const JSON_OBJECT_MODEL_PREFIXES = ["openai/"];

const supportsJsonObject = (model: string): boolean =>
  JSON_OBJECT_MODEL_PREFIXES.some((prefix) => model.startsWith(prefix));

export class OpenRouterProvider implements IAIProvider {
  private apiKey: string;
  private model: string;
  private temperature: number;
  private maxTokens: number;
  private timeoutMs: number;
  private baseURL = "https://openrouter.ai/api/v1/chat/completions";
  private siteUrl: string | undefined;
  private appName: string;

  constructor(config: AIModelConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.temperature = config.temperature ?? 0.2;
    this.maxTokens = config.maxTokens ?? 2048;
    this.timeoutMs = parseInt(process.env.AI_TIMEOUT_MS || "30000", 10);
    this.siteUrl = process.env.OPENROUTER_SITE_URL || undefined;
    this.appName = process.env.OPENROUTER_APP_NAME || "MP Sentinel";
  }

  async generateContent(systemPrompt: string, userPrompt: string): Promise<string> {
    const messages: OpenRouterMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };

    // Add canonical OpenRouter attribution headers
    if (this.appName) {
      headers["X-OpenRouter-Title"] = this.appName;
    }
    if (this.siteUrl) {
      headers["HTTP-Referer"] = this.siteUrl;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    const response = await fetch(this.baseURL, {
      method: "POST",
      signal: controller.signal,
      headers,
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: this.temperature,
        max_tokens: this.maxTokens,
        ...(supportsJsonObject(this.model) && {
          response_format: { type: "json_object" as const },
        }),
      }),
    }).finally(() => clearTimeout(timeoutId));

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `OpenRouter API error: ${response.status} ${response.statusText} ${errorBody}`,
      );
    }

    const data = (await response.json()) as OpenRouterResponse;
    return data.choices[0]?.message?.content || "";
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }
}
