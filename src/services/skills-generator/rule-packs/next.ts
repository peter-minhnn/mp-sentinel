/**
 * Rule pack for Next.js projects
 */

import type { RulePack } from "./index.js";

export const nextRules: RulePack = {
  id: "next",
  label: "Next.js",
  when: (ctx) => {
    const isReact = ctx.deps["react"] !== undefined || ctx.deps["react-dom"] !== undefined;
    const isNext = ctx.deps["next"] !== undefined;
    // Only activate when Next.js is explicitly a dependency
    return isNext;
  },
  rules: [
    {
      kind: "must",
      id: "next/directives",
      requires: [{ dep: "next", minMajor: 13 }],
      text: "Use `'use client'` and `'use server'` directives correctly. Client components cannot import server-only modules (Node fs, direct DB access, etc.).",
    },
    {
      kind: "should",
      id: "next/server-components-default",
      requires: [{ dep: "next", minMajor: 13 }],
      text: "Prefer Server Components by default. Only add `'use client'` when interactivity (hooks, event handlers, browser APIs) is required.",
    },
    {
      kind: "must",
      id: "next/route-segment-config",
      requires: [{ dep: "next", minMajor: 13 }],
      text: "Use route segment config (`export const dynamic = 'force-static'`, etc.) at the top of page/layout files for fine-grained caching control.",
    },
    {
      kind: "should",
      text: "Use `next/image` for image optimization instead of `<img>` tags.",
    },
    {
      kind: "should",
      text: "Colocate data fetching close to consuming components. Avoid prop-drilling data through more than 2 layers.",
    },
    {
      kind: "avoid",
      id: "next/server-component-bundle-bloat",
      requires: [{ dep: "next", minMajor: 13 }],
      text: "Do NOT import large client-side libraries in Server Components that re-export them -- this can bloat the client bundle.",
    },
  ],
  fileGlobs: ["**/*.tsx", "**/*.jsx", "src/app/**/*", "pages/**/*"],
};
