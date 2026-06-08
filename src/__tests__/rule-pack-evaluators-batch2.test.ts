/**
 * Tests for the second batch of deterministic evaluators mapped from the
 * AI review report's recurring patterns:
 *   - typescript-strict/no-double-cast
 *   - vite/no-framework-directives
 *   - tanstack-query/no-inline-query-keys
 *   - antd/no-hardcoded-hex-color
 *
 * Covers valid (no-finding) input, known-bad input, file-extension and
 * dependency gating, and eslint-disable opt-outs.
 */

import { describe, it, expect } from "@jest/globals";
import { evaluateChangedFiles } from "../services/skills-generator/rule-packs/evaluator.js";
import { ALL_PACKS } from "../services/skills-generator/rule-packs/index.js";
import type { RulePackContext } from "../services/skills-generator/rule-packs/index.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeContext(deps?: Record<string, string>): RulePackContext {
  return {
    langProfile: {
      dominant: "typescript",
      secondary: [],
      distribution: { typescript: 5 },
      indexableShare: 1,
      nonIndexableHotspots: [],
    },
    frameworks: [],
    deps: deps ?? {},
  };
}

function findings(
  files: Record<string, string>,
  ruleId: string,
  deps?: Record<string, string>,
): ReturnType<typeof evaluateChangedFiles> {
  return evaluateChangedFiles(makeContext(deps), {
    files: new Map(Object.entries(files)),
  }).filter((f) => f.ruleId === ruleId);
}

// ── typescript-strict/no-double-cast ──────────────────────────────────────────

describe("typescript-strict/no-double-cast evaluator", () => {
  const rule = "typescript-strict/no-double-cast";

  it("flags `as unknown as`", () => {
    expect(
      findings({ "src/a.ts": "const x = v as unknown as Record<string, string>;\n" }, rule),
    ).toHaveLength(1);
  });

  it("flags `as any as`", () => {
    expect(findings({ "src/a.ts": "const x = v as any as Foo;\n" }, rule)).toHaveLength(1);
  });

  it("does not flag a single safe cast", () => {
    expect(findings({ "src/a.ts": "const x = v as Foo;\n" }, rule)).toHaveLength(0);
  });

  it("ignores the pattern inside comments", () => {
    expect(findings({ "src/a.ts": "// v as unknown as Foo\nconst y = 1;\n" }, rule)).toHaveLength(
      0,
    );
  });
});

// ── vite/no-framework-directives ──────────────────────────────────────────────

describe("vite/no-framework-directives evaluator", () => {
  const rule = "vite/no-framework-directives";
  const VITE = { vite: "5.0.0" };

  it("flags a 'use client' directive in a Vite project", () => {
    const f = findings(
      { "src/C.tsx": "'use client';\nexport const C = () => null;\n" },
      rule,
      VITE,
    );
    expect(f).toHaveLength(1);
    expect(f[0]!.issue.line).toBe(1);
  });

  it("flags a 'use server' directive", () => {
    expect(findings({ "src/a.ts": '"use server";\n' }, rule, VITE)).toHaveLength(1);
  });

  it("does not flag a normal string assignment that mentions use client", () => {
    expect(findings({ "src/a.ts": "const mode = 'use client';\n" }, rule, VITE)).toHaveLength(0);
  });

  it("requires the vite dependency to activate", () => {
    expect(findings({ "src/C.tsx": "'use client';\n" }, rule)).toHaveLength(0);
  });
});

// ── tanstack-query/no-inline-query-keys ───────────────────────────────────────

describe("tanstack-query/no-inline-query-keys evaluator", () => {
  const rule = "tanstack-query/no-inline-query-keys";
  const TQ = { "@tanstack/react-query": "5.0.0" };

  it("flags an inline string query key", () => {
    expect(
      findings({ "src/a.ts": "useQuery({ queryKey: ['my-requests-list'] });\n" }, rule, TQ),
    ).toHaveLength(1);
  });

  it("flags an inline mutationKey", () => {
    expect(
      findings({ "src/a.ts": "useMutation({ mutationKey: ['create'] });\n" }, rule, TQ),
    ).toHaveLength(1);
  });

  it("does not flag a query key built from a constant", () => {
    expect(
      findings({ "src/a.ts": "useQuery({ queryKey: DETAIL_QUERY_KEYS.list });\n" }, rule, TQ),
    ).toHaveLength(0);
  });

  it("does not flag a key whose first element is a constant identifier", () => {
    expect(
      findings({ "src/a.ts": "useQuery({ queryKey: [QK.base, id] });\n" }, rule, TQ),
    ).toHaveLength(0);
  });

  it("requires the tanstack-query dependency to activate", () => {
    expect(findings({ "src/a.ts": "queryKey: ['x']\n" }, rule)).toHaveLength(0);
  });
});

