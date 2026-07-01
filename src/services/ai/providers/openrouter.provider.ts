/**
 * OpenRouter Provider
 * Uses OpenAI-compatible REST endpoint
 * Reference: https://openrouter.ai/docs/api/reference/overview
 */

import type {
  AIModelConfig,
  AIResponse,
  AIResponseSchema,
  AIUsage,
  IAIProvider,
} from "../types.js";

interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

interface OpenRouterChoice {
  message: { content: string };
  finish_reason?: string;
}

interface OpenRouterResponse {
  choices: OpenRouterChoice[];
  usage?: OpenRouterUsage;
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

const extractUsage = (raw?: OpenRouterUsage): AIUsage | undefined => {
  if (!raw) return undefined;
  if (typeof raw.prompt_tokens !== "number" || typeof raw.completion_tokens !== "number") {
    return undefined;
  }
  return { inputTokens: raw.prompt_tokens, outputTokens: raw.completion_tokens };
};

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
  private seed: number | undefined;
  private maxTokens: number;
  private timeoutMs: number;
  private baseURL = "https://openrouter.ai/api/v1/chat/completions";
  private siteUrl: string | undefined;
  private appName: string;

  constructor(config: AIModelConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.temperature = config.temperature ?? 0;
    this.seed = config.seed;
    this.maxTokens = config.maxTokens ?? 2048;
    this.timeoutMs = parseInt(process.env.AI_TIMEOUT_MS || "30000", 10);
    this.siteUrl = process.env.OPENROUTER_SITE_URL || undefined;
    this.appName = process.env.OPENROUTER_APP_NAME || "MP Sentinel";
  }

  async generate(
    systemPrompt: string,
    userPrompt: string,
    responseSchema?: AIResponseSchema,
  ): Promise<AIResponse> {
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

    // Phase 2.5: prefer the JSON-Schema variant when the caller passes
    // one AND the underlying model is an OpenAI-family model (the only
    // family OpenRouter reliably forwards `json_schema` to). Fall back to
    // `response_format: { type: "json_object" }` for OpenAI models with
    // no schema, and to plain text for every other family.
    const responseFormat = responseSchema
      ? supportsJsonObject(this.model)
        ? {
            type: "json_schema" as const,
            json_schema: {
              name: responseSchema.name,
              schema: responseSchema.schema,
              strict: responseSchema.strict !== false,
            },
          }
        : undefined
      : supportsJsonObject(this.model)
        ? { type: "json_object" as const }
        : undefined;

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
        ...(this.seed !== undefined && { seed: this.seed }),
        max_tokens: this.maxTokens,
        ...(responseFormat && { response_format: responseFormat }),
      }),
    }).finally(() => clearTimeout(timeoutId));

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `OpenRouter API error: ${response.status} ${response.statusText} ${errorBody}`,
      );
    }

    const data = (await response.json()) as OpenRouterResponse;
    const text = data.choices[0]?.message?.content || "";
    const usage = extractUsage(data.usage);
    const finishReason = normalizeFinishReason(data.choices[0]?.finish_reason);
    const result: AIResponse = { text };
    if (usage) result.usage = usage;
    if (finishReason) result.finishReason = finishReason;
    return result;
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
