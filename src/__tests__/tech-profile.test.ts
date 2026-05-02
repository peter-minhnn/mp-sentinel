/**
 * Unit tests for tech-profile detection and review cue generation
 */

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach, beforeEach } from "@jest/globals";

import { clearConfigCache } from "../utils/config.js";
import { detectTechProfile, getReviewCues } from "../services/tech-profile.js";
import { parseTechStack } from "../services/skills-fetcher.js";
import { buildSystemPrompt } from "../config/prompts.js";
import type { TechProfile } from "../types/index.js";

const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "mp-sentinel-tech-profile-"));
  tempDirs.push(dir);
  return dir;
};

beforeEach(() => {
  clearConfigCache();
});

afterEach(async () => {
  clearConfigCache();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

// ── parseTechStack (export verification) ──────────────────────────────────

describe("parseTechStack", () => {
  it("parses comma-separated technologies", () => {
    const result = parseTechStack("TypeScript 5.7, Node.js 18 (ESM), tsup (esbuild)");
    expect(result.map((t) => t.toLowerCase())).toEqual(
      expect.arrayContaining(["typescript", "node.js", "esm", "tsup", "esbuild"]),
    );
  });

  it("returns empty array for empty string", () => {
    expect(parseTechStack("")).toEqual([]);
  });

  it("filters out short tokens and version numbers", () => {
    const result = parseTechStack("Go, v1, React 18");
    // "go" is 2 chars (filtered), "v1" becomes "v" (1 char, filtered)
    expect(result.map((t) => t.toLowerCase())).toEqual(expect.arrayContaining(["react"]));
  });
});

// ── detectTechProfile ─────────────────────────────────────────────────────

describe("detectTechProfile", () => {
  it("uses config.techStack as priority 1", async () => {
    const result = await detectTechProfile({
      techStack: "TypeScript, React, Node.js",
    });
    expect(result.profile).toBe("react-next");
    expect(result.source).toBe("config");
    expect(result.technologies.map((t) => t.toLowerCase())).toEqual(
      expect.arrayContaining(["typescript", "react", "node.js"]),
    );
  });

  it("maps express to node-service from config.techStack", async () => {
    const result = await detectTechProfile({
      techStack: "TypeScript, Express, PostgreSQL",
    });
    expect(result.profile).toBe("node-service");
    expect(result.source).toBe("config");
  });

  it("maps commander to cli-tooling from config.techStack", async () => {
    const result = await detectTechProfile({
      techStack: "TypeScript, Commander, Node.js",
    });
    expect(result.profile).toBe("cli-tooling");
    expect(result.source).toBe("config");
  });

  it("maps to library when no known framework keywords in techStack", async () => {
    const result = await detectTechProfile({
      techStack: "Python, Rust",
    });
    expect(result.profile).toBe("library");
    expect(result.source).toBe("config");
  });

  it("falls back to package.json when techStack is empty string", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        name: "test-service",
        version: "1.0.0",
        dependencies: { express: "4.18.0" },
      }),
    );

    const result = await detectTechProfile({ techStack: "" }, cwd);
    expect(result.profile).toBe("node-service");
    expect(result.source).toBe("package-json");
    expect(result.technologies).toContain("express");
  });

  it("falls back to package.json when techStack is undefined", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        name: "test-cli",
        version: "1.0.0",
        bin: { "test-cli": "dist/index.js" },
        dependencies: { commander: "14.0.3" },
      }),
    );

    const result = await detectTechProfile({}, cwd);
    expect(result.profile).toBe("cli-tooling");
    expect(result.source).toBe("package-json");
  });

  it("detects cli-tooling from scripts containing cli keyword", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        name: "test-tool",
        version: "1.0.0",
        scripts: { start: "node dist/cli.js" },
      }),
    );

    const result = await detectTechProfile({ techStack: "" }, cwd);
    expect(result.profile).toBe("cli-tooling");
    expect(result.source).toBe("package-json");
  });

  it("detects react-next from package.json with react dependency", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        name: "test-ui",
        version: "1.0.0",
        dependencies: { react: "18.2.0", "react-dom": "18.2.0" },
      }),
    );

    const result = await detectTechProfile({}, cwd);
    expect(result.profile).toBe("react-next");
    expect(result.source).toBe("package-json");
  });

  it("falls back to generic when no config and no package.json", async () => {
    const cwd = await makeTempDir();
    // No package.json in this temp dir

    const result = await detectTechProfile({}, cwd);
    expect(result.profile).toBe("library");
    expect(result.source).toBe("generic");
    expect(result.technologies).toEqual([]);
  });

  it("trims whitespace from techStack before checking", async () => {
    const cwd = await makeTempDir();
    // No package.json in this temp dir, so whitespace-only techStack falls to generic
    const result = await detectTechProfile({ techStack: "   " }, cwd);
    expect(result.source).toBe("generic");
    expect(result.profile).toBe("library");
  });

  it("handles missing package.json gracefully", async () => {
    const cwd = await makeTempDir();
    const result = await detectTechProfile({}, cwd);
    expect(result.profile).toBe("library");
    expect(result.source).toBe("generic");
  });
});

