/**
 * Unit tests for config validation (Zod schema) and ruleFiles loading
 */

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { validateConfig, loadProjectConfig, clearConfigCache } from "../utils/config.js";

beforeEach(() => {
  clearConfigCache();
});

// -- Temp dir helpers for loadProjectConfig tests -------------------------------

const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "mp-sentinel-config-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("validateConfig", () => {
  it("accepts an empty object (all fields optional)", () => {
    expect(validateConfig({})).toBe(true);
  });

  it("accepts a valid full config", () => {
    expect(
      validateConfig({
        techStack: "TypeScript",
        rules: ["no-console"],
        bypassKeyword: "skip:",
        maxConcurrency: 5,
        cacheEnabled: true,
        enableSkillsFetch: false,
        skillsFetchTimeout: 3000,
        ai: {
          enabled: true,
          maxFiles: 10,
          maxDiffLines: 500,
          maxCharsPerFile: 8000,
          promptVersion: "2026-01-01",
        },
        localReview: {
          enabled: true,
          commitCount: 3,
          filterByPattern: true,
          patternMatchMode: "any",
          commitPatterns: [{ type: "feat", pattern: "^feat" }],
          skipPatterns: ["skip:"],
          excludePatterns: ["^Merge"],
        },
      }),
    ).toBe(true);
  });

  it("accepts an eslint adapter block", () => {
    expect(
      validateConfig({
        eslint: {
          enabled: true,
          timeoutMs: 30000,
          severityOverrides: { "no-console": "INFO" },
        },
      }),
    ).toBe(true);
  });

  it("rejects non-object values", () => {
    expect(validateConfig(null)).toBe(false);
    expect(validateConfig("string")).toBe(false);
    expect(validateConfig(42)).toBe(false);
  });

  it("rejects invalid techStack type", () => {
    expect(validateConfig({ techStack: 123 })).toBe(false);
  });

  it("rejects negative maxConcurrency", () => {
    expect(validateConfig({ maxConcurrency: -1 })).toBe(false);
  });

  it("rejects zero maxConcurrency", () => {
    expect(validateConfig({ maxConcurrency: 0 })).toBe(false);
  });

  it("rejects invalid ai.maxFiles", () => {
    expect(validateConfig({ ai: { maxFiles: -5 } })).toBe(false);
  });

  it("rejects invalid commitPattern regex", () => {
    expect(
      validateConfig({
        localReview: {
          commitPatterns: [{ type: "bad", pattern: "[invalid" }],
        },
      }),
    ).toBe(false);
  });

  it("rejects invalid excludePattern regex", () => {
    expect(
      validateConfig({
        localReview: {
          excludePatterns: ["[invalid"],
        },
      }),
    ).toBe(false);
  });

  it("rejects invalid gitProvider value", () => {
    expect(validateConfig({ gitProvider: "bitbucket" })).toBe(false);
  });

  it("rejects invalid repoUrl", () => {
    expect(validateConfig({ repoUrl: "not-a-url" })).toBe(false);
  });

  it("rejects invalid patternMatchMode", () => {
    expect(validateConfig({ localReview: { patternMatchMode: "none" } })).toBe(false);
  });

  it("accepts valid ai.modelTier = premium", () => {
    expect(validateConfig({ ai: { modelTier: "premium" } })).toBe(true);
  });

  it("accepts valid ai.modelTier = balanced", () => {
    expect(validateConfig({ ai: { modelTier: "balanced" } })).toBe(true);
  });

  it("accepts valid ai.modelTier = budget", () => {
    expect(validateConfig({ ai: { modelTier: "budget" } })).toBe(true);
  });

  it("rejects invalid ai.modelTier value", () => {
    expect(validateConfig({ ai: { modelTier: "ultra" } })).toBe(false);
    expect(validateConfig({ ai: { modelTier: 123 } })).toBe(false);
  });

  it("accepts ruleFiles as an array of strings", () => {
    expect(validateConfig({ ruleFiles: ["docs/FLOW.md"] })).toBe(true);
  });

  it("rejects ruleFiles with non-string values", () => {
    expect(validateConfig({ ruleFiles: [123] })).toBe(false);
    expect(validateConfig({ ruleFiles: "not-an-array" })).toBe(false);
  });
});

