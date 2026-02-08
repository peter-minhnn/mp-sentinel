/**
 * Google Gemini AI Provider
 * Best models for code: gemini-2.0-flash-exp, gemini-2.5-flash
 */

import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai';
import type { IAIProvider, AIModelConfig } from '../types.js';

export class GeminiProvider implements IAIProvider {
  private model: GenerativeModel;

  constructor(config: AIModelConfig) {
    const genAI = new GoogleGenerativeAI(config.apiKey);
    this.model = genAI.getGenerativeModel({
      model: config.model,
      generationConfig: {
        temperature: config.temperature ?? 0.2,
        maxOutputTokens: config.maxTokens ?? 8192,
      },
    });
  }

  async generateContent(systemPrompt: string, userPrompt: string): Promise<string> {
    const result = await this.model.generateContent([systemPrompt, userPrompt]);
    return result.response.text();
  }

  isAvailable(): boolean {
    return !!this.model;
  }
}
