import { describe, it, expect } from "@jest/globals";
import {
  validateSkillQuality,
  validateAdapterSpec,
  validateAllAdapterSpecs,
} from "../services/skills-generator/quality-gate.js";
import { ADAPTER_REGISTRY } from "../services/skills-generator/registry.js";
import type {
  GeneratedSkillFile,
  AgentAdapterId,
  SourceIndex,
  ProjectManifest,
} from "../types/index.js";

// -- Helpers ------------------------------------------------------------------

function makeFile(outputPath: string, content: string): GeneratedSkillFile {
  return { outputPath, content };
}

function makeMinimalIndex(overrides?: Partial<ProjectManifest>): SourceIndex {
  const project: ProjectManifest = {
    packageName: "test",
    packageVersion: "1.0.0",
    packageManager: "npm",
    nodeEngine: ">=24.0.0",
    dependencies: {},
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
      {
        path: "src/utils.ts",
        language: "typescript",
        sha256: "def",
        sizeBytes: 50,
        mtimeMs: 0,
        imports: [],
        exports: [],
        symbols: [{ name: "helper", type: "function", line: 1, column: 0 }],
        importsFrom: [],
        importedBy: ["src/index.ts"],
      },
      {
        path: "src/cli/args.ts",
        language: "typescript",
        sha256: "ghi",
        sizeBytes: 200,
        mtimeMs: 0,
        imports: [{ source: "./utils.js", kind: "named", names: ["helper"], line: 1 }],
        exports: [],
        symbols: [{ name: "parseArgs", type: "function", line: 1, column: 0 }],
        importsFrom: ["src/utils.ts"],
        importedBy: [],
      },
    ],
    stats: { totalFiles: 3, indexedFiles: 3, skippedFiles: 0, parseErrors: 0 },
  };
}

// -- Edge cases ---------------------------------------------------------------

