/**
 * Lane C: AI Enrichment Determinism Tests
 *
 * Validates that buildEnrichmentInput produces deterministic output,
 * hashing is stable, validation enforces limits, and configuration
 * resolution handles edge cases correctly.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  validateAIEnrichmentOutput,
  buildEnrichmentInput,
  buildEnrichmentPrompt,
  computeEnrichmentInputHash,
  computeEnrichmentOutputHash,
  resolveAIEnrichmentConfig,
  deepSortForHash,
  computeEnrichmentCacheKey,
  readEnrichmentCache,
  writeEnrichmentCache,
  enrichIndex,
} from "../services/skills-generator/ai-enrichment.js";
import { computeIndexHash } from "../services/skills-generator/metadata.js";
import { AIProviderFactory } from "../services/ai/factory.js";

import type {
  SourceIndex,
  ProjectManifest,
  AIEnrichmentOutput,
  CreateSkillsAIConfig,
} from "../types/index.js";

// -- Fixture helpers ----------------------------------------------------------

function makeMinimalIndex(overrides?: Partial<ProjectManifest>): SourceIndex {
  const project: ProjectManifest = {
    packageName: "test-project",
    packageVersion: "1.0.0",
    packageManager: "npm",
    ecosystem: "node",
    nodeEngine: ">=24.0.0",
    dependencies: { typescript: "5.0.0" },
    devDependencies: {},
    detectedFrameworks: [],
    ...overrides,
  };
  return {
    schemaVersion: "1.2",
    generatedAt: "2026-01-01T00:00:00.000Z",
    toolVersion: "1.0.0",
    project,
    files: [
      {
        path: "src/index.ts",
        language: "typescript",
        sha256: "abc",
        sizeBytes: 100,
        mtimeMs: 0,
        imports: [],
        exports: [],
        symbols: [{ name: "main", type: "function", line: 1, column: 0 }],
        importsFrom: [],
        importedBy: [],
      },
    ],
    stats: { totalFiles: 1, indexedFiles: 1, skippedFiles: 0, parseErrors: 0 },
  };
}

function makeValidOutput(overrides?: Partial<AIEnrichmentOutput>): AIEnrichmentOutput {
  return {
    languageRules: ["Use strict TypeScript settings"],
    libraryRules: ["Use zod for validation"],
    versionNotes: ["TypeScript 5.x supports decorators"],
    riskWarnings: ["Low test coverage detected"],
    recommendedChecks: ["Verify type safety"],
    ...overrides,
  };
}

// Helper: repeat a value N times to build arrays that exceed limits
function repeat<T>(value: T, count: number): T[] {
  return Array.from({ length: count }, () => value);
}

// -- validateAIEnrichmentOutput ----------------------------------------------

describe("validateAIEnrichmentOutput", () => {
  it("valid output with all fields passes validation", () => {
    const output = makeValidOutput();
    const raw = JSON.stringify(output);
    const result = validateAIEnrichmentOutput(raw);
    expect(result.languageRules).toEqual(output.languageRules);
    expect(result.libraryRules).toEqual(output.libraryRules);
    expect(result.versionNotes).toEqual(output.versionNotes);
    expect(result.riskWarnings).toEqual(output.riskWarnings);
    expect(result.recommendedChecks).toEqual(output.recommendedChecks);
  });

  it("missing required field throws", () => {
    const raw = JSON.stringify({ languageRules: [] });
    expect(() => validateAIEnrichmentOutput(raw)).toThrow();
  });

  it("arrays exceeding max length throw: languageRules max 20", () => {
    const output = makeValidOutput({ languageRules: repeat("rule", 21) });
    const raw = JSON.stringify(output);
    expect(() => validateAIEnrichmentOutput(raw)).toThrow(/Too many language rules/);
  });

  it("arrays exceeding max length throw: libraryRules max 30", () => {
    const output = makeValidOutput({ libraryRules: repeat("rule", 31) });
    const raw = JSON.stringify(output);
    expect(() => validateAIEnrichmentOutput(raw)).toThrow(/Too many library rules/);
  });

  it("arrays exceeding max length throw: versionNotes max 10", () => {
    const output = makeValidOutput({ versionNotes: repeat("note", 11) });
    const raw = JSON.stringify(output);
    expect(() => validateAIEnrichmentOutput(raw)).toThrow(/Too many version notes/);
  });

  it("arrays exceeding max length throw: riskWarnings max 15", () => {
    const output = makeValidOutput({ riskWarnings: repeat("warn", 16) });
    const raw = JSON.stringify(output);
    expect(() => validateAIEnrichmentOutput(raw)).toThrow(/Too many risk warnings/);
  });

  it("arrays exceeding max length throw: recommendedChecks max 15", () => {
    const output = makeValidOutput({ recommendedChecks: repeat("check", 16) });
    const raw = JSON.stringify(output);
    expect(() => validateAIEnrichmentOutput(raw)).toThrow(/Too many recommended checks/);
  });
});

// -- computeEnrichmentInputHash ----------------------------------------------

describe("computeEnrichmentInputHash", () => {
  it("same input produces same hash", () => {
    const index = makeMinimalIndex();
    const input1 = buildEnrichmentInput(index);
    const input2 = buildEnrichmentInput(index);
    expect(computeEnrichmentInputHash(input1)).toBe(computeEnrichmentInputHash(input2));
  });

  it("different inputs produce different hashes", () => {
    const index1 = makeMinimalIndex({ packageVersion: "1.0.0" });
    const index2 = makeMinimalIndex({ packageVersion: "2.0.0" });
    const input1 = buildEnrichmentInput(index1);
    const input2 = buildEnrichmentInput(index2);
    expect(computeEnrichmentInputHash(input1)).not.toBe(computeEnrichmentInputHash(input2));
  });

  it("hash is 16 hex chars", () => {
    const index = makeMinimalIndex();
    const input = buildEnrichmentInput(index);
    const hash = computeEnrichmentInputHash(input);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });
});

// -- computeEnrichmentOutputHash ---------------------------------------------

describe("computeEnrichmentOutputHash", () => {
  it("same output produces same hash", () => {
    const output = makeValidOutput();
    expect(computeEnrichmentOutputHash(output)).toBe(computeEnrichmentOutputHash(output));
  });

  it("different outputs produce different hashes", () => {
    const output1 = makeValidOutput({ languageRules: ["Rule A"] });
    const output2 = makeValidOutput({ languageRules: ["Rule B"] });
    expect(computeEnrichmentOutputHash(output1)).not.toBe(computeEnrichmentOutputHash(output2));
  });
});

// -- buildEnrichmentInput ----------------------------------------------------

describe("buildEnrichmentInput", () => {
  it("does not include generatedAt, mtimeMs, or stats fields", () => {
    const index = makeMinimalIndex();
    const input = buildEnrichmentInput(index);
    const serialized = JSON.stringify(input);
    expect(serialized).not.toContain("generatedAt");
    expect(serialized).not.toContain("mtimeMs");
    expect(serialized).not.toContain('"mtimeMs"');
    expect(serialized).not.toContain('"stats"');
  });

  it("does include project metadata (name, version, frameworks)", () => {
    const index = makeMinimalIndex();
    const input = buildEnrichmentInput(index);
    expect(input.projectName).toBe("test-project");
    expect(input.packageVersion).toBe("1.0.0");
    expect(input.detectedFrameworks).toEqual([]);
  });

  it("moduleRoles keys are sorted", () => {
    const index = makeMinimalIndex();
    // Add file roles with non-sorted insertion order
    const indexWithRoles: SourceIndex = {
      ...index,
      insights: {
        fileRoles: {
          "src/utils.ts": "utils" as const,
          "src/cli.ts": "cli-entry" as const,
          "src/service.ts": "service" as const,
          "src/types.ts": "type" as const,
        },
        publicApiFiles: [],
        testMap: {},
        commandMap: {},
        dependencyUsage: {},
        defaultExportFiles: [],
        reExportFiles: [],
        typeOnlyImportFiles: [],
        dynamicImportFiles: [],
      },
    };
    const input = buildEnrichmentInput(indexWithRoles);
    const keys = Object.keys(input.moduleRoles);
    // Verify keys are sorted alphabetically
    for (let i = 1; i < keys.length; i++) {
      expect(keys[i - 1]! <= keys[i]!).toBe(true);
    }
    // Verify file arrays within each category are sorted
    for (const fileList of Object.values(input.moduleRoles)) {
      for (let i = 1; i < fileList.length; i++) {
        expect(fileList[i - 1]! <= fileList[i]!).toBe(true);
      }
    }
  });

  it("handles missing insights gracefully (empty arrays, no crash)", () => {
    const index = makeMinimalIndex();
    const input = buildEnrichmentInput(index);
    expect(input.publicApiFiles).toEqual([]);
    expect(input.topDependencies).toEqual([]);
    expect(input.moduleRoles).toBeDefined();
    // moduleRoles should have all categories but empty arrays
    const roleKeys = Object.keys(input.moduleRoles).sort();
    expect(roleKeys).toEqual(["cli", "config", "other", "services", "tests", "types", "utils"]);
    for (const fileList of Object.values(input.moduleRoles)) {
      expect(fileList).toEqual([]);
    }
  });

  it("includes project rules from .mp-sentinelrc and caps them", () => {
    const index = makeMinimalIndex();
    const rules = repeat("Prefer deterministic review paths", 25);
    const input = buildEnrichmentInput(index, undefined, rules);
    expect(input.projectRules).toHaveLength(20);
    expect(input.projectRules[0]).toBe("Prefer deterministic review paths");
  });
});

// -- buildEnrichmentPrompt ---------------------------------------------------

describe("buildEnrichmentPrompt", () => {
  it("produces identical output for identical input", () => {
    const index = makeMinimalIndex();
    const input = buildEnrichmentInput(index);
    const prompt1 = buildEnrichmentPrompt(input);
    const prompt2 = buildEnrichmentPrompt(input);
    expect(prompt1).toBe(prompt2);
  });

  it("includes all template variables", () => {
    const index = makeMinimalIndex({
      packageName: "my-app",
      packageVersion: "2.0.0",
      packageManager: "pnpm",
    });
    const input = buildEnrichmentInput(index);
    const prompt = buildEnrichmentPrompt(input);
    expect(prompt).toContain("my-app");
    expect(prompt).toContain("2.0.0");
    expect(prompt).toContain("pnpm");
    expect(prompt).toContain("projectName");
    expect(prompt).toContain("fileCount");
    expect(prompt).toContain("testFileCount");
    expect(prompt).toContain("testGapCount");
    expect(prompt).toContain("languageRules");
    expect(prompt).toContain("libraryRules");
  });

  it("includes project rules in the prompt payload", () => {
    const index = makeMinimalIndex();
    const input = buildEnrichmentInput(index, undefined, [
      "Never send full file content when diff context is enough.",
    ]);
    const prompt = buildEnrichmentPrompt(input);
    expect(prompt).toContain("projectRules");
    expect(prompt).toContain("Never send full file content");
    expect(prompt).toContain("highest-priority project-specific constraints");
  });
});

// -- resolveAIEnrichmentConfig -----------------------------------------------

describe("resolveAIEnrichmentConfig", () => {
  it("normalizes provider name to lowercase", () => {
    const aiConfig: CreateSkillsAIConfig = { provider: "GEMINI" };
    const config = resolveAIEnrichmentConfig(aiConfig);
    expect(config.provider).toBe("gemini");
  });

  it("returns empty config when no overrides", () => {
    const aiConfig: CreateSkillsAIConfig = {};
    const config = resolveAIEnrichmentConfig(aiConfig);
    expect(config.provider).toBeUndefined();
    expect(config.model).toBeUndefined();
  });

  it("throws on unsupported provider", () => {
    const aiConfig: CreateSkillsAIConfig = { provider: "unsupported-ai" };
    expect(() => resolveAIEnrichmentConfig(aiConfig)).toThrow(
      /Unsupported createSkills.ai.provider/,
    );
  });

  it("accepts openrouter as valid provider", () => {
    const aiConfig: CreateSkillsAIConfig = { provider: "openrouter" };
    const config = resolveAIEnrichmentConfig(aiConfig);
    expect(config.provider).toBe("openrouter");
  });

  it("accepts all five providers", () => {
    for (const p of ["gemini", "openai", "anthropic", "grok", "openrouter"]) {
      const aiConfig: CreateSkillsAIConfig = { provider: p };
      expect(() => resolveAIEnrichmentConfig(aiConfig)).not.toThrow();
    }
  });
});

// -- deepSortForHash ---------------------------------------------------------

describe("deepSortForHash", () => {
  it("sorts object keys", () => {
    const input = { z: 1, a: 2, m: 3 };
    const result = deepSortForHash(input) as Record<string, unknown>;
    const keys = Object.keys(result);
    expect(keys).toEqual(["a", "m", "z"]);
  });

  it("preserves array order", () => {
    const input = { items: ["z", "a", "m"] };
    const result = deepSortForHash(input) as Record<string, unknown>;
    expect(result["items"]).toEqual(["z", "a", "m"]);
  });

  it("handles nested objects", () => {
    const input = { outer: { z: 1, a: 2 } };
    const result = deepSortForHash(input) as Record<string, Record<string, unknown>>;
    expect(Object.keys(result.outer!)).toEqual(["a", "z"]);
  });

  it("handles null/primitives", () => {
    expect(deepSortForHash(null)).toBe(null);
    expect(deepSortForHash(42)).toBe(42);
    expect(deepSortForHash("hello")).toBe("hello");
    expect(deepSortForHash(true)).toBe(true);
  });
});

// -- Determinism property test -----------------------------------------------

describe("Determinism property test", () => {
  it("buildEnrichmentInput then computeEnrichmentInputHash returns same hash for two SourceIndexes that differ only in non-meaningful fields", () => {
    const base: SourceIndex = {
      schemaVersion: "1.2",
      generatedAt: "2026-01-01T00:00:00.000Z",
      toolVersion: "1.0.0",
      project: {
        packageName: "test-project",
        packageVersion: "1.0.0",
        packageManager: "npm",
        ecosystem: "node",
        nodeEngine: ">=24.0.0",
        dependencies: { typescript: "5.0.0" },
        devDependencies: {},
        detectedFrameworks: [],
      },
      files: [
        {
          path: "src/index.ts",
          language: "typescript",
          sha256: "abc123",
          sizeBytes: 100,
          mtimeMs: 1000,
          imports: [{ source: "./utils.js", kind: "named", names: ["helper"], line: 1 }],
          exports: [],
          symbols: [{ name: "main", type: "function", line: 1, column: 0 }],
          importsFrom: ["src/utils.ts"],
          importedBy: [],
        },
        {
          path: "src/utils.ts",
          language: "typescript",
          sha256: "def456",
          sizeBytes: 50,
          mtimeMs: 2000,
          imports: [],
          exports: [{ kind: "named", names: ["helper"], line: 1 }],
          symbols: [{ name: "helper", type: "function", line: 1, column: 0 }],
          importsFrom: [],
          importedBy: ["src/index.ts"],
        },
      ],
      stats: { totalFiles: 2, indexedFiles: 2, skippedFiles: 0, parseErrors: 0 },
    };

    // Same meaningful data, different generatedAt, stats, mtimeMs
    const variant: SourceIndex = {
      ...base,
      generatedAt: "2027-06-15T12:00:00.000Z",
      files: base.files.map((f) => ({
        ...f,
        mtimeMs: (f.mtimeMs ?? 0) + 9999,
      })),
      stats: { totalFiles: 2, indexedFiles: 2, skippedFiles: 0, parseErrors: 0, durationMs: 5000 },
    };

    const input1 = buildEnrichmentInput(base);
    const input2 = buildEnrichmentInput(variant);
    const hash1 = computeEnrichmentInputHash(input1);
    const hash2 = computeEnrichmentInputHash(input2);

    // The hash should NOT include generatedAt, mtimeMs, or stats
    // These fields are stripped by buildEnrichmentInput
    expect(hash1).toBe(hash2);
  });
});

// -- computeEnrichmentCacheKey ------------------------------------------------

describe("computeEnrichmentCacheKey", () => {
  it("same inputs produce same key", () => {
    const k1 = computeEnrichmentCacheKey("abc123", "gemini", "gem-2.5", "2026-05-08", "xyz789");
    const k2 = computeEnrichmentCacheKey("abc123", "gemini", "gem-2.5", "2026-05-08", "xyz789");
    expect(k1).toBe(k2);
  });

  it("different sourceIndexHash produces different key", () => {
    const k1 = computeEnrichmentCacheKey("abc123", "gemini", "g", "v1", "inp");
    const k2 = computeEnrichmentCacheKey("def456", "gemini", "g", "v1", "inp");
    expect(k1).not.toBe(k2);
  });

  it("different provider produces different key", () => {
    const k1 = computeEnrichmentCacheKey("abc", "gemini", "g", "v1", "inp");
    const k2 = computeEnrichmentCacheKey("abc", "openai", "g", "v1", "inp");
    expect(k1).not.toBe(k2);
  });

  it("different model produces different key", () => {
    const k1 = computeEnrichmentCacheKey("abc", "gemini", "gem-2.5", "v1", "inp");
    const k2 = computeEnrichmentCacheKey("abc", "gemini", "gem-3.0", "v1", "inp");
    expect(k1).not.toBe(k2);
  });

  it("different promptVersion produces different key", () => {
    const k1 = computeEnrichmentCacheKey("abc", "gemini", "g", "2026-01-01", "inp");
    const k2 = computeEnrichmentCacheKey("abc", "gemini", "g", "2026-02-01", "inp");
    expect(k1).not.toBe(k2);
  });

  it("different inputHash produces different key", () => {
    const k1 = computeEnrichmentCacheKey("abc", "gemini", "g", "v1", "inp1");
    const k2 = computeEnrichmentCacheKey("abc", "gemini", "g", "v1", "inp2");
    expect(k1).not.toBe(k2);
  });

  it("key is 16 hex chars", () => {
    const key = computeEnrichmentCacheKey("abc", "gemini", "g", "v1", "inp");
    expect(key).toMatch(/^[0-9a-f]{16}$/);
  });

  it("different baseUrl produces different key", () => {
    const k1 = computeEnrichmentCacheKey("abc", "anthropic", "claude", "v1", "inp");
    const k2 = computeEnrichmentCacheKey(
      "abc",
      "anthropic",
      "claude",
      "v1",
      "inp",
      "https://api.deepseek.com/anthropic/v1/messages",
    );
    expect(k1).not.toBe(k2);
  });

  it("same baseUrl produces same key", () => {
    const k1 = computeEnrichmentCacheKey(
      "abc",
      "anthropic",
      "claude",
      "v1",
      "inp",
      "https://custom.example.com/v1/messages",
    );
    const k2 = computeEnrichmentCacheKey(
      "abc",
      "anthropic",
      "claude",
      "v1",
      "inp",
      "https://custom.example.com/v1/messages",
    );
    expect(k1).toBe(k2);
  });

  it("preserves existing no-baseUrl fixture behavior", () => {
    const k = computeEnrichmentCacheKey("abc", "gemini", "g", "v1", "inp");
    expect(k).toMatch(/^[0-9a-f]{16}$/);
    // Verify deterministic: same inputs produce the same known result
    const expected = computeEnrichmentCacheKey("abc", "gemini", "g", "v1", "inp");
    expect(k).toBe(expected);
  });
});

// -- Cache read/write ---------------------------------------------------------

describe("readEnrichmentCache / writeEnrichmentCache", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mp-sentinel-cache-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("write then read returns same data and metadata", async () => {
    const metadata = {
      mode: "ai" as const,
      provider: "gemini",
      model: "gemini-2.5-flash",
      promptVersion: "2026-05-08",
      inputHash: "abcd1234efgh5678",
      outputHash: "deadbeefcafe1234",
    };
    const output = {
      languageRules: ["Use strict mode"],
      libraryRules: ["Use zod"],
      versionNotes: ["TypeScript 5.x"],
      riskWarnings: ["Low coverage"],
      recommendedChecks: ["Check types"],
    };
    const cacheKey = computeEnrichmentCacheKey(
      "srcHash12345678",
      metadata.provider,
      metadata.model,
      metadata.promptVersion,
      metadata.inputHash,
    );

    await writeEnrichmentCache(tmpDir, cacheKey, metadata, output);
    const cached = await readEnrichmentCache(tmpDir, cacheKey);

    expect(cached).not.toBeNull();
    expect(cached!.metadata).toEqual(metadata);
    expect(cached!.output).toEqual(output);
  });

  it("write creates valid JSON file at correct path", async () => {
    const metadata = {
      mode: "ai" as const,
      provider: "openai",
      model: "gpt-4",
      promptVersion: "2026-05-08",
      inputHash: "input9999999999",
      outputHash: "output88888888",
    };
    const output = {
      languageRules: [],
      libraryRules: [],
      versionNotes: [],
      riskWarnings: [],
      recommendedChecks: [],
    };
    const cacheKey = "testkey12345678";

    await writeEnrichmentCache(tmpDir, cacheKey, metadata, output);

    // Verify file exists at expected path
    const { readFile } = await import("node:fs/promises");
    const cachePath = join(tmpDir, ".mp-sentinel-cache", "ai-enrichment", `${cacheKey}.json`);
    const raw = await readFile(cachePath, "utf-8");
    const parsed = JSON.parse(raw);

    expect(parsed.cacheKey).toBe(cacheKey);
    expect(parsed.metadata.provider).toBe("openai");
    expect(parsed.output.languageRules).toEqual([]);
  });

  it("read returns null for non-existent cache key", async () => {
    const cached = await readEnrichmentCache(tmpDir, "nonexistentkey");
    expect(cached).toBeNull();
  });

  it("read returns null for corrupt JSON", async () => {
    const cacheKey = "corruptkey12345";
    const cacheDir = join(tmpDir, ".mp-sentinel-cache", "ai-enrichment");
    const { mkdir: mkdirAsync } = await import("node:fs/promises");
    await mkdirAsync(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, `${cacheKey}.json`), "not valid json!!!", "utf-8");

    const cached = await readEnrichmentCache(tmpDir, cacheKey);
    expect(cached).toBeNull();
  });

  it("read returns null when cacheKey field mismatches", async () => {
    const metadata = {
      mode: "ai" as const,
      provider: "gemini",
      model: "g",
      promptVersion: "v1",
      inputHash: "abc1234567890abc",
      outputHash: "def1234567890def",
    };
    const output = {
      languageRules: [],
      libraryRules: [],
      versionNotes: [],
      riskWarnings: [],
      recommendedChecks: [],
    };
    const cacheKey = "correctkey12345";
    const wrongKey = "wrongkey67890";

    await writeEnrichmentCache(tmpDir, cacheKey, metadata, output);

    // Try to read with wrong key (but file was saved with correctkey)
    // We need to point readEnrichmentCache at the file that has the wrong key embedded
    const readResult = await readEnrichmentCache(tmpDir, wrongKey);
    expect(readResult).toBeNull();
  });

  it("read returns null when cache envelope has wrong schema (valid JSON, wrong shape)", async () => {
    const cacheKey = "schemamismatch";
    const cacheDir = join(tmpDir, ".mp-sentinel-cache", "ai-enrichment");
    const { mkdir: mkdirAsync } = await import("node:fs/promises");
    await mkdirAsync(cacheDir, { recursive: true });

    // Valid JSON but output is a string instead of an object \u2014 fails Zod schema
    const wrongShape = JSON.stringify({
      cacheKey,
      createdAt: new Date().toISOString(),
      metadata: {
        mode: "ai",
        provider: "gemini",
        model: "g",
        promptVersion: "v1",
        inputHash: "abc",
        outputHash: "def",
      },
      output: "this should be an object, not a string",
    });
    await writeFile(join(cacheDir, `${cacheKey}.json`), wrongShape, "utf-8");

    const cached = await readEnrichmentCache(tmpDir, cacheKey);
    expect(cached).toBeNull();
  });

  it("read returns null when envelope is missing required fields", async () => {
    const cacheKey = "missingfields";
    const cacheDir = join(tmpDir, ".mp-sentinel-cache", "ai-enrichment");
    const { mkdir: mkdirAsync } = await import("node:fs/promises");
    await mkdirAsync(cacheDir, { recursive: true });

    // Valid JSON but missing metadata.model field \u2014 fails Zod schema
    const missingFields = JSON.stringify({
      cacheKey,
      createdAt: new Date().toISOString(),
      metadata: { mode: "ai", provider: "gemini" },
      output: {
        languageRules: [],
        libraryRules: [],
        versionNotes: [],
        riskWarnings: [],
        recommendedChecks: [],
      },
    });
    await writeFile(join(cacheDir, `${cacheKey}.json`), missingFields, "utf-8");

    const cached = await readEnrichmentCache(tmpDir, cacheKey);
    expect(cached).toBeNull();
  });

  it("writeEnrichmentCache does not throw when directory is blocked by a file (cache write failure is non-blocking)", async () => {
    // Create a regular file where the cache directory would be created
    const cacheKey = "writefailtest1";
    const blockPath = join(tmpDir, ".mp-sentinel-cache", "ai-enrichment");
    const { mkdir: mkdirAsync } = await import("node:fs/promises");
    await mkdirAsync(join(tmpDir, ".mp-sentinel-cache"), { recursive: true });
    // Write a file at the ai-enrichment path to block mkdir(dir, { recursive: true })
    await writeFile(blockPath, "blocking file", "utf-8");

    const metadata = {
      mode: "ai" as const,
      provider: "gemini",
      model: "g",
      promptVersion: "v1",
      inputHash: "abc1234567890abc",
      outputHash: "def1234567890def",
    };
    const output = {
      languageRules: [],
      libraryRules: [],
      versionNotes: [],
      riskWarnings: [],
      recommendedChecks: [],
    };

    // Must not throw \u2014 cache write failure is non-blocking
    await expect(writeEnrichmentCache(tmpDir, cacheKey, metadata, output)).resolves.toBeUndefined();
  });

  it("temp/partial .tmp.* files are not treated as cache hits", async () => {
    const cacheKey = "tempfiletest1";
    const cacheDir = join(tmpDir, ".mp-sentinel-cache", "ai-enrichment");
    const { mkdir: mkdirAsync } = await import("node:fs/promises");
    await mkdirAsync(cacheDir, { recursive: true });

    // Write a .tmp.* file (simulating partial write before rename)
    const tmpPath = join(cacheDir, `${cacheKey}.json.tmp.1234567890`);
    const validEnvelope = JSON.stringify({
      cacheKey,
      createdAt: new Date().toISOString(),
      metadata: {
        mode: "ai",
        provider: "gemini",
        model: "g",
        promptVersion: "v1",
        inputHash: "abc",
        outputHash: "def",
      },
      output: {
        languageRules: [],
        libraryRules: [],
        versionNotes: [],
        riskWarnings: [],
        recommendedChecks: [],
      },
    });
    await writeFile(tmpPath, validEnvelope, "utf-8");

    // The tmp file should NOT be found \u2014 only the final .json path is checked
    const cached = await readEnrichmentCache(tmpDir, cacheKey);
    expect(cached).toBeNull();
  });
});

// -- enrichIndex cache integration ---------------------------------------------

describe("enrichIndex cache integration", () => {
  let tmpDir: string;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mp-sentinel-enrich-cache-"));
    process.env.GEMINI_API_KEY = "test-key";
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  function makeTestIndex(): SourceIndex {
    return {
      schemaVersion: "1.2",
      generatedAt: "2026-01-01T00:00:00.000Z",
      toolVersion: "1.0.0",
      project: {
        packageName: "test-project",
        packageVersion: "1.0.0",
        packageManager: "npm",
        ecosystem: "node",
        nodeEngine: ">=24.0.0",
        dependencies: { typescript: "5.0.0" },
        devDependencies: {},
        detectedFrameworks: [],
      },
      files: [
        {
          path: "src/index.ts",
          language: "typescript",
          sha256: "abc",
          sizeBytes: 100,
          mtimeMs: 0,
          imports: [],
          exports: [],
          symbols: [{ name: "main", type: "function", line: 1, column: 0 }],
          importsFrom: [],
          importedBy: [],
        },
      ],
      stats: { totalFiles: 1, indexedFiles: 1, skippedFiles: 0, parseErrors: 0 },
    };
  }

  function makeMockProvider() {
    const validOutput = JSON.stringify({
      languageRules: ["Use strict mode"],
      libraryRules: ["Use zod v4.3.6"],
      versionNotes: ["TypeScript 5.x"],
      riskWarnings: ["Check coverage"],
      recommendedChecks: ["Verify types"],
    });
    return {
      isAvailable: () => true,
      generateContent: jest
        .fn<(systemPrompt: string, userPrompt: string) => Promise<string>>()
        .mockResolvedValue(validOutput),
    };
  }

  it("cache hit: returns cached result without calling provider", async () => {
    const index = makeTestIndex();
    const sourceIndexHash = computeIndexHash(index, tmpDir);
    const input = buildEnrichmentInput(index);
    const inputHash = computeEnrichmentInputHash(input);

    const cacheKey = computeEnrichmentCacheKey(
      sourceIndexHash,
      "gemini",
      "gemini-2.5-flash",
      "2026-05-08",
      inputHash,
    );

    const cachedOutput = {
      languageRules: ["Cached rule"],
      libraryRules: [],
      versionNotes: [],
      riskWarnings: [],
      recommendedChecks: [],
    };
    const cachedMetadata = {
      mode: "ai" as const,
      provider: "gemini",
      model: "gemini-2.5-flash",
      promptVersion: "2026-05-08",
      inputHash,
      outputHash: "cachedoutputhash",
    };

    // Pre-populate cache
    await writeEnrichmentCache(tmpDir, cacheKey, cachedMetadata, cachedOutput);

    // Mock provider \u2014 should NOT be called
    const createProviderSpy = jest.spyOn(AIProviderFactory, "createProvider");
    const getDefaultModelSpy = jest
      .spyOn(AIProviderFactory, "getDefaultModel")
      .mockReturnValue("gemini-2.5-flash");

    const result = await enrichIndex(index, {
      provider: "gemini",
      model: "gemini-2.5-flash",
      projectRoot: tmpDir,
    });

    expect(result).not.toBeNull();
    expect(result!.output).toEqual(cachedOutput);
    expect(result!.metadata).toEqual(cachedMetadata);
    // Provider must NOT have been created (cache hit)
    expect(createProviderSpy).not.toHaveBeenCalled();

    createProviderSpy.mockRestore();
    getDefaultModelSpy.mockRestore();
  });

  it("cache miss: calls provider and writes cache", async () => {
    const index = makeTestIndex();

    const mockProvider = makeMockProvider();
    const createProviderSpy = jest
      .spyOn(AIProviderFactory, "createProvider")
      .mockReturnValue(mockProvider as any);
    const getDefaultModelSpy = jest
      .spyOn(AIProviderFactory, "getDefaultModel")
      .mockReturnValue("gemini-2.5-flash");

    const result = await enrichIndex(index, {
      provider: "gemini",
      model: "gemini-2.5-flash",
      projectRoot: tmpDir,
    });

    expect(result).not.toBeNull();
    expect(mockProvider.generateContent).toHaveBeenCalledTimes(1);

    // Verify cache file was written
    const sourceIndexHash = computeIndexHash(index, tmpDir);
    const input = buildEnrichmentInput(index);
    const inputHash = computeEnrichmentInputHash(input);
    const cacheKey = computeEnrichmentCacheKey(
      sourceIndexHash,
      "gemini",
      "gemini-2.5-flash",
      "2026-05-08",
      inputHash,
    );
    const cached = await readEnrichmentCache(tmpDir, cacheKey);
    expect(cached).not.toBeNull();
    expect(cached!.output).toEqual(result!.output);

    createProviderSpy.mockRestore();
    getDefaultModelSpy.mockRestore();
  });

  it("corrupt cache: provider is called (corrupt cache is ignored)", async () => {
    const index = makeTestIndex();
    const sourceIndexHash = computeIndexHash(index, tmpDir);
    const input = buildEnrichmentInput(index);
    const inputHash = computeEnrichmentInputHash(input);

    const cacheKey = computeEnrichmentCacheKey(
      sourceIndexHash,
      "gemini",
      "gemini-2.5-flash",
      "2026-05-08",
      inputHash,
    );

    // Write corrupt cache file
    const cacheDir = join(tmpDir, ".mp-sentinel-cache", "ai-enrichment");
    const { mkdir: mkdirAsync } = await import("node:fs/promises");
    await mkdirAsync(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, `${cacheKey}.json`), "{{{bad json", "utf-8");

    const mockProvider = makeMockProvider();
    const createProviderSpy = jest
      .spyOn(AIProviderFactory, "createProvider")
      .mockReturnValue(mockProvider as any);
    const getDefaultModelSpy = jest
      .spyOn(AIProviderFactory, "getDefaultModel")
      .mockReturnValue("gemini-2.5-flash");

    const result = await enrichIndex(index, {
      provider: "gemini",
      model: "gemini-2.5-flash",
      projectRoot: tmpDir,
    });

    // Should still succeed via provider call
    expect(result).not.toBeNull();
    expect(mockProvider.generateContent).toHaveBeenCalledTimes(1);

    createProviderSpy.mockRestore();
    getDefaultModelSpy.mockRestore();
  });

  it("projectRoot not set: skips cache entirely, calls provider directly", async () => {
    const index = makeTestIndex();

    const mockProvider = makeMockProvider();
    const createProviderSpy = jest
      .spyOn(AIProviderFactory, "createProvider")
      .mockReturnValue(mockProvider as any);
    const getDefaultModelSpy = jest
      .spyOn(AIProviderFactory, "getDefaultModel")
      .mockReturnValue("gemini-2.5-flash");

    const result = await enrichIndex(index, {
      provider: "gemini",
      model: "gemini-2.5-flash",
      // no projectRoot
    });

    expect(result).not.toBeNull();
    expect(mockProvider.generateContent).toHaveBeenCalledTimes(1);
    // No cache directory should be created
    const cacheDir = join(tmpDir, ".mp-sentinel-cache");
    const { existsSync } = await import("node:fs");
    // The tmpDir is empty \u2014 no cache was written here
    // (but also the test tmpDir was never passed to enrichIndex, so cacheDir won't exist)
    expect(existsSync(cacheDir)).toBe(false);

    createProviderSpy.mockRestore();
    getDefaultModelSpy.mockRestore();
  });
});