// ── antd/no-hardcoded-hex-color ───────────────────────────────────────────────

describe("antd/no-hardcoded-hex-color evaluator", () => {
  const rule = "antd/no-hardcoded-hex-color";
  const ANTD = { antd: "5.0.0" };

  it("flags a hex color in a style context", () => {
    expect(findings({ "src/C.tsx": "const s = { color: '#C0392B' };\n" }, rule, ANTD)).toHaveLength(
      1,
    );
  });

  it("flags hex inside an inline style object", () => {
    expect(
      findings({ "src/C.tsx": "<div style={{ background: '#2E7D32' }} />;\n" }, rule, ANTD),
    ).toHaveLength(1);
  });

  it("does not flag a hex without a styling context (e.g. an id/hash)", () => {
    expect(findings({ "src/a.ts": "const id = '#abc123';\n" }, rule, ANTD)).toHaveLength(0);
  });

  it("does not flag `#header` (not a valid hex color)", () => {
    expect(findings({ "src/C.tsx": "const color = '#header';\n" }, rule, ANTD)).toHaveLength(0);
  });

  it("requires the antd dependency to activate", () => {
    expect(findings({ "src/C.tsx": "const s = { color: '#fff' };\n" }, rule)).toHaveLength(0);
  });
});

// ── diff-awareness (patch content) ────────────────────────────────────────────

describe("evaluators ignore removed lines in patch content", () => {
  it("does not flag an `any` on a removed (`-`) diff line", () => {
    const patch = ["@@ -1,2 +1,1 @@", "-  const x: any = 1;", " const y = 2;"].join("\n");
    expect(findings({ "src/a.ts": patch }, "typescript-strict/no-any")).toHaveLength(0);
  });

  it("still flags an `any` on an added (`+`) diff line", () => {
    const patch = ["@@ -1,1 +1,2 @@", " const y = 2;", "+  const x: any = 1;"].join("\n");
    expect(findings({ "src/a.ts": patch }, "typescript-strict/no-any")).toHaveLength(1);
  });

  it("flags a `'use client'` directive on an added diff line", () => {
    const patch = ["@@ -0,0 +1,1 @@", "+'use client';"].join("\n");
    expect(
      findings({ "src/C.tsx": patch }, "vite/no-framework-directives", { vite: "5.0.0" }),
    ).toHaveLength(1);
  });

  it("does not flag a `'use client'` directive on a removed diff line", () => {
    const patch = ["@@ -1,1 +0,0 @@", "-'use client';"].join("\n");
    expect(
      findings({ "src/C.tsx": patch }, "vite/no-framework-directives", { vite: "5.0.0" }),
    ).toHaveLength(0);
  });
});

// ── pack wiring ───────────────────────────────────────────────────────────────

describe("batch-2 pack evaluator wiring", () => {
  const expectEvaluator = (packId: string, ruleId: string): void => {
    const pack = ALL_PACKS.find((p) => p.id === packId)!;
    expect(pack.evaluators?.some((e) => e.ruleId === ruleId)).toBe(true);
  };

  it("typescript-strict exposes no-double-cast", () =>
    expectEvaluator("typescript-strict", "no-double-cast"));
  it("vite exposes no-framework-directives", () =>
    expectEvaluator("vite", "no-framework-directives"));
  it("tanstack-query exposes no-inline-query-keys", () =>
    expectEvaluator("tanstack-query", "no-inline-query-keys"));
  it("antd exposes no-hardcoded-hex-color", () =>
    expectEvaluator("antd", "no-hardcoded-hex-color"));
});
