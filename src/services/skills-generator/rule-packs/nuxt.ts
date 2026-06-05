/**
 * Rule pack for Nuxt 3 projects.
 *
 * Nuxt builds on Vue 3 + Vite and adds file-system routing, auto-imports,
 * SSR/hydration, server routes, and module conventions. This pack assumes
 * the Vue pack is also active (Nuxt always requires `vue` as a dep).
 */

import type { RulePack } from "./index.js";

export const nuxtRules: RulePack = {
  id: "nuxt",
  label: "Nuxt",
  when: (ctx) => ctx.frameworks.includes("nuxt"),
  rules: [
    {
      kind: "must",
      id: "nuxt/define-page-meta",
      requires: [{ dep: "nuxt", minMajor: 3 }],
      text: "Use `definePageMeta()` in page components for route metadata (layout, middleware, title, etc.).",
    },
    {
      kind: "must",
      id: "nuxt/use-fetch",
      requires: [{ dep: "nuxt", minMajor: 3 }],
      text: "Use `useFetch()` or `useAsyncData()` for data fetching in pages and components — never `fetch()` directly for SSR-safe data.",
    },
    {
      kind: "must",
      id: "nuxt/server-directory",
      requires: [{ dep: "nuxt", minMajor: 3 }],
      text: "Place server-only logic in `server/` directory (API routes, middleware, plugins). Client code must never import from `server/`.",
    },
    {
      kind: "must",
      id: "nuxt/navigate-to",
      requires: [{ dep: "nuxt", minMajor: 3 }],
      text: "Use `navigateTo()` for programmatic navigation, `<NuxtLink>` for declarative links — never `window.location`.",
    },
    {
      kind: "should",
      id: "nuxt/runtime-config",
      requires: [{ dep: "nuxt", minMajor: 3 }],
      text: "Use `useRuntimeConfig()` for environment variables and runtime configuration instead of `process.env` directly.",
    },
    {
      kind: "should",
      id: "nuxt/auto-import-dirs",
      requires: [{ dep: "nuxt", minMajor: 3 }],
      text: "Keep layouts in `layouts/` and composables in `composables/` — Nuxt auto-imports both directories.",
    },
    {
      kind: "should",
      id: "nuxt/router-options",
      requires: [{ dep: "nuxt", minMajor: 3 }],
      text: "Use `app/router.options.ts` for custom route rules (middleware, transitions, scroll behavior) rather than inline page options.",
    },
    {
      kind: "avoid",
      id: "nuxt/no-manual-auto-imports",
      requires: [{ dep: "nuxt", minMajor: 3 }],
      text: "Do NOT manually import auto-imported Vue/Nuxt composables (`useState`, `useFetch`, `ref`, `computed`, etc.) — Nuxt handles this automatically.",
    },
    {
      kind: "avoid",
      text: "Do NOT use Vue Router directly — Nuxt manages routing via the `pages/` directory structure.",
    },
    {
      kind: "avoid",
      text: "Do NOT place secret keys or tokens in `nuxt.config.ts` or in client-side code; use `server/` API routes or runtime config with server-only sources.",
    },
  ],
  fileGlobs: ["**/*.vue", "**/*.ts", "app.vue", "nuxt.config.*", "server/**/*.ts"],
};
