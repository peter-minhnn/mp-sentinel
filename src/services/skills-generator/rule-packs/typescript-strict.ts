/**
 * Rule pack for strict TypeScript projects
 */

import type { RulePack } from "./index.js";

export const typescriptStrictRules: RulePack = {
  id: "typescript-strict",
  label: "TypeScript (Strict)",
  when: (ctx) => {
    const hasTs =
      ctx.langProfile.distribution["typescript"] !== undefined &&
      ctx.langProfile.distribution["typescript"]! > 0;
    const hasTsx =
      ctx.langProfile.distribution["tsx"] !== undefined && ctx.langProfile.distribution["tsx"]! > 0;
    return hasTs || hasTsx;
  },
  rules: [
    {
      kind: "must",
      text: "Use `import type` for type-only imports when `verbatimModuleSyntax` is enabled in `tsconfig.json`.",
    },
    {
      kind: "must",
      text: "Internal imports must include the `.js` extension (NodeNext / ESM resolution).",
    },
    {
      kind: "must",
      text: "Use the `node:` prefix for all Node.js built-in module imports (`node:fs`, `node:path`, `node:process`, etc.).",
    },
    {
      kind: "avoid",
      text: "Do NOT use `any` type. If unavoidable (e.g., untyped third-party types), isolate with a `// eslint-disable-next-line` and a comment explaining why.",
    },
    {
      kind: "must",
      text: "Respect all strict `tsconfig.json` flags: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`.",
    },
    {
      kind: "should",
      text: "Prefer `interface` over `type` for object shapes that may be extended. Use `type` for unions, intersections, and mapped types.",
    },
    {
      kind: "should",
      text: "Use `const` assertions (`as const`) for literal types and tuple inference.",
    },
    {
      kind: "avoid",
      text: "Do NOT use `namespace` or `module` declarations -- use ES module imports/exports instead.",
    },
  ],
  fileGlobs: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
};
