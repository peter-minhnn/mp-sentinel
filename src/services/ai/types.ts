/**
 * AI Provider types and interfaces
 */

export type AIProvider = "gemini" | "openai" | "anthropic" | "grok" | "openrouter";

/**
 * Model tier selector — controls which model from the provider's tier
 * catalog is used when no explicit AI_MODEL is set.
 * - premium: best / newest models for hard reviews (security, architecture)
 * - balanced: default / stable models for everyday CI
 * - budget: cheap / fast models for bulk review
 */
export type ModelTier = "premium" | "balanced" | "budget";

/**
 * Reasoning effort level for OpenAI reasoning models (GPT-5.x, o-series).
 * These models use the Responses API `reasoning.effort` parameter instead
 * of `temperature`, which they do not support.
 */
export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

export interface AIModelConfig {
  provider: AIProvider;
  model: string;
  apiKey: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  /**
   * Reasoning effort for OpenAI reasoning models (GPT-5.x, o-series).
   * Ignored by non-reasoning models and other providers. Defaults to
   * "medium" when omitted.
   */
  reasoningEffort?: ReasoningEffort;
}

/**
 * Token usage reported by an AI provider for a single generation.
 * All counts are absolute (not deltas). Optional because providers
 * occasionally omit the field on partial responses.
 */
export interface AIUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Structured response from a provider call. The `text` field is the
 * generated content; `usage` carries token counts when the provider
 * reports them; `finishReason` is normalized across SDKs.
 */
export interface AIResponse {
  text: string;
  usage?: AIUsage;
  finishReason?: "stop" | "length" | "content_filter" | "error";
}

/**
 * Streaming chunk emitted by `IAIProvider.generateStream` (Phase 3.2).
 *
 * Each chunk carries an incremental delta of generated text. When the
 * stream is complete the provider emits one final chunk with `done: true`
 * and the optional `usage` block populated. Mid-stream chunks have
 * `done: false` and no usage.
 *
 * Consumers can `for await (const chunk of stream) { … }` and assemble
 * the full text by concatenating `chunk.deltaText`. The cache layer
 * receives only the assembled text + usage, so streaming and non-streaming
 * audits produce identical cache entries.
 */
export interface AIStreamChunk {
  /** Incremental text produced since the previous chunk. */
  deltaText: string;
  /** True for the terminal chunk (after which the iterator ends). */
  done: boolean;
  /** Token usage — only populated on the terminal chunk. */
  usage?: AIUsage;
  /** Provider-reported finish reason — only populated on the terminal chunk. */
  finishReason?: AIResponse["finishReason"];
}

/**
 * Optional JSON Schema parameter (Phase 2.5 — provider-native structured
 * output). When supplied, providers that support structured output
 * constrain the model to emit a JSON object matching this schema. The
 * schema is the audit-issue rubric defined in src/config/prompts.ts.
 */
export interface AIResponseSchema {
  /** Schema name used by OpenAI's response_format.json_schema. */
  name: string;
  /** A subset of JSON Schema. Only the fields supported by most providers. */
  schema: Record<string, unknown>;
  /** When true, the provider must reject responses that don't match. */
  strict?: boolean;
}

export interface IAIProvider {
  /**
   * Generate a structured response including token usage when available.
   * Providers that cannot determine usage may omit the `usage` field.
   * Optional for backward compatibility — callers should fall back to
   * `generateContent` when this is missing (see callGenerate in usage.ts).
   *
   * Phase 2.5: the optional `responseSchema` parameter constrains the
   * provider to emit JSON matching the given schema when supported. When
   * the provider doesn't support structured output the schema is ignored
   * and the model's text response is parsed defensively as before.
   */
  generate?(
    systemPrompt: string,
    userPrompt: string,
    responseSchema?: AIResponseSchema,
  ): Promise<AIResponse>;
  /**
   * Streaming variant (Phase 3.2). Optional: providers that don't ship a
   * streaming implementation fall back to `generate()` and emit a single
   * terminal chunk. The yielded sequence ends with a chunk whose
   * `done: true` flag is set; cumulative usage rides on that chunk.
   */
  generateStream?(
    systemPrompt: string,
    userPrompt: string,
    responseSchema?: AIResponseSchema,
  ): AsyncIterable<AIStreamChunk>;
  /**
   * Plain-text generation. Required for all providers and used as a
   * fallback path when `generate()` is not implemented (e.g. legacy
   * test mocks).
   */
  generateContent(systemPrompt: string, userPrompt: string): Promise<string>;
  isAvailable(): boolean;
}

export interface AIProviderFactory {
  createProvider(config: AIModelConfig): IAIProvider;
}
