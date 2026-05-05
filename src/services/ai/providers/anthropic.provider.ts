/**
 * Anthropic Claude Provider
 * Best models for code: claude-sonnet-4-6, claude-opus-4-6
 * Reference: https://docs.anthropic.com/en/docs/about-claude/models
 */

import type { IAIProvider, AIModelConfig } from "../types.js";
import { normalizeAnthropicBaseUrl } from "../anthropic-utils.js";

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicResponse {
  content: AnthropicContentBlock[];
}

export class AnthropicProvider implements IAIProvider {
  private apiKey: string;
  private model: string;
  private temperature: number;
  private maxTokens: number;
  private timeoutMs: number;
  private baseURL: string;
  private isDeepSeek: boolean;
  private apiVersion = "2023-06-01";

  constructor(config: AIModelConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.temperature = config.temperature ?? 0.2;
    this.maxTokens = config.maxTokens ?? 2048;
    this.timeoutMs = parseInt(process.env.AI_TIMEOUT_MS || "30000", 10);
    this.baseURL = normalizeAnthropicBaseUrl(config.baseUrl);
    this.isDeepSeek = this.baseURL.includes("deepseek.com");
  }

  async generateContent(systemPrompt: string, userPrompt: string): Promise<string> {
    const messages: AnthropicMessage[] = [{ role: "user", content: userPrompt }];

    const body: Record<string, unknown> = {
      model: this.model,
      system: systemPrompt,
      messages,
      temperature: this.temperature,
      max_tokens: this.maxTokens,
    };

    // DeepSeek V4 enables thinking mode by default, which breaks
    // JSON parsing. Explicitly disable it for audit use.
    if (this.isDeepSeek) {
      body.thinking = { type: "disabled" };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    const response = await fetch(this.baseURL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": this.apiVersion,
      },
      body: JSON.stringify(body),
    }).finally(() => clearTimeout(timeoutId));

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Anthropic API error: ${response.status} ${response.statusText} ${errorBody}`,
      );
    }

    const data = (await response.json()) as AnthropicResponse;
    // Anthropic-compatible APIs (e.g. DeepSeek V4) may return mixed
    // content blocks: "thinking" blocks followed by "text" blocks.
    // Filter to only text blocks and join them.
    const textBlocks = data.content
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "");
    return textBlocks.join("") || "";
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }
}
