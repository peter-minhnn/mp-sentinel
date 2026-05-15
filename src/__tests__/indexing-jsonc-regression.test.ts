import { afterEach, describe, expect, it, beforeEach } from "@jest/globals";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSourceIndex } from "../commands/indexing.js";
import { ImportResolver } from "../services/source-index/resolver.js";
import { clearParserCache, parseFile } from "../services/source-index/parser.js";
import { getToolVersion } from "../utils/version.js";
import type { IndexableLanguage } from "../types/index.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mp-sentinel-indexing-jsonc-"));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  clearParserCache();
});

afterEach(async () => {
  clearParserCache();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("indexing JSONC regressions", () => {
  it("resolves tsconfig aliases when paths and include globs contain slash-star strings", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src", "lib"), { recursive: true });
    await writeFile(join(cwd, "src", "lib", "foo.ts"), "export const foo = 1;");
    await writeFile(
      join(cwd, "tsconfig.json"),
      [
        "{",
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

    const resolver = new ImportResolver(cwd);
    await resolver.initialize();

    expect(resolver.resolve("@/lib/foo", "src/index.ts")).toEqual({
      external: false,
      path: "src/lib/foo.ts",
    });
  });

  it("does not hard-fail valid TypeScript import() type queries", async () => {
    const parsed = await parseFile(
      "src/app/api/route.ts",
      [
        'type Patch = import("@/types/database").Database["public"]["Tables"]["jobs"]["Update"];',
        "export async function POST(patch: Patch) {",
        "  return patch;",
        "}",
      ].join("\n"),
      "typescript",
    );

    expect(parsed).not.toBeNull();
    expect(parsed!.parseErrors).toBeUndefined();
    expect(parsed!.parseWarnings).toContain(
      "Tree-sitter recovered TypeScript import() type query syntax",
    );
  });

  it("stores mp-sentinel version in SourceIndex.toolVersion, not scanned project version", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", version: "0.1.0" }),
    );
    await writeFile(join(cwd, "src", "index.ts"), "export const main = 1;");

    const index = await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript"] as IndexableLanguage[],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );

    expect(index).not.toBeNull();
    expect(index!.toolVersion).toBe(getToolVersion());
    expect(index!.toolVersion).not.toBe("0.1.0");
  });
});
