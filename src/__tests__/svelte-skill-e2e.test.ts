/**
 * Svelte fixture E2E test — validates that create-skills produces
 * language-appropriate rules for a Svelte project.
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateContent } from "../services/skills-generator/content.js";
import { selectActiveRulePacks } from "../services/skills-generator/rule-packs/index.js";
import { getAdapter } from "../services/skills-generator/registry.js";
import { buildSourceIndex } from "../commands/indexing.js";
import { clearParserCache } from "../services/source-index/parser.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

async function createSvelteFixture(baseDir: string): Promise<void> {
  await mkdir(join(baseDir, "src", "routes"), { recursive: true });
  await mkdir(join(baseDir, "src", "lib"), { recursive: true });

  await writeFile(
    join(baseDir, "package.json"),
    JSON.stringify({
      name: "svelte-fixture",
      version: "1.0.0",
      scripts: { dev: "vite dev", build: "vite build" },
      dependencies: { svelte: "^5.0.0", "@sveltejs/kit": "^2.0.0" },
    }),
  );

  await writeFile(
    join(baseDir, "src", "routes", "+page.svelte"),
    '<script lang="ts">\n  import { onMount } from "svelte";\n  import { base } from "$app/paths";\n  let count = $state(0);\n  function handleClick() { count++; }\n<\/script>\n\n<main>\n  <h1>Hello</h1>\n  <button on:click={handleClick}>{count}</button>\n</main>',
  );

  await writeFile(
    join(baseDir, "src", "lib", "store.ts"),
    'export function hello() { return "hello from svelte"; }\n',
  );
}

describe("Svelte project — deterministic rule packs", () => {
  it("selectActiveRulePacks includes Svelte rules for a Svelte project", () => {
    const langProfile = {
      dominant: "svelte" as const,
      secondary: ["typescript"],
      distribution: { svelte: 2, typescript: 1 },
      indexableShare: 1 / 3,
      nonIndexableHotspots: ["src/svelte"],
    };

    const selection = selectActiveRulePacks({
      langProfile,
      frameworks: ["svelte", "sveltekit"],
      deps: { svelte: "^5.0.0", "@sveltejs/kit": "^2.0.0" },
    });

    const sveltePack = selection.packs.find((p) => p.id === "svelte");
    expect(sveltePack).toBeDefined();
    expect(sveltePack!.rules.length).toBeGreaterThanOrEqual(7);
    const hasImportRule = sveltePack!.rules.some(
      (r) => r.text.includes("import") && r.text.includes("script"),
    );
    expect(hasImportRule).toBe(true);
  });
});

describe("Svelte fixture — generated SKILL.md", () => {
  let tmpDir: string;
  let content: ReturnType<typeof generateContent>;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mp-sentinel-svelte-skill-"));
    await createSvelteFixture(tmpDir);

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

    content = generateContent(index, "svelte-fixture");
  }, 30000);

  afterAll(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("SKILL.md ## Language & Framework Rules contains Svelte rules", () => {
    const section = content.sections.languageRules;
    expect(section).toContain("Svelte Rules");
    expect(section).toContain("import");
    expect(section).toContain("<script>");
  });

  it("SKILL.md ## Language & Framework Rules mentions import placement rule", () => {
    const section = content.sections.languageRules;
    expect(section).toContain("import");
    expect(section).toContain("<script>");
  });

  it("SKILL.md ## Clean Code Policy section exists", () => {
    const section = content.sections.cleanCodePolicy;
    expect(section).toContain("## Clean Code Policy");
    expect(section).toContain("500 lines");
  });

  it("SKILL.md ## File Size Policy section exists", () => {
    const section = content.sections.fileSizePolicy;
    expect(section).toContain("## File Size Policy");
  });

  it("overview shows Svelte as the dominant language", () => {
    const section = content.sections.overview;
    expect(section).toContain("svelte");
  });

  it("references are built correctly", () => {
    const refs = content.references;
    expect(refs.languagePatterns).toContain("Svelte");
    expect(refs.languagePatterns).toContain("Language Distribution");
    expect(refs.codeStyle).toContain("## Code Style");
  });
});

describe("Svelte fixture — adapter output", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mp-sentinel-svelte-adapter-"));
    await createSvelteFixture(tmpDir);

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

    clearParserCache();
    const index2 = await buildSourceIndex(
      tmpDir,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );

    const adapter = getAdapter("claude")!;
    const files = await adapter.generate(index2, {
      projectRoot: tmpDir,
      projectName: "svelte-fixture",
      force: false,
    });

    const codeStyleRef = files.find((f) => f.outputPath.includes("code-style.md"));
    expect(codeStyleRef).toBeDefined();
    expect(codeStyleRef!.content).toContain("Code Style");

    const langPatternsRef = files.find((f) => f.outputPath.includes("language-patterns.md"));
    expect(langPatternsRef).toBeDefined();
    expect(langPatternsRef!.content).toContain("Language Distribution");

    const checklistRef = files.find((f) => f.outputPath.includes("clean-code-checklist.md"));
    expect(checklistRef).toBeDefined();
    expect(checklistRef!.content).toContain("Clean Code Checklist");
  }, 30000);

  afterAll(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("Claude adapter writes reference files", () => {
    // Assertions are in beforeAll to avoid perf overhead
    expect(true).toBe(true);
  });
});
