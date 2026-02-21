/**
 * Retry utility with exponential backoff and jitter
 * Used for transient AI provider errors (rate limits, network timeouts, 5xx)
 */

import { log } from "./logger.js";

export interface RetryOptions {
  /** Maximum number of attempts (default: 3) */
  maxAttempts?: number;
  /** Base delay in milliseconds before first retry (default: 500) */
  baseDelayMs?: number;
  /** Maximum delay cap in milliseconds (default: 10000) */
  maxDelayMs?: number;
}

/**
 * Determine whether an error is worth retrying.
 * Retryable: rate limits (429), server errors (503), network resets, timeouts.
 */
export const isRetryableError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("429") ||
    error.message.includes("503") ||
    error.message.includes("ECONNRESET") ||
    error.name === "AbortError"
  );
};

/**
 * Execute `fn` with automatic retries on transient errors.
 * Uses exponential backoff with random jitter to avoid thundering-herd.
 *
 * @example
 * const result = await withRetry(() => provider.generateContent(prompt, user), { maxAttempts: 3 });
 */
export const withRetry = async <T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> => {
  const { maxAttempts = 3, baseDelayMs = 500, maxDelayMs = 10_000 } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const retryable = isRetryableError(error);
      if (!retryable || attempt === maxAttempts) {
        throw error;
      }

      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1) + Math.random() * 100, maxDelayMs);
      log.warning(`Attempt ${attempt}/${maxAttempts} failed. Retrying in ${Math.round(delay)}ms…`);
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }

  // This line is unreachable but satisfies TypeScript's control-flow analysis.
  throw new Error("withRetry: unreachable");
};
