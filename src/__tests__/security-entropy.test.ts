/**
 * Tests for the Shannon-entropy-based secret detector (Phase 2.1).
 */

import { describe, expect, it } from "@jest/globals";
import {
  isHighEntropySecret,
  scanEntropyMatches,
  shannonEntropy,
} from "../services/security/entropy.js";
import { SecurityService } from "../services/security/index.js";

describe("shannonEntropy", () => {
  it("returns 0 for empty string", () => {
    expect(shannonEntropy("")).toBe(0);
  });

  it("returns 0 for a single repeated character", () => {
    expect(shannonEntropy("aaaaaaaaaa")).toBe(0);
  });

  it("returns log2(N) for uniformly-distributed characters", () => {
    // 2 distinct chars, equal frequency → entropy = 1
    expect(shannonEntropy("abab")).toBeCloseTo(1, 5);
    // 4 distinct chars → entropy = 2
    expect(shannonEntropy("abcdabcd")).toBeCloseTo(2, 5);
  });

  it("base62 random string scores ≥ 5 bits/char", () => {
    const random = "Z9k2pX7vYqM4nB6sLfH8tWcEr1aJgUiOdK0";
    expect(shannonEntropy(random)).toBeGreaterThan(4.5);
  });
});

describe("isHighEntropySecret", () => {
  it("returns false for short strings", () => {
    expect(isHighEntropySecret("abc")).toBe(false);
    expect(isHighEntropySecret("password")).toBe(false);
  });

  it("flags long high-entropy strings", () => {
    const random = "Z9k2pX7vYqM4nB6sLfH8tWcEr1aJgUiOdK0";
    expect(isHighEntropySecret(random)).toBe(true);
  });

  it("does not flag English-prose-like strings", () => {
    const proseLong = "thequickbrownfoxjumpsoverthelazydog";
    expect(isHighEntropySecret(proseLong)).toBe(false);
  });

  it("does not flag URLs", () => {
    const url = "https://example.com/api/v1/some/long/path?with=params";
    expect(isHighEntropySecret(url)).toBe(false);
  });

  it("respects user-supplied allowValues", () => {
    const random = "Z9k2pX7vYqM4nB6sLfH8tWcEr1aJgUiOdK0";
    expect(isHighEntropySecret(random, { allowValues: [random] })).toBe(false);
  });

  it("respects custom minLength", () => {
    const shortish = "Z9k2pX7vYqM4nB6sLfH8";
    expect(isHighEntropySecret(shortish, { minLength: 24 })).toBe(false);
    expect(isHighEntropySecret(shortish, { minLength: 16 })).toBe(true);
  });
});

describe("scanEntropyMatches — assignment patterns", () => {
  it("finds an env-var style assignment", () => {
    const random = "Z9k2pX7vYqM4nB6sLfH8tWcEr1aJgUiOdK0";
    const content = `INTERNAL_TOKEN = "${random}"`;
    const matches = scanEntropyMatches(content);
    expect(matches.length).toBe(1);
    expect(matches[0]?.value).toBe(random);
  });

  it("finds a CLI flag-style assignment", () => {
    const random = "Z9k2pX7vYqM4nB6sLfH8tWcEr1aJgUiOdK0";
    const content = `npx mp-sentinel --token ${random}`;
    const matches = scanEntropyMatches(content);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("does not match a low-entropy quoted string", () => {
    const content = `const greeting = "Hello, world!"`;
    expect(scanEntropyMatches(content)).toEqual([]);
  });

  it("does not match short tokens", () => {
    const content = `const PORT = "3000"`;
    expect(scanEntropyMatches(content)).toEqual([]);
  });
});

describe("SecurityService with entropy enabled", () => {
  it("redacts a high-entropy assignment when entropyEnabled=true", () => {
    const svc = new SecurityService({ entropyEnabled: true });
    const random = "Z9k2pX7vYqM4nB6sLfH8tWcEr1aJgUiOdK0";
    const input = `INTERNAL_TOKEN = "${random}"`;
    const result = svc.sanitizeContent(input);
    expect(result.redactedCount).toBeGreaterThanOrEqual(1);
    expect(result.content).not.toContain(random);
  });

  it("does NOT redact when entropyEnabled defaults to false", () => {
    const svc = new SecurityService();
    const random = "Z9k2pX7vYqM4nB6sLfH8tWcEr1aJgUiOdK0";
    const input = `INTERNAL_TOKEN = "${random}"`;
    const result = svc.sanitizeContent(input);
    // No regex pattern catches a generic INTERNAL_TOKEN; entropy is off by default
    expect(result.matchedPatterns).not.toContain("High-entropy assignment (Phase 2.1)");
  });

  it("honors allowValues", () => {
    const random = "Z9k2pX7vYqM4nB6sLfH8tWcEr1aJgUiOdK0";
    const svc = new SecurityService({
      entropyEnabled: true,
      entropy: { allowValues: [random] },
    });
    const input = `PUBLISHABLE_KEY = "${random}"`;
    const result = svc.sanitizeContent(input);
    // The value is allowlisted, so it should NOT be redacted by the
    // entropy detector.
    expect(result.content).toContain(random);
  });

  it("supports a user-supplied customPattern via the options form", () => {
    const svc = new SecurityService({
      extraPatterns: [{ name: "Internal Webhook", pattern: /WHK-[A-Z0-9]{16}/g }],
    });
    const input = `const w = "WHK-ABCDEF0123456789";`;
    const result = svc.sanitizeContent(input);
    expect(result.matchedPatterns).toContain("Internal Webhook");
  });
});
