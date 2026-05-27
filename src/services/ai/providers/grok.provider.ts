/**
 * xAI Grok API Provider
 * Reference: https://docs.x.ai/developers/quickstart
 * Uses OpenAI-compatible chat completions endpoint.
 */

import type {
  AIModelConfig,
  AIResponse,
  AIResponseSchema,
  AIUsage,
  IAIProvider,
} from "../types.js";

interface GrokMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface GrokUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

interface GrokChoice {
  message: { content: string };
  finish_reason?: string;
}

interface GrokResponse {
  choices: GrokChoice[];
  usage?: GrokUsage;
}

const FINISH_REASON_MAP: Record<string, AIResponse["finishReason"]> = {
  stop: "stop",
  length: "length",
  content_filter: "content_filter",
  error: "error",
};

const normalizeFinishReason = (raw?: string): AIResponse["finishReason"] => {
  if (!raw) return undefined;
  return FINISH_REASON_MAP[raw];
};

const extractUsage = (raw?: GrokUsage): AIUsage | undefined => {
  if (!raw) return undefined;
  if (typeof raw.prompt_tokens !== "number" || typeof raw.completion_tokens !== "number") {
    return undefined;
  }
  return { inputTokens: raw.prompt_tokens, outputTokens: raw.completion_tokens };
};

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

  async generate(
    systemPrompt: string,
    userPrompt: string,
    responseSchema?: AIResponseSchema,
  ): Promise<AIResponse> {
    const messages: GrokMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: this.temperature,
      max_tokens: this.maxTokens,
    };
    // Phase 2.5: Grok ships OpenAI-compatible `response_format` for
    // structured output. When the caller passes a schema we activate it;
    // otherwise legacy text-mode parsing applies.
    if (responseSchema) {
      body["response_format"] = {
        type: "json_schema",
        json_schema: {
          name: responseSchema.name,
          schema: responseSchema.schema,
          strict: responseSchema.strict !== false,
        },
      };
    }

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
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Grok API error: ${response.status} ${response.statusText} ${errorBody}`);
      }

      const data = (await response.json()) as GrokResponse;
      const text = data.choices[0]?.message?.content || "";
      const usage = extractUsage(data.usage);
      const finishReason = normalizeFinishReason(data.choices[0]?.finish_reason);
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
