/**
 * Rule pack for React Router projects.
 * Activates when `react-router` or `react-router-dom` is a dependency.
 */

import type { RulePack } from "./index.js";

export const reactRouterRules: RulePack = {
  id: "react-router",
  label: "React Router",
  when: (ctx) =>
    ctx.deps["react-router"] !== undefined || ctx.deps["react-router-dom"] !== undefined,
  rules: [
    {
      kind: "should",
      id: "react-router/lazy-routes",
      text: "Lazy-load route components (`React.lazy` or the router's `lazy` option) so each route becomes its own chunk.",
    },
    {
      kind: "must",
      id: "react-router/link-navigation",
      text: "Navigate with `<Link>`/`<NavLink>` or `useNavigate()`, never `window.location` assignments, to preserve client-side routing.",
    },
    {
      kind: "should",
      id: "react-router/route-params-validation",
      text: "Validate route params from `useParams()` before use -- they are always `string | undefined`, never trust them as well-formed IDs.",
    },
    {
      kind: "avoid",
      id: "react-router/no-effect-redirects",
      text: "Avoid imperative redirects inside `useEffect` when a declarative `<Navigate>` or route loader/guard can express the same logic.",
    },
  ],
  fileGlobs: ["**/*.tsx", "**/*.jsx"],
};
