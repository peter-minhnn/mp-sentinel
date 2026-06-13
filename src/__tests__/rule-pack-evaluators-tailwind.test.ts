/**
 * Tests for the Tailwind v4 deterministic evaluator:
 *   - tailwind/canonical-classes (`z-[9999]` → `z-9999`)
 *
 * Mirrors Tailwind IntelliSense `suggestCanonicalClasses`. Version-gated to
 * tailwindcss >= 4 — bare values do not exist in v3.
 */

import { describe, it, expect } from "@jest/globals";
import { evaluateChangedFiles } from "../services/skills-generator/rule-packs/evaluator.js";
import type { RulePackContext } from "../services/skills-generator/rule-packs/index.js";

function makeContext(tailwindVersion?: string): RulePackContext {
  return {
    langProfile: {
      dominant: "typescript",
      secondary: [],
      distribution: { typescript: 5 },
      indexableShare: 1,
      nonIndexableHotspots: [],
    },
    frameworks: [],
    deps: tailwindVersion ? { tailwindcss: tailwindVersion } : {},
  };
}

function findingsFor(
  files: Record<string, string>,
  tailwindVersion = "4.3.0",
): ReturnType<typeof evaluateChangedFiles> {
  return evaluateChangedFiles(makeContext(tailwindVersion), {
    files: new Map(Object.entries(files)),
  }).filter((f) => f.ruleId === "tailwind/canonical-classes");
}

describe("tailwind/canonical-classes", () => {
  it("flags z-[9999] and suggests z-9999 (IDE-hint parity)", () => {
    const code = `<div className="fixed z-[9999] flex items-center justify-center"><Card /></div>`;
    const found = findingsFor({ "Overlay.tsx": code });
    expect(found).toHaveLength(1);
    expect(found[0]!.issue.message).toContain("`z-[9999]` → `z-9999`");
    expect(found[0]!.issue.severity).toBe("INFO");
  });

  it("handles negative values and multiple utilities on one line", () => {
    const code = `<div className="-z-[10] order-[3] grid-cols-[7]" />`;
    const found = findingsFor({ "Grid.tsx": code });
    expect(found).toHaveLength(1);
    const message = found[0]!.issue.message;
    expect(message).toContain("`-z-[10]` → `-z-10`");
    expect(message).toContain("`order-[3]` → `order-3`");
    expect(message).toContain("`grid-cols-[7]` → `grid-cols-7`");
  });

  it("does not flag values that genuinely need brackets", () => {
    const code = [
      `<div className="w-[123px] opacity-[0.71] z-[var(--modal-z)]" />`,
      `<div className="grid-cols-[1fr_2fr] bg-[#e5002c]" />`,
    ].join("\n");
    expect(findingsFor({ "Ok.tsx": code })).toHaveLength(0);
  });

  it("does not flag canonical classes", () => {
    const code = `<div className="z-9999 order-3 grid-cols-7" />`;
    expect(findingsFor({ "Ok.tsx": code })).toHaveLength(0);
  });

  it("is version-gated: silent on tailwindcss v3", () => {
    const code = `<div className="z-[9999]" />`;
    expect(findingsFor({ "Overlay.tsx": code }, "3.4.1")).toHaveLength(0);
  });

  it("is dependency-gated: silent without tailwindcss", () => {
    const code = `<div className="z-[9999]" />`;
    expect(
      evaluateChangedFiles(makeContext(undefined), {
        files: new Map([["Overlay.tsx", code]]),
      }).filter((f) => f.ruleId === "tailwind/canonical-classes"),
    ).toHaveLength(0);
  });

  it("only scans markup-bearing files", () => {
    const code = `const cls = "z-[9999]";`;
    expect(findingsFor({ "constants.ts": code })).toHaveLength(0);
  });
});
