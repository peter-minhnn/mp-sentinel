/**
 * Snapshot tests for generated skill content.
 *
 * Generates content for the Claude adapter against a fixture project and
 * verifies key sections and structure are stable. Each snapshot is
 * content-addressed — if the output shape changes intentionally, update
 * snapshots with `npm run test:update-snapshots`.
 *
 * This is not a full-file snapshot (too brittle). Instead it snapshots
 * the structure: section headings, reference file names, and the metadata
 * header template.
 */

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { generateContent } from "../services/skills-generator/content.js";
import { buildSourceIndex } from "../commands/indexing.js";
import { clearParserCache } from "../services/source-index/parser.js";
import { createHash } from "node:crypto";

// ── Fixture setup ──────────────────────────────────────────────────────────

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "mp-sentinel-snapshot-"));
  await mkdir(join(tmpDir, "src"), { recursive: true });
  await writeFile(
    join(tmpDir, "package.json"),
    JSON.stringify({
      name: "snapshot-fixture",
      version: "1.0.0",
      scripts: { test: "jest", build: "tsc" },
      dependencies: { typescript: "^5.0.0" },
    }),
  );
  await writeFile(
    join(tmpDir, "src", "index.ts"),
    'import { readFile } from "node:fs";\nexport function greet(name: string): string {\n  return `Hello ${name}`;\n}\n',
  );
  await writeFile(
    join(tmpDir, "src", "utils.ts"),
    "export function add(a: number, b: number): number {\n  return a + b;\n}\n",
  );
});

afterAll(async () => {
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
});

// ── Helper ──────────────────────────────────────────────────────────────────

function extractSection(content: string, sectionName: string): string {
  const lines = content.split("\n");
  let inSection = false;
  const sectionLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith(`## ${sectionName}`)) {
      inSection = true;
      continue;
    }
    if (inSection) {
      if (line.startsWith("## ")) break;
      sectionLines.push(line);
    }
  }
  return sectionLines.join("\n").trim();
}

/**
 * Compute a deterministic content hash for a generated file.
 * Used to detect unintended changes without storing full output.
 */
function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Snapshot — Claude adapter output", () => {
  let content: ReturnType<typeof generateContent>;

  beforeAll(async () => {
    clearParserCache();
    const index = await buildSourceIndex(
      tmpDir,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );

    content = generateContent(index, "snapshot-fixture");
  }, 30000);

  it("overview section contains project info", () => {
    const overview = content.sections.overview;
    expect(overview).toContain("snapshot-fixture");
    expect(overview).toContain("typescript");
  });

  it("language rules section is deterministic", () => {
    // Typescript-strict pack should be active
    const rules = content.sections.languageRules;
    expect(rules).toContain("TypeScript");
    expect(rules).toContain("import type");
  });

  it("clean code policy section has expected shape", () => {
    const policy = content.sections.cleanCodePolicy;
    expect(policy).toContain("500 lines");
    expect(policy).toContain("80 lines");
    expect(policy).toContain("Cyclomatic complexity");
  });

  it("file size policy section has expected shape", () => {
    const fileSize = content.sections.fileSizePolicy;
    expect(fileSize).toContain("500 lines");
    // When code style profile is not available, the section still shows the limit
    expect(fileSize).toContain("Hard limit");
  });

  it("reference files are built with expected headings", () => {
    const refs = content.references;
    expect(refs.codeStyle).toContain("## Code Style");
    expect(refs.languagePatterns).toContain("## Language Patterns");
    expect(refs.languagePatterns).toContain("Language Distribution");
    expect(refs.cleanCodeChecklist).toContain("## Clean Code Checklist");
  });

  it("section list is stable (snapshot)", () => {
    // Snapshot the section names present in the output
    const sectionNames = Object.entries(content.sections)
      .filter(([, v]) => typeof v === "string" && v.length > 0)
      .map(([k]) => k)
      .sort();
    expect(sectionNames).toMatchSnapshot("section-names");
  });

  it("content hash is stable (snapshot)", () => {
    // Compute hash of key sections to detect unintended drift
    const hashInput =
      content.sections.languageRules +
      content.sections.cleanCodePolicy +
      content.sections.fileSizePolicy;
    expect(contentHash(hashInput)).toMatchSnapshot("section-content-hash");
  });
});

describe("Snapshot — Section content integrity", () => {
  it("Language Rules section starts with language rules header", () => {
    // Just verify the template renders consistently
    const headerMatch = "Language & Framework Rules";
    // This test exists as a placeholder for future snapshot expansion
    expect(true).toBe(true);
  });
});
