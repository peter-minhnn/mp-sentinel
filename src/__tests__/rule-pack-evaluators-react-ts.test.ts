/**
 * Tests for the React and TypeScript-strict deterministic evaluators:
 *   - typescript-strict/no-any
 *   - react/no-inline-style
 *
 * Covers valid (no-finding) input, known-bad input, file-extension guards,
 * eslint-disable opt-outs, string/comment immunity, and dependency-gated
 * activation of the react pack.
 */

import { describe, it, expect } from "@jest/globals";
import { evaluateChangedFiles } from "../services/skills-generator/rule-packs/evaluator.js";
import { runRulePackEvaluators } from "../cli/deterministic-review.js";
import { ALL_PACKS } from "../services/skills-generator/rule-packs/index.js";
import type { RulePackContext } from "../services/skills-generator/rule-packs/index.js";
import { stripStringsAndComments } from "../services/skills-generator/rule-packs/evaluators/text-scan.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeContext(
  langProfile?: Record<string, number>,
  deps?: Record<string, string>,
): RulePackContext {
  return {
    langProfile: {
      dominant: "typescript",
      secondary: [],
      distribution: langProfile ?? { typescript: 1 },
      indexableShare: 1,
      nonIndexableHotspots: [],
    },
    frameworks: [],
    deps: deps ?? {},
  };
}

function makeFiles(files: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(files));
}

function anyFindings(files: Record<string, string>): ReturnType<typeof evaluateChangedFiles> {
  return evaluateChangedFiles(makeContext(), { files: makeFiles(files) }).filter(
    (f) => f.ruleId === "typescript-strict/no-any",
  );
}

const REACT_CTX = makeContext({ typescript: 5 }, { react: "18.3.1" });

function inlineStyleFindings(
  files: Record<string, string>,
): ReturnType<typeof evaluateChangedFiles> {
  return evaluateChangedFiles(REACT_CTX, { files: makeFiles(files) }).filter(
    (f) => f.ruleId === "react/no-inline-style",
  );
}

// ── typescript-strict/no-any ──────────────────────────────────────────────────

describe("typescript-strict/no-any evaluator", () => {
  it("flags `: any` annotations", () => {
    const findings = anyFindings({ "src/a.ts": "function f(x: any) {\n  return x;\n}\n" });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.issue.line).toBe(1);
    expect(findings[0]!.issue.severity).toBe("WARNING");
  });

  it("flags `as any` assertions", () => {
    expect(anyFindings({ "src/a.ts": "const y = z as any;\n" })).toHaveLength(1);
  });

  it("flags generic `any` args (Array<any>, Record<string, any>, any[])", () => {
    expect(anyFindings({ "src/a.ts": "let a: Array<any>;\n" }).length).toBeGreaterThan(0);
    expect(anyFindings({ "src/a.ts": "let b: Record<string, any>;\n" }).length).toBeGreaterThan(0);
    expect(anyFindings({ "src/a.ts": "let c: any[];\n" }).length).toBeGreaterThan(0);
  });

  it("does NOT flag identifiers that merely contain 'any'", () => {
    const findings = anyFindings({
      "src/a.ts": "const company = many(anyOf);\nconst Anya = 1;\n",
    });
    expect(findings).toHaveLength(0);
  });

  it("ignores `any` inside strings and comments", () => {
    const findings = anyFindings({
      "src/a.ts": 'const msg = "cast as any here";\n// returns any value\nconst ok = 1;\n',
    });
    expect(findings).toHaveLength(0);
  });

  it("respects eslint-disable opt-out", () => {
    const findings = anyFindings({
      "src/a.ts":
        "// eslint-disable-next-line @typescript-eslint/no-explicit-any\nconst x: any = 1;\n",
    });
    // Both lines carry no finding: the directive line has no type, and the
    // flagged line is suppressed by the inline disable comment.
    expect(findings).toHaveLength(0);
  });

  it("does not scan .d.ts declaration files", () => {
    expect(anyFindings({ "src/types.d.ts": "export type T = any;\n" })).toHaveLength(0);
  });

  it("passes clean TypeScript with no any", () => {
    expect(anyFindings({ "src/a.ts": "const n: number = 1;\nexport default n;\n" })).toHaveLength(
      0,
    );
  });
});

// ── react/no-inline-style ─────────────────────────────────────────────────────

