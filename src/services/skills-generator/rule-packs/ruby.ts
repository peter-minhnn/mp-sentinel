import type { RulePack } from "./index.js";

export const rubyRules: RulePack = {
  id: "ruby",
  label: "Ruby",
  when: (ctx) => {
    const hasRubyFiles = (ctx.langProfile.distribution["ruby"] ?? 0) > 0;
    const hasRubyDep = ctx.deps["ruby"] !== undefined;
    return hasRubyFiles || hasRubyDep;
  },
  rules: [
    {
      kind: "must",
      text: "Use frozen string literals — add `# frozen_string_literal: true` at the top of every `.rb` file.",
    },
    {
      kind: "must",
      text: "Follow Ruby style guide: `snake_case` for methods/variables, `CamelCase` for classes/modules, `SCREAMING_SNAKE_CASE` for constants.",
    },
    {
      kind: "should",
      text: "Prefer keyword arguments (`def foo(bar:)`) over positional arguments for methods with 3+ parameters.",
    },
    { kind: "should", text: "Use safe navigation operator `&.` to avoid nil-check conditionals." },
    {
      kind: "avoid",
      text: "Do NOT use `unless` with an `else` — rephrase the condition for readability.",
    },
    {
      kind: "avoid",
      text: "Do NOT rescue `Exception` — rescue specific exception classes instead.",
    },
  ],
  fileGlobs: ["**/*.rb"],
};
