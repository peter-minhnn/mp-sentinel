import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach, beforeEach } from "@jest/globals";

import { parseCliArgs } from "../cli/args.js";
import { buildSourceIndex, getIndexingConfig, runIndexingCommand } from "../commands/indexing.js";
import { clearConfigCache, loadProjectConfig } from "../utils/config.js";
import { detectPackageManager, extensionToLanguage } from "../services/source-index/manifest.js";
import { buildIndexContext } from "../cli/review.js";
import { ImportResolver } from "../services/source-index/resolver.js";
import type { SourceIndex } from "../types/index.js";

const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "mp-sentinel-indexing-"));
  tempDirs.push(dir);
  return dir;
};

beforeEach(() => {
  process.argv = ["node", "mp-sentinel"];
});

afterEach(async () => {
  clearConfigCache();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("indexing CLI args", () => {
  it("parses indexing subcommand options", () => {
    process.argv = ["node", "mp-sentinel", "indexing", "--force", "--index-format", "json"];

    const parsed = parseCliArgs();

    expect(parsed.command).toBe("indexing");
    expect(parsed.values.force).toBe(true);
    expect(parsed.values["index-format"]).toBe("json");
  });

  it("defaults to console format", () => {
    process.argv = ["node", "mp-sentinel", "indexing"];
    const parsed = parseCliArgs();
    expect(parsed.values["index-format"]).toBe("console");
  });

  it("parses --stats flag", () => {
    process.argv = ["node", "mp-sentinel", "indexing", "--stats"];
    const parsed = parseCliArgs();
    expect(parsed.command).toBe("indexing");
    expect(parsed.values.stats).toBe(true);
  });

  it("parses --explain flag", () => {
    process.argv = ["node", "mp-sentinel", "indexing", "--explain", "src/foo.ts"];
    const parsed = parseCliArgs();
    expect(parsed.command).toBe("indexing");
    expect(parsed.values.explain).toBe("src/foo.ts");
  });
});

describe("source index manifest helpers", () => {
  it("maps JS/TS extensions", () => {
    expect(extensionToLanguage("ts")).toBe("typescript");
    expect(extensionToLanguage("tsx")).toBe("tsx");
    expect(extensionToLanguage("js")).toBe("javascript");
    expect(extensionToLanguage("jsx")).toBe("jsx");
    expect(extensionToLanguage("py")).toBeNull();
  });

  it("detects package managers by lockfile", async () => {
    const cwd = await makeTempDir();
    await writeFile(join(cwd, "pnpm-lock.yaml"), "");
    expect(detectPackageManager(cwd)).toBe("pnpm");
  });
});

describe("buildSourceIndex", () => {
  it("builds a source index cache for a temp TypeScript project", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"));
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        name: "fixture",
        version: "1.2.3",
        dependencies: { typescript: "5.9.3" },
      }),
    );
    await writeFile(join(cwd, "src", "index.ts"), `export function hello() { return "hi"; }`);

    const index = await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );

    expect(index).not.toBeNull();
    expect(index!.project.packageName).toBe("fixture");
    expect(index!.stats.indexedFiles).toBe(1);
    expect(index!.stats.parseErrors).toBe(0);
    expect(index!.files[0]?.symbols.some((symbol) => symbol.name === "hello")).toBe(true);
    expect(index!.stats).toHaveProperty("durationMs");
    expect(index!.stats.durationMs).toBeGreaterThan(0);
    expect(index!.stats).toHaveProperty("cacheHitFiles");
    expect(index!.stats).toHaveProperty("parsedFiles");
  });

  it("returns null only on critical failures (e.g., tree-sitter not available)", async () => {
    // This test verifies that buildSourceIndex tries to build even without config
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"));
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0" }),
    );
    await writeFile(join(cwd, "src", "index.ts"), `export const x = 1;`);

    const index = await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );

    // Should return an index (even if empty) unless there's a critical error
    expect(index).not.toBeNull();
  });
});

