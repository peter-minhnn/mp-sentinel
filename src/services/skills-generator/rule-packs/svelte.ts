/**
 * Rule pack for Svelte / SvelteKit projects
 */

import type { RulePack } from "./index.js";
import { importsInsideScript } from "./evaluators/svelte-evaluators.js";

export const svelteRules: RulePack = {
  id: "svelte",
  label: "Svelte",
  when: (ctx) => {
    // Active when Svelte files exist in the codebase or Svelte is a dependency
    const hasSvelteFiles =
      ctx.langProfile.distribution["svelte"] !== undefined &&
      ctx.langProfile.distribution["svelte"]! > 0;
    const hasSvelteDep = ctx.deps["svelte"] !== undefined;
    return hasSvelteFiles || hasSvelteDep;
  },
  rules: [
    {
      kind: "must",
      text: "Place all `import` statements inside the `<script>` block in `.svelte` files. Imports outside `<script>` will cause build errors or silent failures.",
    },
    {
      kind: "should",
      id: "svelte/runes-reactivity",
      requires: [{ dep: "svelte", minMajor: 5 }],
      text: "Use Svelte 5 runes (`$state`, `$derived`, `$effect`) for reactivity rather than Svelte 4 `$:` reactive declarations when using Svelte 5.",
    },
    {
      kind: "should",
      id: "svelte/legacy-reactive-statements",
      requires: [{ dep: "svelte", maxMajor: 4 }],
      text: "Use `$:` reactive declarations for derived state (Svelte 4 and earlier). Rune APIs are not available in this Svelte major.",
    },
    {
      kind: "avoid",
      text: "Do NOT put top-level logic or statements outside the `<script>` tag in `.svelte` files. Only HTML/template syntax belongs at the top level.",
    },
    {
      kind: "must",
      text: 'Use `lang="ts"` consistently on all `<script>` tags in `.svelte` files when TypeScript is used.',
    },
    {
      kind: "should",
      text: "Keep `.svelte` components focused on presentation. Move complex business logic to `.ts` modules.",
    },
    {
      kind: "must",
      text: "In SvelteKit, use `+page.server.ts` for server-only data loading and `+page.ts` for universal load functions. Never import server-only code in client components.",
    },
    {
      kind: "avoid",
      text: "Do NOT use `on:click` etc. with inline arrow functions in hot paths -- extract event handlers to named functions or use `$effect` for cleanup.",
    },
  ],
  fileGlobs: ["**/*.svelte"],
  evaluators: [importsInsideScript],
};
