/**
 * Tests for rule-pack evaluator engine and individual evaluators.
 *
 * Covers: evaluator engine execution, each shipped evaluator's
 * no-finding path (valid input) and finding path (known-bad input),
 * severity overrides, and active-pack filtering.
 */

import { describe, it, expect } from "@jest/globals";
import { evaluateChangedFiles } from "../services/skills-generator/rule-packs/evaluator.js";
import { ALL_PACKS } from "../services/skills-generator/rule-packs/index.js";
import type { RulePackContext } from "../services/skills-generator/rule-packs/index.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeContext(langProfile?: Record<string, number>): RulePackContext {
  return {
    langProfile: {
      dominant: "typescript",
      secondary: [],
      distribution: langProfile ?? { typescript: 1 },
      indexableShare: 1,
      nonIndexableHotspots: [],
    },
    frameworks: [],
    deps: {},
  };
}

function makeFiles(files: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(files));
}

// ── Evaluator Engine ────────────────────────────────────────────────────────

describe("Evaluator engine", () => {
  it("returns empty findings when no evaluators trigger", () => {
    const findings = evaluateChangedFiles(makeContext(), {
      files: makeFiles({ "src/index.ts": "const x = 1;\n" }),
    });
    // Builtin evaluators (file-too-long, function-too-long) should pass
    expect(findings.length).toBe(0);
  });

  it("returns findings for files exceeding maxFileLines", () => {
    const longFile = Array.from({ length: 600 }, (_, i) => `console.log(${i});`).join("\n");
    const findings = evaluateChangedFiles(makeContext(), {
      files: makeFiles({ "src/long.ts": longFile }),
    });
    const fileFindings = findings.filter((f) => f.ruleId.startsWith("builtin/"));
    expect(findings.length).toBeGreaterThan(0);
    // At least one finding should be for file-too-long
    expect(findings.some((f) => f.ruleId === "builtin/file-too-long")).toBe(true);
  });

  it("includes ruleId in <packId>/<ruleId> format", () => {
    const longFile = Array.from({ length: 600 }, (_, i) => `const x${i} = ${i};\n`).join("");
    const findings = evaluateChangedFiles(makeContext(), {
      files: makeFiles({ "src/long.ts": longFile }),
    });
    for (const f of findings) {
      expect(f.ruleId).toMatch(/^[a-z-]+\/[a-z-]+$/);
    }
  });

  it("severity override changes finding severity", () => {
    const longFile = Array.from({ length: 600 }, (_, i) => `console.log(${i});\n`).join("");
    const findings = evaluateChangedFiles(makeContext(), {
      files: makeFiles({ "src/long.ts": longFile }),
      severityOverrides: { "builtin/file-too-long": "CRITICAL" },
    });
    for (const f of findings) {
      if (f.ruleId === "builtin/file-too-long") {
        expect(f.issue.severity).toBe("CRITICAL");
      }
    }
  });
});

// ── Svelte Evaluator ────────────────────────────────────────────────────────

describe("Svelte evaluator: imports-inside-script", () => {
  it("passes valid svelte file with imports inside <script>", () => {
    const content = [
      '<script lang="ts">',
      '  import { onMount } from "svelte";',
      "  let count = 0;",
      "</script>",
      "",
      "<h1>Hello</h1>",
    ].join("\n");

    const findings = evaluateChangedFiles(makeContext({ svelte: 5, typescript: 2 }), {
      files: makeFiles({ "src/Button.svelte": content }),
    });
    const svelteFindings = findings.filter((f) => f.ruleId.startsWith("svelte/"));
    expect(svelteFindings).toHaveLength(0);
  });

  it("flags import outside <script> in svelte file", () => {
    const content = [
      '<script lang="ts">',
      "  let count = 0;",
      "</script>",
      "",
      'import { onMount } from "svelte";',
      "",
      "<h1>Hello</h1>",
    ].join("\n");

    const findings = evaluateChangedFiles(makeContext({ svelte: 5, typescript: 2 }), {
      files: makeFiles({ "src/Bad.svelte": content }),
    });
    const svelteFindings = findings.filter((f) => f.ruleId.startsWith("svelte/"));
    expect(svelteFindings.length).toBeGreaterThan(0);
    expect(svelteFindings[0]!.ruleId).toBe("svelte/imports-inside-script");
    // The import is on line 5 (0-indexed line 4)
    expect(svelteFindings[0]!.issue.line).toBe(5);
  });

  it("does not flag non-svelte files", () => {
    const content = ['import { onMount } from "react";', "const x = 1;"].join("\n");

    const findings = evaluateChangedFiles(makeContext({ typescript: 5 }), {
      files: makeFiles({ "src/component.ts": content }),
    });
    const svelteFindings = findings.filter((f) => f.ruleId.startsWith("svelte/"));
    expect(svelteFindings).toHaveLength(0);
  });
});