describe("loadProjectConfig with ruleFiles", () => {
  it("reads a rule file and appends content to config.rules", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "docs"), { recursive: true });
    await writeFile(join(cwd, "docs", "FLOW.md"), "# Flow\nUse consistent patterns.");
    await writeFile(
      join(cwd, ".mp-sentinelrc.json"),
      JSON.stringify({
        rules: ["CRITICAL: No console.log"],
        ruleFiles: ["docs/FLOW.md"],
      }),
    );

    const config = await loadProjectConfig(cwd);
    expect(config.rules).toHaveLength(2);
    expect(config.rules![0]).toBe("CRITICAL: No console.log");
    expect(config.rules![1]).toBe("From docs/FLOW.md:\n# Flow\nUse consistent patterns.");
  });

  it("preserves the eslint adapter block through parsing (not stripped)", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, ".mp-sentinelrc.json"),
      JSON.stringify({
        eslint: { enabled: true },
      }),
    );

    const config = await loadProjectConfig(cwd);
    expect(config.eslint).toBeDefined();
    expect(config.eslint!.enabled).toBe(true);
  });

  it("preserves createSkills.policies.maxComponentLines through parsing (not stripped)", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, ".mp-sentinelrc.json"),
      JSON.stringify({
        createSkills: {
          policies: {
            maxFileLines: 500,
            warnFileLines: 350,
            maxFunctionLines: 80,
            maxComponentLines: 222,
            maxParams: 5,
            maxCyclomaticHint: 12,
            forbidDefaultExports: false,
          },
        },
      }),
    );

    const config = await loadProjectConfig(cwd);
    expect(config.createSkills?.policies?.maxComponentLines).toBe(222);
  });

  it("fills missing policy fields from defaults for legacy partial configs", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, ".mp-sentinelrc.json"),
      // Legacy partial block (predates maxComponentLines) must still load.
      JSON.stringify({ createSkills: { policies: { maxFileLines: 600 } } }),
    );

    const config = await loadProjectConfig(cwd);
    // User-provided field is preserved...
    expect(config.createSkills?.policies?.maxFileLines).toBe(600);
    // ...and omitted fields are filled from DEFAULT_CREATE_SKILLS_POLICIES.
    expect(config.createSkills?.policies?.maxComponentLines).toBe(150);
    expect(config.createSkills?.policies?.maxFunctionLines).toBe(80);
  });

  it("reads multiple rule files", async () => {
    const cwd = await makeTempDir();
    await writeFile(join(cwd, "ARCH.md"), "Architecture rules here.");
    await writeFile(join(cwd, "STYLE.md"), "Style guide here.");
    await writeFile(
      join(cwd, ".mp-sentinelrc.json"),
      JSON.stringify({
        ruleFiles: ["ARCH.md", "STYLE.md"],
      }),
    );

    const config = await loadProjectConfig(cwd);
    expect(config.rules).toHaveLength(2);
    expect(config.rules![0]).toBe("From ARCH.md:\nArchitecture rules here.");
    expect(config.rules![1]).toBe("From STYLE.md:\nStyle guide here.");
  });

  it("rejects an absolute path", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, ".mp-sentinelrc.json"),
      JSON.stringify({
        ruleFiles: ["/etc/passwd"],
      }),
    );

    await expect(loadProjectConfig(cwd)).rejects.toThrow(
      'ruleFiles: "/etc/passwd" must be a relative path.',
    );
  });

  it("rejects path traversal outside project root", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, ".mp-sentinelrc.json"),
      JSON.stringify({
        ruleFiles: ["../secrets.md"],
      }),
    );

    await expect(loadProjectConfig(cwd)).rejects.toThrow(
      'ruleFiles: "../secrets.md" must be inside the project root.',
    );
  });

  it("rejects Windows-style backslash traversal", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, ".mp-sentinelrc.json"),
      JSON.stringify({
        ruleFiles: ["..\\secrets.md"],
      }),
    );

    await expect(loadProjectConfig(cwd)).rejects.toThrow(
      'ruleFiles: "..\\secrets.md" must be inside the project root.',
    );
  });

  it("accepts a valid file whose name starts with dots", async () => {
    const cwd = await makeTempDir();
    await writeFile(join(cwd, "..rules.md"), "Valid dot file rules.");
    await writeFile(
      join(cwd, ".mp-sentinelrc.json"),
      JSON.stringify({
        ruleFiles: ["..rules.md"],
      }),
    );

    const config = await loadProjectConfig(cwd);
    expect(config.rules).toHaveLength(1);
    expect(config.rules![0]).toBe("From ..rules.md:\nValid dot file rules.");
  });

  it("rejects a missing file", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, ".mp-sentinelrc.json"),
      JSON.stringify({
        ruleFiles: ["nonexistent.md"],
      }),
    );

    await expect(loadProjectConfig(cwd)).rejects.toThrow('ruleFiles: cannot read "nonexistent.md"');
  });

  it("rejects more than 10 rule files", async () => {
    const cwd = await makeTempDir();
    const elevenFiles = Array.from({ length: 11 }, (_, i) => `rule${i}.md`);
    await writeFile(join(cwd, ".mp-sentinelrc.json"), JSON.stringify({ ruleFiles: elevenFiles }));

    await expect(loadProjectConfig(cwd)).rejects.toThrow(
      "ruleFiles: maximum 10 files allowed, got 11.",
    );
  });

  it("truncates file content to 12,000 chars", async () => {
    const cwd = await makeTempDir();
    const longContent = "x".repeat(15000);
    await writeFile(join(cwd, "LONG.md"), longContent);
    await writeFile(join(cwd, ".mp-sentinelrc.json"), JSON.stringify({ ruleFiles: ["LONG.md"] }));

    const config = await loadProjectConfig(cwd);
    const rule = config.rules![0]!;
    expect(rule.startsWith("From LONG.md:\n")).toBe(true);
    const contentAfterPrefix = rule.slice("From LONG.md:\n".length);
    expect(contentAfterPrefix.length).toBe(12000);
  });

  it("creates rules array if not present when ruleFiles is set", async () => {
    const cwd = await makeTempDir();
    await writeFile(join(cwd, "RULES.md"), "Some rules.");
    await writeFile(join(cwd, ".mp-sentinelrc.json"), JSON.stringify({ ruleFiles: ["RULES.md"] }));

    const config = await loadProjectConfig(cwd);
    expect(config.rules).toHaveLength(1);
  });

  it("merges inline rules before file-derived rules", async () => {
    const cwd = await makeTempDir();
    await writeFile(join(cwd, "EXTRA.md"), "Extra rules from file.");
    await writeFile(
      join(cwd, ".mp-sentinelrc.json"),
      JSON.stringify({
        rules: ["Inline rule A", "Inline rule B"],
        ruleFiles: ["EXTRA.md"],
      }),
    );

    const config = await loadProjectConfig(cwd);
    expect(config.rules![0]).toBe("Inline rule A");
    expect(config.rules![1]).toBe("Inline rule B");
    expect(config.rules![2]).toBe("From EXTRA.md:\nExtra rules from file.");
  });
});
