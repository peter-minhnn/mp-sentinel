/**
 * Rule pack for React projects
 */

import type { RulePack } from "./index.js";
import {
  noInlineStyle,
  exhaustiveDepsSuppressed,
  componentInsideComponent,
  unstableContextValue,
  longFunction,
} from "./evaluators/react-evaluators.js";

export const reactRules: RulePack = {
  id: "react",
  label: "React",
  when: (ctx) => {
    const hasReactDep = ctx.deps["react"] !== undefined || ctx.deps["react-dom"] !== undefined;
    return hasReactDep;
  },
  rules: [
    {
      kind: "must",
      id: "react/rules-of-hooks",
      text: "Follow the Rules of Hooks: only call hooks at the top level of a component or custom hook, never inside conditions, loops, or callbacks.",
    },
    {
      kind: "avoid",
      id: "react/no-fetch-in-render",
      text: "Do NOT fetch data directly in render. Use `useEffect`, React Query, SWR, or a framework data loader (Next.js, Remix).",
    },
    {
      kind: "must",
      id: "react/stable-list-keys",
      text: "Add a stable `key` prop to all elements inside `.map()` or `.filter()` render loops. Use a unique ID, not the array index.",
    },
    {
      kind: "should",
      id: "react/function-components",
      text: "Prefer function components with hooks over class components for new code.",
    },
    {
      kind: "should",
      id: "react/extract-custom-hooks",
      text: "Extract reusable logic into custom hooks rather than duplicating `useEffect` / `useState` patterns.",
    },
    {
      kind: "avoid",
      id: "react/no-direct-state-mutation",
      text: "Do NOT mutate state directly -- always use the setter from `useState` or produce new objects/arrays.",
    },
    {
      kind: "should",
      id: "react/memo-after-profiling",
      text: "Use `React.memo` sparingly and only after profiling. Premature memoization can increase memory pressure.",
    },
    {
      kind: "avoid",
      id: "react/no-nested-component-defs",
      text: "Do NOT declare components inside another component body -- they remount (state reset + full subtree re-render) on every parent render. Move them to module scope.",
    },
    {
      kind: "should",
      id: "react/stable-context-value",
      text: "Memoize context Provider values (`useMemo`) and keep state as close to where it is used as possible, so one state change does not re-render an entire page.",
    },
  ],
  fileGlobs: ["**/*.tsx", "**/*.jsx"],
  evaluators: [
    noInlineStyle,
    exhaustiveDepsSuppressed,
    componentInsideComponent,
    unstableContextValue,
    longFunction,
  ],
};
