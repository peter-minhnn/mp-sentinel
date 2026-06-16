import type { RulePack } from "./index.js";

export const phpRules: RulePack = {
  id: "php",
  label: "PHP",
  when: (ctx) => {
    const hasPhpFiles = (ctx.langProfile.distribution["php"] ?? 0) > 0;
    const hasPhpDep = ctx.deps["php"] !== undefined;
    return hasPhpFiles || hasPhpDep;
  },
  rules: [
    {
      kind: "must",
      text: "Declare `strict_types=1` in every PHP file to enable strict type checking.",
    },
    { kind: "must", text: "Use type declarations for all function parameters and return types." },
    {
      kind: "must",
      text: "Follow PSR-12 coding style: namespace declarations, class definitions, brace placement, and indentation.",
    },
    {
      kind: "should",
      text: "Prefer `final` classes by default -- only open a class for extension when the design explicitly requires it.",
    },
    {
      kind: "should",
      text: "Use constructor promotion (`public function __construct(private readonly int $id)`) for cleaner DTOs.",
    },
    {
      kind: "avoid",
      text: "Do NOT use `mixed` as a type hint -- prefer union types or a well-defined interface.",
    },
    {
      kind: "avoid",
      text: "Do NOT use `var` or dynamic property creation -- always declare properties explicitly.",
    },
  ],
  fileGlobs: ["**/*.php"],
};
