/**
 * Anthropic Claude Provider
 * Best models for code: claude-sonnet-4-6, claude-opus-4-6
 * Reference: https://docs.anthropic.com/en/docs/about-claude/models
 */

import type {
  AIModelConfig,
  AIResponse,
  AIResponseSchema,
  AIStreamChunk,
  AIUsage,
  IAIProvider,
} from "../types.js";
import { normalizeAnthropicBaseUrl } from "../anthropic-utils.js";
import { parseSseStream } from "../sse.js";

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  /** Only present on `tool_use` blocks (Phase 2.5 structured output). */
  input?: unknown;
  name?: string;
}

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
}

interface AnthropicResponse {
  content: AnthropicContentBlock[];
  usage?: AnthropicUsage;
  stop_reason?: string;
}

const STOP_REASON_MAP: Record<string, AIResponse["finishReason"]> = {
  end_turn: "stop",
  stop_sequence: "stop",
  max_tokens: "length",
  tool_use: "stop",
  refusal: "content_filter",
};

const normalizeStopReason = (raw?: string): AIResponse["finishReason"] => {
  if (!raw) return undefined;
  return STOP_REASON_MAP[raw];
};

const extractUsage = (raw?: AnthropicUsage): AIUsage | undefined => {
  if (!raw) return undefined;
  if (typeof raw.input_tokens !== "number" || typeof raw.output_tokens !== "number") {
    return undefined;
  }
  return { inputTokens: raw.input_tokens, outputTokens: raw.output_tokens };
};

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

  async generate(
    systemPrompt: string,
    userPrompt: string,
    responseSchema?: AIResponseSchema,
  ): Promise<AIResponse> {
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

    // Phase 2.5: Anthropic exposes structured output via the tool-use
    // pattern — we declare a single tool whose input_schema matches the
    // audit shape and force the model to call it. The DeepSeek shim
    // doesn't support tools so we skip the schema there.
    if (responseSchema && !this.isDeepSeek) {
      body["tools"] = [
        {
          name: responseSchema.name,
          description: "Emit the audit findings in the structured schema.",
          input_schema: responseSchema.schema,
        },
      ];
      body["tool_choice"] = { type: "tool", name: responseSchema.name };
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
    let text = data.content
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");
    // Phase 2.5: when structured output was requested, the model emits a
    // `tool_use` block whose `input` is the parsed JSON object. Serialize
    // it back to a JSON string so the downstream parser (which expects
    // text) keeps working unchanged.
    if (!text) {
      const toolBlock = data.content.find((b) => b.type === "tool_use" && b.input !== undefined);
      if (toolBlock?.input !== undefined) {
        text = JSON.stringify(toolBlock.input);
      }
    }
    const usage = extractUsage(data.usage);
    const finishReason = normalizeStopReason(data.stop_reason);
    const result: AIResponse = { text };
    if (usage) result.usage = usage;
    if (finishReason) result.finishReason = finishReason;
    return result;
  }

  /**
   * Stream a response chunk-by-chunk (Phase 3.2).
   *
   * Anthropic's streaming protocol uses standard SSE. The events we care
   * about are:
   *   - `content_block_delta` — `data.delta.text` carries the incremental text
   *   - `message_delta` — `data.usage` carries running output token counts
   *   - `message_start` — `data.message.usage.input_tokens`
   *   - `message_stop` — sentinel for end of stream
   *
   * DeepSeek-compatible endpoints (`baseUrl` includes `deepseek.com`)
   * disable streaming `thinking` mode for the same reason `generate()` does.
   */
  async *generateStream(
    systemPrompt: string,
    userPrompt: string,
    responseSchema?: AIResponseSchema,
  ): AsyncIterable<AIStreamChunk> {
    const body: Record<string, unknown> = {
      model: this.model,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      stream: true,
    };
    if (this.isDeepSeek) body["thinking"] = { type: "disabled" };
    if (responseSchema && !this.isDeepSeek) {
      body["tools"] = [
        {
          name: responseSchema.name,
          description: "Emit the audit findings in the structured schema.",
          input_schema: responseSchema.schema,
        },
      ];
      body["tool_choice"] = { type: "tool", name: responseSchema.name };
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
          "x-api-key": this.apiKey,
          "anthropic-version": this.apiVersion,
        },
        body: JSON.stringify(body),
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Anthropic streaming error: ${response.status} ${response.statusText} ${errorBody}`,
      );
    }

    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason: AIResponse["finishReason"] | undefined;
    // Buffered partial JSON for tool_use input deltas — Anthropic streams
    // structured output as `input_json_delta` snippets that must be
    // concatenated before parsing.
    let toolInputJson = "";

    for await (const ev of parseSseStream(response.body)) {
      if (!ev.data) continue;
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(ev.data) as Record<string, unknown>;
      } catch {
        continue;
      }
      const type = payload["type"] as string | undefined;
      if (type === "message_start") {
        const msg = payload["message"] as { usage?: { input_tokens?: number } } | undefined;
        if (typeof msg?.usage?.input_tokens === "number") {
          inputTokens = msg.usage.input_tokens;
        }
      } else if (type === "content_block_delta") {
        const delta = payload["delta"] as
          | { type?: string; text?: string; partial_json?: string }
          | undefined;
        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          yield { deltaText: delta.text, done: false };
        } else if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
          toolInputJson += delta.partial_json;
        }
      } else if (type === "message_delta") {
        const usage = payload["usage"] as { output_tokens?: number } | undefined;
        if (typeof usage?.output_tokens === "number") outputTokens = usage.output_tokens;
        const stop = (payload["delta"] as { stop_reason?: string } | undefined)?.stop_reason;
        finishReason =
          stop === "end_turn" || stop === "stop_sequence" || stop === "tool_use"
            ? "stop"
            : stop === "max_tokens"
              ? "length"
              : stop === "refusal"
                ? "content_filter"
                : undefined;
      } else if (type === "message_stop") {
        // Emit terminal chunk below.
        break;
      }
    }

    // If we accumulated a tool_use JSON object, emit it as a final delta
    // so the downstream parser (which expects text) sees structured output.
    const terminal: AIStreamChunk = {
      deltaText: toolInputJson || "",
      done: true,
    };
    if (inputTokens > 0 || outputTokens > 0) {
      terminal.usage = { inputTokens, outputTokens };
    }
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
