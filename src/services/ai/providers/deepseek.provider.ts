/**
 * DeepSeek API Provider (OpenAI-compatible Chat Completions).
 * Reference: https://api-docs.deepseek.com/api/create-chat-completion
 *
 * Unlike the Anthropic-compatible shim (`api.deepseek.com/anthropic`), this
 * path supports the two features audits need for stable, cacheable output:
 *   - `thinking: { type: "disabled" }` — suppress chain-of-thought so the
 *     response is compact JSON, not reasoning prose (also keeps output under
 *     `max_tokens`).
 *   - `response_format: { type: "json_object" }` — DeepSeek guarantees the
 *     content is valid JSON, so the audit parser stops producing ERROR results.
 *     ERROR results are never cached, so JSON mode is what lets the cache fill
 *     and makes repeated reviews of the same diff deterministic.
 *
 * DeepSeek has NO `seed` parameter (verified against the official spec), so
 * run-to-run determinism comes from temperature 0 plus the audit cache, not
 * from seeded sampling.
 */

import type {
  AIModelConfig,
  AIResponse,
  AIResponseSchema,
  AIUsage,
  IAIProvider,
} from "../types.js";

interface DeepSeekMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface DeepSeekUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

interface DeepSeekChoice {
  message: { content: string | null };
  finish_reason?: string;
}

interface DeepSeekResponse {
  choices: DeepSeekChoice[];
  usage?: DeepSeekUsage;
}

const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";

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

const extractUsage = (raw?: DeepSeekUsage): AIUsage | undefined => {
  if (!raw) return undefined;
  if (typeof raw.prompt_tokens !== "number" || typeof raw.completion_tokens !== "number") {
    return undefined;
  }
  return { inputTokens: raw.prompt_tokens, outputTokens: raw.completion_tokens };
};

/**
 * Resolve the chat-completions endpoint. Accepts a bare host
 * (`https://api.deepseek.com`), a `/v1` or `/beta` suffixed base, or a full
 * `/chat/completions` URL, and always returns the completions path.
 */
const resolveDeepSeekURL = (raw: string | undefined): string => {
  const base = (raw ?? DEFAULT_DEEPSEEK_BASE_URL).trim().replace(/\/+$/, "");
  if (base.length === 0) return `${DEFAULT_DEEPSEEK_BASE_URL}/chat/completions`;
  if (/\/chat\/completions$/.test(base)) return base;
  return `${base}/chat/completions`;
};

export class DeepSeekProvider implements IAIProvider {
  private apiKey: string;
  private model: string;
  private temperature: number;
  private maxTokens: number;
  private timeoutMs: number;
  private baseURL: string;
  private thinkingEnabled: boolean;

  constructor(config: AIModelConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.temperature = config.temperature ?? 0;
    this.maxTokens = config.maxTokens ?? 2048;
    // Thinking (chain-of-thought) is ON by default: deepseek-v4 is a reasoning
    // model and with thinking disabled it rubber-stamps every file as PASS
    // (~15 output tokens) instead of analyzing. Set DEEPSEEK_THINKING=disabled
    // for a fast/cheap shallow pass.
    this.thinkingEnabled =
      (process.env.DEEPSEEK_THINKING ?? "enabled").trim().toLowerCase() !== "disabled";
    // deepseek-v4 models are large and (even with thinking disabled) routinely
    // take well over the 30s chat-model default on big diff hunks. A short
    // timeout aborts mid-generation ("The operation was aborted"), which marks
    // the file ERROR and poisons the whole run's status. Give them a generous
    // default like the OpenAI reasoning models; AI_TIMEOUT_MS still overrides.
    const explicitTimeout = process.env.AI_TIMEOUT_MS;
    this.timeoutMs =
      explicitTimeout && explicitTimeout.trim().length > 0
        ? parseInt(explicitTimeout, 10)
        : 180_000;
    // config.baseUrl (from settings) wins; DEEPSEEK_BASE_URL env is the fallback.
    this.baseURL = resolveDeepSeekURL(config.baseUrl ?? process.env.DEEPSEEK_BASE_URL);
  }

  async generate(
    systemPrompt: string,
    userPrompt: string,
    responseSchema?: AIResponseSchema,
  ): Promise<AIResponse> {
    const messages: DeepSeekMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    // In thinking mode the reasoning trace counts toward max_tokens, so a tight
    // budget starves the final JSON answer (truncated -> parse ERROR -> not
    // cached). Give the answer generous headroom; the visible answer stays small
    // because the reasoning lives in a separate `reasoning_content` field.
    const effectiveMaxTokens = this.thinkingEnabled
      ? Math.max(this.maxTokens, 16_000)
      : this.maxTokens;

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: this.temperature,
      max_tokens: effectiveMaxTokens,
      thinking: { type: this.thinkingEnabled ? "enabled" : "disabled" },
    };
    // JSON mode guarantees the final `content` is valid JSON. The reasoning
    // trace (when thinking is on) is returned separately in `reasoning_content`,
    // which we ignore — so parsing `content` keeps working unchanged.
    if (responseSchema) {
      body["response_format"] = { type: "json_object" };
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
        throw new Error(
          `DeepSeek API error: ${response.status} ${response.statusText} ${errorBody}`,
        );
      }

      const data = (await response.json()) as DeepSeekResponse;
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
