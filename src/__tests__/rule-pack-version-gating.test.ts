/**
 * Framework-version gating fixtures for rule packs and evaluators:
 * Svelte 4 vs 5, Angular 15/16/17, Next 12 (pages) vs 13+ (App Router),
 * Vue 2 vs 3, Nuxt 2 vs 3. Unknown/broad ranges emit only stable rules.
 */

import { describe, it, expect } from "@jest/globals";
import type { LanguageProfile } from "../types/index.js";
import {
  selectActiveRulePacks,
  type RulePackContext,
} from "../services/skills-generator/rule-packs/index.js";
import { evaluateChangedFiles } from "../services/skills-generator/rule-packs/evaluator.js";

const langProfile = (distribution: Record<string, number>): LanguageProfile => ({
  dominant: Object.keys(distribution)[0] ?? "unknown",
  secondary: [],
  distribution,
  indexableShare: 1,
  nonIndexableHotspots: [],
});

const ctx = (
  deps: Record<string, string>,
  distribution: Record<string, number> = {},
  frameworks: string[] = [],
): RulePackContext => ({
  langProfile: langProfile(distribution),
  frameworks,
  deps,
});

const ruleTexts = (c: RulePackContext): string[] =>
  selectActiveRulePacks(c).allRules.map((r) => r.text);

describe("Svelte 4 vs 5 gating", () => {
  it("emits runes guidance only for Svelte 5", () => {
    const texts = ruleTexts(ctx({ svelte: "^5.0.0" }, { svelte: 3 }));
    expect(texts.some((t) => t.includes("Svelte 5 runes"))).toBe(true);
    expect(texts.some((t) => t.includes("not available in this Svelte version"))).toBe(false);
  });

  it("emits legacy reactive guidance only for Svelte 4", () => {
    const texts = ruleTexts(ctx({ svelte: "^4.2.0" }, { svelte: 3 }));
    expect(texts.some((t) => t.includes("Use Svelte 5 runes"))).toBe(false);
    expect(texts.some((t) => t.includes("not available in this Svelte major"))).toBe(true);
  });

  it("emits neither version-specific rule for unknown ranges, keeps stable rules", () => {
    const texts = ruleTexts(ctx({ svelte: "latest" }, { svelte: 3 }));
    expect(texts.some((t) => t.includes("Svelte 5 runes"))).toBe(false);
    expect(texts.some((t) => t.includes("not available in this Svelte major"))).toBe(false);
    // Stable generic rules still present
    expect(texts.some((t) => t.includes("inside the `<script>` block"))).toBe(true);
  });
});

describe("Angular 15/16/17 gating", () => {
  const angularCtx = (range: string) => ctx({ "@angular/core": range }, { typescript: 5 });

  it("Angular 15: no inject(), signals, or control-flow advice", () => {
    const texts = ruleTexts(angularCtx("^15.2.0"));
    expect(texts.some((t) => t.includes("`inject()` for dependency injection"))).toBe(false);
    expect(texts.some((t) => t.includes("signals (`signal()`"))).toBe(false);
    expect(texts.some((t) => t.includes("built-in control flow"))).toBe(false);
    // Stable rules survive
    expect(texts.some((t) => t.includes("async"))).toBe(true);
  });

  it("Angular 16: signals advice without v17-only rules", () => {
    const texts = ruleTexts(angularCtx("~16.1.0"));
    expect(texts.some((t) => t.includes("signals (`signal()`"))).toBe(true);
    expect(texts.some((t) => t.includes("`inject()` for dependency injection"))).toBe(false);
    expect(texts.some((t) => t.includes("built-in control flow"))).toBe(false);
  });

  it("Angular 17: full modern rule set", () => {
    const texts = ruleTexts(angularCtx("^17.0.0"));
    expect(texts.some((t) => t.includes("`inject()` for dependency injection"))).toBe(true);
    expect(texts.some((t) => t.includes("signals (`signal()`"))).toBe(true);
    expect(texts.some((t) => t.includes("built-in control flow"))).toBe(true);
  });

  it("prefer-inject evaluator runs only for Angular 17+", () => {
    const file = new Map([
      ["src/app.component.ts", "class A { constructor(private svc: FooService) {} }"],
    ]);
    const v15 = evaluateChangedFiles(ctx({ "@angular/core": "^15.0.0" }), { files: file });
    const v17 = evaluateChangedFiles(ctx({ "@angular/core": "^17.1.0" }), { files: file });
    const unknown = evaluateChangedFiles(ctx({ "@angular/core": "latest" }), { files: file });

    expect(v15.some((f) => f.ruleId === "angular/prefer-inject")).toBe(false);
    expect(unknown.some((f) => f.ruleId === "angular/prefer-inject")).toBe(false);
    expect(v17.some((f) => f.ruleId === "angular/prefer-inject")).toBe(true);
  });
});

