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
      id: "next/image-optimization",
      text: "Use `next/image` for image optimization instead of `<img>` tags.",
    },
    {
      kind: "should",
      id: "next/data-fetching-colocation",
      text: "Colocate data fetching close to consuming components. Avoid prop-drilling data through more than 2 layers.",
    },
    // ── App Router (Next.js 13+) ─────────────────────────────────────────────
    {
      kind: "avoid",
      id: "next/server-component-bundle-bloat",
      requires: [{ dep: "next", minMajor: 13 }],
      text: "Do NOT import large client-side libraries in Server Components that re-export them -- this can bloat the client bundle.",
    },
    // ── Pages Router (Next.js <= 12) ─────────────────────────────────────────
    {
      kind: "must",
      id: "next/pages-router-only",
      requires: [{ dep: "next", maxMajor: 12 }],
      text: "Pages Router project -- do NOT add `app/` directory, `'use client'`/`'use server'` directives, Server Components, or route handlers. Use `pages/`, `_app.tsx`, `_document.tsx` only.",
    },
    {
      kind: "should",
      id: "next/ssr-ssg-patterns",
      requires: [{ dep: "next", maxMajor: 12 }],
      text: "Fetch data at the page level via `getServerSideProps` (SSR) or `getStaticProps`/`getStaticPaths` (SSG). Use React Query / SWR for client-side fetches inside components.",
    },
    {
      kind: "should",
      id: "next/api-routes",
      requires: [{ dep: "next", maxMajor: 12 }],
      text: "API endpoints belong in `pages/api/` -- each file exports a default handler `(req: NextApiRequest, res: NextApiResponse) => void`.",
    },
  ],
  fileGlobs: ["**/*.tsx", "**/*.jsx", "src/app/**/*", "pages/**/*"],
};
