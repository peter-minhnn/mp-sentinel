/**
 * Tests for the builtin/no-empty-catch evaluator.
 *
 * Covers single-line and multi-line empty catches, comment-only bodies,
 * non-empty bodies (no finding), the promise `.catch()` false-positive guard,
 * eslint-disable opt-out, file-extension gating, and diff-removed-line immunity.
 */

import { describe, it, expect } from "@jest/globals";
import { evaluateChangedFiles } from "../services/skills-generator/rule-packs/evaluator.js";
import { ALL_PACKS } from "../services/skills-generator/rule-packs/index.js";
import type { RulePackContext } from "../services/skills-generator/rule-packs/index.js";

function ctx(): RulePackContext {
  return {
    langProfile: {
      dominant: "typescript",
      secondary: [],
      distribution: { typescript: 1 },
      indexableShare: 1,
      nonIndexableHotspots: [],
    },
    frameworks: [],
    deps: {},
  };
}

function emptyCatchFindings(files: Record<string, string>) {
  return evaluateChangedFiles(ctx(), { files: new Map(Object.entries(files)) }).filter(
    (f) => f.ruleId === "builtin/no-empty-catch",
  );
}

describe("builtin/no-empty-catch", () => {
  it("flags a single-line empty catch", () => {
    expect(emptyCatchFindings({ "a.ts": "try { f(); } catch (e) {}\n" })).toHaveLength(1);
  });

  it("flags a multi-line empty catch", () => {
    expect(emptyCatchFindings({ "a.ts": "try {\n  f();\n} catch (e) {\n}\n" })).toHaveLength(1);
  });

  it("flags a comment-only catch body (e.g. `// Ignore`)", () => {
    expect(
      emptyCatchFindings({ "a.ts": "try {\n  f();\n} catch {\n  // Ignore\n}\n" }),
    ).toHaveLength(1);
  });

  it("does not flag a catch that logs the error", () => {
    expect(
      emptyCatchFindings({ "a.ts": "try {\n  f();\n} catch (e) {\n  console.error(e);\n}\n" }),
    ).toHaveLength(0);
  });

  it("does not flag a catch with a same-line statement", () => {
    expect(emptyCatchFindings({ "a.ts": "try { f(); } catch (e) { log(e); }\n" })).toHaveLength(0);
  });

  it("does not flag a promise `.catch(() => {})`", () => {
    expect(emptyCatchFindings({ "a.ts": "p.catch(() => {});\n" })).toHaveLength(0);
  });

  it("respects an eslint-disable inside the body", () => {
    expect(
      emptyCatchFindings({
        "a.ts": "try {\n  f();\n} catch (e) {\n  // eslint-disable-next-line\n}\n",
      }),
    ).toHaveLength(0);
  });

  it("only runs on JS/TS family files", () => {
    expect(emptyCatchFindings({ "a.py": "try:\n    pass\nexcept:\n    pass\n" })).toHaveLength(0);
  });

  it("ignores an empty catch on a removed diff line", () => {
    const patch = ["@@ -1,1 +0,0 @@", "-} catch (e) {}"].join("\n");
    expect(emptyCatchFindings({ "a.ts": patch })).toHaveLength(0);
  });

  it("flags an empty catch on an added diff line", () => {
    const patch = ["@@ -0,0 +1,1 @@", "+} catch (e) {}"].join("\n");
    expect(emptyCatchFindings({ "a.ts": patch })).toHaveLength(1);
  });

  it("is registered on the builtin pack", () => {
    const builtin = ALL_PACKS.find((p) => p.id === "builtin")!;
    expect(builtin.evaluators?.some((e) => e.ruleId === "no-empty-catch")).toBe(true);
  });
});
