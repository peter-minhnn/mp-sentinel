/**
 * Unit tests for config validation (Zod schema)
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { validateConfig, clearConfigCache } from "../utils/config.js";

beforeEach(() => {
  clearConfigCache();
});

describe("validateConfig", () => {
  it("accepts an empty object (all fields optional)", () => {
    expect(validateConfig({})).toBe(true);
  });

  it("accepts a valid full config", () => {
    expect(
      validateConfig({
        techStack: "TypeScript",
        rules: ["no-console"],
        bypassKeyword: "skip:",
        maxConcurrency: 5,
        cacheEnabled: true,
        enableSkillsFetch: false,
        skillsFetchTimeout: 3000,
        ai: {
          enabled: true,
          maxFiles: 10,
          maxDiffLines: 500,
          maxCharsPerFile: 8000,
          promptVersion: "2026-01-01",
        },
        localReview: {
          enabled: true,
          commitCount: 3,
          filterByPattern: true,
          patternMatchMode: "any",
          commitPatterns: [{ type: "feat", pattern: "^feat" }],
          skipPatterns: ["skip:"],
          excludePatterns: ["^Merge"],
        },
      }),
    ).toBe(true);
  });

  it("rejects non-object values", () => {
    expect(validateConfig(null)).toBe(false);
    expect(validateConfig("string")).toBe(false);
    expect(validateConfig(42)).toBe(false);
  });

  it("rejects invalid techStack type", () => {
    expect(validateConfig({ techStack: 123 })).toBe(false);
  });

  it("rejects negative maxConcurrency", () => {
    expect(validateConfig({ maxConcurrency: -1 })).toBe(false);
  });

  it("rejects zero maxConcurrency", () => {
    expect(validateConfig({ maxConcurrency: 0 })).toBe(false);
  });

  it("rejects invalid ai.maxFiles", () => {
    expect(validateConfig({ ai: { maxFiles: -5 } })).toBe(false);
  });

  it("rejects invalid commitPattern regex", () => {
    expect(
      validateConfig({
        localReview: {
          commitPatterns: [{ type: "bad", pattern: "[invalid" }],
        },
      }),
    ).toBe(false);
  });

  it("rejects invalid excludePattern regex", () => {
    expect(
      validateConfig({
        localReview: {
          excludePatterns: ["[invalid"],
        },
      }),
    ).toBe(false);
  });

  it("rejects invalid gitProvider value", () => {
    expect(validateConfig({ gitProvider: "bitbucket" })).toBe(false);
  });

  it("rejects invalid repoUrl", () => {
    expect(validateConfig({ repoUrl: "not-a-url" })).toBe(false);
  });

  it("rejects invalid patternMatchMode", () => {
    expect(validateConfig({ localReview: { patternMatchMode: "none" } })).toBe(false);
  });
});
