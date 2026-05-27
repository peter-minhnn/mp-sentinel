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
} from "../types.js";
import { parseSseStream } from "../sse.js";

interface OpenAIResponseOutputContent {
  text?: string;
}

interface OpenAIResponseOutput {
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

const extractText = (data: OpenAIResponse): string => {
  if (data.output_text) return data.output_text;
  if (data.output?.[0]?.content?.[0]?.text) {
    return data.output[0].content[0].text;
  }
  return "";
};

export class OpenAIProvider implements IAIProvider {
  private apiKey: string;
  private model: string;
  private temperature: number;
  private maxTokens: number;
  private timeoutMs: number;
  private baseURL = "https://api.openai.com/v1/responses";

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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    const body: Record<string, unknown> = {
      model: this.model,
      instructions: systemPrompt,
      input: userPrompt,
      max_output_tokens: this.maxTokens,
      temperature: this.temperature,
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
      max_output_tokens: this.maxTokens,
      temperature: this.temperature,
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
