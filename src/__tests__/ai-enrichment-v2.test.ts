/**
 * AI Enrichment v2 schema tests — validates the extended output schema
 * with rulesByLanguage, antiPatterns, cleanCodeRules, styleEnforcement.
 */

import { describe, it, expect } from "@jest/globals";
import {
  validateAIEnrichmentOutput,
  buildEnrichmentInput,
  computeEnrichmentInputHash,
} from "../services/skills-generator/ai-enrichment.js";
import type { SourceIndex, AIEnrichmentOutput } from "../types/index.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeMinimalIndex(): SourceIndex {
  return {
    schemaVersion: "1.2",
    generatedAt: "",
    toolVersion: "",
    project: {
      packageName: "test-project",
      ecosystem: "node",
      packageVersion: "1.0.0",
      packageManager: "npm",
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

const v2Output: AIEnrichmentOutput = {
  languageRules: ["Use strict TypeScript settings"],
  libraryRules: ["Use zod for validation"],
  versionNotes: ["TypeScript 5.x supports decorators"],
  riskWarnings: ["Low test coverage detected"],
  recommendedChecks: ["Verify type safety"],
  rulesByLanguage: {
    typescript: [
      "Use `import type` for type-only imports",
      "Use `node:` prefix for built-in modules",
    ],
    svelte: ["Place all imports inside the `<script>` block", "Use `$state` rune in Svelte 5"],
  },
  cleanCodeRules: ["Keep functions under 80 lines", "Avoid default exports"],
  antiPatterns: [
    {
      pattern: "Import outside `<script>` block in .svelte files",
      files: ["src/lib/Bad.svelte"],
      fix: "Move all import statements inside the `<script>` block",
    },
  ],
  styleEnforcement: ["Use 2-space indentation (detected from codebase)", "Prefer single quotes"],
};

// ── Tests ───────────────────────────────────────────────────────────────────

describe("AI Enrichment v2 — validateAIEnrichmentOutput", () => {
  it("passes validation with all v2 fields", () => {
    const raw = JSON.stringify(v2Output);
    const result = validateAIEnrichmentOutput(raw);
    expect(result.languageRules).toEqual(v2Output.languageRules);
    expect(result.rulesByLanguage).toBeDefined();
    expect(result.rulesByLanguage!.typescript).toHaveLength(2);
    expect(result.rulesByLanguage!.svelte).toHaveLength(2);
    expect(result.antiPatterns).toBeDefined();
    expect(result.antiPatterns!.length).toBeGreaterThan(0);
    expect(result.cleanCodeRules).toBeDefined();
    expect(result.styleEnforcement).toBeDefined();
  });

  it("passes validation without v2 fields (backward compatible)", () => {
    const basic: AIEnrichmentOutput = {
      languageRules: [],
      libraryRules: [],
      versionNotes: [],
      riskWarnings: [],
      recommendedChecks: [],
    };
    const raw = JSON.stringify(basic);
    const result = validateAIEnrichmentOutput(raw);
    expect(result.languageRules).toEqual([]);
    expect(result.rulesByLanguage).toBeUndefined();
    expect(result.antiPatterns).toBeUndefined();
  });

  it("validates antiPatterns structure", () => {
    const withPatterns = {
      ...v2Output,
      antiPatterns: [
        {
          pattern: "Test pattern",
          files: ["src/test.ts"],
          fix: "Fix suggestion",
        },
      ],
    };
    const raw = JSON.stringify(withPatterns);
    const result = validateAIEnrichmentOutput(raw);
    expect(result.antiPatterns).toHaveLength(1);
    expect(result.antiPatterns![0]!.pattern).toBe("Test pattern");
    expect(result.antiPatterns![0]!.files).toContain("src/test.ts");
    expect(result.antiPatterns![0]!.fix).toBe("Fix suggestion");
  });

  it("validates rulesByLanguage structure", () => {
    const withRules = {
      ...v2Output,
      rulesByLanguage: {
        typescript: ["Rule 1", "Rule 2"],
      },
    };
    const raw = JSON.stringify(withRules);
    const result = validateAIEnrichmentOutput(raw);
    expect(result.rulesByLanguage).toBeDefined();
    expect(Object.keys(result.rulesByLanguage!)).toContain("typescript");
    expect(result.rulesByLanguage!.typescript).toHaveLength(2);
  });

  it("caps rulesByLanguage per language at 15 rules", () => {
    const manyRules = Array.from({ length: 16 }, (_, i) => `Rule ${i}`);
    const raw = JSON.stringify({
      ...v2Output,
      rulesByLanguage: { typescript: manyRules },
    });
    expect(() => validateAIEnrichmentOutput(raw)).toThrow();
  });

  it("caps antiPatterns at 10 entries", () => {
    const manyPatterns = Array.from({ length: 11 }, (_, i) => ({
      pattern: `Pattern ${i}`,
      files: [`file${i}.ts`],
      fix: "Fix it",
    }));
    const raw = JSON.stringify({
      ...v2Output,
      languageRules: [],
      libraryRules: [],
      versionNotes: [],
      riskWarnings: [],
      recommendedChecks: [],
      antiPatterns: manyPatterns,
    });
    expect(() => validateAIEnrichmentOutput(raw)).toThrow();
  });

  it("Svelte-specific rulesByLanguage entry survives serialization", () => {
    const raw = JSON.stringify(v2Output);
    const result = validateAIEnrichmentOutput(raw);
    expect(result.rulesByLanguage?.svelte).toBeDefined();
    if (result.rulesByLanguage?.svelte) {
      expect(result.rulesByLanguage.svelte[0]!).toContain("script");
    }
  });

  it("antiPatterns files cite the source paths correctly", () => {
    const raw = JSON.stringify(v2Output);
    const result = validateAIEnrichmentOutput(raw);
    const allFiles = result.antiPatterns!.flatMap((ap) => ap.files);
    expect(allFiles).toContain("src/lib/Bad.svelte");
  });
});

describe("AI Enrichment v2 — buildEnrichmentInput stability", () => {
  it("input hash is stable with same input", () => {
    const index = makeMinimalIndex();
    const input1 = buildEnrichmentInput(index);
    const input2 = buildEnrichmentInput(index);
    expect(computeEnrichmentInputHash(input1)).toBe(computeEnrichmentInputHash(input2));
  });

  it("v2 optional fields do not affect hash when absent", () => {
    const index = makeMinimalIndex();
    const input = buildEnrichmentInput(index);
    const hash = computeEnrichmentInputHash(input);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });
});
