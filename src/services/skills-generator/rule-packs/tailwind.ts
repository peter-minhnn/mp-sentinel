/**
 * Rule pack for Tailwind CSS projects (v4-focused evaluators are
 * version-gated individually via `requires`).
 */

import type { RulePack } from "./index.js";
import { canonicalClasses } from "./evaluators/tailwind-evaluators.js";

export const tailwindRules: RulePack = {
  id: "tailwind",
  label: "Tailwind CSS",
  when: (ctx) => ctx.deps["tailwindcss"] !== undefined,
  rules: [
    {
      kind: "should",
      text: "Prefer canonical classes over arbitrary values when the theme scale covers the value: `z-9999` not `z-[9999]`, `grid-cols-7` not `grid-cols-[7]` (Tailwind v4 bare values).",
    },
    {
      kind: "avoid",
      text: "Do NOT hardcode design tokens as arbitrary values (`text-[#e5002c]`, `w-[13px]`) when an equivalent theme token exists -- extend the theme instead so values stay consistent.",
    },
  ],
  fileGlobs: ["**/*.tsx", "**/*.jsx", "**/*.html", "**/*.vue", "**/*.svelte", "**/*.astro"],
  evaluators: [canonicalClasses],
};
