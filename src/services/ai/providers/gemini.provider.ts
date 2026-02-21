/**
 * Google Gemini AI Provider
 * Best models for code: gemini-2.0-flash-exp, gemini-2.5-flash
 */

import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai';
import type { IAIProvider, AIModelConfig } from '../types.js';

export class GeminiProvider implements IAIProvider {
  private readonly model: GenerativeModel;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(config: AIModelConfig) {
    this.apiKey = config.apiKey;
    this.timeoutMs = parseInt(process.env.AI_TIMEOUT_MS || "30000", 10);
    const genAI = new GoogleGenerativeAI(config.apiKey);
    this.model = genAI.getGenerativeModel({
      model: config.model,
      generationConfig: {
        temperature: config.temperature ?? 0.2,
        maxOutputTokens: config.maxTokens ?? 2048,
      },
    });
  }

  async generateContent(systemPrompt: string, userPrompt: string): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      // The @google/generative-ai SDK accepts a RequestOptions object as the
      // second argument to generateContent, which forwards the signal.
      const result = await this.model.generateContent(
        [systemPrompt, userPrompt],
        { signal: controller.signal } as Parameters<GenerativeModel["generateContent"]>[1],
      );
      return result.response.text();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }
}
