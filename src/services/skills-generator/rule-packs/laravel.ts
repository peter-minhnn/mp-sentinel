import type { RulePack } from "./index.js";

export const laravelRules: RulePack = {
  id: "laravel",
  label: "Laravel",
  when: (ctx) => ctx.frameworks.includes("laravel"),
  rules: [
    {
      kind: "must",
      text: "Use Eloquent ORM for database queries — avoid raw SQL unless query complexity requires it.",
    },
    {
      kind: "must",
      text: "Validate incoming request data using Form Request classes, not inline in controllers.",
    },
    {
      kind: "must",
      text: "Use route model binding to automatically resolve Eloquent models from route parameters.",
    },
    {
      kind: "should",
      text: "Keep controllers thin — move business logic to Service classes or Actions.",
    },
    {
      kind: "should",
      text: "Use Laravel's built-in authorization (Gates/Policies) instead of checking permissions inline.",
    },
    {
      kind: "avoid",
      text: "Do NOT use `dd()` or `dump()` in committed code — use Laravel's logging or dedicated debug tooling.",
    },
    {
      kind: "avoid",
      text: "Do NOT place queries inside Blade templates — use View Composers or dedicated DTOs.",
    },
  ],
  fileGlobs: ["**/*.php", "app/**", "resources/views/**"],
};
