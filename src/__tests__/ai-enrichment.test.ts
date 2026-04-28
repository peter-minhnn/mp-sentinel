/**
 * Lane C: AI Enrichment Determinism Tests
 *
 * Validates that buildEnrichmentInput produces deterministic output,
 * hashing is stable, validation enforces limits, and configuration
 * resolution handles edge cases correctly.
 */

import { describe, it, expect } from "@jest/globals";

import {
  validateAIEnrichmentOutput,
  buildEnrichmentInput,
  buildEnrichmentPrompt,
  computeEnrichmentInputHash,
  computeEnrichmentOutputHash,
  resolveAIEnrichmentConfig,
  deepSortForHash,
} from "../services/skills-generator/ai-enrichment.js";

import type {
  SourceIndex,
  ProjectManifest,
  AIEnrichmentOutput,
  CreateSkillsAIConfig,
} from "../types/index.js";

// ── Fixture helpers ──────────────────────────────────────────────────────────

function makeMinimalIndex(overrides?: Partial<ProjectManifest>): SourceIndex {
  const project: ProjectManifest = {
    packageName: "test-project",
    packageVersion: "1.0.0",
    packageManager: "npm",
    nodeEngine: ">=18",
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

// ── validateAIEnrichmentOutput ──────────────────────────────────────────────

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

// ── computeEnrichmentInputHash ──────────────────────────────────────────────

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

// ── computeEnrichmentOutputHash ─────────────────────────────────────────────

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

// ── buildEnrichmentInput ────────────────────────────────────────────────────

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
});

// ── buildEnrichmentPrompt ───────────────────────────────────────────────────

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
});

// ── resolveAIEnrichmentConfig ───────────────────────────────────────────────

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
});

// ── deepSortForHash ─────────────────────────────────────────────────────────

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

// ── Determinism property test ───────────────────────────────────────────────

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
        nodeEngine: ">=18",
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
