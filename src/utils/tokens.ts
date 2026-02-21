/**
 * Token estimation utilities using tiktoken
 * Used to warn when payloads approach AI provider context limits
 */

import { log } from "./logger.js";

// ── Provider-specific context-window limits ───────────────────────────────────
export const PROVIDER_TOKEN_LIMITS: Record<string, number> = {
  gemini: 1_000_000, // Gemini 1.5 Pro / 2.0 Flash
  openai: 128_000, // GPT-4o / GPT-4 Turbo
  anthropic: 200_000, // Claude 3.5 Sonnet / Opus
};

export const DEFAULT_TOKEN_LIMIT = 100_000; // Conservative default

/**
 * Resolve the token limit for a given provider name.
 * Falls back to DEFAULT_TOKEN_LIMIT for unknown providers.
 */
export const resolveTokenLimit = (provider?: string, configOverride?: number): number => {
  if (configOverride && configOverride > 0) return configOverride;
  if (provider) {
    const known = PROVIDER_TOKEN_LIMITS[provider.toLowerCase()];
    if (known) return known;
  }
  return DEFAULT_TOKEN_LIMIT;
};

// ── Lazy-load tiktoken ────────────────────────────────────────────────────────
let encoderCache: { encode: (text: string) => Uint32Array } | null = null;

const getEncoder = async (): Promise<{ encode: (text: string) => Uint32Array }> => {
  if (encoderCache) return encoderCache;
  try {
    // tiktoken uses cl100k_base for GPT-4 / Claude / Gemini approximation
    const { get_encoding } = await import("tiktoken");
    encoderCache = get_encoding("cl100k_base");
    return encoderCache;
  } catch {
    // Fallback: rough character-based estimate (1 token ≈ 4 chars)
    return {
      encode: (text: string) => new Uint32Array(Math.ceil(text.length / 4)),
    };
  }
};

/**
 * Estimate token count for a string.
 * Uses tiktoken cl100k_base (GPT-4 / Claude compatible).
 * Falls back to character-based estimate if tiktoken unavailable.
 */
export const estimateTokens = async (text: string): Promise<number> => {
  const encoder = await getEncoder();
  return encoder.encode(text).length;
};

/**
 * Estimate total tokens for a list of file payloads.
 * Returns the total count and per-file breakdown.
 */
export const estimatePayloadTokens = async (
  files: Array<{ path: string; content: string }>,
): Promise<{ total: number; perFile: Array<{ path: string; tokens: number }> }> => {
  const encoder = await getEncoder();
  const perFile = files.map((f) => ({
    path: f.path,
    tokens: encoder.encode(f.content).length,
  }));
  const total = perFile.reduce((sum, f) => sum + f.tokens, 0);
  return { total, perFile };
};

/**
 * Warn if total token count exceeds the given limit.
 * Returns true if the limit is exceeded (caller may choose to exit).
 *
 * @param total      Estimated total tokens
 * @param limit      Provider context-window limit
 * @param warnAt     Fraction of limit at which to warn (default: 0.8 = 80%)
 */
export const warnIfTokenLimitExceeded = (total: number, limit: number, warnAt = 0.8): boolean => {
  const warnThreshold = Math.floor(limit * warnAt);
  if (total >= limit) {
    log.warning(
      `⚠️  Estimated payload is ${total.toLocaleString()} tokens, which EXCEEDS the ` +
        `provider limit of ${limit.toLocaleString()} tokens. ` +
        `Reduce maxFiles or maxCharsPerFile in your config to avoid truncated results.`,
    );
    return true;
  }
  if (total >= warnThreshold) {
    log.warning(
      `⚠️  Estimated payload is ${total.toLocaleString()} tokens ` +
        `(${Math.round((total / limit) * 100)}% of the ${limit.toLocaleString()}-token limit). ` +
        `Consider reducing maxFiles or maxCharsPerFile.`,
    );
  }
  return false;
};

/**
 * Generate a human-readable payload summary with token estimates.
 * Accounts for system prompt tokens in the total.
 * Logs a warning and returns true if the limit is exceeded.
 *
 * @param files        File payloads to estimate
 * @param tokenLimit   Provider context-window limit
 * @param systemPrompt Optional system prompt to include in the estimate
 */
export const generatePayloadSummary = async (
  files: Array<{ path: string; content: string }>,
  tokenLimit: number,
  systemPrompt?: string,
): Promise<{ exceeded: boolean; total: number }> => {
  const { total: fileTokens, perFile } = await estimatePayloadTokens(files);

  // Account for system prompt overhead
  let systemPromptTokens = 0;
  if (systemPrompt) {
    const encoder = await getEncoder();
    systemPromptTokens = encoder.encode(systemPrompt).length;
  }

  const total = fileTokens + systemPromptTokens;

  log.info(
    `Payload summary: ${files.length} file(s), ~${fileTokens.toLocaleString()} file tokens` +
      (systemPromptTokens > 0
        ? ` + ~${systemPromptTokens.toLocaleString()} system prompt tokens`
        : "") +
      ` = ~${total.toLocaleString()} total`,
  );

  if (files.length > 0) {
    const top = [...perFile].sort((a, b) => b.tokens - a.tokens).slice(0, 3);
    for (const f of top) {
      log.file(`   ${f.path}: ~${f.tokens.toLocaleString()} tokens`);
    }
  }

  const exceeded = warnIfTokenLimitExceeded(total, tokenLimit);
  return { exceeded, total };
};

/**
 * Chunk a file's content into segments that fit within maxCharsPerFile.
 * Returns an array of chunks with their index for context.
 */
export const chunkFileContent = (content: string, maxCharsPerFile: number): string[] => {
  if (content.length <= maxCharsPerFile) return [content];

  const chunks: string[] = [];
  const lines = content.split("\n");
  let currentChunk: string[] = [];
  let currentLength = 0;

  for (const line of lines) {
    const lineLength = line.length + 1; // +1 for newline
    if (currentLength + lineLength > maxCharsPerFile && currentChunk.length > 0) {
      chunks.push(currentChunk.join("\n"));
      currentChunk = [];
      currentLength = 0;
    }
    currentChunk.push(line);
    currentLength += lineLength;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join("\n"));
  }

  return chunks;
};
