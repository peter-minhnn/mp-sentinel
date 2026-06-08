/**
 * Tests for the rule-pack → AI-prompt bridge.
 *
 * Verifies that active packs are derived from a tech profile and rendered into
 * a prompt section, that language packs activate for non-JS stacks, and that
 * the rendered output stays within the rule cap.
 */

import { describe, it, expect } from "@jest/globals";
import type { TechProfile } from "../types/index.js";
import {
  buildProjectRulePackContext,
  renderRulePackRulesSection,
} from "../services/rule-pack-prompt.js";
import { buildSystemPrompt } from "../config/prompts.js";

function profile(technologies: string[]): TechProfile {
  return { profile: "react-spa", technologies, source: "config" };
}

describe("renderRulePackRulesSection", () => {
  it("renders curated rules for a TypeScript stack", async () => {
    const ctx = await buildProjectRulePackContext(profile(["typescript"]));
    const section = renderRulePackRulesSection(ctx);
    expect(section).toBeTruthy();
    expect(section).toContain("FRAMEWORK & LANGUAGE BEST-PRACTICE RULES");
    expect(section).toContain("TypeScript (Strict)");
  });

  it("activates a non-JS language pack (Python) from tech keywords", async () => {
    const ctx = await buildProjectRulePackContext(profile(["python", "django"]));
    expect(ctx.langProfile.distribution["python"]).toBeGreaterThan(0);
    const section = renderRulePackRulesSection(ctx);
    expect(section).toBeTruthy();
    // The Python pack should contribute at least one rule line.
    expect(section!.toLowerCase()).toContain("python");
  });

  it("activates a framework pack from manifest deps (react)", async () => {
    // Inject deps directly to avoid depending on the on-disk manifest.
    const ctx = await buildProjectRulePackContext(profile(["typescript"]));
    ctx.deps = { ...ctx.deps, react: "18.3.1" };
    const section = renderRulePackRulesSection(ctx);
    expect(section).toContain("React");
  });

  it("returns null when no packs are active", () => {
    const section = renderRulePackRulesSection({
      langProfile: {
        dominant: "unknown",
        secondary: [],
        distribution: {},
        indexableShare: 1,
        nonIndexableHotspots: [],
      },
      frameworks: [],
      deps: {},
    });
    // builtin pack has no rules, so the rendered section should be null.
    expect(section).toBeNull();
  });

  it("is injected into the assembled system prompt", async () => {
    const prompt = await buildSystemPrompt({
      techStack: "TypeScript, React 18, Vite",
    } as Parameters<typeof buildSystemPrompt>[0]);
    expect(prompt).toContain("FRAMEWORK & LANGUAGE BEST-PRACTICE RULES");
    expect(prompt).toContain("TypeScript (Strict)");
  });

  it("caps the number of rendered rules", async () => {
    const ctx = await buildProjectRulePackContext(
      profile(["typescript", "react", "python", "go", "rust"]),
    );
    ctx.deps = { ...ctx.deps, react: "18.3.1", antd: "5.0.0", vite: "5.0.0" };
    const section = renderRulePackRulesSection(ctx);
    expect(section).toBeTruthy();
    const ruleLines = section!.split("\n").filter((l) => /^- (MUST|SHOULD|AVOID):/.test(l));
    expect(ruleLines.length).toBeLessThanOrEqual(40);
  });
});
