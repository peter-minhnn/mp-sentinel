/**
 * Tests for clean-code policy sections
 */

import { describe, it, expect } from "@jest/globals";
import { generateContent } from "../services/skills-generator/content.js";
import type { CodeStyleProfile, CreateSkillsPolicies, SourceIndex } from "../types/index.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

const emptyIndex: SourceIndex = {
  schemaVersion: "1.2",
  generatedAt: "",
  toolVersion: "",
  project: {
    packageName: "test",
    ecosystem: "node",
    dependencies: {},
    devDependencies: {},
    detectedFrameworks: [],
    scripts: {},
  },
  files: [],
  stats: { totalFiles: 0, indexedFiles: 0, skippedFiles: 0, parseErrors: 0 },
};

const codeStyleProfile: CodeStyleProfile = {
  indent: "2-spaces",
  singleQuoteRatio: 0.8,
  semicolonRatio: 0.1,
  p50FileLines: 80,
  p95FileLines: 320,
  maxFileLines: 1200,
  trailingNewlineRatio: 0.9,
  formatterConfigs: [".prettierrc"],
  svelteImportOutsideScriptRatio: 0,
  oversizedFiles: [
    { path: "src/huge.ts", lines: 1200 },
    { path: "src/large.ts", lines: 850 },
    { path: "src/big.ts", lines: 620 },
    { path: "src/medium-big.ts", lines: 510 },
  ],
};

const policies: CreateSkillsPolicies = {
  maxFileLines: 500,
  warnFileLines: 350,
  maxFunctionLines: 80,
  maxParams: 5,
  maxCyclomaticHint: 12,
  forbidDefaultExports: true,
};

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Clean Code Policy section", () => {
  it("renders the clean code policy with configurable limits", () => {
    const content = generateContent(
      emptyIndex,
      "test",
      undefined,
      undefined,
      codeStyleProfile,
      policies,
    );
    const section = content.sections.cleanCodePolicy;
    expect(section).toContain("## Clean Code Policy");
    expect(section).toContain("500 lines");
    expect(section).toContain("350 lines");
    expect(section).toContain("80 lines");
    expect(section).toContain("5 per function");
    expect(section).toContain("Default exports are forbidden");
  });

  it("renders a different limit when overridden", () => {
    const customPolicies: CreateSkillsPolicies = {
      ...policies,
      maxFileLines: 1000,
      forbidDefaultExports: false,
    };
    const content = generateContent(
      emptyIndex,
      "test",
      undefined,
      undefined,
      codeStyleProfile,
      customPolicies,
    );
    const section = content.sections.cleanCodePolicy;
    expect(section).toContain("1000 lines");
    expect(section).not.toContain("Default exports are forbidden");
  });
});

describe("File Size Policy section", () => {
  it("renders percentiles when codeStyleProfile is provided", () => {
    const content = generateContent(
      emptyIndex,
      "test",
      undefined,
      undefined,
      codeStyleProfile,
      policies,
    );
    const section = content.sections.fileSizePolicy;
    expect(section).toContain("## File Size Policy");
    expect(section).toContain("500 lines");
    expect(section).toContain("P50");
    expect(section).toContain("320");
    expect(section).toContain("1200");
  });

  it("lists oversized files as technical debt", () => {
    const content = generateContent(
      emptyIndex,
      "test",
      undefined,
      undefined,
      codeStyleProfile,
      policies,
    );
    const section = content.sections.fileSizePolicy;
    expect(section).toContain("src/huge.ts");
    expect(section).toContain("src/large.ts");
    expect(section).toContain("technical debt");
  });

  it("handles no codeStyleProfile gracefully", () => {
    const content = generateContent(emptyIndex, "test");
    const cleanCode = content.sections.cleanCodePolicy;
    const fileSize = content.sections.fileSizePolicy;
    // Should still render with defaults but no profile data
    expect(cleanCode).toContain("## Clean Code Policy");
    expect(fileSize).toContain("## File Size Policy");
    expect(fileSize).toContain("500 lines");
  });

  it("handles no oversized files cleanly", () => {
    const cleanProfile: CodeStyleProfile = {
      ...codeStyleProfile,
      oversizedFiles: [],
      maxFileLines: 250,
    };
    const content = generateContent(
      emptyIndex,
      "test",
      undefined,
      undefined,
      cleanProfile,
      policies,
    );
    const section = content.sections.fileSizePolicy;
    expect(section).toContain("No files exceed");
    expect(section).not.toContain("technical debt");
  });
});
