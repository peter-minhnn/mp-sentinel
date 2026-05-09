/**
 * Rule pack for Solid.js projects
 */

import type { RulePack, FileEvaluator } from "./index.js";

/**
 * Evaluator: detect destructured props (Solid doesn't re-run on prop changes)
 */
const destructuredProps: FileEvaluator = {
  ruleId: "no-destructured-props",
  evaluate: ({ filePath, lines }) => {
    if (!filePath.endsWith(".tsx") && !filePath.endsWith(".jsx")) return [];
    const results: Array<{
      ruleId: string;
      passed: boolean;
      message: string;
      line: number;
      column: number;
      severity: "CRITICAL" | "WARNING" | "INFO";
      suggestion: string;
    }> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // Check for destructured props in function params: `function Foo({ bar })`
      if (/(?:function\s+\w+|const\s+\w+\s*=\s*\(?)\s*\{[^}]+\}\s*[:)]/.test(line)) {
        results.push({
          ruleId: "no-destructured-props",
          passed: false,
          message:
            "Destructured props in a component function may not react to prop changes. Solid relies on direct property access for reactivity.",
          line: i + 1,
          column: 0,
          severity: "WARNING",
          suggestion:
            "Use `props.bar` instead of destructuring to preserve Solid's reactive tracking.",
        });
      }
    }

    return results;
  },
};

export const solidRules: RulePack = {
  id: "solid",
  label: "Solid",
  when: (ctx) => {
    const hasSolidDep = ctx.deps["solid-js"] !== undefined;
    const hasSolidFiles =
      ctx.langProfile.distribution["tsx"] !== undefined &&
      ctx.langProfile.distribution["tsx"]! > 0 &&
      hasSolidDep;
    return hasSolidFiles || hasSolidDep;
  },
  rules: [
    {
      kind: "must",
      text: "Use `createSignal`, `createMemo`, `createEffect` for reactive state — not plain variables. Solid's reactivity depends on tracking access within tracked scopes.",
    },
    {
      kind: "avoid",
      text: "Do NOT destructure props in component function parameters. Access `props.x` directly to preserve reactive tracking.",
    },
    {
      kind: "should",
      text: "Prefer JSX over `document.createElement` or string interpolation for DOM updates. Solid's JSX compiler produces direct DOM operations.",
    },
    {
      kind: "should",
      text: "Use `For` and `Show` control flow components from `solid-js` instead of `.map()` and ternary operators for reactive lists and conditionals.",
    },
    {
      kind: "avoid",
      text: "Do NOT use hooks-like patterns with conditional calls. Solid's primitives are not hooks — they can be called inside conditionals, but doing so complicates reasoning.",
    },
    {
      kind: "must",
      text: "Wrap side effects in `createEffect` — not raw `setTimeout` or `Promise.then` — to ensure proper cleanup and tracking.",
    },
  ],
  fileGlobs: ["**/*.tsx", "**/*.jsx"],
  evaluators: [destructuredProps],
};
