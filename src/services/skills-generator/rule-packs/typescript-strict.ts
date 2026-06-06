/**
 * Rule pack for strict TypeScript projects.
 *
 * Config-aware: NodeNext-specific rules (`.js` import extensions) and
 * strict-flag reminders are gated on the project's real tsconfig.
 * Projects using `moduleResolution: "bundler"` (Vite, Next.js) never see
 * NodeNext import rules, and only flags that are actually enabled are
 * mentioned.
 */

import type { RulePack, RulePackContext } from "./index.js";
import {
  enabledStrictFlags,
  recommendsImportType,
  requiresJsImportExtensions,
} from "../ts-project-flags.js";

const hasAnyStrictFlag = (ctx: RulePackContext): boolean =>
  !ctx.tsConfig || enabledStrictFlags(ctx.tsConfig).length > 0;

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
      id: "typescript-strict/import-type",
      enabled: (ctx) => recommendsImportType(ctx.tsConfig),
      text: "Use `import type` for type-only imports (`verbatimModuleSyntax` is enabled in `tsconfig.json`).",
    },
    {
      kind: "must",
      id: "typescript-strict/js-import-extensions",
      enabled: (ctx) => requiresJsImportExtensions(ctx.tsConfig),
      text: "Internal imports must include the `.js` extension (NodeNext / ESM resolution).",
    },
    {
      kind: "must",
      id: "typescript-strict/node-prefix",
      enabled: (ctx) => requiresJsImportExtensions(ctx.tsConfig),
      text: "Use the `node:` prefix for all Node.js built-in module imports (`node:fs`, `node:path`, `node:process`, etc.).",
    },
    {
      kind: "avoid",
      id: "typescript-strict/no-any",
      text: "Do NOT use `any` type. If unavoidable (e.g., untyped third-party types), isolate with a `// eslint-disable-next-line` and a comment explaining why.",
    },
    {
      kind: "must",
      id: "typescript-strict/strict-flags",
      enabled: hasAnyStrictFlag,
      text: "Respect all strict `tsconfig.json` flags enabled in this project (see Code Conventions for the exact list).",
    },
    {
      kind: "should",
      id: "typescript-strict/interface-vs-type",
      text: "Prefer `interface` over `type` for object shapes that may be extended. Use `type` for unions, intersections, and mapped types.",
    },
    {
      kind: "should",
      id: "typescript-strict/const-assertions",
      text: "Use `const` assertions (`as const`) for literal types and tuple inference.",
    },
    {
      kind: "avoid",
      id: "typescript-strict/no-namespaces",
      text: "Do NOT use `namespace` or `module` declarations -- use ES module imports/exports instead.",
    },
  ],
  fileGlobs: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
};
