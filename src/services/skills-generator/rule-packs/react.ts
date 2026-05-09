/**
 * Rule pack for React projects
 */

import type { RulePack } from "./index.js";

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
      text: "Follow the Rules of Hooks: only call hooks at the top level of a component or custom hook, never inside conditions, loops, or callbacks.",
    },
    {
      kind: "avoid",
      text: "Do NOT fetch data directly in render. Use `useEffect`, React Query, SWR, or a framework data loader (Next.js, Remix).",
    },
    {
      kind: "must",
      text: "Add a stable `key` prop to all elements inside `.map()` or `.filter()` render loops. Use a unique ID, not the array index.",
    },
    {
      kind: "should",
      text: "Prefer function components with hooks over class components for new code.",
    },
    {
      kind: "should",
      text: "Extract reusable logic into custom hooks rather than duplicating `useEffect` / `useState` patterns.",
    },
    {
      kind: "avoid",
      text: "Do NOT mutate state directly -- always use the setter from `useState` or produce new objects/arrays.",
    },
    {
      kind: "should",
      text: "Use `React.memo` sparingly and only after profiling. Premature memoization can increase memory pressure.",
    },
  ],
  fileGlobs: ["**/*.tsx", "**/*.jsx"],
};
