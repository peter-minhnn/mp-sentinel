/**
 * Rule pack for Vite projects. Activates only when `vite` is a dependency.
 */

import type { RulePack } from "./index.js";
import { noFrameworkDirectives } from "./evaluators/vite-evaluators.js";

export const viteRules: RulePack = {
  id: "vite",
  label: "Vite",
  when: (ctx) => ctx.deps["vite"] !== undefined,
  rules: [
    {
      kind: "must",
      id: "vite/env-prefix",
      text: "Client-exposed environment variables must use the `VITE_` prefix and be read via `import.meta.env`, never `process.env`.",
    },
    {
      kind: "should",
      id: "vite/dynamic-import-chunks",
      text: "Use dynamic `import()` for large or rarely used modules so Vite can split them into separate chunks.",
    },
    {
      kind: "should",
      id: "vite/static-asset-imports",
      text: "Import static assets through the module graph (or Vite's public directory for verbatim files) instead of hardcoding paths, so hashing and bundling work.",
    },
    {
      kind: "avoid",
      id: "vite/no-node-builtins-client",
      text: "Do NOT import Node.js built-ins (`fs`, `path`, etc.) in client code -- Vite targets the browser; keep Node-only logic in config or server files.",
    },
  ],
  fileGlobs: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "vite.config.*"],
  evaluators: [noFrameworkDirectives],
};