describe("indexing configuration", () => {
  it("getIndexingConfig returns defaults when config has no indexing section", async () => {
    const cwd = await makeTempDir();
    const config = await loadProjectConfig(cwd);

    const indexingConfig = getIndexingConfig(config);

    expect(indexingConfig.enabled).toBe(false);
    expect(indexingConfig.languages).toEqual(["typescript", "tsx", "javascript", "jsx"]);
    expect(indexingConfig.cachePath).toBe(".mp-sentinel-cache/source-index.json");
    expect(indexingConfig.maxFileSize).toBe(512000);
  });

  it("getIndexingConfig merges custom values", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, ".mp-sentinelrc.json"),
      JSON.stringify({
        indexing: {
          enabled: true,
          languages: ["typescript", "tsx"],
          cachePath: ".custom-cache/index.json",
          maxFileSize: 1024000,
        },
      }),
    );

    clearConfigCache();
    const config = await loadProjectConfig(cwd);

    const indexingConfig = getIndexingConfig(config);

    expect(indexingConfig.enabled).toBe(true);
    expect(indexingConfig.languages).toEqual(["typescript", "tsx"]);
    expect(indexingConfig.cachePath).toBe(".custom-cache/index.json");
    expect(indexingConfig.maxFileSize).toBe(1024000);
  });

  it("getIndexingConfig accepts partial config (only some fields)", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, ".mp-sentinelrc.json"),
      JSON.stringify({
        indexing: {
          enabled: true,
        },
      }),
    );

    clearConfigCache();
    const config = await loadProjectConfig(cwd);

    const indexingConfig = getIndexingConfig(config);

    expect(indexingConfig.enabled).toBe(true);
    expect(indexingConfig.languages).toEqual(["typescript", "tsx", "javascript", "jsx"]); // default
    expect(indexingConfig.cachePath).toBe(".mp-sentinel-cache/source-index.json"); // default
    expect(indexingConfig.maxFileSize).toBe(512000); // default
  });

  it("validates indexing.languages as enum values", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, ".mp-sentinelrc.json"),
      JSON.stringify({
        indexing: {
          languages: ["python", "typescript"],
        },
      }),
    );

    clearConfigCache();
    await expect(loadProjectConfig(cwd)).rejects.toThrow("indexing.languages.0 — Invalid option");
  });

  it("validates indexing.maxFileSize as positive integer", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, ".mp-sentinelrc.json"),
      JSON.stringify({
        indexing: {
          maxFileSize: -100,
        },
      }),
    );

    clearConfigCache();
    await expect(loadProjectConfig(cwd)).rejects.toThrow("indexing.maxFileSize");
  });
});

