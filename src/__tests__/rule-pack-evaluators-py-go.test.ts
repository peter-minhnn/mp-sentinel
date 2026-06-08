/**
 * Tests for the Python and Go deterministic evaluators:
 *   - python/bare-except, python/mutable-default-arg, python/debugger-statement
 *   - go/discarded-error
 *
 * Covers valid/known-bad input, language gating, extension guards, and
 * diff-removed-line immunity.
 */

import { describe, it, expect } from "@jest/globals";
import { evaluateChangedFiles } from "../services/skills-generator/rule-packs/evaluator.js";
import { ALL_PACKS } from "../services/skills-generator/rule-packs/index.js";
import type { RulePackContext } from "../services/skills-generator/rule-packs/index.js";

function ctxFor(lang: string): RulePackContext {
  return {
    langProfile: {
      dominant: lang,
      secondary: [],
      distribution: { [lang]: 5 },
      indexableShare: 1,
      nonIndexableHotspots: [],
    },
    frameworks: [],
    deps: {},
  };
}

function find(lang: string, files: Record<string, string>, ruleId: string) {
  return evaluateChangedFiles(ctxFor(lang), { files: new Map(Object.entries(files)) }).filter(
    (f) => f.ruleId === ruleId,
  );
}

// ── Python ────────────────────────────────────────────────────────────────────

describe("python evaluators", () => {
  it("flags a bare except", () => {
    expect(
      find("python", { "a.py": "try:\n    do()\nexcept:\n    pass\n" }, "python/bare-except"),
    ).toHaveLength(1);
  });

  it("does not flag a specific except", () => {
    expect(
      find(
        "python",
        { "a.py": "try:\n    do()\nexcept ValueError:\n    pass\n" },
        "python/bare-except",
      ),
    ).toHaveLength(0);
  });

  it("flags a mutable default argument", () => {
    expect(
      find(
        "python",
        { "a.py": "def f(items=[]):\n    return items\n" },
        "python/mutable-default-arg",
      ),
    ).toHaveLength(1);
  });

  it("does not flag a None default", () => {
    expect(
      find(
        "python",
        { "a.py": "def f(items=None):\n    return items\n" },
        "python/mutable-default-arg",
      ),
    ).toHaveLength(0);
  });

  it("flags a leftover breakpoint()", () => {
    expect(
      find("python", { "a.py": "x = 1\nbreakpoint()\n" }, "python/debugger-statement"),
    ).toHaveLength(1);
  });

  it("respects a # noqa suppression", () => {
    expect(
      find("python", { "a.py": "except:  # noqa\n    pass\n" }, "python/bare-except"),
    ).toHaveLength(0);
  });

  it("only runs on .py files", () => {
    expect(find("python", { "a.ts": "except:\n" }, "python/bare-except")).toHaveLength(0);
  });
});

// ── Go ────────────────────────────────────────────────────────────────────────

describe("go/discarded-error evaluator", () => {
  const rule = "go/discarded-error";

  it("flags `_ = call()` discarding a result", () => {
    expect(find("go", { "a.go": "func main() {\n\t_ = doThing()\n}\n" }, rule)).toHaveLength(1);
  });

  it("flags a package-qualified call", () => {
    expect(find("go", { "a.go": "_ = json.Marshal(v)\n" }, rule)).toHaveLength(1);
  });

  it("does not flag `_ = someVar` (not a call)", () => {
    expect(find("go", { "a.go": "_ = someVar\n" }, rule)).toHaveLength(0);
  });

  it("does not flag the comma-ok map idiom", () => {
    expect(find("go", { "a.go": "v, ok := m[key]\n" }, rule)).toHaveLength(0);
  });

  it("respects a //nolint suppression", () => {
    expect(find("go", { "a.go": "_ = doThing() //nolint\n" }, rule)).toHaveLength(0);
  });

  it("ignores a removed (`-`) diff line", () => {
    const patch = ["@@ -1,1 +0,0 @@", "-\t_ = doThing()"].join("\n");
    expect(find("go", { "a.go": patch }, rule)).toHaveLength(0);
  });
});

// ── wiring ────────────────────────────────────────────────────────────────────

describe("py/go pack wiring", () => {
  it("python pack exposes its evaluators", () => {
    const pack = ALL_PACKS.find((p) => p.id === "python")!;
    const ids = pack.evaluators?.map((e) => e.ruleId) ?? [];
    expect(ids).toEqual(
      expect.arrayContaining(["bare-except", "mutable-default-arg", "debugger-statement"]),
    );
  });

  it("go pack exposes discarded-error", () => {
    const pack = ALL_PACKS.find((p) => p.id === "go")!;
    expect(pack.evaluators?.some((e) => e.ruleId === "discarded-error")).toBe(true);
  });
});