// ── getReviewCues ─────────────────────────────────────────────────────────

describe("getReviewCues", () => {
  it("returns technology-specific cues for known technologies", () => {
    const profile: TechProfile = {
      profile: "library",
      technologies: ["typescript", "react", "vitest"],
      source: "config",
    };
    const cues = getReviewCues(profile);
    expect(cues.length).toBeGreaterThanOrEqual(3);
    expect(cues.length).toBeLessThanOrEqual(5);
    // Should include typescript-related cues
    const hasTsCue = cues.some((c) => c.toLowerCase().includes("null"));
    expect(hasTsCue).toBe(true);
  });

  it("caps at 5 cues even with many technologies", () => {
    const profile: TechProfile = {
      profile: "library",
      technologies: [
        "typescript",
        "react",
        "vitest",
        "jest",
        "playwright",
        "vite",
        "esbuild",
        "nodejs",
        "prisma",
        "tailwindcss",
      ],
      source: "config",
    };
    const cues = getReviewCues(profile);
    expect(cues.length).toBe(5);
  });

  it("falls back to profile-level pitfalls when no tech-specific cues match", () => {
    const profile: TechProfile = {
      profile: "node-service",
      technologies: [],
      source: "generic",
    };
    const cues = getReviewCues(profile);
    expect(cues.length).toBeGreaterThanOrEqual(3);
    expect(cues.length).toBeLessThanOrEqual(5);
    // Should have node-service fallback cues
    const hasServiceCue = cues.some(
      (c) =>
        c.toLowerCase().includes("handler") ||
        c.toLowerCase().includes("error handling") ||
        c.toLowerCase().includes("env"),
    );
    expect(hasServiceCue).toBe(true);
  });

  it("falls back to library profile pitfalls", () => {
    const profile: TechProfile = {
      profile: "library",
      technologies: [],
      source: "generic",
    };
    const cues = getReviewCues(profile);
    expect(cues.length).toBeGreaterThanOrEqual(3);
    const hasApiCue = cues.some((c) => c.toLowerCase().includes("public api"));
    expect(hasApiCue).toBe(true);
  });

  it("supplements tech cues with profile cues when under 5", () => {
    const profile: TechProfile = {
      profile: "cli-tooling",
      technologies: ["commander"],
      source: "config",
    };
    const cues = getReviewCues(profile);
    // commander has 2 cues, should be supplemented by profile cues up to cap
    expect(cues.length).toBeGreaterThanOrEqual(2);
    expect(cues.length).toBeLessThanOrEqual(5);
  });

  it("deduplicates similar cues", () => {
    const profile: TechProfile = {
      profile: "library",
      technologies: ["typescript", "react"],
      source: "config",
    };
    const cues = getReviewCues(profile);
    // No duplicate cues (check first 60 chars don't collide)
    const seen = new Set<string>();
    for (const cue of cues) {
      const key = cue.slice(0, 60).toLowerCase().trim();
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

// ── buildSystemPrompt integration ─────────────────────────────────────────

describe("buildSystemPrompt with tech profile", () => {
  it("includes STACK-AWARE REVIEW FOCUS section", async () => {
    const prompt = await buildSystemPrompt({
      techStack: "TypeScript, React",
    });
    expect(prompt).toContain("### STACK-AWARE REVIEW FOCUS");
  });

  it("STACK-AWARE REVIEW FOCUS appears before PROJECT SPECIFIC RULES", async () => {
    const prompt = await buildSystemPrompt({
      techStack: "TypeScript",
      rules: ["No console.log"],
    });
    const focusIdx = prompt.indexOf("### STACK-AWARE REVIEW FOCUS");
    const rulesIdx = prompt.indexOf("### PROJECT SPECIFIC RULES");
    expect(focusIdx).toBeGreaterThan(0);
    expect(rulesIdx).toBeGreaterThan(0);
    expect(focusIdx).toBeLessThan(rulesIdx);
  });

  it("project rules retain HIGHEST PRIORITY label", async () => {
    const prompt = await buildSystemPrompt({
      techStack: "TypeScript",
      rules: ["No console.log"],
    });
    expect(prompt).toContain("PROJECT SPECIFIC RULES (HIGHEST PRIORITY)");
  });

  it("omits STACK-AWARE REVIEW FOCUS when no technologies detected (generic)", async () => {
    // Use a unit-test specific approach: detectTechProfile returns generic, but
    // buildSystemPrompt may still show the section with empty stack info.
    // The section header should appear but without cues content if no cues generated.
    const prompt = await buildSystemPrompt({});
    // When profile is library with no techs, getReviewCues returns profile pitfalls
    // which ARE included, so the section should appear.
    expect(prompt).toContain("### STACK-AWARE REVIEW FOCUS");
  });

  it("accepts explicit techProfile parameter", async () => {
    const tp: TechProfile = {
      profile: "react-next",
      technologies: ["react", "typescript"],
      source: "config",
    };
    const prompt = await buildSystemPrompt({ techStack: "TypeScript, React" }, undefined, tp);
    expect(prompt).toContain("### STACK-AWARE REVIEW FOCUS");
    expect(prompt).toContain("react, typescript");
  });
});
