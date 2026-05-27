/**
 * Provider pricing table — USD cost per 1 million tokens (input / output).
 *
 * Numbers reflect the public list price for each model family at the time
 * of writing and are best-effort. Unknown providers/models return
 * `undefined`, which surfaces in the report as "cost unknown" rather than
 * a false zero.
 *
 * Update via PR when providers publish a price change. Models not listed
 * here fall through to the family prefix lookup (e.g. `gpt-5.2*` matches
 * the `gpt-5.2` family); if no family matches, cost reporting is skipped.
 */

import type { AIProvider, AIUsage } from "./types.js";

export interface ModelPrice {
  /** USD per 1M input (prompt) tokens */
  inputPerMillion: number;
  /** USD per 1M output (completion) tokens */
  outputPerMillion: number;
}

/**
 * Exact model id → price. Checked before the family-prefix table so a
 * specific override always wins.
 */
const EXACT_MODEL_PRICES: Record<string, ModelPrice> = {
  // Gemini 2.5
  "gemini-2.5-pro": { inputPerMillion: 1.25, outputPerMillion: 10.0 },
  "gemini-2.5-flash": { inputPerMillion: 0.3, outputPerMillion: 2.5 },
  "gemini-2.5-flash-lite": { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  // OpenAI GPT-5 family (representative — adjust when official prices shift)
  "gpt-5.2": { inputPerMillion: 2.5, outputPerMillion: 10.0 },
  "gpt-5.2-pro": { inputPerMillion: 10.0, outputPerMillion: 40.0 },
  "gpt-5-mini": { inputPerMillion: 0.25, outputPerMillion: 2.0 },
  // Anthropic Claude 4.6 family
  "claude-opus-4-7": { inputPerMillion: 15.0, outputPerMillion: 75.0 },
  "claude-opus-4-6": { inputPerMillion: 15.0, outputPerMillion: 75.0 },
  "claude-sonnet-4-6": { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  "claude-haiku-4-5": { inputPerMillion: 0.8, outputPerMillion: 4.0 },
  // xAI Grok
  "grok-4-1-fast-reasoning": { inputPerMillion: 0.2, outputPerMillion: 0.5 },
  "grok-code-fast-1": { inputPerMillion: 0.2, outputPerMillion: 1.5 },
};

/**
 * Family-prefix fallback. Used when the exact model id isn't in the table —
 * e.g. preview variants like `gemini-2.5-flash-preview` map to the base
 * `gemini-2.5-flash` price. First match wins; ordering matters.
 */
const FAMILY_PRICES: Array<{ prefix: string; price: ModelPrice }> = [
  { prefix: "gemini-2.5-pro", price: { inputPerMillion: 1.25, outputPerMillion: 10.0 } },
  {
    prefix: "gemini-2.5-flash-lite",
    price: { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  },
  { prefix: "gemini-2.5-flash", price: { inputPerMillion: 0.3, outputPerMillion: 2.5 } },
  { prefix: "gemini-3", price: { inputPerMillion: 2.0, outputPerMillion: 8.0 } },
  { prefix: "gpt-5.2", price: { inputPerMillion: 2.5, outputPerMillion: 10.0 } },
  { prefix: "gpt-5.4", price: { inputPerMillion: 3.5, outputPerMillion: 14.0 } },
  { prefix: "gpt-5.5", price: { inputPerMillion: 4.0, outputPerMillion: 16.0 } },
  { prefix: "gpt-5-mini", price: { inputPerMillion: 0.25, outputPerMillion: 2.0 } },
  { prefix: "claude-opus", price: { inputPerMillion: 15.0, outputPerMillion: 75.0 } },
  { prefix: "claude-sonnet", price: { inputPerMillion: 3.0, outputPerMillion: 15.0 } },
  { prefix: "claude-haiku", price: { inputPerMillion: 0.8, outputPerMillion: 4.0 } },
  { prefix: "grok-4", price: { inputPerMillion: 0.5, outputPerMillion: 1.5 } },
];

/**
 * Look up a price for a given provider + model id.
 * OpenRouter ids carry a provider prefix (`openai/gpt-5.2`) which is stripped
 * before lookup so the OpenAI/Anthropic/etc. tables apply.
 */
export const getModelPrice = (provider: AIProvider, model: string): ModelPrice | undefined => {
  const lookupModel =
    provider === "openrouter" && model.includes("/") ? (model.split("/")[1] ?? model) : model;

  const exact = EXACT_MODEL_PRICES[lookupModel];
  if (exact) return exact;

  for (const entry of FAMILY_PRICES) {
    if (lookupModel.startsWith(entry.prefix)) return entry.price;
  }
  return undefined;
};

/**
 * Compute USD cost for a single call. Returns `undefined` when usage or
 * pricing is unknown so callers can distinguish "no data" from "$0.00".
 */
export const estimateCost = (
  provider: AIProvider,
  model: string,
  usage: AIUsage | undefined,
): number | undefined => {
  if (!usage) return undefined;
  const price = getModelPrice(provider, model);
  if (!price) return undefined;
  const inputCost = (usage.inputTokens / 1_000_000) * price.inputPerMillion;
  const outputCost = (usage.outputTokens / 1_000_000) * price.outputPerMillion;
  return inputCost + outputCost;
};