describe("indexing command output", () => {
  it("runIndexingCommand returns JSON output when format=json", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"));
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0" }),
    );
    await writeFile(join(cwd, "src", "index.ts"), `export const x = 1;`);

    let jsonBlob: string | null = null;
    const originalLog = console.log;
    console.log = (...args) => {
      const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      if (text.trim().startsWith("{") && text.includes("schemaVersion")) {
        jsonBlob = text;
      }
      originalLog?.(...args);
    };

    try {
      const exitCode = await runIndexingCommand({ "index-format": "json", force: true }, cwd);

      expect(exitCode).toBe(0);
      expect(jsonBlob).not.toBeNull();
      const parsed = JSON.parse(jsonBlob!.trim());
      expect(parsed.schemaVersion).toBe("1.1");
      expect(parsed.project).toBeDefined();
      expect(parsed.stats).toHaveProperty("durationMs");
    } finally {
      console.log = originalLog;
    }
  });

  it("runIndexingCommand --stats outputs JSON stats object", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"));
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0" }),
    );
    await writeFile(join(cwd, "src", "index.ts"), `export const x = 1;`);

    let jsonBlob: string | null = null;
    const originalLog = console.log;
    console.log = (...args) => {
      const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      if (text.trim().startsWith("{")) jsonBlob = text;
      originalLog?.(...args);
    };

    try {
      const exitCode = await runIndexingCommand(
        { "index-format": "json", stats: true, force: true },
        cwd,
      );

      expect(exitCode).toBe(0);
      expect(jsonBlob).not.toBeNull();
      const parsed = JSON.parse(jsonBlob!.trim());
      expect(parsed).toHaveProperty("totalFiles");
      expect(parsed).toHaveProperty("indexedFiles");
      expect(parsed).toHaveProperty("skippedFiles");
      expect(parsed).toHaveProperty("parseErrors");
      expect(parsed).toHaveProperty("durationMs");
      expect(parsed).toHaveProperty("importEdges");
      expect(parsed).toHaveProperty("graphEnabled");
    } finally {
      console.log = originalLog;
    }
  });

  it("runIndexingCommand --explain outputs JSON file info", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"));
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0" }),
    );
    await writeFile(join(cwd, "src", "index.ts"), `export function hello() { return "hi"; }`);

    let jsonBlob: string | null = null;
    const originalLog = console.log;
    console.log = (...args) => {
      const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      if (text.trim().startsWith("{")) jsonBlob = text;
      originalLog?.(...args);
    };

    try {
      const exitCode = await runIndexingCommand(
        { "index-format": "json", explain: "src/index.ts", force: true },
        cwd,
      );

      expect(exitCode).toBe(0);
      expect(jsonBlob).not.toBeNull();
      const parsed = JSON.parse(jsonBlob!.trim());
      expect(parsed).toHaveProperty("path", "src/index.ts");
      expect(parsed).toHaveProperty("language", "typescript");
      expect(parsed).toHaveProperty("symbols");
      expect(parsed).toHaveProperty("imports");
      expect(parsed).toHaveProperty("exports");
    } finally {
      console.log = originalLog;
    }
  });

  it("builds index even when config has indexing.enabled: false (command override)", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"));
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0" }),
    );
    await writeFile(
      join(cwd, ".mp-sentinelrc.json"),
      JSON.stringify({ indexing: { enabled: false } }),
    );
    await writeFile(join(cwd, "src", "index.ts"), `export const x = 1;`);

    let jsonBlob: string | null = null;
    const originalLog = console.log;
    console.log = (...args) => {
      const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      if (text.trim().startsWith("{") && text.includes("schemaVersion")) {
        jsonBlob = text;
      }
      originalLog?.(...args);
    };

    try {
      const exitCode = await runIndexingCommand({ "index-format": "json", force: true }, cwd);

      expect(exitCode).toBe(0);
      expect(jsonBlob).not.toBeNull();
      const parsed = JSON.parse(jsonBlob!.trim());
      expect(parsed.schemaVersion).toBe("1.1");
      expect(parsed.project).toBeDefined();
      expect(parsed.stats).toHaveProperty("durationMs");
      expect(parsed.stats.indexedFiles).toBe(1);
    } finally {
      console.log = originalLog;
    }
  });
});

describe("buildIndexContext (review integration)", () => {
  it("returns null when indexing.enabled is false", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"));
    await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
    await writeFile(
      join(cwd, ".mp-sentinelrc.json"),
      JSON.stringify({ indexing: { enabled: false } }),
    );
    await writeFile(join(cwd, "src", "index.ts"), `export const x = 1;`);

    const config = await loadProjectConfig(cwd);
    expect(config.indexing?.enabled).toBe(false);

    const context = await buildIndexContext(config, [{ path: "src/index.ts" }], cwd);

    expect(context).toBeNull();
  });

  it("returns null when cache file does not exist", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"));
    await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
    await writeFile(
      join(cwd, ".mp-sentinelrc.json"),
      JSON.stringify({ indexing: { enabled: true } }),
    );
    await writeFile(join(cwd, "src", "index.ts"), `export const x = 1;`);

    const config = await loadProjectConfig(cwd);
    expect(config.indexing?.enabled).toBe(true);

    const context = await buildIndexContext(config, [{ path: "src/index.ts" }], cwd);

    expect(context).toBeNull();
  });

  it("injects context when valid index exists and enabled", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"));
    await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
    await writeFile(
      join(cwd, ".mp-sentinelrc.json"),
      JSON.stringify({ indexing: { enabled: true } }),
    );
    await writeFile(join(cwd, "src", "index.ts"), `export function hello() { return "hi"; }`);

    // Build the index first
    const config = await loadProjectConfig(cwd);
    const indexingConfig = getIndexingConfig(config);
    await buildSourceIndex(cwd, indexingConfig, true);

    const context = await buildIndexContext(config, [{ path: "src/index.ts" }], cwd);

    expect(context).not.toBeNull();
    expect(context).toContain("=== Source Index Context ===");
    expect(context).toContain("Project: test");
    expect(context).toContain("File: src/index.ts");
    expect(context).toContain("function hello");
    expect(context).toContain("=== End Source Index Context ===");
  });
});

