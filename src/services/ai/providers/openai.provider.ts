/**
 * OpenAI GPT Provider (Responses API)
 * Uses the POST /v1/responses endpoint.
 * Reference: https://platform.openai.com/docs/api-reference/responses
 */

import type {
  AIModelConfig,
  AIResponse,
  AIResponseSchema,
  AIStreamChunk,
  AIUsage,
  IAIProvider,
  ReasoningEffort,
} from "../types.js";
import { parseSseStream } from "../sse.js";

/**
 * Reasoning models exposed via the Responses API (GPT-5.x and the o-series)
 * do NOT accept the `temperature` parameter — they reject the request with
 * a 400 `Unsupported parameter: 'temperature'`. Instead they take a
 * `reasoning.effort` hint. We detect them by model-name prefix and switch
 * the request body accordingly.
 *
 * Matches: gpt-5, gpt-5.2, gpt-5.5-mini, o1, o1-mini, o3, o3-pro, o4-mini, …
 */
const isReasoningModel = (model: string): boolean => {
  const m = model.trim().toLowerCase();
  return /^gpt-5(\b|[.-])/.test(m) || /^o[1-9](\b|[.-])/.test(m);
};

interface OpenAIResponseOutputContent {
  type?: string;
  text?: string;
}

interface OpenAIResponseOutput {
  /** "message" for assistant output; "reasoning" for the thinking item. */
  type?: string;
  role?: string;
  content?: OpenAIResponseOutputContent[];
}

interface OpenAIResponseUsage {
  input_tokens?: number;
  output_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
}

interface OpenAIResponse {
  output_text?: string;
  output?: OpenAIResponseOutput[];
  usage?: OpenAIResponseUsage;
  finish_reason?: string;
  status?: string;
}

const FINISH_REASON_MAP: Record<string, AIResponse["finishReason"]> = {
  stop: "stop",
  completed: "stop",
  length: "length",
  max_output_tokens: "length",
  content_filter: "content_filter",
  refusal: "content_filter",
  error: "error",
  failed: "error",
};

const normalizeFinishReason = (raw?: string): AIResponse["finishReason"] => {
  if (!raw) return undefined;
  return FINISH_REASON_MAP[raw];
};

const extractUsage = (raw?: OpenAIResponseUsage): AIUsage | undefined => {
  if (!raw) return undefined;
  const input = raw.input_tokens ?? raw.prompt_tokens;
  const output = raw.output_tokens ?? raw.completion_tokens;
  if (typeof input !== "number" || typeof output !== "number") return undefined;
  return { inputTokens: input, outputTokens: output };
};

const collectText = (
  items: readonly OpenAIResponseOutput[],
  match: (item: OpenAIResponseOutput) => boolean,
): string => {
  const parts: string[] = [];
  for (const item of items) {
    if (!match(item)) continue;
    for (const content of item.content ?? []) {
      if (typeof content.text === "string" && content.text.length > 0) {
        parts.push(content.text);
      }
    }
  }
  return parts.join("");
};

/**
 * Resolve the Responses API endpoint, honoring a custom OpenAI-compatible base
 * URL (e.g. a corporate gateway or proxy) via OPENAI_BASE_URL. Without this the
 * provider always hit api.openai.com, so a "custom endpoint" configured in the
 * UI was silently ignored. Normalization is forgiving:
 *   - ".../responses" or ".../v1/responses" → used as-is
 *   - ".../v1"                              → append "/responses"
 *   - anything else                          → append "/v1/responses"
 */
const DEFAULT_OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

export const resolveOpenAIResponsesURL = (rawBase?: string): string => {
  const base = (rawBase ?? "").trim().replace(/\/+$/, "");
  if (base.length === 0) return DEFAULT_OPENAI_RESPONSES_URL;
  if (/\/responses$/.test(base)) return base;
  if (/\/v\d+$/.test(base)) return `${base}/responses`;
  return `${base}/v1/responses`;
};

const extractText = (data: OpenAIResponse): string => {
  // `output_text` is a convenience aggregate some responses include.
  if (typeof data.output_text === "string" && data.output_text.length > 0) {
    return data.output_text;
  }
  const items = data.output ?? [];
  // Reasoning models (GPT-5.x, o-series) put a `reasoning` item FIRST and the
  // assistant text in a later `message` item — so we must find the message by
  // type, not assume index 0. Non-reasoning models have the message at index 0,
  // which this still handles.
  const fromMessage = collectText(items, (item) => item.type === "message");
  if (fromMessage.length > 0) return fromMessage;
  // Fallback: any output item that carries text (covers shape variations).
  return collectText(items, () => true);
};

export class OpenAIProvider implements IAIProvider {
  private apiKey: string;
  private model: string;
  private temperature: number;
  private seed: number | undefined;
  private reasoningEffort: ReasoningEffort;
  private maxTokens: number;
  private timeoutMs: number;
  private baseURL: string;

