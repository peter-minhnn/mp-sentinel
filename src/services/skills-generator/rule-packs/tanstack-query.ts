/**
 * Rule pack for TanStack Query (React Query) projects.
 * Activates when `@tanstack/react-query` (or legacy `react-query`) is a dependency.
 */

import type { RulePack } from "./index.js";

export const tanstackQueryRules: RulePack = {
  id: "tanstack-query",
  label: "TanStack Query",
  when: (ctx) =>
    ctx.deps["@tanstack/react-query"] !== undefined || ctx.deps["react-query"] !== undefined,
  rules: [
    {
      kind: "must",
      id: "tanstack-query/stable-query-keys",
      text: "Query keys must be stable, serializable arrays that include every variable the query function depends on.",
    },
    {
      kind: "should",
      id: "tanstack-query/invalidate-after-mutation",
      text: "After mutations, invalidate or update the affected queries (`queryClient.invalidateQueries` / `setQueryData`) instead of refetching manually.",
    },
    {
      kind: "avoid",
      id: "tanstack-query/no-state-mirroring",
      text: "Do NOT copy query results into `useState` -- read from the query cache; mirrored state goes stale and double-renders.",
    },
    {
      kind: "should",
      id: "tanstack-query/error-loading-states",
      text: "Handle `isPending` / `isError` states explicitly in the UI rather than assuming data is always available.",
    },
  ],
  fileGlobs: ["**/*.ts", "**/*.tsx"],
};
