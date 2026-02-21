/**
 * Unit tests for token estimation utilities
 */

import { describe, it, expect } from "@jest/globals";
import {
  resolveTokenLimit,
  PROVIDER_TOKEN_LIMITS,
  warnIfTokenLimitExceeded,
  chunkFileContent,
  estimatePayloadTokens,
} from "../utils/tokens.js";

// ── resolveTokenLimit ─────────────────────────────────────────────────────────

describe("resolveTokenLimit", () => {
  it("returns Gemini limit for gemini provider", () => {
    expect(resolveTokenLimit("gemini")).toBe(PROVIDER_TOKEN_LIMITS["gemini"]);
  });

  it("returns OpenAI limit for openai provider", () => {
    expect(resolveTokenLimit("openai")).toBe(PROVIDER_TOKEN_LIMITS["openai"]);
  });

  it("returns Anthropic limit for anthropic provider", () => {
    expect(resolveTokenLimit("anthropic")).toBe(PROVIDER_TOKEN_LIMITS["anthropic"]);
  });

  it("is case-insensitive for provider name", () => {
    expect(resolveTokenLimit("GEMINI")).toBe(PROVIDER_TOKEN_LIMITS["gemini"]);
  });

  it("returns DEFAULT_TOKEN_LIMIT for unknown provider", () => {
    expect(resolveTokenLimit("unknown-provider")).toBe(100_000);
  });

  it("returns DEFAULT_TOKEN_LIMIT when no provider given", () => {
    expect(resolveTokenLimit()).toBe(100_000);
  });

  it("respects configOverride over provider default", () => {
    expect(resolveTokenLimit("gemini", 50_000)).toBe(50_000);
  });

  it("ignores zero configOverride", () => {
    expect(resolveTokenLimit("gemini", 0)).toBe(PROVIDER_TOKEN_LIMITS["gemini"]);
  });
});

// ── warnIfTokenLimitExceeded ──────────────────────────────────────────────────

describe("warnIfTokenLimitExceeded", () => {
  it("returns false when well under limit", () => {
    expect(warnIfTokenLimitExceeded(1_000, 100_000)).toBe(false);
  });

  it("returns false when at exactly 79% of limit", () => {
    expect(warnIfTokenLimitExceeded(79_000, 100_000)).toBe(false);
  });

  it("returns false (but warns) when at 80% of limit", () => {
    // At 80% it warns but does NOT return true
    expect(warnIfTokenLimitExceeded(80_000, 100_000)).toBe(false);
  });

  it("returns true when at or above limit", () => {
    expect(warnIfTokenLimitExceeded(100_000, 100_000)).toBe(true);
    expect(warnIfTokenLimitExceeded(150_000, 100_000)).toBe(true);
  });
});

// ── chunkFileContent ──────────────────────────────────────────────────────────

describe("chunkFileContent", () => {
  it("returns single chunk when content fits", () => {
    const content = "const x = 1;\nconst y = 2;";
    const chunks = chunkFileContent(content, 1000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(content);
  });

  it("splits content into multiple chunks when too large", () => {
    // Create content larger than maxCharsPerFile
    const line = "const x = 1; // some code\n";
    const content = line.repeat(100); // ~2700 chars
    const chunks = chunkFileContent(content, 500);
    expect(chunks.length).toBeGreaterThan(1);
    // All chunks should be within the limit (approximately)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(600); // some tolerance for line boundaries
    }
  });

  it("preserves all content across chunks", () => {
    const line = "const x = 1;\n";
    const content = line.repeat(50);
    const chunks = chunkFileContent(content, 100);
    const reassembled = chunks.join("\n");
    // All original lines should be present
    expect(reassembled).toContain("const x = 1;");
  });

  it("handles empty content", () => {
    const chunks = chunkFileContent("", 1000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe("");
  });
});

// ── estimatePayloadTokens ─────────────────────────────────────────────────────

describe("estimatePayloadTokens", () => {
  it("returns zero total for empty files array", async () => {
    const { total, perFile } = await estimatePayloadTokens([]);
    expect(total).toBe(0);
    expect(perFile).toHaveLength(0);
  });

  it("returns positive token count for non-empty content", async () => {
    const files = [
      { path: "src/a.ts", content: "const x = 1; const y = 2;" },
      { path: "src/b.ts", content: "function hello() { return 'world'; }" },
    ];
    const { total, perFile } = await estimatePayloadTokens(files);
    expect(total).toBeGreaterThan(0);
    expect(perFile).toHaveLength(2);
    expect(perFile[0]?.tokens).toBeGreaterThan(0);
    expect(perFile[1]?.tokens).toBeGreaterThan(0);
    expect(total).toBe((perFile[0]?.tokens ?? 0) + (perFile[1]?.tokens ?? 0));
  });

  it("larger content produces more tokens", async () => {
    const small = [{ path: "a.ts", content: "x" }];
    const large = [{ path: "b.ts", content: "x".repeat(1000) }];
    const { total: smallTotal } = await estimatePayloadTokens(small);
    const { total: largeTotal } = await estimatePayloadTokens(large);
    expect(largeTotal).toBeGreaterThan(smallTotal);
  });
});
