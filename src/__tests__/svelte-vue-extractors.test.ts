/**
 * Tests for Svelte and Vue lexical extractors
 */

import { describe, it, expect } from "@jest/globals";
import { extractFromSvelte } from "../services/source-index/extractors/svelte.js";
import { extractFromVue } from "../services/source-index/extractors/vue.js";

// ── Svelte Extractor ───────────────────────────────────────────────────────

describe("extractFromSvelte", () => {
  it("extracts imports from <script> block", () => {
    const content = [
      '<script lang="ts">',
      "  import { onMount } from 'svelte';",
      "  import Page from './Page.svelte';",
      "  let count = 0;",
      "</script>",
      "",
      "<h1>Hello</h1>",
    ].join("\n");

    const result = extractFromSvelte(content);
    expect(result.imports).toHaveLength(2);
    expect(result.imports[0]!.source).toBe("svelte");
    expect(result.imports[1]!.source).toBe("./Page.svelte");
  });

  it("extracts Svelte 5 rune declarations", () => {
    const content = [
      '<script lang="ts">',
      "  import { onMount } from 'svelte';",
      "  let count = $state(0);",
      "  let doubled = $derived(count * 2);",
      "</script>",
      "",
      "<p>{count}</p>",
    ].join("\n");

    const result = extractFromSvelte(content);
    // Should find 1 import + 2 symbol declarations for runes
    const symbolNames = result.symbols.map((s) => s.name);
    expect(symbolNames).toContain("count");
    expect(symbolNames).toContain("doubled");
    expect(result.imports).toHaveLength(1);
  });

  it("extracts export declarations", () => {
    const content = [
      "<script>",
      "  export let name = 'world';",
      "  export const greeting = 'Hello';",
      "</script>",
      "",
      "<h1>{greeting} {name}</h1>",
    ].join("\n");

    const result = extractFromSvelte(content);
    const exportNames = result.exports.map((e) => e.names).flat();
    expect(exportNames).toContain("name");
    expect(exportNames).toContain("greeting");
  });

  it("handles multi-script blocks (instance + module)", () => {
    const content = [
      '<script context="module">',
      "  import { base } from '$app/paths';",
      "  export function load() { return { base }; }",
      "</script>",
      "",
      "<script>",
      "  import { onMount } from 'svelte';",
      "  let x = 1;",
      "</script>",
      "",
      "<p>{x}</p>",
    ].join("\n");

    const result = extractFromSvelte(content);
    expect(result.imports).toHaveLength(2);
    expect(result.exports.some((e) => e.names.includes("load"))).toBe(true);
  });

  it("handles no script block", () => {
    const content = ["<h1>Hello</h1>", "<p>No script here</p>"].join("\n");

    const result = extractFromSvelte(content);
    expect(result.imports).toHaveLength(0);
    expect(result.exports).toHaveLength(0);
    expect(result.symbols).toHaveLength(0);
  });

  it("handles empty content", () => {
    const result = extractFromSvelte("");
    expect(result.imports).toHaveLength(0);
    expect(result.exports).toHaveLength(0);
    expect(result.symbols).toHaveLength(0);
  });

  it("extracts function declarations", () => {
    const content = [
      '<script lang="ts">',
      "  function handleClick() { console.log('clicked'); }",
      "  function greet(name: string): string { return `Hello ${name}`; }",
      "</script>",
      "",
      "<button on:click={handleClick}>Click</button>",
    ].join("\n");

    const result = extractFromSvelte(content);
    const funcNames = result.symbols.filter((s) => s.type === "function").map((s) => s.name);
    expect(funcNames).toContain("handleClick");
    expect(funcNames).toContain("greet");
  });
});

// ── Vue Extractor ──────────────────────────────────────────────────────────

describe("extractFromVue", () => {
  it("extracts imports from <script setup>", () => {
    const content = [
      '<script setup lang="ts">',
      "  import { ref } from 'vue';",
      "  import MyComponent from './MyComponent.vue';",
      "  const count = ref(0);",
      "</script>",
      "",
      "<template>",
      "  <div>{{ count }}</div>",
      "</template>",
    ].join("\n");

    const result = extractFromVue(content);
    expect(result.imports).toHaveLength(2);
    expect(result.imports[0]!.source).toBe("vue");
    expect(result.imports[1]!.source).toBe("./MyComponent.vue");
  });

  it("extracts defineProps and defineEmits as exports", () => {
    const content = [
      '<script setup lang="ts">',
      "  import { ref } from 'vue';",
      "  const props = defineProps<{ name: string }>();",
      "  const emit = defineEmits<{ change: [value: string] }>();",
      "</script>",
      "",
      "<template><div>{{ props.name }}</div></template>",
    ].join("\n");

    const result = extractFromVue(content);
    const exportNames = result.exports.map((e) => e.names).flat();
    expect(exportNames).toContain("props");
    expect(exportNames).toContain("emit");
  });

  it("extracts top-level variables and functions", () => {
    const content = [
      "<script setup>",
      "  import { computed } from 'vue';",
      "  const doubled = computed(() => count.value * 2);",
      "  function increment() { count.value++; }",
      "</script>",
      "",
      '<template><button @click="increment">{{ doubled }}</button></template>',
    ].join("\n");

    const result = extractFromVue(content);
    const symbolNames = result.symbols.map((s) => s.name);
    expect(symbolNames).toContain("doubled");
    expect(symbolNames).toContain("increment");
    expect(result.imports).toHaveLength(1);
  });

  it("handles no script block", () => {
    const content = ["<template>", "  <div>Hello</div>", "</template>"].join("\n");

    const result = extractFromVue(content);
    expect(result.imports).toHaveLength(0);
    expect(result.exports).toHaveLength(0);
    expect(result.symbols).toHaveLength(0);
  });

  it("handles multi-script (normal + setup)", () => {
    const content = [
      "<script>",
      "  export default { name: 'MyComp' };",
      "</script>",
      "",
      '<script setup lang="ts">',
      "  import { ref } from 'vue';",
      "  const count = ref(0);",
      "</script>",
      "",
      "<template><div>{{ count }}</div></template>",
    ].join("\n");

    const result = extractFromVue(content);
    expect(result.imports).toHaveLength(1);
    expect(result.symbols.some((s) => s.name === "count")).toBe(true);
  });
});