describe("Next.js 12 (pages) vs 13+ (App Router) gating", () => {
  it("Next 12: no App Router directives advice", () => {
    const texts = ruleTexts(ctx({ next: "12.3.4", react: "^18.0.0" }));
    // Phrases unique to the 13+ App Router rules. (The Pages Router rule itself
    // mentions "'use client'"/"Server Components" as things NOT to add, so we
    // must match the App Router *advice*, not those bare substrings.)
    expect(texts.some((t) => t.includes("directives correctly"))).toBe(false);
    expect(texts.some((t) => t.includes("Prefer Server Components by default"))).toBe(false);
    // Stable rule survives
    expect(texts.some((t) => t.includes("next/image"))).toBe(true);
  });

  it("Next 13+: App Router rules included", () => {
    const texts = ruleTexts(ctx({ next: "^13.4.0", react: "^18.0.0" }));
    expect(texts.some((t) => t.includes("'use client'"))).toBe(true);
    expect(texts.some((t) => t.includes("route segment config"))).toBe(true);
  });
});

describe("Vue 2 vs 3 gating", () => {
  it("Vue 2: no script-setup / Composition API advice, stable SFC rules remain", () => {
    const texts = ruleTexts(ctx({ vue: "^2.7.14" }, { vue: 4 }));
    expect(texts.some((t) => t.includes("`<script setup>` syntax"))).toBe(false);
    expect(texts.some((t) => t.includes("defineProps"))).toBe(false);
    expect(texts.some((t) => t.includes("Options API"))).toBe(false);
    expect(texts.some((t) => t.includes("scoped"))).toBe(true);
  });

  it("Vue 3: full Composition API rule set", () => {
    const texts = ruleTexts(ctx({ vue: "^3.4.0" }, { vue: 4 }));
    expect(texts.some((t) => t.includes("`<script setup>` syntax"))).toBe(true);
    expect(texts.some((t) => t.includes("defineProps"))).toBe(true);
  });
});

describe("Nuxt 2 vs 3 gating", () => {
  it("Nuxt 2: no Nuxt-3 composable/server-dir advice", () => {
    const texts = ruleTexts(ctx({ nuxt: "^2.15.0", vue: "^2.7.0" }, { vue: 4 }, ["nuxt"]));
    expect(texts.some((t) => t.includes("definePageMeta"))).toBe(false);
    expect(texts.some((t) => t.includes("useFetch"))).toBe(false);
    expect(texts.some((t) => t.includes("useRuntimeConfig"))).toBe(false);
  });

  it("Nuxt 3: full Nuxt-3 rule set", () => {
    const texts = ruleTexts(ctx({ nuxt: "^3.8.0", vue: "^3.4.0" }, { vue: 4 }, ["nuxt"]));
    expect(texts.some((t) => t.includes("definePageMeta"))).toBe(true);
    expect(texts.some((t) => t.includes("useFetch"))).toBe(true);
  });

  it("Nuxt unknown range: only stable Nuxt rules remain", () => {
    const texts = ruleTexts(ctx({ nuxt: "latest", vue: "^3.4.0" }, { vue: 4 }, ["nuxt"]));
    expect(texts.some((t) => t.includes("definePageMeta"))).toBe(false);
    // Stable (ungated) Nuxt rules still present
    expect(texts.some((t) => t.includes("Vue Router"))).toBe(true);
  });
});
