import type { RulePack } from "./index.js";

export const railsRules: RulePack = {
  id: "rails",
  label: "Rails",
  when: (ctx) => ctx.frameworks.includes("rails"),
  rules: [
    {
      kind: "must",
      text: "Use Strong Parameters in all controllers -- never use `params.permit!` or bypass mass-assignment protection.",
    },
    {
      kind: "must",
      text: "Use scopes for common queries on models instead of class methods returning `ActiveRecord::Relation`.",
    },
    {
      kind: "must",
      text: "Use `before_action` callbacks sparingly -- prefer explicit method calls in the action for clarity.",
    },
    {
      kind: "should",
      text: "Keep models focused on persistence and business logic -- move presentation logic to helpers/view models.",
    },
    { kind: "should", text: "Use `partials` and `layouts` to avoid duplication in views." },
    {
      kind: "avoid",
      text: "Do NOT use `skip_before_action` to bypass authentication -- use proper authorization checks per action.",
    },
    {
      kind: "avoid",
      text: "Do NOT put complex SQL in controllers -- use scopes or query objects.",
    },
  ],
  fileGlobs: ["**/*.rb", "app/**", "config/**"],
};
