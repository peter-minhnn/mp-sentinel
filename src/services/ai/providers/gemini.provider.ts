/**
 * Google Gemini AI Provider
 * Uses the @google/genai SDK.
 * Reference: https://ai.google.dev/gemini-api/docs
 */

import { GoogleGenAI } from "@google/genai";
import type { IAIProvider, AIModelConfig } from "../types.js";

export class GeminiProvider implements IAIProvider {
  private readonly client: GoogleGenAI;
  private readonly model: string;
  private readonly temperature: number;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;

  private readonly apiKey: string;

  constructor(config: AIModelConfig) {
    this.client = new GoogleGenAI({ apiKey: config.apiKey });
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
      const result = await this.client.models.generateContent({
        model: this.model,
        contents: userPrompt,
        config: {
          systemInstruction: systemPrompt,
          temperature: this.temperature,
          maxOutputTokens: this.maxTokens,
          abortSignal: controller.signal,
        },
      });

      return result.text ?? "";
    } finally {
      clearTimeout(timeoutId);
    }
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }
}
