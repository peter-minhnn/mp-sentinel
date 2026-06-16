/**
 * Tests for the React refactor/re-render deterministic evaluators:
 *   - react/component-inside-component
 *   - react/unstable-context-value
 *   - react/long-function
 *
 * Regression source: complex components and full-component re-render
 * pitfalls passing review without any refactor suggestion.
 */

import { describe, it, expect } from "@jest/globals";
import { evaluateChangedFiles } from "../services/skills-generator/rule-packs/evaluator.js";
import type { RulePackContext } from "../services/skills-generator/rule-packs/index.js";

function makeContext(): RulePackContext {
  return {
    langProfile: {
      dominant: "typescript",
      secondary: [],
      distribution: { typescript: 5 },
      indexableShare: 1,
      nonIndexableHotspots: [],
    },
    frameworks: [],
    deps: { react: "18.3.1" },
  };
}

function findingsFor(
  ruleId: string,
  files: Record<string, string>,
): ReturnType<typeof evaluateChangedFiles> {
  return evaluateChangedFiles(makeContext(), { files: new Map(Object.entries(files)) }).filter(
    (f) => f.ruleId === `react/${ruleId}`,
  );
}

// ── component-inside-component ──────────────────────────────────────────────

describe("react/component-inside-component", () => {
  it("flags a component declared inside another component", () => {
    const code = [
      "export const Page = () => {",
      "  const Row = (props: RowProps) => <tr>{props.children}</tr>;",
      "  return <table>{rows.map((r) => <Row key={r.id} {...r} />)}</table>;",
      "};",
    ].join("\n");
    const found = findingsFor("component-inside-component", { "Page.tsx": code });
    expect(found).toHaveLength(1);
    expect(found[0]!.issue.line).toBe(2);
  });

  it("flags nested function declarations with PascalCase names", () => {
    const code = [
      "function Dashboard() {",
      "  function Header() {",
      "    return <h1>Title</h1>;",
      "  }",
      "  return <Header />;",
      "}",
    ].join("\n");
    expect(findingsFor("component-inside-component", { "D.tsx": code })).toHaveLength(1);
  });

  it("does not flag module-scope components (no indentation)", () => {
    const code = [
      "const Header = () => <h1>Title</h1>;",
      "export function Dashboard() {",
      "  return <Header />;",
      "}",
    ].join("\n");
    expect(findingsFor("component-inside-component", { "D.tsx": code })).toHaveLength(0);
  });

  it("does not flag camelCase helpers or hooks inside components", () => {
    const code = [
      "export const Page = () => {",
      "  const formatRow = (r: Row) => `${r.id}`;",
      "  const useThing = () => 1;",
      "  return <div>{formatRow(row)}</div>;",
      "};",
    ].join("\n");
    expect(findingsFor("component-inside-component", { "P.tsx": code })).toHaveLength(0);
  });

  it("ignores test/spec/stories files and non-JSX files", () => {
    const code = ["describe('x', () => {", "  const Wrapper = () => <div />;", "});"].join("\n");
    expect(findingsFor("component-inside-component", { "P.test.tsx": code })).toHaveLength(0);
    expect(findingsFor("component-inside-component", { "P.ts": code })).toHaveLength(0);
  });
});

// ── unstable-context-value ──────────────────────────────────────────────────

describe("react/unstable-context-value", () => {
  it("flags Provider value={{ ... }} object literals", () => {
    const code = [
      "export const App = () => (",
      "  <ThemeContext.Provider value={{ theme, setTheme }}>",
      "    <Page />",
      "  </ThemeContext.Provider>",
      ");",
    ].join("\n");
    const found = findingsFor("unstable-context-value", { "App.tsx": code });
    expect(found).toHaveLength(1);
    expect(found[0]!.issue.line).toBe(2);
  });

  it("does not flag memoized provider values", () => {
    const code = [
      "const ctxValue = useMemo(() => ({ theme, setTheme }), [theme]);",
      "return <ThemeContext.Provider value={ctxValue}><Page /></ThemeContext.Provider>;",
    ].join("\n");
    expect(findingsFor("unstable-context-value", { "App.tsx": code })).toHaveLength(0);
  });

  it("does not flag non-Provider props with object literals", () => {
    const code = "return <Table pagination={{ pageSize: 10 }} />;";
    expect(findingsFor("unstable-context-value", { "T.tsx": code })).toHaveLength(0);
  });
});

