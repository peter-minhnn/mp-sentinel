/**
 * Unit tests for retry utility
 */

import { describe, it, expect, jest } from "@jest/globals";
import { withRetry, isRetryableError } from "../utils/retry.js";

// ── isRetryableError ──────────────────────────────────────────────────────────

describe("isRetryableError", () => {
  it("returns true for 429 errors", () => {
    expect(isRetryableError(new Error("HTTP 429 Too Many Requests"))).toBe(true);
  });

  it("returns true for 503 errors", () => {
    expect(isRetryableError(new Error("503 Service Unavailable"))).toBe(true);
  });

  it("returns true for ECONNRESET errors", () => {
    expect(isRetryableError(new Error("ECONNRESET"))).toBe(true);
  });

  it("returns true for AbortError", () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    expect(isRetryableError(err)).toBe(true);
  });

  it("returns false for non-retryable errors", () => {
    expect(isRetryableError(new Error("Invalid API key"))).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isRetryableError("string error")).toBe(false);
    expect(isRetryableError(null)).toBe(false);
  });
});

// ── withRetry ─────────────────────────────────────────────────────────────────

describe("withRetry", () => {
  it("returns result on first success", async () => {
    const fn = jest.fn<() => Promise<string>>().mockResolvedValue("ok");
    const result = await withRetry(fn, { maxAttempts: 3 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on retryable error and succeeds on third attempt", async () => {
    let calls = 0;
    const fn = jest.fn<() => Promise<string>>().mockImplementation(async () => {
      calls++;
      if (calls < 3) throw new Error("429 rate limit");
      return "success";
    });

    // Use very short delays so the test completes quickly
    const result = await withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 1,
      maxDelayMs: 5,
    });
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(3);
  }, 10_000);

  it("throws after maxAttempts on retryable error", async () => {
    const fn = jest.fn<() => Promise<string>>().mockImplementation(async () => {
      throw new Error("429 rate limit");
    });

    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 })).rejects.toThrow(
      "429 rate limit",
    );
    expect(fn).toHaveBeenCalledTimes(3);
  }, 10_000);

  it("does not retry non-retryable errors", async () => {
    const fn = jest.fn<() => Promise<string>>().mockRejectedValue(new Error("Invalid API key"));

    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })).rejects.toThrow(
      "Invalid API key",
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
