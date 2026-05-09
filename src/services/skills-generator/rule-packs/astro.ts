/**
 * Rule pack for Astro projects
 */

import type { RulePack, FileEvaluator } from "./index.js";

/**
 * Evaluator: detect client-side code without proper island directive
 */
const islandDirectiveMissing: FileEvaluator = {
  ruleId: "island-directive-missing",
  evaluate: ({ filePath, lines }) => {
    if (!filePath.endsWith(".astro")) return [];
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
      // Check for interactive JS patterns without client: directive
      if (
        /onclick=|onload=|onchange=|addEventListener/.test(line) &&
        !/client:/.test(lines.slice(Math.max(0, i - 3), i + 1).join(" "))
      ) {
        results.push({
          ruleId: "island-directive-missing",
          passed: false,
          message: "Interactive JavaScript found without a `client:` island directive.",
          line: i + 1,
          column: 0,
          severity: "WARNING",
          suggestion:
            "Wrap interactive elements in an island component with `client:load`, `client:idle`, or `client:visible`.",
        });
      }
    }

    return results;
  },
};

export const astroRules: RulePack = {
  id: "astro",
  label: "Astro",
  when: (ctx) => {
    const hasAstroFiles =
      ctx.langProfile.distribution["astro"] !== undefined &&
      ctx.langProfile.distribution["astro"]! > 0;
    const hasAstroDep = ctx.deps["astro"] !== undefined;
    return hasAstroFiles || hasAstroDep;
  },
  rules: [
    {
      kind: "must",
      text: "Place all component logic in the frontmatter section (`---` delimiters) at the top of `.astro` files. The frontmatter runs at build time.",
    },
    {
      kind: "must",
      text: "Use `client:*` directives (`client:load`, `client:idle`, `client:visible`, `client:media`) for interactive components. Without a directive, components are rendered as static HTML.",
    },
    {
      kind: "should",
      text: "Use Framework Components (React, Svelte, Vue) for interactive islands when you need client-side state. Keep `.astro` files for static content and layout.",
    },
    {
      kind: "avoid",
      text: "Do NOT put `<script>` tags with global event handlers directly in `.astro` templates without proper scoping. Use Astro's built-in script processing or framework islands.",
    },
    {
      kind: "should",
      text: "Use Astro's content collections (`src/content/`) for structured content with schema validation, rather than manual Markdown frontmatter parsing.",
    },
    {
      kind: "should",
      text: "Prefer Astro's image optimization (`<Image />`, `<Picture />`) over raw `<img>` tags for assets in `src/`.",
    },
  ],
  fileGlobs: ["**/*.astro"],
  evaluators: [islandDirectiveMissing],
};