// ── long-function (React-aware) ─────────────────────────────────────────────

const makeLongComponent = (logicLines: number, jsxLines = 1): string =>
  [
    "export const Big = () => {",
    ...Array.from({ length: logicLines }, (_, i) => `  const v${i} = ${i};`),
    "  return (",
    ...Array.from({ length: jsxLines }, () => "    <div />"),
    "  );",
    "};",
  ].join("\n");

const makeLongFunction = (bodyLines: number): string =>
  [
    "export function processData() {",
    ...Array.from({ length: bodyLines }, (_, i) => `  const v${i} = ${i};`),
    "  return total;",
    "}",
  ].join("\n");

const findingsForWithConfig = (
  ruleId: string,
  files: Record<string, string>,
  config: Record<string, unknown>,
): ReturnType<typeof evaluateChangedFiles> =>
  evaluateChangedFiles(makeContext(), {
    files: new Map(Object.entries(files)),
    config,
  }).filter((f) => f.ruleId === `react/${ruleId}`);

describe("react/long-function", () => {
  it("flags a component whose LOGIC exceeds the component limit (default 150)", () => {
    const found = findingsFor("long-function", { "Big.tsx": makeLongComponent(160) });
    expect(found).toHaveLength(1);
    expect(found[0]!.issue.line).toBe(1);
    expect(found[0]!.issue.message).toContain("excluding JSX");
  });

  it("does NOT flag a small-logic component even with a huge JSX return", () => {
    // 20 logic lines + 300 JSX lines: total >> 150 but logic is tiny.
    expect(findingsFor("long-function", { "Ok.tsx": makeLongComponent(20, 300) })).toHaveLength(0);
  });

  it("honors a configured maxComponentLines and excludes JSX from the count", () => {
    const found = findingsForWithConfig(
      "long-function",
      { "Big.tsx": makeLongComponent(40, 200) },
      { maxFunctionLines: 80, maxComponentLines: 30 },
    );
    expect(found).toHaveLength(1);
    // 40 logic lines + the declaration line = 41 measured, NOT 240+ with JSX.
    expect(found[0]!.issue.message).toContain("41 lines excluding JSX");
  });

  it("flags a plain (non-component) function over maxFunctionLines", () => {
    const found = findingsFor("long-function", { "util.ts": makeLongFunction(90) });
    expect(found).toHaveLength(1);
    expect(found[0]!.issue.message).toMatch(/^Function spans/);
  });

  it("does not flag components within the limit", () => {
    expect(findingsFor("long-function", { "Ok.tsx": makeLongComponent(40) })).toHaveLength(0);
  });

  it("does not double-count nested short functions inside a long one", () => {
    const code = [
      "export const Big = () => {",
      "  const onClick = () => {",
      "    doThing();",
      "  };",
      ...Array.from({ length: 160 }, (_, i) => `  const v${i} = ${i};`),
      "  return <div />;",
      "};",
    ].join("\n");
    const found = findingsFor("long-function", { "Big.tsx": code });
    expect(found).toHaveLength(1);
    expect(found[0]!.issue.line).toBe(1);
  });

  it("skips patch content (diff hunks) entirely", () => {
    const patch = [
      "diff --git a/Big.tsx b/Big.tsx",
      "@@ -1,3 +1,200 @@",
      "+export const Big = () => {",
      ...Array.from({ length: 160 }, (_, i) => `+  const v${i} = ${i};`),
      "+};",
    ].join("\n");
    expect(findingsFor("long-function", { "Big.tsx": patch })).toHaveLength(0);
  });
});
