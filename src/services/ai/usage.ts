/**
 * Token usage helpers shared by auditFile / auditCommit and the
 * review-summary aggregator (Phase 1.1).
 *
 * Lives in its own file to keep `services/ai/index.ts` under the 500-line
 * policy ceiling (see SKILL.md).
 */

import type {
  AIProvider,
  AIResponse,
  AIResponseSchema,
  AIStreamChunk,
  AIUsage,
  IAIProvider,
} from "./types.js";
import type { AuditResult, FileAuditResult } from "../../types/index.js";
import { estimateCost } from "./pricing.js";

/**
 * Invoke a provider while gracefully handling the legacy contract where
 * `generate()` is not implemented. Real production providers implement
 * `generate`; some test mocks predate Phase 1.1 and only have
 * `generateContent` — for those we return an AIResponse with no usage data.
 *
 * Phase 2.5: optional `responseSchema` parameter — providers that support
 * structured output use it; legacy mocks ignore it transparently.
 */
/**
 * Stream from a provider with graceful fallback (Phase 3.2). Yields chunks
 * directly when the provider implements `generateStream`; otherwise calls
 * `generate()` and synthesizes a single terminal chunk. Callbacks that
 * just want the final text + usage can pass the result through
 * `assembleStream()`.
 */
export const callGenerateStream = async function* (
  provider: IAIProvider,
  systemPrompt: string,
  userPrompt: string,
  responseSchema?: AIResponseSchema,
): AsyncIterable<AIStreamChunk> {
  if (typeof provider.generateStream === "function") {
    yield* provider.generateStream(systemPrompt, userPrompt, responseSchema);
    return;
  }
  // Fallback: collect via generate() and emit one synthetic terminal chunk.
  const response = await callGenerate(provider, systemPrompt, userPrompt, responseSchema);
  const chunk: AIStreamChunk = { deltaText: response.text, done: true };
  if (response.usage) chunk.usage = response.usage;
  if (response.finishReason) chunk.finishReason = response.finishReason;
  yield chunk;
};

/**
 * Drain an async-iterable of stream chunks into a single AIResponse.
 * Useful for callers that don't actually care about incremental delivery
 * (the cache layer, JSON-output mode, etc.) but want the same usage
 * accounting as a streamed call.
 */
export const assembleStream = async (
  stream: AsyncIterable<AIStreamChunk>,
  onDelta?: (delta: string) => void,
): Promise<AIResponse> => {
  let text = "";
  let usage: AIUsage | undefined;
  let finishReason: AIResponse["finishReason"] | undefined;
  for await (const chunk of stream) {
    if (chunk.deltaText) {
      text += chunk.deltaText;
      onDelta?.(chunk.deltaText);
    }
    if (chunk.done) {
      if (chunk.usage) usage = chunk.usage;
      if (chunk.finishReason) finishReason = chunk.finishReason;
    }
  }
  const result: AIResponse = { text };
  if (usage) result.usage = usage;
  if (finishReason) result.finishReason = finishReason;
  return result;
};

export const callGenerate = async (
  provider: IAIProvider,
  systemPrompt: string,
  userPrompt: string,
  responseSchema?: AIResponseSchema,
): Promise<AIResponse> => {
  if (typeof provider.generate === "function") {
    return provider.generate(systemPrompt, userPrompt, responseSchema);
  }
  const text = await provider.generateContent(systemPrompt, userPrompt);
  return { text };
};

/**
 * Attach provider-reported usage to an AuditResult parsed from response text.
 * Keeps the merge in one place so cache reads (which never see usage) and
 * fresh calls produce consistent shapes.
 */
export const withUsage = (result: AuditResult, response: AIResponse): AuditResult => {
  if (!response.usage) return result;
  return { ...result, usage: response.usage };
};

/**
 * Sum a list of optional AIUsage objects. Returns undefined when every
 * input is absent so callers can omit the `usage` field entirely on
 * deterministic / all-cached paths.
 */
export const sumUsages = (usages: Array<AIUsage | undefined>): AIUsage | undefined => {
  let input = 0;
  let output = 0;
  let any = false;
  for (const u of usages) {
    if (!u) continue;
    any = true;
    input += u.inputTokens;
    output += u.outputTokens;
  }
  return any ? { inputTokens: input, outputTokens: output } : undefined;
};

export interface ReviewUsageSummary {
  inputTokens: number;
  outputTokens: number;
  /**
   * Number of AI calls that contributed usage data. May be < auditedFiles
   * when some calls were cached or providers omitted usage data.
   */
  callCount: number;
  /** Best-effort USD cost. Absent when the model has no entry in pricing. */
  estimatedCostUsd?: number;
}

/**
 * Aggregate per-file audit usage into a single review-level summary.
 * Returns undefined when no file in the batch reported usage (e.g. dry-run,
 * deterministic-only, or fully cached runs).
 */
export const summarizeUsage = (
  results: FileAuditResult[],
  provider: AIProvider,
  model: string,
): ReviewUsageSummary | undefined => {
  let input = 0;
  let output = 0;
  let callCount = 0;
  for (const r of results) {
    const u = r.result.usage;
    if (!u) continue;
    input += u.inputTokens;
    output += u.outputTokens;
    callCount += 1;
  }
  if (callCount === 0) return undefined;
  const cost = estimateCost(provider, model, { inputTokens: input, outputTokens: output });
  return {
    inputTokens: input,
    outputTokens: output,
    callCount,
    ...(typeof cost === "number" && { estimatedCostUsd: cost }),
  };
};

/** Stable circuit-breaker key for a given provider+model. */
export const breakerKey = (provider: AIProvider, model: string): string => `${provider}:${model}`;
