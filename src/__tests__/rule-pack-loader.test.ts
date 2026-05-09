/**
 * Tests for user-supplied rule pack loader
 */

import { describe, it, expect } from "@jest/globals";
import { resolve } from "node:path";
import {
  loadUserRulePacks,
  applyPackOverrides,
} from "../services/skills-generator/rule-packs/loader.js";
import { ALL_PACKS } from "../services/skills-generator/rule-packs/index.js";

const FIXTURE_DIR = resolve(process.cwd(), "src/__tests__/fixtures/custom-rule-pack");

describe("loadUserRulePacks", () => {
  it("loads a JSON rule pack from fixture", async () => {
    const result = await loadUserRulePacks(FIXTURE_DIR, {
      include: ["team-rules.json"],
    });

    expect(result.packs).toHaveLength(1);
    expect(result.packs[0]!.pack.id).toBe("team-rules");
    expect(result.packs[0]!.pack.label).toBe("Team Conventions");
    expect(result.packs[0]!.pack.rules).toHaveLength(3);
  });

  it("returns empty when no include paths given", async () => {
    const result = await loadUserRulePacks("/tmp", undefined);
    expect(result.packs).toHaveLength(0);
    expect(result.exclude.size).toBe(0);
  });

  it("populates exclude set from config", async () => {
    const result = await loadUserRulePacks("/tmp", {
      exclude: ["python", "go"],
    });

    expect(result.exclude.has("python")).toBe(true);
    expect(result.exclude.has("go")).toBe(true);
  });

  it("validates rule structure with Zod", async () => {
    const result = await loadUserRulePacks(FIXTURE_DIR, {
      include: ["team-rules.json"],
    });

    const pack = result.packs[0]!.pack;
    expect(pack.rules[0]!.kind).toBe("must");
    expect(pack.rules[0]!.text).toContain("Service files");
    expect(
      pack.when({
        langProfile: {
          dominant: "typescript",
          secondary: [],
          distribution: {},
          indexableShare: 1,
          nonIndexableHotspots: [],
        },
        frameworks: [],
        deps: {},
      }),
    ).toBe(true); // User packs always active
  });
});

describe("applyPackOverrides", () => {
  it("excludes packs by id", () => {
    const result = applyPackOverrides(ALL_PACKS, new Set(["python", "go"]), []);
    const packIds = result.map((p) => p.id);
    expect(packIds).not.toContain("python");
    expect(packIds).not.toContain("go");
    expect(packIds).toContain("svelte");
  });

  it("keeps all packs when no exclusions", () => {
    const result = applyPackOverrides(ALL_PACKS, new Set(), []);
    const packIds = result.map((p) => p.id);
    expect(packIds.length).toBe(ALL_PACKS.length);
  });

  it("disables rules via extends.disable", () => {
    // Find a pack with rules
    const sveltePack = ALL_PACKS.find((p) => p.id === "svelte")!;
    const originalCount = sveltePack.rules.length;

    const result = applyPackOverrides(
      [
        {
          id: "svelte",
          label: "Svelte",
          when: () => true,
          rules: [...sveltePack.rules],
          fileGlobs: ["**/*.svelte"],
          evaluators: sveltePack.evaluators ?? [],
        },
      ],
      new Set(),
      [{ from: "svelte", disable: [sveltePack.rules[0]!.text] }],
    );

    const modifiedPack = result.find((p) => p.id === "svelte")!;
    expect(modifiedPack.rules.length).toBe(originalCount - 1);
  });
});
