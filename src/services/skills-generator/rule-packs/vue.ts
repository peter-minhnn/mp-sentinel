/**
 * Rule pack for Vue / Vue SFC projects
 */

import type { RulePack } from "./index.js";

export const vueRules: RulePack = {
  id: "vue",
  label: "Vue",
  when: (ctx) => {
    const hasVueFiles =
      ctx.langProfile.distribution["vue"] !== undefined && ctx.langProfile.distribution["vue"]! > 0;
    const hasVueDep = ctx.deps["vue"] !== undefined;
    return hasVueFiles || hasVueDep;
  },
  rules: [
    {
      kind: "must",
      id: "vue/script-setup",
      requires: [{ dep: "vue", minMajor: 3 }],
      text: "Use `<script setup>` syntax for Single File Components. It provides better TypeScript inference and smaller bundle size.",
    },
    {
      kind: "must",
      text: "Place all imports inside `<script setup>` -- never import outside the script block in `.vue` files.",
    },
    {
      kind: "should",
      id: "vue/define-props-emits",
      requires: [{ dep: "vue", minMajor: 3 }],
      text: "Use `defineProps` and `defineEmits` with TypeScript generics for type-safe component interfaces.",
    },
    {
      kind: "must",
      text: "Keep the `<template>`, `<script>`, and `<style>` sections in order in `.vue` files.",
    },
    {
      kind: "should",
      text: "Use `scoped` styles by default in `<style scoped>` to avoid global CSS leaks.",
    },
    {
      kind: "avoid",
      id: "vue/no-options-api",
      requires: [{ dep: "vue", minMajor: 3 }],
      text: "Do NOT use Options API for new components when Composition API with `<script setup>` is available.",
    },
  ],
  fileGlobs: ["**/*.vue"],
};