// ── ImportResolver unit tests ──────────────────────────────────────────────

describe("ImportResolver", () => {
  it("resolves relative import ./foo to foo.ts", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"));
    await writeFile(join(cwd, "src", "foo.ts"), `export const foo = 1;`);

    const resolver = new ImportResolver(cwd);
    await resolver.initialize();
    const result = resolver.resolve("./foo", "src/index.ts");

    expect(result.external).toBe(false);
    expect(result.path).toBe("src/foo.ts");
  });

  it("resolves ../bar/baz across directories", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"));
    await mkdir(join(cwd, "bar"));
    await writeFile(join(cwd, "bar", "baz.ts"), `export const baz = 1;`);

    const resolver = new ImportResolver(cwd);
    await resolver.initialize();
    const result = resolver.resolve("../bar/baz", "src/index.ts");

    expect(result.external).toBe(false);
    expect(result.path).toBe("bar/baz.ts");
  });

  it("resolves ./dir to dir/index.ts", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"));
    await mkdir(join(cwd, "src", "dir"));
    await writeFile(join(cwd, "src", "dir", "index.ts"), `export const x = 1;`);

    const resolver = new ImportResolver(cwd);
    await resolver.initialize();
    const result = resolver.resolve("./dir", "src/index.ts");

    expect(result.external).toBe(false);
    expect(result.path).toBe("src/dir/index.ts");
  });

  it("resolves tsconfig path alias @/lib/foo to src/lib/foo.ts", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"));
    await mkdir(join(cwd, "src", "lib"));
    await writeFile(join(cwd, "src", "lib", "foo.ts"), `export const libFoo = 1;`);
    await writeFile(
      join(cwd, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } }),
    );

    const resolver = new ImportResolver(cwd);
    await resolver.initialize();
    const result = resolver.resolve("@/lib/foo", "src/index.ts");

    expect(result.external).toBe(false);
    expect(result.path).toBe("src/lib/foo.ts");
  });

  it("marks external packages as external (react, node:fs, @types/node, lodash)", async () => {
    const cwd = await makeTempDir();
    const resolver = new ImportResolver(cwd);
    await resolver.initialize();

    expect(resolver.resolve("react", "src/index.ts").external).toBe(true);
    expect(resolver.resolve("react", "src/index.ts").path).toBeNull();
    expect(resolver.resolve("node:fs", "src/index.ts").external).toBe(true);
    expect(resolver.resolve("@types/node", "src/index.ts").external).toBe(true);
    expect(resolver.resolve("lodash", "src/index.ts").external).toBe(true);
  });

  it("handles missing local imports without crashing", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"));

    const resolver = new ImportResolver(cwd);
    await resolver.initialize();
    const result = resolver.resolve("./nonexistent", "src/index.ts");

    expect(result.path).toBeNull();
    expect(result.external).toBe(false);
  });

  it("builds importsFrom and importedBy for circular imports a->b->a", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"));
    await writeFile(join(cwd, "src", "a.ts"), `import { b } from "./b.js"; export const a = 1;`);
    await writeFile(join(cwd, "src", "b.ts"), `import { a } from "./a.js"; export const b = 1;`);

    const index = await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );

    expect(index).not.toBeNull();
    const fileA = index!.files.find((f) => f.path === "src/a.ts");
    const fileB = index!.files.find((f) => f.path === "src/b.ts");

    expect(fileA).toBeDefined();
    expect(fileB).toBeDefined();
    expect(fileA!.importsFrom).toContain("src/b.ts");
    expect(fileB!.importsFrom).toContain("src/a.ts");
    expect(fileA!.importedBy).toContain("src/b.ts");
    expect(fileB!.importedBy).toContain("src/a.ts");
  });
});