  constructor(config: AIModelConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.temperature = config.temperature ?? 0;
    this.seed = config.seed;
    this.reasoningEffort = config.reasoningEffort ?? "medium";
    this.maxTokens = config.maxTokens ?? 2048;
    // Reasoning models (GPT-5.x, o-series) think before answering, so a single
    // request routinely runs well past the 30s chat-model default — the request
    // then aborts ("This operation was aborted") and retries fruitlessly. Give
    // them a much longer default; an explicit AI_TIMEOUT_MS still overrides.
    const explicitTimeout = process.env.AI_TIMEOUT_MS;
    const defaultTimeout = isReasoningModel(config.model) ? 180_000 : 30_000;
    this.timeoutMs =
      explicitTimeout && explicitTimeout.trim().length > 0
        ? parseInt(explicitTimeout, 10)
        : defaultTimeout;
    // config.baseUrl (from settings) wins; OPENAI_BASE_URL env is the fallback.
    this.baseURL = resolveOpenAIResponsesURL(config.baseUrl ?? process.env.OPENAI_BASE_URL);
  }

  /**
   * Build the sampling-control fields for the request body. Reasoning models
   * (GPT-5.x, o-series) reject `temperature` and instead accept
   * `reasoning.effort`; everything else takes `temperature`.
   */
  private samplingParams(): Record<string, unknown> {
    if (isReasoningModel(this.model)) {
      // Reasoning models reject `temperature`/`seed`; determinism is governed
      // by `reasoning.effort` only.
      return { reasoning: { effort: this.reasoningEffort } };
    }
    return {
      temperature: this.temperature,
      ...(this.seed !== undefined && { seed: this.seed }),
    };
  }

  /**
   * Output-token budget. Reasoning models spend `max_output_tokens` on BOTH
   * the hidden reasoning and the visible answer, so a tight budget can starve
   * the answer to empty (status "incomplete") and break parsing. Give them a
   * floor so the audit JSON always fits; callers can raise it via AI_MAX_TOKENS.
   */
  private maxOutputTokens(): number {
    if (isReasoningModel(this.model)) {
      return Math.max(this.maxTokens, 4096);
    }
    return this.maxTokens;
  }

  async generate(
    systemPrompt: string,
    userPrompt: string,
    responseSchema?: AIResponseSchema,
  ): Promise<AIResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    const body: Record<string, unknown> = {
      model: this.model,
      instructions: systemPrompt,
      input: userPrompt,
      max_output_tokens: this.maxOutputTokens(),
      ...this.samplingParams(),
      store: false,
    };
    // Phase 2.5: OpenAI Responses API supports `text.format.json_schema`
    // to constrain output to a JSON schema. When the caller provides a
    // schema we attach it; otherwise legacy text-mode parsing applies.
    if (responseSchema) {
      body["text"] = {
        format: {
          type: "json_schema",
          name: responseSchema.name,
          schema: responseSchema.schema,
          strict: responseSchema.strict !== false,
        },
      };
    }

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
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText} ${errorBody}`);
      }

      const data = (await response.json()) as OpenAIResponse;
      const text = extractText(data);
      const usage = extractUsage(data.usage);
      const finishReason = normalizeFinishReason(data.finish_reason ?? data.status);
      const result: AIResponse = { text };
      if (usage) result.usage = usage;
      if (finishReason) result.finishReason = finishReason;
      return result;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Stream a response chunk-by-chunk (Phase 3.2).
   *
   * OpenAI's Responses API supports SSE streaming via `stream: true`. We
   * watch for:
   *   - `response.output_text.delta` events — `data.delta` carries text deltas
   *   - `response.completed` — `data.response.usage` carries the totals
   *   - `response.failed` / `response.incomplete` — surface as finishReason
   *
   * When structured output is in use (`responseSchema`), the deltas still
   * arrive as text fragments that, when concatenated, form valid JSON.
   */
  async *generateStream(
    systemPrompt: string,
    userPrompt: string,
    responseSchema?: AIResponseSchema,
  ): AsyncIterable<AIStreamChunk> {
    const body: Record<string, unknown> = {
      model: this.model,
      instructions: systemPrompt,
      input: userPrompt,
      max_output_tokens: this.maxOutputTokens(),
      ...this.samplingParams(),
      store: false,
      stream: true,
    };
    if (responseSchema) {
      body["text"] = {
        format: {
          type: "json_schema",
          name: responseSchema.name,
          schema: responseSchema.schema,
          strict: responseSchema.strict !== false,
        },
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(this.baseURL, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `OpenAI streaming error: ${response.status} ${response.statusText} ${errorBody}`,
      );
    }

    let usage: AIUsage | undefined;
    let finishReason: AIResponse["finishReason"] | undefined;

    for await (const ev of parseSseStream(response.body)) {
      if (!ev.data || ev.data === "[DONE]") continue;
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(ev.data) as Record<string, unknown>;
      } catch {
        continue;
      }
      const type = (payload["type"] as string | undefined) ?? ev.event;
      if (type === "response.output_text.delta") {
        const delta = payload["delta"];
        if (typeof delta === "string" && delta.length > 0) {
          yield { deltaText: delta, done: false };
        }
      } else if (type === "response.completed" || type === "response.incomplete") {
        const resp = payload["response"] as
          | { usage?: OpenAIResponseUsage; status?: string }
          | undefined;
        usage = extractUsage(resp?.usage);
        finishReason = normalizeFinishReason(resp?.status);
        break;
      } else if (type === "response.failed" || type === "error") {
        finishReason = "error";
        break;
      }
    }

    const terminal: AIStreamChunk = { deltaText: "", done: true };
    if (usage) terminal.usage = usage;
    if (finishReason) terminal.finishReason = finishReason;
    yield terminal;
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
