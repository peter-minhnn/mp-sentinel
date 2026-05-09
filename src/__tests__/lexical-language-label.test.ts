/**
 * Lexical language label test — asserts that Svelte/Vue files are
 * labelled with their correct language in the source index.
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSourceIndex } from "../commands/indexing.js";

async function createSvelteFixture(baseDir: string): Promise<void> {
  await mkdir(join(baseDir, "src", "routes"), { recursive: true });
  await mkdir(join(baseDir, "src", "lib"), { recursive: true });

  await writeFile(
    join(baseDir, "package.json"),
    JSON.stringify({
      name: "lang-label-test",
      version: "1.0.0",
      scripts: { dev: "vite dev" },
      dependencies: { svelte: "^5.0.0", "@sveltejs/kit": "^2.0.0" },
    }),
  );

  await writeFile(
    join(baseDir, "src", "routes", "+page.svelte"),
    '<script lang="ts">\n  import { onMount } from "svelte";\n  let count = $state(0);\n<\/script>\n\n<main>\n  <h1>Hello</h1>\n</main>',
  );

  await writeFile(
    join(baseDir, "src", "lib", "store.ts"),
    'export function hello() { return "hello"; }\n',
  );
}

describe("lexical language label", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mp-sentinel-lang-label-"));
    await createSvelteFixture(tmpDir);

    // Clear any cached index from previous runs
    await rm(join(tmpDir, ".mp-sentinel-cache"), { recursive: true, force: true }).catch(() => {});
  }, 15000);

  afterAll(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it("assigns language 'svelte' to .svelte files in the source index", async () => {
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

    expect(index).not.toBeNull();
    const svelteFiles = index!.files.filter((f) => f.path.endsWith(".svelte"));
    expect(svelteFiles.length).toBeGreaterThan(0);

    for (const f of svelteFiles) {
      expect(f.language).toBe("svelte");
    }
  });

  it("keeps language 'typescript' for .ts files", async () => {
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

    expect(index).not.toBeNull();
    const tsFiles = index!.files.filter((f) => f.path.endsWith(".ts"));
    for (const f of tsFiles) {
      expect(f.language).toBe("typescript");
    }
  });
});