// ── buildIndexContext priority / cap tests ─────────────────────────────────

describe("buildIndexContext priority and cap", () => {
  const makeEnabledConfig = async (cwd: string) => {
    await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
    await writeFile(
      join(cwd, ".mp-sentinelrc.json"),
      JSON.stringify({ indexing: { enabled: true } }),
    );
    clearConfigCache();
    return loadProjectConfig(cwd);
  };

  it("lists changed files before related files in context output", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"));
    const config = await makeEnabledConfig(cwd);
    await writeFile(join(cwd, "src", "a.ts"), `import { b } from "./b.js"; export const a = 1;`);
    await writeFile(join(cwd, "src", "b.ts"), `export const b = 1;`);

    const indexingConfig = getIndexingConfig(config);
    await buildSourceIndex(cwd, { ...indexingConfig, enabled: true }, true);

    const context = await buildIndexContext(config, [{ path: "src/a.ts" }], cwd);

    expect(context).not.toBeNull();
    const aPos = context!.indexOf("src/a.ts");
    const bPos = context!.indexOf("src/b.ts");
    expect(aPos).toBeGreaterThanOrEqual(0);
    expect(bPos).toBeGreaterThanOrEqual(0);
    expect(aPos).toBeLessThan(bPos);
  });

  it("caps related imports at MAX_RELATED_PER_FILE (3) per changed file", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"));
    const config = await makeEnabledConfig(cwd);

    await writeFile(
      join(cwd, "src", "a.ts"),
      [
        `import { b } from "./b.js";`,
        `import { c } from "./c.js";`,
        `import { d } from "./d.js";`,
        `import { e } from "./e.js";`,
        `import { f } from "./f.js";`,
        `export const a = 1;`,
      ].join("\n"),
    );
    for (const name of ["b", "c", "d", "e", "f"]) {
      await writeFile(join(cwd, "src", `${name}.ts`), `export const ${name} = 1;`);
    }

    const indexingConfig = getIndexingConfig(config);
    await buildSourceIndex(cwd, { ...indexingConfig, enabled: true }, true);

    const context = await buildIndexContext(config, [{ path: "src/a.ts" }], cwd);

    expect(context).not.toBeNull();
    const matches = (context!.match(/^File: src\/[b-f]\.ts/gm) ?? []).length;
    expect(matches).toBeLessThanOrEqual(3);
  });

  it("falls back gracefully for schema 1.0 index without graph fields", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"));
    await mkdir(join(cwd, ".mp-sentinel-cache"));
    const config = await makeEnabledConfig(cwd);

    const legacyIndex: SourceIndex = {
      schemaVersion: "1.0",
      generatedAt: new Date().toISOString(),
      toolVersion: "1.0.0",
      project: {
        packageName: "test",
        packageVersion: "1.0.0",
        dependencies: {},
        devDependencies: {},
        detectedFrameworks: [],
      },
      files: [
        {
          path: "src/index.ts",
          language: "typescript",
          sha256: "abc",
          sizeBytes: 100,
          mtimeMs: Date.now(),
          imports: [],
          exports: [],
          symbols: [{ name: "hello", type: "function", line: 1, column: 0 }],
        },
      ],
      stats: { totalFiles: 1, indexedFiles: 1, skippedFiles: 0, parseErrors: 0 },
    };
    await writeFile(
      join(cwd, ".mp-sentinel-cache", "source-index.json"),
      JSON.stringify(legacyIndex),
    );

    await expect(buildIndexContext(config, [{ path: "src/index.ts" }], cwd)).resolves.not.toThrow();
  });
});
