/**
 * Tests for Tier-1 rule packs (Astro, Solid, Angular)
 */

import { describe, it, expect } from "@jest/globals";
import { selectActiveRulePacks, ALL_PACKS } from "../services/skills-generator/rule-packs/index.js";
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

// ── Astro Pack ──────────────────────────────────────────────────────────────

describe("Astro rule pack", () => {
  it("activates when .astro files exist", () => {
    const ctx = makeContext({
      langProfile: {
        dominant: "astro",
        secondary: [],
        distribution: { astro: 5, typescript: 2 },
        indexableShare: 2 / 7,
        nonIndexableHotspots: ["src/astro"],
      },
    });
    const { packs } = selectActiveRulePacks(ctx);
    expect(packs.find((p) => p.id === "astro")).toBeDefined();
  });

  it("activates when astro is a dependency", () => {
    const ctx = makeContext({ deps: { astro: "^5.0.0" } });
    const { packs } = selectActiveRulePacks(ctx);
    expect(packs.find((p) => p.id === "astro")).toBeDefined();
  });

  it("has rules about client directives", () => {
    const ctx = makeContext({ deps: { astro: "^5.0.0" } });
    const { allRules } = selectActiveRulePacks(ctx);
    const hasClientRule = allRules.some((r) => r.text.includes("client:"));
    expect(hasClientRule).toBe(true);
  });

  it("has evaluator for island directives", () => {
    const astroPack = ALL_PACKS.find((p) => p.id === "astro")!;
    expect(astroPack.evaluators).toBeDefined();
    expect(astroPack.evaluators!.length).toBeGreaterThan(0);
    expect(astroPack.evaluators![0]!.ruleId).toBe("island-directive-missing");
  });

  it("does not activate in a pure TypeScript project", () => {
    const ctx = makeContext();
    const { packs } = selectActiveRulePacks(ctx);
    expect(packs.find((p) => p.id === "astro")).toBeUndefined();
  });
});

// ── Solid Pack ──────────────────────────────────────────────────────────────

describe("Solid rule pack", () => {
  it("activates when solid-js is a dependency", () => {
    const ctx = makeContext({ deps: { "solid-js": "^1.9.0" } });
    const { packs } = selectActiveRulePacks(ctx);
    expect(packs.find((p) => p.id === "solid")).toBeDefined();
  });

  it("has rules about createSignal", () => {
    const ctx = makeContext({ deps: { "solid-js": "^1.9.0" } });
    const { allRules } = selectActiveRulePacks(ctx);
    const hasSignalRule = allRules.some((r) => r.text.includes("createSignal"));
    expect(hasSignalRule).toBe(true);
  });

  it("has evaluator for destructured props", () => {
    const solidPack = ALL_PACKS.find((p) => p.id === "solid")!;
    expect(solidPack.evaluators).toBeDefined();
    expect(solidPack.evaluators![0]!.ruleId).toBe("no-destructured-props");
  });

  it("does not activate without solid-js dependency", () => {
    const ctx = makeContext();
    const { packs } = selectActiveRulePacks(ctx);
    expect(packs.find((p) => p.id === "solid")).toBeUndefined();
  });
});

// ── Angular Pack ────────────────────────────────────────────────────────────

describe("Angular rule pack", () => {
  it("activates when @angular/core is a dependency", () => {
    const ctx = makeContext({ deps: { "@angular/core": "^18.0.0" } });
    const { packs } = selectActiveRulePacks(ctx);
    expect(packs.find((p) => p.id === "angular")).toBeDefined();
  });

  it("activates when @angular/common is a dependency", () => {
    const ctx = makeContext({ deps: { "@angular/common": "^18.0.0" } });
    const { packs } = selectActiveRulePacks(ctx);
    expect(packs.find((p) => p.id === "angular")).toBeDefined();
  });

  it("has rules about inject() and signals", () => {
    const ctx = makeContext({ deps: { "@angular/core": "^18.0.0" } });
    const { allRules } = selectActiveRulePacks(ctx);
    expect(allRules.some((r) => r.text.includes("inject()"))).toBe(true);
    expect(allRules.some((r) => r.text.includes("signal"))).toBe(true);
  });

  it("has evaluator for constructor injection", () => {
    const angularPack = ALL_PACKS.find((p) => p.id === "angular")!;
    expect(angularPack.evaluators).toBeDefined();
    expect(angularPack.evaluators![0]!.ruleId).toBe("prefer-inject");
  });

  it("does not activate without Angular dependencies", () => {
    const ctx = makeContext();
    const { packs } = selectActiveRulePacks(ctx);
    expect(packs.find((p) => p.id === "angular")).toBeUndefined();
  });
});

// ── ALL_PACKS registration ──────────────────────────────────────────────────

describe("ALL_PACKS includes new packs", () => {
  it("includes all 12 packs", () => {
    const packIds = ALL_PACKS.map((p) => p.id);
    expect(packIds).toContain("astro");
    expect(packIds).toContain("solid");
    expect(packIds).toContain("angular");
    expect(packIds).toContain("nuxt");
    expect(packIds).toContain("dart");
    expect(packIds).toContain("flutter");
    expect(packIds).toContain("php");
    expect(packIds).toContain("laravel");
    expect(packIds).toContain("ruby");
    expect(packIds).toContain("rails");
    expect(packIds).toContain("vite");
    expect(packIds).toContain("react-router");
    expect(packIds).toContain("tanstack-query");
    expect(packIds).toContain("antd");
    expect(packIds).toContain("supabase");
    expect(packIds).toContain("tailwind");
    expect(packIds).toContain("nestjs");
    expect(ALL_PACKS.length).toBe(26);
  });
});
