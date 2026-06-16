import type { RulePack } from "./index.js";

export const dartRules: RulePack = {
  id: "dart",
  label: "Dart",
  when: (ctx) => {
    const hasDartFiles = (ctx.langProfile.distribution["dart"] ?? 0) > 0;
    const hasDartDep =
      ctx.deps["dart"] !== undefined || Object.keys(ctx.deps).some((k) => k.startsWith("dart:"));
    return hasDartFiles || hasDartDep;
  },
  rules: [
    {
      kind: "must",
      text: "Use `const` constructors where possible -- Dart can canonicalize const instances at compile time.",
    },
    { kind: "must", text: "Prefer `final` over `var` for variables that are never reassigned." },
    {
      kind: "must",
      text: "Use null safety operators (`??`, `?.`, `!`) consistently -- never suppress null safety with `late` unless unavoidable.",
    },
    {
      kind: "should",
      text: "Follow `Effective Dart` style: use `lowerCamelCase` for variables/functions, `UpperCamelCase` for types.",
    },
    { kind: "should", text: "Use `factory` constructors for object reuse or caching logic." },
    {
      kind: "avoid",
      text: "Do NOT use `dynamic` unless interop with JS or JSON parsing requires it.",
    },
    {
      kind: "avoid",
      text: "Do NOT use `print()` for logging -- use a proper logging package (e.g., `logging`, `logger`).",
    },
  ],
  fileGlobs: ["**/*.dart"],
};
