/**
 * Rule pack for Supabase projects.
 * Activates when `@supabase/supabase-js` (or the SSR helper) is a dependency.
 */

import type { RulePack } from "./index.js";

export const supabaseRules: RulePack = {
  id: "supabase",
  label: "Supabase",
  when: (ctx) =>
    ctx.deps["@supabase/supabase-js"] !== undefined || ctx.deps["@supabase/ssr"] !== undefined,
  rules: [
    {
      kind: "must",
      id: "supabase/no-service-role-client",
      text: "Never ship the `service_role` key to client code. Only the anon/publishable key may appear in browser bundles or client env vars.",
    },
    {
      kind: "must",
      id: "supabase/rls-first",
      text: "Treat Row Level Security as the authorization boundary: every user-facing table needs RLS policies; do not rely on client-side filtering.",
    },
    {
      kind: "must",
      id: "supabase/handle-query-errors",
      text: "Supabase query builders return `{ data, error }` without throwing -- check `error` (and null `data`) on every call.",
    },
    {
      kind: "should",
      id: "supabase/single-client-instance",
      text: "Create the Supabase client once (module-level or context) and reuse it; per-call `createClient` leaks connections and auth listeners.",
    },
  ],
  fileGlobs: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
};