describe("validateSkillQuality", () => {
  describe("edge cases", () => {
    it("returns empty report for empty files array", () => {
      const report = validateSkillQuality([], "claude", null);
      expect(report.passed).toBe(true);
      expect(report.checks).toHaveLength(0);
      expect(report.errors).toBe(0);
      expect(report.warnings).toBe(0);
    });

    it("handles null index gracefully (skips path validation)", () => {
      const files = [makeFile("SKILL.md", "## Overview\n\ncontent")];
      const report = validateSkillQuality(files, "claude", null);
      expect(report.checks.filter((c) => c.type === "unknown-path")).toHaveLength(0);
    });

    it("handles unknown adapter file layout gracefully", () => {
      // For an unknown multi-file adapter, unknown filenames skip required sections
      const files = [makeFile("custom.md", "## Anything\n\ncontent")];
      const report = validateSkillQuality(files, "generic" as AgentAdapterId, null);
      expect(report.errors).toBeGreaterThanOrEqual(0);
    });
  });

  // -- Max file size ----------------------------------------------------------

  describe("max file size", () => {
    it("flags SKILL.md over 30000 chars as error for claude", () => {
      const longContent = "# Header\n\n" + "x".repeat(30001);
      const files = [makeFile(".claude/skills/test/SKILL.md", longContent)];
      const report = validateSkillQuality(files, "claude", null);
      const sizeErrors = report.checks.filter(
        (c) => c.type === "max-file-size" && c.severity === "error",
      );
      expect(sizeErrors.length).toBe(1);
      expect(sizeErrors[0]!.file).toContain("SKILL.md");
    });

    it("flags reference files over 6000 chars for claude", () => {
      const longContent = "## Architecture\n\n" + "x".repeat(6001);
      const files = [makeFile(".claude/skills/test/references/architecture.md", longContent)];
      const report = validateSkillQuality(files, "claude", null);
      const sizeErrors = report.checks.filter(
        (c) => c.type === "max-file-size" && c.severity === "error",
      );
      expect(sizeErrors.length).toBe(1);
    });

    it("flags single-file adapter output over 30000 chars", () => {
      const longContent = "# Big\n\n" + "x".repeat(30001);
      const files = [makeFile(".cursor/rules/test.mdc", longContent)];
      const report = validateSkillQuality(files, "cursor", null);
      const sizeErrors = report.checks.filter(
        (c) => c.type === "max-file-size" && c.severity === "error",
      );
      expect(sizeErrors.length).toBe(1);
    });

    it("passes files within size limits", () => {
      const files = [
        makeFile(".claude/skills/test/SKILL.md", "x".repeat(1000)),
        makeFile(".claude/skills/test/references/architecture.md", "x".repeat(2000)),
      ];
      const report = validateSkillQuality(files, "claude", null);
      const sizeErrors = report.checks.filter(
        (c) => c.type === "max-file-size" && c.severity === "error",
      );
      expect(sizeErrors).toHaveLength(0);
    });
  });

  // -- Max file lines ---------------------------------------------------------

  describe("max file lines", () => {
    it("flags generated file over 500 lines as error", () => {
      const longContent = Array.from({ length: 502 }, (_, i) => `line ${i + 1}`).join("\n");
      const files = [makeFile(".cursor/rules/test.mdc", longContent)];
      const report = validateSkillQuality(files, "cursor", null);
      const lineErrors = report.checks.filter(
        (c) => c.type === "max-file-lines" && c.severity === "error",
      );
      expect(lineErrors.length).toBe(1);
      expect(lineErrors[0]!.message).toContain("502 lines");
    });

    it("passes generated file at exactly 500 lines without trailing newline", () => {
      const content = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join("\n");
      const files = [makeFile(".claude/skills/test/SKILL.md", content)];
      const report = validateSkillQuality(files, "claude", null);
      const lineErrors = report.checks.filter(
        (c) => c.type === "max-file-lines" && c.severity === "error",
      );
      expect(lineErrors).toHaveLength(0);
    });

    it("passes generated file at exactly 500 lines with trailing newline", () => {
      const content = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
      const files = [makeFile(".claude/skills/test/SKILL.md", content)];
      const report = validateSkillQuality(files, "claude", null);
      const lineErrors = report.checks.filter(
        (c) => c.type === "max-file-lines" && c.severity === "error",
      );
      expect(lineErrors).toHaveLength(0);
    });

    it("flags Claude reference file over 500 lines", () => {
      const longContent = Array.from({ length: 501 }, (_, i) => `line ${i + 1}`).join("\n");
      const files = [makeFile(".claude/skills/test/references/architecture.md", longContent)];
      const report = validateSkillQuality(files, "claude", null);
      const lineErrors = report.checks.filter(
        (c) => c.type === "max-file-lines" && c.severity === "error",
      );
      expect(lineErrors.length).toBe(1);
    });

    it("flags single-file adapter output over 500 lines", () => {
      const longContent = Array.from({ length: 501 }, (_, i) => `line ${i + 1}`).join("\n");
      const files = [makeFile(".agents/rules/test.md", longContent)];
      const report = validateSkillQuality(files, "generic" as AgentAdapterId, null);
      const lineErrors = report.checks.filter(
        (c) => c.type === "max-file-lines" && c.severity === "error",
      );
      expect(lineErrors.length).toBe(1);
    });

    it("flags 501 lines with trailing newline as error", () => {
      const longContent = Array.from({ length: 501 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
      const files = [makeFile(".claude/skills/test/SKILL.md", longContent)];
      const report = validateSkillQuality(files, "claude", null);
      const lineErrors = report.checks.filter(
        (c) => c.type === "max-file-lines" && c.severity === "error",
      );
      expect(lineErrors.length).toBe(1);
    });

    it("passes empty file", () => {
      const files = [makeFile(".claude/skills/test/SKILL.md", "")];
      const report = validateSkillQuality(files, "claude", null);
      const lineErrors = report.checks.filter(
        (c) => c.type === "max-file-lines" && c.severity === "error",
      );
      expect(lineErrors).toHaveLength(0);
    });

    it("passes file with only newlines", () => {
      const files = [makeFile(".claude/skills/test/SKILL.md", "\n\n\n")];
      const report = validateSkillQuality(files, "claude", null);
      const lineErrors = report.checks.filter(
        (c) => c.type === "max-file-lines" && c.severity === "error",
      );
      expect(lineErrors).toHaveLength(0);
    });

    it("passes short file under 500 lines", () => {
      const files = [makeFile(".claude/skills/test/SKILL.md", "# Short\n\ncontent")];
      const report = validateSkillQuality(files, "claude", null);
      const lineErrors = report.checks.filter(
        (c) => c.type === "max-file-lines" && c.severity === "error",
      );
      expect(lineErrors).toHaveLength(0);
    });
  });

  // -- Required sections ------------------------------------------------------

  describe("required sections", () => {
    it("flags missing required sections in Claude SKILL.md", () => {
      const files = [makeFile(".claude/skills/test/SKILL.md", "# No H2 headings\n\ncontent")];
      const report = validateSkillQuality(files, "claude", null);
      const sectionChecks = report.checks.filter((c) => c.type === "required-section");
      expect(sectionChecks.length).toBeGreaterThan(0);
      expect(sectionChecks.every((c) => c.severity === "error")).toBe(true);
    });

    it("passes when all required sections are present in SKILL.md", () => {
      const content = [
        "## Required Agent Workflow",
        "",
        "step 1",
        "",
        "## Reference Routing",
        "",
        "routing",
        "",
        "## Overview",
        "",
        "overview text",
        "",
        "## References",
        "",
        "- [ref](./references/foo.md)",
      ].join("\n");
      const files = [makeFile(".claude/skills/test/SKILL.md", content)];
      const report = validateSkillQuality(files, "claude", null);
      const sectionErrors = report.checks.filter(
        (c) => c.type === "required-section" && c.severity === "error",
      );
      expect(sectionErrors).toHaveLength(0);
    });

    it("matches Project Profile section by prefix", () => {
      const content = ["## Project Profile: cli-tooling", "", "profile content"].join("\n");
      const files = [makeFile(".claude/skills/test/references/commands.md", content)];
      const report = validateSkillQuality(files, "claude", null);
      const profileMissing = report.checks.filter(
        (c) => c.type === "required-section" && c.message.includes("Project Profile"),
      );
      expect(profileMissing).toHaveLength(0);
    });

    it("flags missing prefixed section in commands.md", () => {
      const files = [
        makeFile(".claude/skills/test/references/commands.md", "## Some Other Section\n\ncontent"),
      ];
      const report = validateSkillQuality(files, "claude", null);
      const profileChecks = report.checks.filter(
        (c) => c.type === "required-section" && c.message.includes("Project Profile"),
      );
      expect(profileChecks.length).toBeGreaterThan(0);
    });

    it("flags missing sections in single-file adapter output", () => {
      const files = [makeFile(".cursor/rules/test.mdc", "# No proper H2s")];
      const report = validateSkillQuality(files, "cursor", null);
      const sectionChecks = report.checks.filter((c) => c.type === "required-section");
      expect(sectionChecks.length).toBeGreaterThan(0);
    });

    it("passes single-file with all required sections", () => {
      const content = [
        "## Required Agent Workflow",
        "",
        "step",
        "",
        "## Reference Routing",
        "",
        "routing",
        "",
        "## Overview",
        "",
        "text",
        "",
        "## Architecture",
        "",
        "text",
        "",
        "## Module Map",
        "",
        "text",
        "",
        "## Codebase Map",
        "",
        "text",
        "",
        "## Testing Map",
        "",
        "text",
        "",
        "## Dependencies",
        "",
        "text",
        "",
        "## Public API Surface",
        "",
        "text",
        "",
        "## Project Profile: cli-tooling",
        "",
        "text",
      ].join("\n");
      const files = [makeFile(".cursor/rules/test.mdc", content)];
      const report = validateSkillQuality(files, "cursor", null);
      const sectionErrors = report.checks.filter(
        (c) => c.type === "required-section" && c.severity === "error",
      );
      expect(sectionErrors).toHaveLength(0);
    });
  });

  // -- Required references (Claude only) --------------------------------------

  describe("required references", () => {
    it("flags SKILL.md without 7 reference links", () => {
      const content = [
        "## Required Agent Workflow",
        "",
        "steps",
        "",
        "## Overview",
        "",
        "overview",
        "",
        "## References",
        "",
        "- [one](./references/a.md)",
      ].join("\n");
      const files = [makeFile(".claude/skills/test/SKILL.md", content)];
      const report = validateSkillQuality(files, "claude", null);
      const refChecks = report.checks.filter((c) => c.type === "required-references");
      expect(refChecks.length).toBe(1);
      expect(refChecks[0]!.severity).toBe("error");
    });

    it("passes when exactly 7 reference links are present", () => {
      const refs = [
        "- [a](./references/architecture.md)",
        "- [b](./references/codebase-map.md)",
        "- [c](./references/testing-map.md)",
        "- [d](./references/dependencies.md)",
        "- [e](./references/public-api.md)",
        "- [f](./references/modules.md)",
        "- [g](./references/commands.md)",
      ];
      const content = [
        "## Required Agent Workflow",
        "",
        "steps",
        "",
        "## Overview",
        "",
        "overview",
        "",
        "## References",
        "",
        ...refs,
      ].join("\n");
      const files = [makeFile(".claude/skills/test/SKILL.md", content)];
      const report = validateSkillQuality(files, "claude", null);
      const refErrors = report.checks.filter(
        (c) => c.type === "required-references" && c.severity === "error",
      );
      expect(refErrors).toHaveLength(0);
    });

    it("does not flag references check on non-Claude adapters", () => {
      const files = [makeFile(".cursor/rules/test.mdc", "no refs at all")];
      const report = validateSkillQuality(files, "cursor", null);
      const refChecks = report.checks.filter((c) => c.type === "required-references");
      expect(refChecks).toHaveLength(0);
    });
  });

  // -- No duplicate sections --------------------------------------------------

  describe("duplicate sections", () => {
    it("flags duplicate H2 headings", () => {
      const content = "## Overview\n\nfirst\n\n## Overview\n\nsecond";
      const files = [makeFile(".claude/skills/test/SKILL.md", content)];
      const report = validateSkillQuality(files, "claude", null);
      const dupChecks = report.checks.filter((c) => c.type === "duplicate-section");
      expect(dupChecks.length).toBeGreaterThanOrEqual(1);
      expect(dupChecks[0]!.severity).toBe("error");
    });

    it("passes when all H2s are unique", () => {
      const content = "## First\n\na\n\n## Second\n\nb\n\n## Third\n\nc";
      const files = [makeFile(".agents/rules/test.md", content)];
      const report = validateSkillQuality(files, "generic", null);
      const dupChecks = report.checks.filter((c) => c.type === "duplicate-section");
      expect(dupChecks).toHaveLength(0);
    });
  });

  // -- Empty sections ---------------------------------------------------------

  describe("empty sections", () => {
    it("flags H2 heading with no content after it", () => {
      const content = "## Overview\n\n## Architecture\n\ncontent here";
      const files = [makeFile(".claude/skills/test/SKILL.md", content)];
      const report = validateSkillQuality(files, "claude", null);
      const emptyChecks = report.checks.filter((c) => c.type === "empty-section");
      expect(emptyChecks.length).toBe(1);
      expect(emptyChecks[0]!.severity).toBe("warning");
    });

    it("passes sections with content", () => {
      const content = "## Overview\n\nhas content\n\n## Architecture\n\nalso has content";
      const files = [makeFile(".claude/skills/test/SKILL.md", content)];
      const report = validateSkillQuality(files, "claude", null);
      const emptyChecks = report.checks.filter((c) => c.type === "empty-section");
      expect(emptyChecks).toHaveLength(0);
    });

    it("flags trailing empty section at EOF", () => {
      const content = "## Overview\n\ncontent\n\n## Trailing\n";
      const files = [makeFile(".claude/skills/test/SKILL.md", content)];
      const report = validateSkillQuality(files, "claude", null);
      const emptyTrailing = report.checks.filter(
        (c) => c.type === "empty-section" && c.message.includes("Trailing"),
      );
      expect(emptyTrailing.length).toBe(1);
    });
  });

  // -- Unknown path validation ------------------------------------------------

  describe("unknown path validation", () => {
    it("flags backtick paths not in source index", () => {
      const index = makeMinimalIndex();
      const content = "check `src/ghost.ts` file";
      const files = [makeFile(".claude/skills/test/references/architecture.md", content)];
      const report = validateSkillQuality(files, "claude", index);
      const pathChecks = report.checks.filter((c) => c.type === "unknown-path");
      expect(pathChecks.length).toBe(1);
      expect(pathChecks[0]!.severity).toBe("warning");
    });

    it("passes known paths from source index", () => {
      const index = makeMinimalIndex();
      const content = "check `src/index.ts` and `src/utils.ts`";
      const files = [makeFile(".claude/skills/test/references/architecture.md", content)];
      const report = validateSkillQuality(files, "claude", index);
      const pathErrors = report.checks.filter((c) => c.type === "unknown-path");
      expect(pathErrors).toHaveLength(0);
    });

    it("ignores ./references/ prefixed paths", () => {
      const index = makeMinimalIndex();
      const content = "see `./references/architecture.md` for details";
      const files = [makeFile(".claude/skills/test/SKILL.md", content)];
      const report = validateSkillQuality(files, "claude", index);
      const pathChecks = report.checks.filter((c) => c.type === "unknown-path");
      expect(pathChecks).toHaveLength(0);
    });

    it("ignores commands and package names", () => {
      const index = makeMinimalIndex();
      const content = "run `npm test` with package `@jest/globals`";
      const files = [makeFile(".claude/skills/test/references/commands.md", content)];
      const report = validateSkillQuality(files, "claude", index);
      const pathChecks = report.checks.filter((c) => c.type === "unknown-path");
      expect(pathChecks).toHaveLength(0);
    });

    it("ignores URLs", () => {
      const index = makeMinimalIndex();
      const content = "see `https://example.com/doc` for docs";
      const files = [makeFile(".claude/skills/test/references/architecture.md", content)];
      const report = validateSkillQuality(files, "claude", index);
      const pathChecks = report.checks.filter((c) => c.type === "unknown-path");
      expect(pathChecks).toHaveLength(0);
    });

    it("allows known non-source paths like package.json and tsconfig.json", () => {
      const index = makeMinimalIndex();
      const content = "Config files: `package.json`, `tsconfig.json`, `AGENTS.md`, `CLAUDE.md`";
      const files = [makeFile(".claude/skills/test/references/commands.md", content)];
      const report = validateSkillQuality(files, "claude", index);
      const pathChecks = report.checks.filter((c) => c.type === "unknown-path");
      expect(pathChecks).toHaveLength(0);
    });

    it("allows paths under known non-source directories", () => {
      const index = makeMinimalIndex();
      const content =
        "Agent dirs: `.claude/skills/proj/SKILL.md`, `.cursor/rules/proj.mdc`, `.clinerules/proj.md`";
      const files = [makeFile(".claude/skills/test/SKILL.md", content)];
      const report = validateSkillQuality(files, "claude", index);
      const pathChecks = report.checks.filter((c) => c.type === "unknown-path");
      expect(pathChecks).toHaveLength(0);
    });

    it("allows .mp-sentinel-cache/source-index.json as known path", () => {
      const index = makeMinimalIndex();
      const content = "Cache at `.mp-sentinel-cache/source-index.json`";
      const files = [makeFile(".claude/skills/test/references/architecture.md", content)];
      const report = validateSkillQuality(files, "claude", index);
      const pathChecks = report.checks.filter((c) => c.type === "unknown-path");
      expect(pathChecks).toHaveLength(0);
    });
  });

  // -- Codebase fidelity ----------------------------------------------------

  describe("codebase fidelity (real signals)", () => {
    it("errors when content does not mention CLI entrypoints present in index", () => {
      const index = makeMinimalIndex({
        scripts: { test: "jest", build: "tsup" },
      });
      // Add a CLI entrypoint role via insights
      index.insights = {
        fileRoles: {
          "src/index.ts": "cli-entry",
          "src/utils.ts": "utils",
          "src/cli/args.ts": "command",
        },
        publicApiFiles: [],
        testMap: {},
        commandMap: {},
        dependencyUsage: {},
        defaultExportFiles: [],
        reExportFiles: [],
        typeOnlyImportFiles: [],
        dynamicImportFiles: [],
      };
      // Content that doesn't mention the CLI entrypoint path
      const content = [
        "## Required Agent Workflow",
        "",
        "steps",
        "",
        "## Overview",
        "",
        "overview",
        "",
        "## Architecture",
        "",
        "architecture",
        "",
        "## Module Map",
        "",
        "modules",
        "",
        "## Codebase Map",
        "",
        "map",
        "",
        "## Testing Map",
        "",
        "tests",
        "",
        "## Dependencies",
        "",
        "deps",
        "",
        "## Public API Surface",
        "",
        "api",
        "",
        "## Project Profile: cli-tooling",
        "",
        "profile",
      ].join("\n");
      const files = [makeFile(".cursor/rules/test.mdc", content)];
      const report = validateSkillQuality(files, "cursor", index);
      const signalChecks = report.checks.filter((c) => c.type === "missing-real-signal");
      const cliChecks = signalChecks.filter((c) => c.message.includes("CLI entrypoint"));
      expect(cliChecks.length).toBe(1);
      expect(cliChecks[0]!.severity).toBe("error");
    });

    it("passes when content mentions real entrypoints", () => {
      const index = makeMinimalIndex({
        scripts: { test: "jest", build: "tsup" },
      });
      index.insights = {
        fileRoles: {
          "src/index.ts": "cli-entry",
          "src/utils.ts": "utils",
          "src/cli/args.ts": "command",
        },
        publicApiFiles: [],
        testMap: {},
        commandMap: {},
        dependencyUsage: {},
        defaultExportFiles: [],
        reExportFiles: [],
        typeOnlyImportFiles: [],
        dynamicImportFiles: [],
      };
      // Content that mentions CLI entrypoint, command files, and scripts
      const content = [
        "## Required Agent Workflow",
        "",
        "steps involving src/index.ts and src/cli/args.ts, run \`npm test\` and \`npm run build\`",
        "",
        "## Overview",
        "",
        "overview",
        "",
        "## Architecture",
        "",
        "architecture",
        "",
        "## Module Map",
        "",
        "modules",
        "",
        "## Codebase Map",
        "",
        "map",
        "",
        "## Testing Map",
        "",
        "tests",
        "",
        "## Dependencies",
        "",
        "deps",
        "",
        "## Public API Surface",
        "",
        "api",
        "",
        "## Project Profile: cli-tooling",
        "",
        "profile",
      ].join("\n");
      const files = [makeFile(".cursor/rules/test.mdc", content)];
      const report = validateSkillQuality(files, "cursor", index);
      const cliChecks = report.checks.filter(
        (c) => c.type === "missing-real-signal" && c.message.includes("CLI entrypoint"),
      );
      expect(cliChecks).toHaveLength(0);
      const scriptChecks = report.checks.filter(
        (c) => c.type === "missing-real-signal" && c.message.includes("package.json script"),
      );
      expect(scriptChecks).toHaveLength(0);
    });

    it("errors when content does not mention package.json scripts", () => {
      const index = makeMinimalIndex({
        scripts: { test: "jest", build: "tsup", lint: "eslint" },
      });
      // Content with no script references
      const content = [
        "## Required Agent Workflow",
        "",
        "steps",
        "",
        "## Overview",
        "",
        "overview",
        "",
        "## Architecture",
        "",
        "architecture",
        "",
        "## Module Map",
        "",
        "modules",
        "",
        "## Codebase Map",
        "",
        "map",
        "",
        "## Testing Map",
        "",
        "tests",
        "",
        "## Dependencies",
        "",
        "deps",
        "",
        "## Public API Surface",
        "",
        "api",
        "",
        "## Project Profile: cli-tooling",
        "",
        "profile",
      ].join("\n");
      const files = [makeFile(".cursor/rules/test.mdc", content)];
      const report = validateSkillQuality(files, "cursor", index);
      const signalChecks = report.checks.filter(
        (c) => c.type === "missing-real-signal" && c.message.includes("package.json script"),
      );
      expect(signalChecks.length).toBe(1);
      expect(signalChecks[0]!.severity).toBe("error");
    });

    it("warns when content does not mention top-level source directories", () => {
      const index = makeMinimalIndex();
      // Content with no source dir mentions
      const content = [
        "## Required Agent Workflow",
        "",
        "steps",
        "",
        "## Overview",
        "",
        "overview",
        "",
        "## Architecture",
        "",
        "architecture",
        "",
        "## Module Map",
        "",
        "modules",
        "",
        "## Codebase Map",
        "",
        "map",
        "",
        "## Testing Map",
        "",
        "tests",
        "",
        "## Dependencies",
        "",
        "deps",
        "",
        "## Public API Surface",
        "",
        "api",
        "",
        "## Project Profile: cli-tooling",
        "",
        "profile",
      ].join("\n");
      const files = [makeFile(".cursor/rules/test.mdc", content)];
      const report = validateSkillQuality(files, "cursor", index);
      const signalChecks = report.checks.filter(
        (c) => c.type === "missing-real-signal" && c.message.includes("source directory"),
      );
      expect(signalChecks.length).toBe(1);
    });

    it("skips real-signal checks when index is null", () => {
      const content = [
        "## Required Agent Workflow",
        "",
        "steps",
        "",
        "## Overview",
        "",
        "overview",
      ].join("\n");
      const files = [makeFile(".cursor/rules/test.mdc", content)];
      const report = validateSkillQuality(files, "cursor", null);
      const signalChecks = report.checks.filter((c) => c.type === "missing-real-signal");
      expect(signalChecks).toHaveLength(0);
    });

    it("only checks main skill files, not reference files", () => {
      const index = makeMinimalIndex({
        scripts: { test: "jest" },
      });
      index.insights = {
        fileRoles: { "src/index.ts": "cli-entry" },
        publicApiFiles: [],
        testMap: {},
        commandMap: {},
        dependencyUsage: {},
        defaultExportFiles: [],
        reExportFiles: [],
        typeOnlyImportFiles: [],
        dynamicImportFiles: [],
      };
      // Reference files should not trigger real-signal checks
      const content = "## Architecture\n\nsome architecture text";
      const files = [makeFile(".claude/skills/test/references/architecture.md", content)];
      const report = validateSkillQuality(files, "claude", index);
      const signalChecks = report.checks.filter((c) => c.type === "missing-real-signal");
      expect(signalChecks).toHaveLength(0);
    });

    it("errors when content does not mention command files present in index", () => {
      const index = makeMinimalIndex({
        scripts: { test: "jest" },
      });
      index.insights = {
        fileRoles: {
          "src/index.ts": "cli-entry",
          "src/commands/deploy.ts": "command",
          "src/commands/build.ts": "command",
        },
        publicApiFiles: [],
        testMap: {},
        commandMap: {},
        dependencyUsage: {},
        defaultExportFiles: [],
        reExportFiles: [],
        typeOnlyImportFiles: [],
        dynamicImportFiles: [],
      };
      // Content mentions CLI entrypoint but NOT command files
      const content = [
        "## Required Agent Workflow",
        "",
        "steps involving src/index.ts but not the command files, run \`npm test\`",
        "",
        "## Overview",
        "",
        "overview",
        "",
        "## Architecture",
        "",
        "architecture",
        "",
        "## Module Map",
        "",
        "modules",
        "",
        "## Codebase Map",
        "",
        "map",
        "",
        "## Testing Map",
        "",
        "tests",
        "",
        "## Dependencies",
        "",
        "deps",
        "",
        "## Public API Surface",
        "",
        "api",
        "",
        "## Project Profile: cli-tooling",
        "",
        "profile",
      ].join("\n");
      const files = [makeFile(".cursor/rules/test.mdc", content)];
      const report = validateSkillQuality(files, "cursor", index);
      const cmdChecks = report.checks.filter(
        (c) => c.type === "missing-real-signal" && c.message.includes("command file"),
      );
      expect(cmdChecks.length).toBe(1);
      expect(cmdChecks[0]!.severity).toBe("error");
    });
  });

  // -- QualityReport structure ------------------------------------------------

  describe("QualityReport structure", () => {
    it("passed is true when there are only warnings", () => {
      const content = "## Overview\n\n## Architecture\n\ncontent";
      const files = [makeFile(".claude/skills/test/SKILL.md", content)];
      const report = validateSkillQuality(files, "claude", null);
      // May have warnings for empty Overview, but passed should be true
      expect(report.passed).toBe(report.errors === 0);
    });

    it("passed is false when there are errors", () => {
      const content = "## Overview\n\n## Overview\n\ncontent";
      const files = [makeFile(".claude/skills/test/SKILL.md", content)];
      const report = validateSkillQuality(files, "claude", null);
      if (report.errors > 0) {
        expect(report.passed).toBe(false);
      }
    });

    it("errors and warnings counts match checks array", () => {
      const files = [makeFile(".claude/skills/test/SKILL.md", "## Overview\n\ncontent")];
      const report = validateSkillQuality(files, "claude", null);
      const actualErrors = report.checks.filter((c) => c.severity === "error").length;
      const actualWarnings = report.checks.filter((c) => c.severity === "warning").length;
      expect(report.errors).toBe(actualErrors);
      expect(report.warnings).toBe(actualWarnings);
    });
  });

  // -- Adapter layout contract (v1.0.17+) ------------------------------------

  describe("adapter-layout-contract", () => {
    const skillSpec = {
      officialDocsUrl: "https://example.com",
      outputKind: "skill" as const,
      workspacePath: ".agents/skills/{projectName}-test/",
      requiredFiles: ["SKILL.md"],
      frontmatterRules: { required: ["description"] },
      sizeLimit: 20000,
    };

    it("passes valid skill layout", () => {
      const files = [
        makeFile(
          ".agents/skills/my-project-test/SKILL.md",
          "---\ndescription: test desc\n---\n\n# Skill",
        ),
      ];
      const report = validateSkillQuality(files, "antigravity", null, skillSpec, "my-project");
      const layoutErrors = report.checks.filter(
        (c) => c.type === "adapter-layout-contract" && c.severity === "error",
      );
      expect(layoutErrors).toHaveLength(0);
    });

    it("errors on missing SKILL.md for skill-style adapter", () => {
      const files = [makeFile(".agents/skills/my-project-test/README.md", "# No SKILL.md here")];
      const report = validateSkillQuality(files, "antigravity", null, skillSpec, "my-project");
      const layoutErrors = report.checks.filter(
        (c) => c.type === "adapter-layout-contract" && c.severity === "error",
      );
      expect(layoutErrors.length).toBeGreaterThan(0);
      expect(layoutErrors.some((c) => c.message.includes("SKILL.md"))).toBe(true);
    });

    it("errors on missing description frontmatter in SKILL.md", () => {
      const files = [
        makeFile(
          ".agents/skills/my-project-test/SKILL.md",
          "---\nname: test\n---\n\n# No description",
        ),
      ];
      const report = validateSkillQuality(files, "antigravity", null, skillSpec, "my-project");
      const missingDesc = report.checks.filter(
        (c) =>
          c.type === "adapter-layout-contract" &&
          c.severity === "error" &&
          c.message.includes("description"),
      );
      expect(missingDesc.length).toBeGreaterThan(0);
    });

    it("errors when SKILL.md has no frontmatter at all", () => {
      const files = [makeFile(".agents/skills/my-project-test/SKILL.md", "# No frontmatter")];
      const report = validateSkillQuality(files, "antigravity", null, skillSpec, "my-project");
      const noFm = report.checks.filter(
        (c) =>
          c.type === "adapter-layout-contract" &&
          c.severity === "error" &&
          c.message.includes("YAML frontmatter"),
      );
      expect(noFm.length).toBeGreaterThan(0);
    });

    it("errors on skill file outside workspace path", () => {
      const files = [
        makeFile(
          ".agents/skills/other-project/SKILL.md",
          "---\ndescription: test\n---\n\n# Wrong dir",
        ),
      ];
      const report = validateSkillQuality(files, "antigravity", null, skillSpec, "my-project");
      const layoutErrors = report.checks.filter(
        (c) =>
          c.type === "adapter-layout-contract" &&
          c.severity === "error" &&
          c.message.includes("must contain workspace"),
      );
      expect(layoutErrors.length).toBeGreaterThan(0);
    });

    it("errors on legacy .antigravity/rules/ path for antigravity adapter", () => {
      const antigravitySpec = {
        officialDocsUrl: "https://antigravity.google/docs/skills",
        outputKind: "skill" as const,
        workspacePath: ".agents/skills/{projectName}-antigravity-best-practices/",
        requiredFiles: ["SKILL.md"],
        frontmatterRules: { required: ["description"] },
        sizeLimit: 20000,
      };
      const files = [
        makeFile(".antigravity/rules/my-project-best-practices.md", "# Legacy antigravity path"),
      ];
      const report = validateSkillQuality(
        files,
        "antigravity",
        null,
        antigravitySpec,
        "my-project",
      );
      const legacyErrors = report.checks.filter(
        (c) =>
          c.type === "adapter-layout-contract" &&
          c.severity === "error" &&
          c.message.includes("legacy"),
      );
      expect(legacyErrors.length).toBeGreaterThan(0);
    });

    it("skips adapter-layout-contract when adapterSpec is not provided (backward compat)", () => {
      const files = [makeFile(".claude/skills/test/SKILL.md", "## Overview\n\ncontent")];
      const report = validateSkillQuality(files, "claude", null);
      const layoutChecks = report.checks.filter((c) => c.type === "adapter-layout-contract");
      expect(layoutChecks).toHaveLength(0);
    });

    it("passes valid rule-style adapter layout", () => {
      const ruleSpec = {
        officialDocsUrl: "https://example.com",
        outputKind: "rule" as const,
        workspacePath: ".cursor/rules/{projectName}-best-practices.mdc",
        requiredFiles: [],
        frontmatterRules: { required: [] },
        sizeLimit: 20000,
      };
      const files = [makeFile(".cursor/rules/my-app-best-practices.mdc", "# Valid rule")];
      const report = validateSkillQuality(files, "cursor", null, ruleSpec, "my-app");
      const layoutErrors = report.checks.filter(
        (c) => c.type === "adapter-layout-contract" && c.severity === "error",
      );
      expect(layoutErrors).toHaveLength(0);
    });
  });

  // -- Risky Unicode ----------------------------------------------------------

  describe("risky unicode", () => {
    it("flags em dash in generated content as error", () => {
      const content = "## Overview\n\nThis is a test \u2014 with em dash.";
      const files = [makeFile(".claude/skills/test/SKILL.md", content)];
      const report = validateSkillQuality(files, "claude", null);
      const unicodeErrors = report.checks.filter(
        (c) => c.type === "risky-unicode" && c.severity === "error",
      );
      expect(unicodeErrors.length).toBe(1);
      expect(unicodeErrors[0]!.message).toContain("em dash");
    });

    it("flags ellipsis in generated content as error", () => {
      const content = "## Architecture\n\nLoading\u2026 please wait.";
      const files = [makeFile(".cursor/rules/test.mdc", content)];
      const report = validateSkillQuality(files, "cursor", null);
      const unicodeErrors = report.checks.filter(
        (c) => c.type === "risky-unicode" && c.severity === "error",
      );
      expect(unicodeErrors.length).toBe(1);
      expect(unicodeErrors[0]!.message).toContain("ellipsis");
    });

    it("flags right arrow in generated content as error", () => {
      const content = "## Commands\n\nRun \u2192 Build \u2192 Deploy";
      const files = [makeFile(".claude/skills/test/SKILL.md", content)];
      const report = validateSkillQuality(files, "claude", null);
      const unicodeErrors = report.checks.filter(
        (c) => c.type === "risky-unicode" && c.severity === "error",
      );
      expect(unicodeErrors.length).toBe(1);
      expect(unicodeErrors[0]!.message).toContain("right arrow");
    });

    it("passes clean ASCII generated content", () => {
      const content = [
        "## Overview",
        "",
        "Project: my-cli v2.0.0 - a CLI tool for automation.",
        "",
        "## Architecture",
        "",
        "- src/cli/ - 3 source file(s)",
        "- src/utils/ - 2 source file(s)",
        "",
        "## Agent Workflow",
        "",
        "1. **Read SKILL.md** - project profile, conventions, pitfalls.",
        "2. Use source index diagnostics before broad scans.",
        "3. Load relevant references.",
      ].join("\n");
      const files = [makeFile(".claude/skills/test/SKILL.md", content)];
      const report = validateSkillQuality(files, "claude", null);
      const unicodeChecks = report.checks.filter((c) => c.type === "risky-unicode");
      expect(unicodeChecks).toHaveLength(0);
    });

    it("flags multiple risky character types in the same file", () => {
      const content =
        "## Overview\n\nEm dash \u2014 here, ellipsis\u2026 there, arrow \u2192 next.";
      const files = [makeFile(".agents/skills/test/SKILL.md", content)];
      const report = validateSkillQuality(files, "codex", null);
      const unicodeErrors = report.checks.filter(
        (c) => c.type === "risky-unicode" && c.severity === "error",
      );
      expect(unicodeErrors.length).toBe(3); // em dash, ellipsis, arrow
    });

    it("counts multiple occurrences of the same character correctly", () => {
      const content = "## Overview\n\nDash \u2014 here \u2014 and \u2014 there.";
      const files = [makeFile(".claude/skills/test/SKILL.md", content)];
      const report = validateSkillQuality(files, "claude", null);
      const unicodeErrors = report.checks.filter(
        (c) => c.type === "risky-unicode" && c.severity === "error",
      );
      expect(unicodeErrors.length).toBe(1);
      expect(unicodeErrors[0]!.message).toContain("3 occurrence(s)");
    });

    it("does not break on empty content", () => {
      const files = [makeFile(".claude/skills/test/SKILL.md", "")];
      const report = validateSkillQuality(files, "claude", null);
      const unicodeChecks = report.checks.filter((c) => c.type === "risky-unicode");
      expect(unicodeChecks).toHaveLength(0);
    });

    it("flags checkmark and ballot x in generated content", () => {
      const content = "## Status\n\nTests: \u2713 passed, \u2717 failed";
      const files = [makeFile(".claude/skills/test/SKILL.md", content)];
      const report = validateSkillQuality(files, "claude", null);
      const unicodeErrors = report.checks.filter(
        (c) => c.type === "risky-unicode" && c.severity === "error",
      );
      expect(unicodeErrors.length).toBe(2);
    });

    it("flags smart quotes in generated content", () => {
      const content =
        "## Overview\n\nUse \u2018single\u2019 and \u201cdouble\u201d quotes carefully.";
      const files = [makeFile(".claude/skills/test/SKILL.md", content)];
      const report = validateSkillQuality(files, "claude", null);
      const unicodeErrors = report.checks.filter(
        (c) => c.type === "risky-unicode" && c.severity === "error",
      );
      expect(unicodeErrors.length).toBe(4); // left single, right single, left double, right double
    });
  });

  // -- Reference Routing quality gate (v1.16.1+) ------------------------------

  describe("reference routing", () => {
    function routingSection(body: string): string {
      return ["## Reference Routing", "", body].join("\n");
    }

    function validTable(): string {
      return [
        "When touching files, load only the relevant references:",
        "",
        "| Directory Pattern | Recommended References |",
        "|---|---|",
        "| `src/cli/`, `src/commands/` | commands, testing-map |",
        "| `src/types/` | public-api, codebase-map |",
        "| Other files | architecture, codebase-map |",
      ].join("\n");
    }

    function makeContent(sectionBody: string): string {
      return [
        "## Required Agent Workflow",
        "",
        "step 1",
        "",
        routingSection(sectionBody),
        "",
        "## Overview",
        "",
        "overview",
      ].join("\n");
    }

    it("passes a well-formed reference routing table", () => {
      const content = makeContent(validTable());
      const files = [makeFile(".claude/skills/test/SKILL.md", content)];
      const report = validateSkillQuality(files, "claude", null);
      const routingErrors = report.checks.filter(
        (c) => c.type === "reference-routing" && c.severity === "error",
      );
      expect(routingErrors).toHaveLength(0);
    });

    it("flags file-looking pattern with trailing slash as error", () => {
      const badTable = [
        "| Directory Pattern | Recommended References |",
        "|---|---|",
        "| `src/index.ts/` | architecture, codebase-map |",
        "| Other files | architecture, codebase-map |",
      ].join("\n");
      const content = makeContent(badTable);
      const files = [makeFile(".cursor/rules/test.mdc", content)];
      const report = validateSkillQuality(files, "cursor", null);
      const routingErrors = report.checks.filter(
        (c) => c.type === "reference-routing" && c.severity === "error",
      );
      expect(routingErrors.length).toBe(1);
      expect(routingErrors[0]!.message).toContain("src/index.ts/");
      expect(routingErrors[0]!.message).toContain("looks like a file path");
    });

    it("flags unknown reference name as error", () => {
      const badTable = [
        "| Directory Pattern | Recommended References |",
        "|---|---|",
        "| `src/utils/` | helpers, foobar |",
        "| Other files | architecture, codebase-map |",
      ].join("\n");
      const content = makeContent(badTable);
      const files = [makeFile(".claude/skills/test/SKILL.md", content)];
      const report = validateSkillQuality(files, "claude", null);
      const routingErrors = report.checks.filter(
        (c) => c.type === "reference-routing" && c.severity === "error",
      );
      expect(routingErrors.length).toBe(2); // "helpers" and "foobar" both unknown
      expect(routingErrors.some((c) => c.message.includes('"helpers"'))).toBe(true);
      expect(routingErrors.some((c) => c.message.includes('"foobar"'))).toBe(true);
    });

    it("flags missing fallback row as error", () => {
      const noFallback = [
        "| Directory Pattern | Recommended References |",
        "|---|---|",
        "| `src/cli/` | commands, testing-map |",
        "| `src/types/` | public-api, codebase-map |",
      ].join("\n");
      const content = makeContent(noFallback);
      const files = [makeFile(".claude/skills/test/SKILL.md", content)];
      const report = validateSkillQuality(files, "claude", null);
      const routingErrors = report.checks.filter(
        (c) => c.type === "reference-routing" && c.severity === "error",
      );
      const fallbackErrors = routingErrors.filter((c) => c.message.includes("fallback"));
      expect(fallbackErrors.length).toBe(1);
    });

    it("flags missing table markup as error", () => {
      const content = makeContent("Just some prose, no table at all.");
      const files = [makeFile(".claude/skills/test/SKILL.md", content)];
      const report = validateSkillQuality(files, "claude", null);
      const routingErrors = report.checks.filter(
        (c) => c.type === "reference-routing" && c.severity === "error",
      );
      expect(routingErrors.length).toBe(1);
      expect(routingErrors[0]!.message).toContain("table missing");
    });

    it("flags missing header columns as error", () => {
      const badHeader = [
        "| Some Column | Another Column |",
        "|---|---|",
        "| `src/cli/` | commands |",
        "| Other files | architecture |",
      ].join("\n");
      const content = makeContent(badHeader);
      const files = [makeFile(".claude/skills/test/SKILL.md", content)];
      const report = validateSkillQuality(files, "claude", null);
      const routingErrors = report.checks.filter(
        (c) => c.type === "reference-routing" && c.severity === "error",
      );
      const headerErrors = routingErrors.filter((c) => c.message.includes("header"));
      expect(headerErrors.length).toBe(1);
    });

    it("warns when row count exceeds cap", () => {
      const rows: string[] = [];
      for (let i = 0; i < 18; i++) {
        rows.push(`| \`src/dir${i}/\` | architecture, codebase-map |`);
      }
      const bigTable = [
        "| Directory Pattern | Recommended References |",
        "|---|---|",
        ...rows,
        "| Other files | architecture, codebase-map |",
      ].join("\n");
      const content = makeContent(bigTable);
      const files = [makeFile(".claude/skills/test/SKILL.md", content)];
      const report = validateSkillQuality(files, "claude", null);
      const routingWarnings = report.checks.filter(
        (c) => c.type === "reference-routing" && c.severity === "warning",
      );
      expect(routingWarnings.length).toBe(1);
      expect(routingWarnings[0]!.message).toContain("19 data rows");
    });

    it("returns no routing checks when Reference Routing section is absent", () => {
      const content = [
        "## Required Agent Workflow",
        "",
        "steps",
        "",
        "## Overview",
        "",
        "overview",
      ].join("\n");
      const files = [makeFile(".claude/skills/test/SKILL.md", content)];
      const report = validateSkillQuality(files, "claude", null);
      const routingChecks = report.checks.filter((c) => c.type === "reference-routing");
      expect(routingChecks).toHaveLength(0);
    });

    it("treats Other files row reference names as exempt from validation", () => {
      const fallbackTable = [
        "| Directory Pattern | Recommended References |",
        "|---|---|",
        "| `src/cli/` | commands, testing-map |",
        "| Other files | architecture, codebase-map |",
      ].join("\n");
      const content = makeContent(fallbackTable);
      const files = [makeFile(".claude/skills/test/SKILL.md", content)];
      const report = validateSkillQuality(files, "claude", null);
      const routingErrors = report.checks.filter((c) => c.type === "reference-routing");
      expect(routingErrors).toHaveLength(0);
    });
  });

  // -- Agent workflow contract (v1.19+) ----------------------------------------

  describe("agent workflow contract (v1.19+)", () => {
    const VALID_REF_ROUTING = [
      "| Directory Pattern | Recommended References |",
      "|---|---|",
      "| `src/cli/` | commands, testing-map |",
      "| Other files | architecture, codebase-map |",
    ].join("\n");

    function makeSingleFileSkillWithWorkflow(workflowBody: string): string {
      return [
        "## Required Agent Workflow",
        "",
        workflowBody,
        "",
        "## Reference Routing",
        "",
        VALID_REF_ROUTING,
        "",
        "## Overview",
        "",
        "overview",
        "",
        "## Architecture",
        "",
        "architecture",
        "",
        "## Module Map",
        "",
        "module map",
        "",
        "## Codebase Map",
        "",
        "codebase map",
        "",
        "## Testing Map",
        "",
        "testing map",
        "",
        "## Dependencies",
        "",
        "dependencies",
        "",
        "## Public API Surface",
        "",
        "public api",
        "",
        "## Project Profile: cli-tooling",
        "",
        "profile",
      ].join("\n");
    }

    const VALID_WORKFLOW = [
      "Before writing any code for **test**, follow these steps in order:",
      "",
      "1. **Read SKILL.md** - project profile, conventions, pitfalls.",
      "2. **Read local agent instructions**: `AGENTS.md`, `CLAUDE.md`.",
      "3. **Check parser health first**:",
      "   - `mp-sentinel indexing --health --index-format json` - index health overview",
      "4. **Drilldown when health suggests issues**:",
      "   - `mp-sentinel indexing --recovered --index-format json` - fallback recoveries",
      "   - `mp-sentinel indexing --parse-errors --index-format json` - hard parse errors",
      "5. **Before editing**, use source index diagnostics:",
      "   - `mp-sentinel indexing --agent-context <file> --index-format json` - symbols, imports, dependents",
      "   - `mp-sentinel indexing --explain-index <file> --index-format json` - imports, dependents, symbols",
      "   - `mp-sentinel indexing --find-symbol <name> --index-format json` - search for symbols",
      "   - `mp-sentinel indexing --find-import <pkg> --index-format json` - search for imports",
      "   - `mp-sentinel indexing --stats --index-format json` - index summary",
      "   - `mp-sentinel --explain-context --format json --files <file>` - review context enrichment",
      "6. **Load only the relevant references**",
      "7. **Respect the profile rules** - each profile has specific review pitfalls listed below.",
    ].join("\n");

    it("returns zero agent-workflow-contract errors for valid workflow", () => {
      const content = makeSingleFileSkillWithWorkflow(VALID_WORKFLOW);
      const files = [makeFile(".cursor/rules/test.mdc", content)];
      const report = validateSkillQuality(files, "cursor", null);
      const errors = report.checks.filter(
        (c) => c.type === "agent-workflow-contract" && c.severity === "error",
      );
      expect(errors).toHaveLength(0);
    });

    it("flags missing --agent-context as error", () => {
      const body = VALID_WORKFLOW.replace(
        "`mp-sentinel indexing --agent-context <file> --index-format json`",
        "`mp-sentinel indexing --some-other`",
      );
      const content = makeSingleFileSkillWithWorkflow(body);
      const files = [makeFile(".cursor/rules/test.mdc", content)];
      const report = validateSkillQuality(files, "cursor", null);
      const errors = report.checks.filter(
        (c) => c.type === "agent-workflow-contract" && c.severity === "error",
      );
      expect(errors.length).toBe(1);
      expect(errors[0]!.message).toContain("agent-context");
    });

    it("flags missing --explain-index as error", () => {
      const body = VALID_WORKFLOW.replace(
        "`mp-sentinel indexing --explain-index <file> --index-format json`",
        "`mp-sentinel indexing --some-other`",
      );
      const content = makeSingleFileSkillWithWorkflow(body);
      const files = [makeFile(".cursor/rules/test.mdc", content)];
      const report = validateSkillQuality(files, "cursor", null);
      const errors = report.checks.filter(
        (c) => c.type === "agent-workflow-contract" && c.severity === "error",
      );
      expect(errors.length).toBe(1);
      expect(errors[0]!.message).toContain("explain-index");
    });

    it("flags missing --find-symbol as error", () => {
      const body = VALID_WORKFLOW.replace(
        "`mp-sentinel indexing --find-symbol <name> --index-format json`",
        "`mp-sentinel indexing --some-other`",
      );
      const content = makeSingleFileSkillWithWorkflow(body);
      const files = [makeFile(".cursor/rules/test.mdc", content)];
      const report = validateSkillQuality(files, "cursor", null);
      const errors = report.checks.filter(
        (c) => c.type === "agent-workflow-contract" && c.severity === "error",
      );
      expect(errors.length).toBe(1);
      expect(errors[0]!.message).toContain("find-symbol");
    });

    it("flags missing --find-import as error", () => {
      const body = VALID_WORKFLOW.replace(
        "`mp-sentinel indexing --find-import <pkg> --index-format json`",
        "`mp-sentinel indexing --some-other`",
      );
      const content = makeSingleFileSkillWithWorkflow(body);
      const files = [makeFile(".cursor/rules/test.mdc", content)];
      const report = validateSkillQuality(files, "cursor", null);
      const errors = report.checks.filter(
        (c) => c.type === "agent-workflow-contract" && c.severity === "error",
      );
      expect(errors.length).toBe(1);
      expect(errors[0]!.message).toContain("find-import");
    });

    it("flags missing --stats as error", () => {
      const body = VALID_WORKFLOW.replace(
        "`mp-sentinel indexing --stats --index-format json`",
        "`mp-sentinel indexing --some-other`",
      );
      const content = makeSingleFileSkillWithWorkflow(body);
      const files = [makeFile(".cursor/rules/test.mdc", content)];
      const report = validateSkillQuality(files, "cursor", null);
      const errors = report.checks.filter(
        (c) => c.type === "agent-workflow-contract" && c.severity === "error",
      );
      expect(errors.length).toBe(1);
      expect(errors[0]!.message).toContain("stats");
    });

    it("flags missing --explain-context as error", () => {
      const body = VALID_WORKFLOW.replace(
        "`mp-sentinel --explain-context --format json --files <file>`",
        "`mp-sentinel --some-other`",
      );
      const content = makeSingleFileSkillWithWorkflow(body);
      const files = [makeFile(".cursor/rules/test.mdc", content)];
      const report = validateSkillQuality(files, "cursor", null);
      const errors = report.checks.filter(
        (c) => c.type === "agent-workflow-contract" && c.severity === "error",
      );
      expect(errors.length).toBe(1);
      expect(errors[0]!.message).toContain("explain-context");
    });

    it("flags missing --index-format json on one indexing command as error", () => {
      const body = VALID_WORKFLOW.replace(
        "`mp-sentinel indexing --find-symbol <name> --index-format json`",
        "`mp-sentinel indexing --find-symbol <name>`",
      );
      const content = makeSingleFileSkillWithWorkflow(body);
      const files = [makeFile(".cursor/rules/test.mdc", content)];
      const report = validateSkillQuality(files, "cursor", null);
      const errors = report.checks.filter(
        (c) => c.type === "agent-workflow-contract" && c.severity === "error",
      );
      expect(errors.length).toBe(1);
      expect(errors[0]!.message).toContain("find-symbol");
      expect(errors[0]!.message).toContain("index-format json");
    });

    it("flags missing --format json on --explain-context as error", () => {
      const body = VALID_WORKFLOW.replace(
        "`mp-sentinel --explain-context --format json --files <file>`",
        "`mp-sentinel --explain-context --files <file>`",
      );
      const content = makeSingleFileSkillWithWorkflow(body);
      const files = [makeFile(".cursor/rules/test.mdc", content)];
      const report = validateSkillQuality(files, "cursor", null);
      const errors = report.checks.filter(
        (c) => c.type === "agent-workflow-contract" && c.severity === "error",
      );
      expect(errors.length).toBe(1);
      expect(errors[0]!.message).toContain("explain-context");
      expect(errors[0]!.message).toContain("format json");
    });

    it("flags only the indexing command that lacks --index-format json (regression)", () => {
      const body = VALID_WORKFLOW.replace(
        "`mp-sentinel indexing --find-symbol <name> --index-format json`",
        "`mp-sentinel indexing --find-symbol <name>`",
      );
      const content = makeSingleFileSkillWithWorkflow(body);
      const files = [makeFile(".cursor/rules/test.mdc", content)];
      const report = validateSkillQuality(files, "cursor", null);
      const errors = report.checks.filter(
        (c) => c.type === "agent-workflow-contract" && c.severity === "error",
      );
      expect(errors.length).toBe(1);
      expect(errors[0]!.message).toContain("find-symbol");
      expect(errors[0]!.message).toContain("index-format json");
      // Other commands still have --index-format json and should not error
      const otherFailures = errors.filter((c) => !c.message.includes("find-symbol"));
      expect(otherFailures).toHaveLength(0);
    });

    // v1.28.0: new parser diagnostic commands
    it("flags missing --health as error", () => {
      const body = VALID_WORKFLOW.replace(
        "`mp-sentinel indexing --health --index-format json`",
        "`mp-sentinel indexing --some-other`",
      );
      const content = makeSingleFileSkillWithWorkflow(body);
      const files = [makeFile(".cursor/rules/test.mdc", content)];
      const report = validateSkillQuality(files, "cursor", null);
      const errors = report.checks.filter(
        (c) => c.type === "agent-workflow-contract" && c.severity === "error",
      );
      expect(errors.length).toBe(1);
      expect(errors[0]!.message).toContain("health");
    });

    it("flags missing --recovered as error", () => {
      const body = VALID_WORKFLOW.replace(
        "`mp-sentinel indexing --recovered --index-format json`",
        "`mp-sentinel indexing --some-other`",
      );
      const content = makeSingleFileSkillWithWorkflow(body);
      const files = [makeFile(".cursor/rules/test.mdc", content)];
      const report = validateSkillQuality(files, "cursor", null);
      const errors = report.checks.filter(
        (c) => c.type === "agent-workflow-contract" && c.severity === "error",
      );
      expect(errors.length).toBe(1);
      expect(errors[0]!.message).toContain("recovered");
    });

    it("flags missing --parse-errors as error", () => {
      const body = VALID_WORKFLOW.replace(
        "`mp-sentinel indexing --parse-errors --index-format json`",
        "`mp-sentinel indexing --some-other`",
      );
      const content = makeSingleFileSkillWithWorkflow(body);
      const files = [makeFile(".cursor/rules/test.mdc", content)];
      const report = validateSkillQuality(files, "cursor", null);
      const errors = report.checks.filter(
        (c) => c.type === "agent-workflow-contract" && c.severity === "error",
      );
      expect(errors.length).toBe(1);
      expect(errors[0]!.message).toContain("parse-errors");
    });
  });

  // -- Adapter spec completeness (v1.14+) -------------------------------------

  describe("validateAdapterSpec (spec completeness)", () => {
    it("every primary adapter has a complete spec", () => {
      const primaryAdapters = ADAPTER_REGISTRY.filter((a) => a.id !== "generic");
      expect(primaryAdapters.length).toBeGreaterThan(0);

      for (const adapter of primaryAdapters) {
        const issues = validateAdapterSpec(adapter);
        expect(issues).toEqual([]);
      }
    });

    it("primary adapters have valid officialDocsUrl", () => {
      const primaryAdapters = ADAPTER_REGISTRY.filter((a) => a.id !== "generic");
      for (const adapter of primaryAdapters) {
        expect(adapter.spec.officialDocsUrl).toBeTruthy();
        expect(adapter.spec.officialDocsUrl).toMatch(/^https:\/\//);
      }
    });

    it("primary adapters have workspacePath with {projectName}", () => {
      const primaryAdapters = ADAPTER_REGISTRY.filter((a) => a.id !== "generic");
      for (const adapter of primaryAdapters) {
        expect(adapter.spec.workspacePath).toContain("{projectName}");
      }
    });

    it("skill adapters have SKILL.md in requiredFiles", () => {
      const skillAdapters = ADAPTER_REGISTRY.filter(
        (a) => a.spec.outputKind === "skill" && a.id !== "generic",
      );
      expect(skillAdapters.length).toBeGreaterThan(0);
      for (const adapter of skillAdapters) {
        expect(adapter.spec.requiredFiles).toContain("SKILL.md");
      }
    });

    it("rule adapters have file extension in workspacePath", () => {
      const ruleAdapters = ADAPTER_REGISTRY.filter(
        (a) => a.spec.outputKind === "rule" && a.id !== "generic",
      );
      expect(ruleAdapters.length).toBeGreaterThan(0);
      for (const adapter of ruleAdapters) {
        expect(adapter.spec.workspacePath).toMatch(/\.[a-z]+$/);
      }
    });

    it("generic adapter is skipped by validateAdapterSpec", () => {
      const generic = ADAPTER_REGISTRY.find((a) => a.id === "generic")!;
      const issues = validateAdapterSpec(generic);
      expect(issues).toEqual([]);
    });

    it("validateAllAdapterSpecs returns zero issues for current registry", () => {
      const issues = validateAllAdapterSpecs(ADAPTER_REGISTRY);
      expect(issues).toEqual([]);
    });

    it("flags missing officialDocsUrl on a primary adapter", () => {
      const badAdapter = {
        ...ADAPTER_REGISTRY.find((a) => a.id === "claude")!,
        id: "bad" as AgentAdapterId,
        spec: {
          ...ADAPTER_REGISTRY.find((a) => a.id === "claude")!.spec,
          officialDocsUrl: "",
        },
      };
      const issues = validateAdapterSpec(badAdapter);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some((i) => i.includes("officialDocsUrl"))).toBe(true);
    });

    it("flags missing SKILL.md in requiredFiles for a skill adapter", () => {
      const badAdapter = {
        ...ADAPTER_REGISTRY.find((a) => a.id === "claude")!,
        id: "bad" as AgentAdapterId,
        spec: {
          ...ADAPTER_REGISTRY.find((a) => a.id === "claude")!.spec,
          requiredFiles: [],
        },
      };
      const issues = validateAdapterSpec(badAdapter);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some((i) => i.includes("SKILL.md"))).toBe(true);
    });

    it("flags missing {projectName} in workspacePath", () => {
      const badAdapter = {
        ...ADAPTER_REGISTRY.find((a) => a.id === "claude")!,
        id: "bad" as AgentAdapterId,
        spec: {
          ...ADAPTER_REGISTRY.find((a) => a.id === "claude")!.spec,
          workspacePath: ".claude/skills/best-practices/",
        },
      };
      const issues = validateAdapterSpec(badAdapter);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some((i) => i.includes("projectName"))).toBe(true);
    });

    it("flags rule workspacePath without file extension", () => {
      const badAdapter = {
        ...ADAPTER_REGISTRY.find((a) => a.id === "cursor")!,
        id: "bad" as AgentAdapterId,
        spec: {
          ...ADAPTER_REGISTRY.find((a) => a.id === "cursor")!.spec,
          workspacePath: ".cursor/rules/{projectName}-best-practices",
        },
      };
      const issues = validateAdapterSpec(badAdapter);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some((i) => i.includes("file extension"))).toBe(true);
    });
  });
});
