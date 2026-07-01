/**
 * Google Gemini AI Provider
 * Uses the @google/genai SDK.
 * Reference: https://ai.google.dev/gemini-api/docs
 */

import { GoogleGenAI } from "@google/genai";
import type {
  AIModelConfig,
  AIResponse,
  AIResponseSchema,
  AIUsage,
  IAIProvider,
} from "../types.js";

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

interface GeminiCandidate {
  finishReason?: string;
}

interface GeminiResultLike {
  text?: string;
  usageMetadata?: GeminiUsageMetadata;
  candidates?: GeminiCandidate[];
}

const FINISH_REASON_MAP: Record<string, AIResponse["finishReason"]> = {
  STOP: "stop",
  MAX_TOKENS: "length",
  SAFETY: "content_filter",
  RECITATION: "content_filter",
  OTHER: "error",
};

const normalizeFinishReason = (raw?: string): AIResponse["finishReason"] => {
  if (!raw) return undefined;
  return FINISH_REASON_MAP[raw];
};

const extractUsage = (raw?: GeminiUsageMetadata): AIUsage | undefined => {
  if (!raw) return undefined;
  const input = raw.promptTokenCount;
  const output = raw.candidatesTokenCount;
  if (typeof input !== "number" || typeof output !== "number") return undefined;
  return { inputTokens: input, outputTokens: output };
};

export class GeminiProvider implements IAIProvider {
  private readonly client: GoogleGenAI;
  private readonly model: string;
  private readonly temperature: number;
  private readonly seed: number | undefined;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;

  private readonly apiKey: string;

  constructor(config: AIModelConfig) {
    this.client = new GoogleGenAI({ apiKey: config.apiKey });
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.temperature = config.temperature ?? 0;
    this.seed = config.seed;
    this.maxTokens = config.maxTokens ?? 2048;
    this.timeoutMs = parseInt(process.env.AI_TIMEOUT_MS || "30000", 10);
  }

  async generate(
    systemPrompt: string,
    userPrompt: string,
    responseSchema?: AIResponseSchema,
  ): Promise<AIResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    // Phase 2.5: Gemini supports structured output via `responseSchema`
    // + `responseMimeType: "application/json"`. The SDK accepts the same
    // JSON Schema shape we pass to the other providers.
    const generationConfig: Record<string, unknown> = {
      systemInstruction: systemPrompt,
      temperature: this.temperature,
      ...(this.seed !== undefined && { seed: this.seed }),
      maxOutputTokens: this.maxTokens,
      abortSignal: controller.signal,
    };
    if (responseSchema) {
      generationConfig["responseMimeType"] = "application/json";
      generationConfig["responseSchema"] = responseSchema.schema;
    }

    try {
      const raw = (await this.client.models.generateContent({
        model: this.model,
        contents: userPrompt,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        config: generationConfig as any,
      })) as GeminiResultLike;

      const text = raw.text ?? "";
      const usage = extractUsage(raw.usageMetadata);
      const finishReason = normalizeFinishReason(raw.candidates?.[0]?.finishReason);
      const result: AIResponse = { text };
      if (usage) result.usage = usage;
      if (finishReason) result.finishReason = finishReason;
      return result;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** @deprecated use generate() — kept for backward compatibility */
  async generateContent(systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await this.generate(systemPrompt, userPrompt);
    return response.text;
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }
}