describe("react/no-inline-style evaluator", () => {
  it("flags JSX inline style object literals", () => {
    const findings = inlineStyleFindings({
      "src/C.tsx": "export const C = () => <div style={{ color: 'red' }} />;\n",
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.issue.severity).toBe("WARNING");
  });

  it("does NOT flag style object references", () => {
    const findings = inlineStyleFindings({
      "src/C.tsx": "export const C = () => <div style={styles.row} />;\n",
    });
    expect(findings).toHaveLength(0);
  });

  it("only runs on tsx/jsx files, not plain .ts", () => {
    const findings = inlineStyleFindings({
      "src/util.ts": "const x = { style: { color: 'red' } };\n",
    });
    expect(findings).toHaveLength(0);
  });

  it("requires the react dependency to activate", () => {
    // No react dep → react pack inactive → no finding even on a .tsx file.
    const findings = evaluateChangedFiles(makeContext({ typescript: 5 }), {
      files: makeFiles({ "src/C.tsx": "const C = () => <div style={{ color: 'red' }} />;\n" }),
    }).filter((f) => f.ruleId === "react/no-inline-style");
    expect(findings).toHaveLength(0);
  });

  it("respects eslint-disable opt-out", () => {
    const findings = inlineStyleFindings({
      "src/C.tsx": "const C = () => <div style={{ color: 'red' }} />; // eslint-disable-line\n",
    });
    expect(findings).toHaveLength(0);
  });
});

// ── react/exhaustive-deps-suppressed ──────────────────────────────────────────

describe("react/exhaustive-deps-suppressed evaluator", () => {
  function depsFindings(files: Record<string, string>): ReturnType<typeof evaluateChangedFiles> {
    return evaluateChangedFiles(REACT_CTX, { files: makeFiles(files) }).filter(
      (f) => f.ruleId === "react/exhaustive-deps-suppressed",
    );
  }

  it("flags a react-hooks/exhaustive-deps suppression", () => {
    const findings = depsFindings({
      "src/C.tsx":
        "useEffect(() => { run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps\n",
    });
    expect(findings).toHaveLength(1);
  });

  it("flags the eslint-disable-next-line form", () => {
    const findings = depsFindings({
      "src/h.ts": "// eslint-disable-next-line react-hooks/exhaustive-deps\nuseEffect(fn, []);\n",
    });
    expect(findings).toHaveLength(1);
  });

  it("does not flag an unrelated eslint-disable", () => {
    const findings = depsFindings({
      "src/C.tsx": "const x = 1; // eslint-disable-line no-console\n",
    });
    expect(findings).toHaveLength(0);
  });
});

// ── text-scan helper ──────────────────────────────────────────────────────────

describe("stripStringsAndComments", () => {
  it("blanks string literal contents", () => {
    expect(stripStringsAndComments('const a = "x: any";').includes("any")).toBe(false);
  });

  it("drops line comments", () => {
    expect(stripStringsAndComments("const a = 1; // x: any").includes("any")).toBe(false);
  });

  it("drops block comments on a single line", () => {
    expect(stripStringsAndComments("const a = 1; /* x: any */ const b = 2;").includes("any")).toBe(
      false,
    );
  });

  it("preserves real code outside strings/comments", () => {
    expect(stripStringsAndComments("let v: any = 1;").includes("any")).toBe(true);
  });
});

// ── pack wiring ───────────────────────────────────────────────────────────────

describe("pack evaluator wiring", () => {
  it("typescript-strict pack exposes the no-any evaluator", () => {
    const pack = ALL_PACKS.find((p) => p.id === "typescript-strict")!;
    expect(pack.evaluators?.some((e) => e.ruleId === "no-any")).toBe(true);
  });

  it("react pack exposes the no-inline-style evaluator", () => {
    const pack = ALL_PACKS.find((p) => p.id === "react")!;
    expect(pack.evaluators?.some((e) => e.ruleId === "no-inline-style")).toBe(true);
  });
});

// ── deps wiring (runRulePackEvaluators) ───────────────────────────────────────

describe("runRulePackEvaluators dependency gating", () => {
  const tsxFile = [{ path: "src/C.tsx", content: "const C = () => <div style={{ x: 1 }} />;\n" }];

  it("activates the react pack when deps include react", () => {
    const results = runRulePackEvaluators(tsxFile, undefined, { react: "18.3.1" });
    const issues = results.flatMap((r) => r.result.issues ?? []);
    expect(issues.some((i) => i.message.includes("inline `style={{ }}`"))).toBe(true);
  });

  it("leaves the react pack inactive when deps are absent (backward compatible)", () => {
    const results = runRulePackEvaluators(tsxFile);
    const issues = results.flatMap((r) => r.result.issues ?? []);
    expect(issues.some((i) => i.message.includes("inline `style={{ }}`"))).toBe(false);
  });
});
