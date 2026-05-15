import { afterEach, describe, expect, it } from "@jest/globals";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readManifest } from "../services/source-index/manifests/registry.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mp-sentinel-manifest-jsonc-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("node manifest JSONC parsing", () => {
  it("preserves tsconfig paths when aliases and globs contain slash-star strings", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0", dependencies: {} }),
    );
    await writeFile(
      join(cwd, "tsconfig.json"),
      [
        "{",
        "  // aliases should survive JSONC stripping",
        '  "compilerOptions": {',
        '    "baseUrl": ".",',
        '    "paths": {',
        '      "@/*": ["./src/*"],',
        "    },",
        "  },",
        '  "include": ["**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],',
        "}",
      ].join("\n"),
    );

    const manifest = await readManifest(cwd);

    expect(manifest.tsConfig?.compilerOptions.paths).toEqual({ "@/*": ["./src/*"] });
  });
});
