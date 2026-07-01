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
 * Status codes returned by AI providers that indicate a transient failure
 * worth retrying. 408 (request timeout), 429 (rate limited), 5xx (server
 * errors). 501/505 are deliberately omitted because they signal a hard
 * client/server contract mismatch, not a transient issue.
 */
const RETRYABLE_STATUS_PATTERNS: RegExp[] = [
  /\b408\b/,
  /\b425\b/, // too early — sometimes returned by edge networks
  /\b429\b/,
  /\b500\b/,
  /\b502\b/,
  /\b503\b/,
  /\b504\b/,
  /\b522\b/, // Cloudflare connection timed out
  /\b524\b/, // Cloudflare a timeout occurred
];

/**
 * Substrings (case-insensitive) that signal a retryable transport-layer
 * failure regardless of HTTP status. Kept as a flat list so adding new
 * signals is a one-line change.
 */
const RETRYABLE_MESSAGE_NEEDLES: readonly string[] = [
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE", // broken pipe on a half-closed connection
  "EAI_AGAIN",
  "ENETUNREACH",
  "ENOTFOUND", // transient DNS hiccup
  "socket hang up",
  // undici/fetch transient socket teardown mid-request. The provider drops a
  // long-running request (common with DeepSeek thinking mode) and the whole
  // review otherwise fails on a single file. Safe to retry.
  "socket connection was closed",
  "closed unexpectedly",
  "other side closed",
  "UND_ERR_SOCKET",
  "network timeout",
  "fetch failed",
  "request timed out",
  "Service Unavailable",
  "Bad Gateway",
  "Gateway Timeout",
];

/**
 * Determine whether an error is worth retrying.
 * Retryable: rate limits (408/425/429), server errors (5xx), network resets,
 * DNS hiccups, socket hangups, fetch failures, and explicit AbortError.
 */
export const isRetryableError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return true;

  const message = error.message;
  if (RETRYABLE_STATUS_PATTERNS.some((re) => re.test(message))) return true;

  const lower = message.toLowerCase();
  return RETRYABLE_MESSAGE_NEEDLES.some((needle) => lower.includes(needle.toLowerCase()));
};

/**
 * Parse a Retry-After header value from inside an error message. Providers
 * commonly include the raw response body in the thrown Error.message; if
 * that body has a `Retry-After: N` line or a JSON `retry_after` field we
 * honor it so the next attempt waits at least that long.
 *
 * Returns delay in milliseconds, capped to `maxDelayMs`, or undefined when
 * no Retry-After signal is found.
 */
export const parseRetryAfterMs = (errorMessage: string, maxDelayMs: number): number | undefined => {
  // RFC 7231 header form: "Retry-After: 30" (seconds)
  const headerMatch = errorMessage.match(/Retry-After:\s*(\d+)/i);
  if (headerMatch) {
    const seconds = parseInt(headerMatch[1]!, 10);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, maxDelayMs);
    }
  }

  // JSON body form: "retry_after": 12 or "retry_after_ms": 12000
  const jsonMs = errorMessage.match(/"retry_after_ms"\s*:\s*(\d+)/);
  if (jsonMs) {
    const ms = parseInt(jsonMs[1]!, 10);
    if (Number.isFinite(ms) && ms > 0) return Math.min(ms, maxDelayMs);
  }
  const jsonSec = errorMessage.match(/"retry_after"\s*:\s*(\d+)/);
  if (jsonSec) {
    const seconds = parseInt(jsonSec[1]!, 10);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, maxDelayMs);
    }
  }

  return undefined;
};

/**
 * Execute `fn` with automatic retries on transient errors.
 * Uses exponential backoff with random jitter to avoid thundering-herd.
 * Honors Retry-After signals in error messages (RFC 7231 or JSON body).
 *
 * @example
 * const result = await withRetry(() => provider.generate(prompt, user), { maxAttempts: 3 });
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

      const errorMsg = error instanceof Error ? error.message : String(error);
      const retryAfter = parseRetryAfterMs(errorMsg, maxDelayMs);
      // Exponential backoff with jitter; clamp to maxDelay. If Retry-After
      // is present, honor it (still capped) — providers know best.
      const backoff = Math.min(baseDelayMs * 2 ** (attempt - 1) + Math.random() * 100, maxDelayMs);
      const delay = retryAfter ?? backoff;
      // Surface WHY it failed — a bare "Attempt failed" hides the cause (rate
      // limit, 5xx, network, timeout), making repeated retries impossible to
      // diagnose. Keep it to the first line, trimmed, so logs stay readable.
      const reason = errorMsg.split("\n")[0]?.slice(0, 300) ?? "unknown error";
      log.warning(
        `Attempt ${attempt}/${maxAttempts} failed: ${reason}. Retrying in ${Math.round(delay)}ms…`,
      );
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }

  // This line is unreachable but satisfies TypeScript's control-flow analysis.
  throw new Error("withRetry: unreachable");
};
