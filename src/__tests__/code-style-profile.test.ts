/**
 * Tests for CodeStyleProfile detection
 */

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "@jest/globals";
import { detectCodeStyleProfile } from "../services/skills-generator/code-style-profile.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mp-sentinel-csp-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs) {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
  tempDirs.length = 0;
});

function makeMinimalIndex(
  files: Array<{ path: string; symbols?: any[]; imports?: any[]; exports?: any[] }>,
) {
  return {
    schemaVersion: "1.2" as const,
    generatedAt: "",
    toolVersion: "",
    project: {
      packageName: "test",
      dependencies: {},
      devDependencies: {},
      detectedFrameworks: [],
    },
    files: files.map((f) => ({
      path: f.path,
      language: "typescript" as const,
      sha256: "",
      sizeBytes: 0,
      mtimeMs: 0,
      imports: f.imports ?? [],
      exports: f.exports ?? [],
      symbols: f.symbols ?? [],
    })),
    stats: {
      totalFiles: files.length,
      indexedFiles: files.length,
      skippedFiles: 0,
      parseErrors: 0,
    },
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("detectCodeStyleProfile", () => {
  it("detects 2-space indent and single quotes", async () => {
    const dir = await makeTempDir();
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(
      join(dir, "src", "index.ts"),
      [
        "function hello() {",
        "  const name = 'world';",
        "  return name;",
        "}",
        "",
        "export default hello;",
      ].join("\n"),
    );

    const index = makeMinimalIndex([
      { path: "src/index.ts", symbols: [{ name: "hello", type: "function", line: 1, column: 0 }] },
    ]);

    const profile = await detectCodeStyleProfile(dir, index as any);
    expect(profile.indent).toBe("2-spaces");
    expect(profile.singleQuoteRatio).toBeGreaterThan(0.5);
  });

  it("detects 4-space indent and double quotes", async () => {
    const dir = await makeTempDir();
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(
      join(dir, "src", "utils.ts"),
      [
        "function greet(name: string): string {",
        '    return "Hello, " + name;',
        "}",
        "",
        "export { greet };",
      ].join("\n"),
    );

    const index = makeMinimalIndex([
      { path: "src/utils.ts", symbols: [{ name: "greet", type: "function", line: 1, column: 0 }] },
    ]);

    const profile = await detectCodeStyleProfile(dir, index as any);
    expect(profile.indent).toBe("4-spaces");
    expect(profile.singleQuoteRatio).toBeLessThan(0.5);
  });

  it("detects tab indentation", async () => {
    const dir = await makeTempDir();
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(
      join(dir, "src", "app.ts"),
      [
        "function render(): void {",
        "\tconst el = document.createElement('div');",
        "\tel.textContent = 'hello';",
        "\treturn el;",
        "}",
      ].join("\n"),
    );

    const index = makeMinimalIndex([
      { path: "src/app.ts", symbols: [{ name: "render", type: "function", line: 1, column: 0 }] },
    ]);

    const profile = await detectCodeStyleProfile(dir, index as any);
    expect(profile.indent).toBe("tab");
  });

  it("detects formatter configs", async () => {
    const dir = await makeTempDir();
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "index.ts"), "const x = 1;\n");
    await writeFile(join(dir, ".prettierrc"), JSON.stringify({ singleQuote: true }));
    await writeFile(join(dir, ".editorconfig"), "root = true\n");

    const index = makeMinimalIndex([{ path: "src/index.ts" }]);

    const profile = await detectCodeStyleProfile(dir, index as any);
    expect(profile.formatterConfigs).toContain(".prettierrc");
    expect(profile.formatterConfigs).toContain(".editorconfig");
  });

  it("reports oversized files", async () => {
    const dir = await makeTempDir();
    await mkdir(join(dir, "src"), { recursive: true });

    // Create a large file with >500 lines of symbols
    const largeFile = Array.from({ length: 600 }, (_, i) => `export const fn${i} = () => ${i};`);
    await writeFile(join(dir, "src", "huge.ts"), largeFile.join("\n"));

    const symbols = Array.from({ length: 600 }, (_, i) => ({
      name: `fn${i}`,
      type: "variable" as const,
      line: i + 1,
      column: 0,
    }));

    const index = makeMinimalIndex([
      { path: "src/huge.ts", symbols },
      { path: "src/small.ts", symbols: [{ name: "x", type: "variable", line: 1, column: 0 }] },
    ]);

    const profile = await detectCodeStyleProfile(dir, index as any);
    expect(profile.oversizedFiles.length).toBeGreaterThan(0);
    expect(profile.oversizedFiles[0]!.path).toBe("src/huge.ts");
    expect(profile.oversizedFiles[0]!.lines).toBeGreaterThan(500);
  });

  it("handles empty project", async () => {
    const dir = await makeTempDir();
    const index = makeMinimalIndex([]);

    const profile = await detectCodeStyleProfile(dir, index as any);
    expect(profile.indent).toBe("unknown");
    expect(profile.formatterConfigs).toEqual([]);
    expect(profile.oversizedFiles).toEqual([]);
    expect(profile.singleQuoteRatio).toBe(0.5);
    expect(profile.semicolonRatio).toBe(0.5);
  });

  it("detects svelte import outside script", async () => {
    const dir = await makeTempDir();
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(
      join(dir, "src", "Component.svelte"),
      [
        '<script lang="ts">',
        "  import { onMount } from 'svelte';",
        "  let count = 0;",
        "</script>",
        "",
        "<button on:click={() => count++}>{count}</button>",
      ].join("\n"),
    );

    const index = makeMinimalIndex([{ path: "src/Component.svelte" }]);

    const profile = await detectCodeStyleProfile(dir, index as any);
    // All imports are inside script, so ratio should be 0
    expect(profile.svelteImportOutsideScriptRatio).toBe(0);
  });

  it("computes file size percentiles", async () => {
    const dir = await makeTempDir();
    await mkdir(join(dir, "src"), { recursive: true });

    // Create files with varying sizes
    await writeFile(join(dir, "src", "small.ts"), "export const a = 1;\n");
    await writeFile(
      join(dir, "src", "medium.ts"),
      Array.from({ length: 100 }, (_, i) => `export const fn${i} = () => ${i};`).join("\n"),
    );
    await writeFile(
      join(dir, "src", "large.ts"),
      Array.from({ length: 300 }, (_, i) => `export const fn${i} = () => ${i};`).join("\n"),
    );

    const index = makeMinimalIndex([
      {
        path: "src/small.ts",
        symbols: [{ name: "a", type: "variable" as const, line: 1, column: 0 }],
      },
      {
        path: "src/medium.ts",
        symbols: Array.from({ length: 100 }, (_, i) => ({
          name: `fn${i}`,
          type: "variable" as const,
          line: i + 1,
          column: 0,
        })),
      },
      {
        path: "src/large.ts",
        symbols: Array.from({ length: 300 }, (_, i) => ({
          name: `fn${i}`,
          type: "variable" as const,
          line: i + 1,
          column: 0,
        })),
      },
    ]);

    const profile = await detectCodeStyleProfile(dir, index as any);
    expect(profile.p50FileLines).toBeGreaterThan(0);
    expect(profile.p95FileLines).toBeGreaterThanOrEqual(profile.p50FileLines);
    expect(profile.maxFileLines).toBeGreaterThanOrEqual(profile.p95FileLines);
  });

  it("detects semicolon usage", async () => {
    const dir = await makeTempDir();
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(
      join(dir, "src", "semicolons.ts"),
      [
        "const a = 1;",
        "const b = 2;",
        "const c = 3;",
        'console.log("hello");',
        "function x() {",
        "  return a + b;",
        "}",
      ].join("\n"),
    );

    const index = makeMinimalIndex([
      {
        path: "src/semicolons.ts",
        symbols: [{ name: "x", type: "function" as const, line: 5, column: 0 }],
      },
    ]);

    const profile = await detectCodeStyleProfile(dir, index as any);
    expect(profile.semicolonRatio).toBeGreaterThan(0.5);
  });
});
