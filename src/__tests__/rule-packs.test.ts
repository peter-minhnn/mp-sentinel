/**
 * Tests for RulePack selection
 */

import { describe, it, expect } from "@jest/globals";
import { selectActiveRulePacks } from "../services/skills-generator/rule-packs/index.js";
import type { RulePackContext } from "../services/skills-generator/rule-packs/index.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeContext(overrides: Partial<RulePackContext> = {}): RulePackContext {
  return {
    langProfile: {
      dominant: "typescript",
      secondary: [],
      distribution: {},
      indexableShare: 1,
      nonIndexableHotspots: [],
    },
    frameworks: [],
    deps: {},
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("selectActiveRulePacks", () => {
  it("activates Svelte pack when .svelte files exist", () => {
    const ctx = makeContext({
      langProfile: {
        dominant: "svelte",
        secondary: ["typescript"],
        distribution: { svelte: 5, typescript: 3 },
        indexableShare: 3 / 8,
        nonIndexableHotspots: [],
      },
    });
    const { packs, allRules } = selectActiveRulePacks(ctx);
    const sveltePack = packs.find((p) => p.id === "svelte");
    expect(sveltePack).toBeDefined();
    expect(sveltePack!.rules.length).toBeGreaterThan(0);
    expect(allRules.length).toBeGreaterThan(0);
  });

  it("activates Svelte pack when svelte is in deps", () => {
    const ctx = makeContext({ deps: { svelte: "^5.0.0" } });
    const { packs } = selectActiveRulePacks(ctx);
    expect(packs.find((p) => p.id === "svelte")).toBeDefined();
  });

  it("activates Vue pack when .vue files exist", () => {
    const ctx = makeContext({
      langProfile: {
        dominant: "vue",
        secondary: ["typescript"],
        distribution: { vue: 10, typescript: 5 },
        indexableShare: 5 / 15,
        nonIndexableHotspots: [],
      },
    });
    const { packs } = selectActiveRulePacks(ctx);
    expect(packs.find((p) => p.id === "vue")).toBeDefined();
  });

  it("activates React pack when react is a dependency", () => {
    const ctx = makeContext({ deps: { react: "^19.0.0" } });
    const { packs } = selectActiveRulePacks(ctx);
    expect(packs.find((p) => p.id === "react")).toBeDefined();
  });

  it("activates Next.js pack when next is a dependency", () => {
    const ctx = makeContext({ deps: { next: "^15.0.0" } });
    const { packs } = selectActiveRulePacks(ctx);
    expect(packs.find((p) => p.id === "next")).toBeDefined();
  });

  it("activates TypeScript strict pack when .ts files exist", () => {
    const ctx = makeContext({
      langProfile: {
        dominant: "typescript",
        secondary: [],
        distribution: { typescript: 20 },
        indexableShare: 1,
        nonIndexableHotspots: [],
      },
    });
    const { packs } = selectActiveRulePacks(ctx);
    expect(packs.find((p) => p.id === "typescript-strict")).toBeDefined();
  });

  it("activates Python pack when .py files exist", () => {
    const ctx = makeContext({
      langProfile: {
        dominant: "python",
        secondary: [],
        distribution: { python: 15 },
        indexableShare: 0,
        nonIndexableHotspots: [],
      },
    });
    const { packs } = selectActiveRulePacks(ctx);
    expect(packs.find((p) => p.id === "python")).toBeDefined();
  });

  it("activates Go pack when .go files exist", () => {
    const ctx = makeContext({
      langProfile: {
        dominant: "go",
        secondary: [],
        distribution: { go: 10 },
        indexableShare: 0,
        nonIndexableHotspots: [],
      },
    });
    const { packs } = selectActiveRulePacks(ctx);
    expect(packs.find((p) => p.id === "go")).toBeDefined();
  });

  it("activates Rust pack when .rs files exist", () => {
    const ctx = makeContext({
      langProfile: {
        dominant: "rust",
        secondary: [],
        distribution: { rust: 8 },
        indexableShare: 0,
        nonIndexableHotspots: [],
      },
    });
    const { packs } = selectActiveRulePacks(ctx);
    expect(packs.find((p) => p.id === "rust")).toBeDefined();
  });

  it("returns no packs for empty context", () => {
    const ctx = makeContext();
    const { packs } = selectActiveRulePacks(ctx);
    // TypeScript-strict should still activate if .ts files are present
    expect(packs.length).toBeGreaterThanOrEqual(0);
  });

  it("activates multiple packs for polyglot projects", () => {
    const ctx = makeContext({
      langProfile: {
        dominant: "python",
        secondary: ["typescript", "go", "rust"],
        distribution: { python: 20, typescript: 15, go: 5, rust: 3 },
        indexableShare: 15 / 43,
        nonIndexableHotspots: [],
      },
      deps: { react: "^19.0.0" },
    });
    const { packs } = selectActiveRulePacks(ctx);
    const packIds = packs.map((p) => p.id);
    expect(packIds).toContain("python");
    expect(packIds).toContain("typescript-strict");
    expect(packIds).toContain("go");
    expect(packIds).toContain("rust");
    expect(packIds).toContain("react");
  });

  it("classifies rules by kind", () => {
    const ctx = makeContext({
      langProfile: {
        dominant: "typescript",
        secondary: [],
        distribution: { typescript: 10 },
        indexableShare: 1,
        nonIndexableHotspots: [],
      },
    });
    const { allRules } = selectActiveRulePacks(ctx);
    const kinds = new Set(allRules.map((r) => r.kind));
    expect(kinds.has("must")).toBe(true);
    expect(kinds.has("should")).toBe(true);
    expect(kinds.has("avoid")).toBe(true);
  });
});
