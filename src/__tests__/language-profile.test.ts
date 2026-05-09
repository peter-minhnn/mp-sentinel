/**
 * Tests for LanguageProfile detection
 */

import { describe, it, expect } from "@jest/globals";
import {
  detectLanguageProfile,
  extensionToLanguageName,
} from "../services/skills-generator/language-profile.js";

// ── extensionToLanguageName ─────────────────────────────────────────────────

describe("extensionToLanguageName", () => {
  it("handles TypeScript extensions", () => {
    expect(extensionToLanguageName("ts")).toBe("typescript");
    expect(extensionToLanguageName("tsx")).toBe("tsx");
    expect(extensionToLanguageName("mts")).toBe("typescript");
    expect(extensionToLanguageName("cts")).toBe("typescript");
  });

  it("handles JavaScript extensions", () => {
    expect(extensionToLanguageName("js")).toBe("javascript");
    expect(extensionToLanguageName("jsx")).toBe("jsx");
    expect(extensionToLanguageName("mjs")).toBe("javascript");
    expect(extensionToLanguageName("cjs")).toBe("javascript");
  });

  it("handles Svelte and Vue", () => {
    expect(extensionToLanguageName("svelte")).toBe("svelte");
    expect(extensionToLanguageName("vue")).toBe("vue");
  });

  it("handles Python", () => {
    expect(extensionToLanguageName("py")).toBe("python");
    expect(extensionToLanguageName("pyi")).toBe("python");
  });

  it("handles Go and Rust", () => {
    expect(extensionToLanguageName("go")).toBe("go");
    expect(extensionToLanguageName("rs")).toBe("rust");
  });

  it("handles unknown extensions", () => {
    expect(extensionToLanguageName("xyz")).toBeNull();
    expect(extensionToLanguageName("")).toBeNull();
  });

  it("handles leading dot", () => {
    expect(extensionToLanguageName(".ts")).toBe("typescript");
    expect(extensionToLanguageName(".svelte")).toBe("svelte");
  });
});

// ── detectLanguageProfile ───────────────────────────────────────────────────

describe("detectLanguageProfile", () => {
  it("detects TypeScript-only project", () => {
    const files = ["src/index.ts", "src/utils.ts", "src/types.ts", "src/helpers.ts"];
    const profile = detectLanguageProfile(files);
    expect(profile.dominant).toBe("typescript");
    expect(profile.secondary).toEqual([]);
    expect(profile.distribution).toEqual({ typescript: 4 });
    expect(profile.indexableShare).toBe(1);
    expect(profile.nonIndexableHotspots).toEqual([]);
  });

  it("detects Svelte-heavy project", () => {
    const files = [
      "src/routes/+page.svelte",
      "src/routes/+layout.svelte",
      "src/lib/Button.svelte",
      "src/lib/Card.svelte",
      "src/lib/utils.ts",
      "package.json",
    ];
    const profile = detectLanguageProfile(files);
    expect(profile.dominant).toBe("svelte");
    expect(profile.secondary).toContain("typescript");
    expect(profile.distribution).toHaveProperty("svelte", 4);
    expect(profile.distribution).toHaveProperty("typescript", 1);
    // 5 detectable files: 4 svelte + 1 typescript + 1 json = 6 total in distribution
    // indexable: 1/6 = ~0.167
    expect(profile.indexableShare).toBeCloseTo(1 / 6, 5);
    expect(profile.nonIndexableHotspots).toContain("src/svelte");
  });

  it("detects mixed polyglot project", () => {
    const files = [
      "src/main.py",
      "src/utils.py",
      "src/handler.py",
      "src/config.ts",
      "src/types.ts",
      "tests/test_main.py",
      "scripts/deploy.sh",
    ];
    const profile = detectLanguageProfile(files);
    expect(profile.dominant).toBe("python");
    expect(profile.secondary).toContain("typescript");
    expect(profile.secondary).toContain("shell");
    expect(profile.distribution).toHaveProperty("python", 4);
    expect(profile.distribution).toHaveProperty("typescript", 2);
    // 7 detectable files: 4 python + 2 typescript + 1 shell
    // indexable: 2/7 = ~0.286
    expect(profile.indexableShare).toBeCloseTo(2 / 7, 5);
  });

  it("handles empty file list", () => {
    const profile = detectLanguageProfile([]);
    expect(profile.dominant).toBe("unknown");
    expect(profile.secondary).toEqual([]);
    expect(profile.distribution).toEqual({});
    expect(profile.indexableShare).toBe(0);
  });

  it("detects hotspots in non-indexable languages", () => {
    const files = [
      "src/components/Button.svelte",
      "src/components/Card.svelte",
      "src/pages/Home.svelte",
      "src/lib/utils.ts",
      "src/lib/api.ts",
      "routes/index.ts",
    ];
    const profile = detectLanguageProfile(files);
    expect(profile.nonIndexableHotspots.length).toBeGreaterThan(0);
    expect(profile.nonIndexableHotspots.some((h) => h.includes("svelte"))).toBe(true);
  });

  it("handles SourceIndex input", () => {
    const index = {
      schemaVersion: "1.2" as const,
      generatedAt: "",
      toolVersion: "",
      project: {
        packageName: "test",
        dependencies: {},
        devDependencies: {},
        detectedFrameworks: [],
      },
      files: [
        { path: "src/index.ts" },
        { path: "src/utils.ts" },
        { path: "src/component.svelte" },
      ] as any[],
      stats: {
        totalFiles: 3,
        indexedFiles: 2,
        skippedFiles: 0,
        parseErrors: 0,
      },
      manifestHash: "abc",
    };
    const profile = detectLanguageProfile(index as any);
    expect(profile.dominant).toBe("typescript");
    expect(profile.distribution).toHaveProperty("svelte", 1);
    expect(profile.distribution).toHaveProperty("typescript", 2);
  });

  it("treats .test.ts and .spec.tsx as their correct language", () => {
    const files = ["src/index.ts", "src/index.test.ts", "src/component.spec.tsx"];
    const profile = detectLanguageProfile(files);
    expect(profile.dominant).toBe("typescript");
    expect(profile.distribution.typescript).toBe(2);
    expect(profile.distribution.tsx).toBe(1);
  });
});