// ── Clean-code Evaluators ───────────────────────────────────────────────────

describe("Clean-code evaluator: file-too-long", () => {
  it("passes for files under the limit", () => {
    const shortFile = Array.from({ length: 50 }, (_, i) => `const x${i} = ${i};`).join("\n");
    const findings = evaluateChangedFiles(makeContext(), {
      files: makeFiles({ "src/short.ts": shortFile }),
    });
    expect(findings.filter((f) => f.ruleId === "builtin/file-too-long")).toHaveLength(0);
  });

  it("flags files over the limit", () => {
    const longFile = Array.from({ length: 600 }, (_, i) => `const x${i} = ${i};`).join("\n");
    const findings = evaluateChangedFiles(makeContext(), {
      files: makeFiles({ "src/too-long.ts": longFile }),
    });
    expect(findings.filter((f) => f.ruleId === "builtin/file-too-long").length).toBeGreaterThan(0);
  });
});

describe("Clean-code evaluator: function-too-long", () => {
  it("flags functions over maxFunctionLines", () => {
    const longFunc = [
      "function longFunction() {",
      ...Array.from({ length: 100 }, (_, i) => `  const x${i} = ${i};`),
      "}",
    ].join("\n");

    const findings = evaluateChangedFiles(makeContext(), {
      files: makeFiles({ "src/long-func.ts": longFunc }),
    });
    expect(findings.filter((f) => f.ruleId === "builtin/function-too-long").length).toBeGreaterThan(
      0,
    );
  });

  it("passes for short functions", () => {
    const shortFunc = ["function shortFunction() {", "  const x = 1;", "  return x;", "}"].join(
      "\n",
    );

    const findings = evaluateChangedFiles(makeContext(), {
      files: makeFiles({ "src/short-func.ts": shortFunc }),
    });
    expect(findings.filter((f) => f.ruleId === "builtin/function-too-long")).toHaveLength(0);
  });
});

// ── ALL_PACKS evaluator presence ────────────────────────────────────────────

describe("ALL_PACKS evaluator presence", () => {
  it("all packs with evaluators have non-empty evaluator arrays", () => {
    for (const pack of ALL_PACKS) {
      if (pack.evaluators) {
        expect(pack.evaluators.length).toBeGreaterThan(0);
        for (const ev of pack.evaluators) {
          expect(ev.ruleId).toMatch(/^[a-z][a-z0-9-]*$/);
          expect(typeof ev.evaluate).toBe("function");
        }
      }
    }
  });

  it("builtin pack has file-too-long and function-too-long evaluators", () => {
    const builtin = ALL_PACKS.find((p) => p.id === "builtin")!;
    expect(builtin.evaluators).toBeDefined();
    const evIds = builtin.evaluators!.map((e) => e.ruleId);
    expect(evIds).toContain("file-too-long");
    expect(evIds).toContain("function-too-long");
  });

  it("svelte pack has imports-inside-script evaluator", () => {
    const svelte = ALL_PACKS.find((p) => p.id === "svelte")!;
    expect(svelte.evaluators).toBeDefined();
    expect(svelte.evaluators![0]!.ruleId).toBe("imports-inside-script");
  });
});
