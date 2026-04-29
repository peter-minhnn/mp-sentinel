import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach, beforeEach } from "@jest/globals";

import { parseCliArgs } from "../cli/args.js";
import { buildSourceIndex, getIndexingConfig, runIndexingCommand } from "../commands/indexing.js";
import { setLogQuietMode } from "../utils/logger.js";
import { clearConfigCache, loadProjectConfig } from "../utils/config.js";
import {
  detectPackageManager,
  extensionToLanguage,
  computeManifestHash,
} from "../services/source-index/manifest.js";
import { buildIndexContext } from "../cli/review.js";
import { ImportResolver } from "../services/source-index/resolver.js";
import { querySymbols, queryImports, queryAgentContext } from "../services/source-index/query.js";
import { FileHandler } from "../services/file-handler/index.js";
import type { SourceIndex, IndexableLanguage } from "../types/index.js";

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

  it("parses --explain-index flag", () => {
    process.argv = ["node", "mp-sentinel", "indexing", "--explain-index", "src/foo.ts"];
    const parsed = parseCliArgs();
    expect(parsed.command).toBe("indexing");
    expect(parsed.values.explainIndex).toBe("src/foo.ts");
  });

  it("parses --explain alias for --explain-index", () => {
    process.argv = ["node", "mp-sentinel", "indexing", "--explain", "src/foo.ts"];
    const parsed = parseCliArgs();
    expect(parsed.command).toBe("indexing");
    expect(parsed.values.explainIndex).toBe("src/foo.ts");
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
      expect(parsed.schemaVersion).toBe("1.2");
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
        { "index-format": "json", explainIndex: "src/index.ts", force: true },
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
      expect(parsed.schemaVersion).toBe("1.2");
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

// ── Manifest-aware cache invalidation tests ───────────────────────────────────

describe("manifest hash cache invalidation", () => {
  const makeProject = async (cwd: string, pkg: object) => {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "package.json"), JSON.stringify(pkg));
    await writeFile(join(cwd, "src", "index.ts"), `export function hello() { return "hi"; }`);
  };

  it("returns new index when package.json changes but source files do not", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd, { name: "fixture", version: "1.0.0", dependencies: {} });

    const config = {
      enabled: true,
      languages: ["typescript", "tsx", "javascript", "jsx"] as IndexableLanguage[],
      cachePath: ".mp-sentinel-cache/source-index.json",
      maxFileSize: 512000,
    };

    // First build
    const idx1 = await buildSourceIndex(cwd, config, false);
    expect(idx1).not.toBeNull();
    expect(idx1!.project.packageVersion).toBe("1.0.0");
    expect(idx1!.manifestHash).toBeDefined();

    // Change version in package.json (source files unchanged)
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.1", dependencies: {} }),
    );

    // Second build without force — should rebuild because manifest changed
    const idx2 = await buildSourceIndex(cwd, config, false);
    expect(idx2).not.toBeNull();
    expect(idx2!.project.packageVersion).toBe("1.0.1");
    expect(idx2!.manifestHash).not.toBe(idx1!.manifestHash);
  });

  it("manifest-only change reuses cached parsed files (0 parsed, all cache hits)", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd, { name: "fixture", version: "1.0.0", scripts: { test: "jest" } });

    const config = {
      enabled: true,
      languages: ["typescript", "tsx", "javascript", "jsx"] as IndexableLanguage[],
      cachePath: ".mp-sentinel-cache/source-index.json",
      maxFileSize: 512000,
    };

    // First build
    const idx1 = await buildSourceIndex(cwd, config, false);
    expect(idx1!.stats.parsedFiles).toBe(1);
    expect(idx1!.stats.cacheHitFiles).toBe(0);

    // Change scripts only
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { test: "vitest" } }),
    );

    // Second build — should reuse all cached files
    const idx2 = await buildSourceIndex(cwd, config, false);
    expect(idx2!.stats.parsedFiles).toBe(0);
    expect(idx2!.stats.cacheHitFiles).toBe(1);
    expect(idx2!.project.scripts).toEqual({ test: "vitest" });
  });

  it("treats legacy index without manifestHash as manifest-stale", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd, { name: "fixture", version: "1.0.0" });

    const config = {
      enabled: true,
      languages: ["typescript", "tsx", "javascript", "jsx"] as IndexableLanguage[],
      cachePath: ".mp-sentinel-cache/source-index.json",
      maxFileSize: 512000,
    };

    // Inject a legacy index without manifestHash
    const legacyIndex: SourceIndex = {
      schemaVersion: "1.1",
      generatedAt: new Date().toISOString(),
      toolVersion: "1.0.0",
      project: {
        packageName: "fixture",
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
          mtimeMs: 0,
          imports: [],
          exports: [],
          symbols: [{ name: "hello", type: "function", line: 1, column: 0 }],
        },
      ],
      stats: { totalFiles: 1, indexedFiles: 1, skippedFiles: 0, parseErrors: 0 },
    };
    await mkdir(join(cwd, ".mp-sentinel-cache"), { recursive: true });
    await writeFile(
      join(cwd, ".mp-sentinel-cache", "source-index.json"),
      JSON.stringify(legacyIndex),
    );

    // buildSourceIndex should detect manifestHash missing and rebuild
    const idx = await buildSourceIndex(cwd, config, false);
    expect(idx).not.toBeNull();
    expect(idx!.manifestHash).toBeDefined();
  });

  it("tsconfig path alias change rebuilds graph with cached parsed files", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await mkdir(join(cwd, "src", "lib"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0" }),
    );
    await writeFile(
      join(cwd, "src", "index.ts"),
      `import { helper } from "@/lib/helper.js"; export const main = 1;`,
    );
    await writeFile(join(cwd, "src", "lib", "helper.ts"), `export const helper = () => "hi";`);
    await writeFile(join(cwd, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }));

    const config = {
      enabled: true,
      languages: ["typescript", "tsx", "javascript", "jsx"] as IndexableLanguage[],
      cachePath: ".mp-sentinel-cache/source-index.json",
      maxFileSize: 512000,
    };

    // First build without path alias
    const idx1 = await buildSourceIndex(cwd, config, false);
    expect(idx1).not.toBeNull();

    // Update tsconfig with path alias
    await writeFile(
      join(cwd, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
      }),
    );

    // Second build — source files unchanged, only tsconfig changed
    const idx2 = await buildSourceIndex(cwd, config, false);
    expect(idx2).not.toBeNull();
    expect(idx2!.stats.parsedFiles).toBe(0); // reused cached files
    expect(idx2!.stats.cacheHitFiles).toBeGreaterThanOrEqual(1);
    expect(idx2!.manifestHash).not.toBe(idx1!.manifestHash);
  });

  it("computeManifestHash is deterministic for same inputs", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0" }),
    );
    await writeFile(join(cwd, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }));

    const h1 = await computeManifestHash(cwd);
    const h2 = await computeManifestHash(cwd);
    expect(h1).toBe(h2);
  });

  it("computeManifestHash changes when package.json changes", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0" }),
    );

    const h1 = await computeManifestHash(cwd);
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.1" }),
    );
    const h2 = await computeManifestHash(cwd);
    expect(h1).not.toBe(h2);
  });
});

// ── Incremental parse-error resilience ─────────────────────────────────────

describe("incremental parse-error resilience", () => {
  const defaultConfig = {
    enabled: true,
    languages: ["typescript", "tsx", "javascript", "jsx"] as IndexableLanguage[],
    cachePath: ".mp-sentinel-cache/source-index.json",
    maxFileSize: 512000,
  };

  it("keeps existing cached entries when incremental re-parse fails (healthy cache)", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0" }),
    );
    await writeFile(join(cwd, "src", "a.ts"), `export const a = 1;`);
    await writeFile(join(cwd, "src", "b.ts"), `export const b = 2;`);
    await writeFile(join(cwd, "src", "c.ts"), `export const c = 3;`);

    // Build healthy initial index
    const idx1 = await buildSourceIndex(cwd, defaultConfig, false);
    expect(idx1).not.toBeNull();
    expect(idx1!.stats.parseErrors).toBe(0);

    // Modify one file to contain a syntax error that tree-sitter reports
    await writeFile(join(cwd, "src", "b.ts"), `export const b = ;`);

    // Incremental re-index: file b.ts fails to parse but old cached entry is healthy
    const idx2 = await buildSourceIndex(cwd, defaultConfig, false);
    expect(idx2).not.toBeNull();
    // The file b.ts should still be in the index (from old cache)
    expect(idx2!.files.some((f) => f.path === "src/b.ts")).toBe(true);
    // The overall index should still be healthy
    expect(idx2!.stats.parseErrors).toBeLessThanOrEqual(idx2!.stats.indexedFiles * 0.5);
  });

  it("survives small incremental parse-error batch without aborting", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0" }),
    );
    // Create 10 healthy files
    for (let i = 0; i < 10; i++) {
      await writeFile(join(cwd, "src", `f${i}.ts`), `export const f${i} = ${i};`);
    }

    // Build healthy initial index
    const idx1 = await buildSourceIndex(cwd, defaultConfig, false);
    expect(idx1).not.toBeNull();
    expect(idx1!.stats.parseErrors).toBe(0);

    // Break 2 files (small batch relative to 10 total)
    await writeFile(join(cwd, "src", "f1.ts"), `export const f1 = ;`);
    await writeFile(join(cwd, "src", "f2.ts"), `export const f2 = ;`);

    // Should not abort — 2/2 incremental parse failures but 0/10 overall
    // when old cached entries are used for failed files.
    const idx2 = await buildSourceIndex(cwd, defaultConfig, false);
    expect(idx2).not.toBeNull();
    // Both broken files should still be present (from old cache)
    expect(idx2!.files.some((f) => f.path === "src/f1.ts")).toBe(true);
    expect(idx2!.files.some((f) => f.path === "src/f2.ts")).toBe(true);
  });

  it("still fails full rebuild with high parse-error rate", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0" }),
    );
    // Create files where >50% have syntax errors
    await writeFile(join(cwd, "src", "ok1.ts"), `export const ok1 = 1;`);
    await writeFile(join(cwd, "src", "bad1.ts"), `export const bad1 = ;`);
    await writeFile(join(cwd, "src", "bad2.ts"), `export const bad2 = ;`);

    // Force rebuild (no existing cache) — should throw because 2/3 = 66% > 50%
    await expect(buildSourceIndex(cwd, defaultConfig, true)).rejects.toThrow(
      "Source indexing aborted",
    );
  });

  it("full rebuild succeeds when parse-error rate is at or below 50%", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0" }),
    );
    await writeFile(join(cwd, "src", "ok1.ts"), `export const ok1 = 1;`);
    await writeFile(join(cwd, "src", "ok2.ts"), `export const ok2 = 2;`);
    await writeFile(join(cwd, "src", "ok3.ts"), `export const ok3 = 3;`);
    await writeFile(join(cwd, "src", "bad1.ts"), `export const bad1 = ;`);
    await writeFile(join(cwd, "src", "bad2.ts"), `export const bad2 = ;`);

    // Force rebuild: 2/5 = 40% < 50% — should succeed
    const idx = await buildSourceIndex(cwd, defaultConfig, true);
    expect(idx).not.toBeNull();
    expect(idx!.stats.parseErrors).toBe(2);
  });

  it("does not overwrite a good cache with a worse index", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0" }),
    );
    await writeFile(join(cwd, "src", "a.ts"), `export const a = 1;`);
    await writeFile(join(cwd, "src", "b.ts"), `export const b = 2;`);
    await writeFile(join(cwd, "src", "c.ts"), `export const c = 3;`);

    // Build healthy initial index
    const idx1 = await buildSourceIndex(cwd, defaultConfig, false);
    expect(idx1!.stats.parseErrors).toBe(0);

    // Replace all files with broken content + add more broken files
    await writeFile(join(cwd, "src", "a.ts"), `export const a = ;`);
    await writeFile(join(cwd, "src", "b.ts"), `export const b = ;`);
    await writeFile(join(cwd, "src", "c.ts"), `export const c = ;`);
    await writeFile(join(cwd, "src", "d.ts"), `export const d = ;`);
    await writeFile(join(cwd, "src", "e.ts"), `export const e = ;`);

    // Incremental (no force): all 5 files need re-index, all 5 fail.
    // With no healthy cached files to fall back to, the overall error rate
    // would be high, and the existing cache is better — keep it.
    const idx2 = await buildSourceIndex(cwd, defaultConfig, false);
    expect(idx2).not.toBeNull();
    // Should return the existing good index, not the degraded one
    expect(idx2!.stats.parseErrors).toBe(0);
  });

  it("warns but continues when new files fail to parse alongside healthy cache", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0" }),
    );
    await writeFile(join(cwd, "src", "a.ts"), `export const a = 1;`);
    await writeFile(join(cwd, "src", "b.ts"), `export const b = 2;`);

    // Build healthy initial index
    const idx1 = await buildSourceIndex(cwd, defaultConfig, false);
    expect(idx1!.stats.parseErrors).toBe(0);

    // Add a new file with syntax errors (not in existing cache)
    await writeFile(join(cwd, "src", "broken.ts"), `export const broken = ;`);

    // Incremental: new broken file has parse error but overall rate is 1/3 ≈ 33% < 50%
    const idx2 = await buildSourceIndex(cwd, defaultConfig, false);
    expect(idx2).not.toBeNull();
    // The broken file is included (with parseErrors) — but overall index is healthy
    expect(idx2!.files.some((f) => f.path === "src/broken.ts")).toBe(true);
    expect(idx2!.stats.parseErrors).toBe(1);
    expect(idx2!.stats.parseErrors / idx2!.stats.indexedFiles).toBeLessThanOrEqual(0.5);
  });
});

// ── Lane B: extension support and resolver accuracy ─────────────────────────

describe("extension support (.mts/.cts/.mjs/.cjs)", () => {
  it("maps .mts and .cts to typescript language", () => {
    expect(extensionToLanguage("mts")).toBe("typescript");
    expect(extensionToLanguage("cts")).toBe("typescript");
  });

  it("maps .mjs and .cjs to javascript language", () => {
    expect(extensionToLanguage("mjs")).toBe("javascript");
    expect(extensionToLanguage("cjs")).toBe("javascript");
  });

  it("indexes .mts and .cts files", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0" }),
    );
    await writeFile(join(cwd, "src", "app.mts"), `export const app = 1;`);
    await writeFile(join(cwd, "src", "util.cts"), `export const util = 2;`);

    const idx = await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      false,
    );
    expect(idx).not.toBeNull();
    expect(idx!.files.some((f) => f.path === "src/app.mts")).toBe(true);
    expect(idx!.files.some((f) => f.path === "src/util.cts")).toBe(true);
  });
});

describe("import resolver extension normalisation", () => {
  it("resolves .mjs import specifier to .ts source file", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }));
    await writeFile(join(cwd, "src", "dep.ts"), `export const dep = 1;`);
    await writeFile(join(cwd, "src", "main.ts"), `import { dep } from "./dep.mjs";`);

    const resolver = new ImportResolver(cwd);
    await resolver.initialize();
    const result = resolver.resolve("./dep.mjs", "src/main.ts");
    expect(result.path).toBe("src/dep.ts");
    expect(result.external).toBe(false);
  });

  it("resolves .cjs import specifier to .ts source file", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }));
    await writeFile(join(cwd, "src", "dep.ts"), `export const dep = 1;`);
    await writeFile(join(cwd, "src", "main.ts"), `import { dep } from "./dep.cjs";`);

    const resolver = new ImportResolver(cwd);
    await resolver.initialize();
    const result = resolver.resolve("./dep.cjs", "src/main.ts");
    expect(result.path).toBe("src/dep.ts");
    expect(result.external).toBe(false);
  });

  it("resolves .mts import specifier", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }));
    await writeFile(join(cwd, "src", "mod.mts"), `export const mod = 1;`);
    await writeFile(join(cwd, "src", "main.ts"), `import { mod } from "./mod.mts";`);

    const resolver = new ImportResolver(cwd);
    await resolver.initialize();
    const result = resolver.resolve("./mod.mts", "src/main.ts");
    expect(result.path).toBe("src/mod.mts");
    expect(result.external).toBe(false);
  });
});

describe("tsconfig extends resolution", () => {
  it("resolves path aliases from extended base tsconfig", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src", "lib"), { recursive: true });
    // Base config defines path alias
    await writeFile(
      join(cwd, "tsconfig.base.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@lib/*": ["src/lib/*"] },
        },
      }),
    );
    // Child config extends base, does not redefine paths
    await writeFile(
      join(cwd, "tsconfig.json"),
      JSON.stringify({
        extends: "./tsconfig.base.json",
        compilerOptions: { outDir: "dist" },
      }),
    );
    await writeFile(join(cwd, "src", "lib", "helper.ts"), `export const helper = 1;`);
    await writeFile(join(cwd, "src", "main.ts"), `import { helper } from "@lib/helper";`);

    const resolver = new ImportResolver(cwd);
    await resolver.initialize();
    const result = resolver.resolve("@lib/helper", "src/main.ts");
    expect(result.path).toBeDefined();
    expect(result.path).toBe("src/lib/helper.ts");
    expect(result.external).toBe(false);
  });

  it("child paths override parent paths", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src", "lib"), { recursive: true });
    await mkdir(join(cwd, "src", "overrides"), { recursive: true });
    await writeFile(
      join(cwd, "tsconfig.base.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@lib/*": ["src/lib/*"] },
        },
      }),
    );
    await writeFile(
      join(cwd, "tsconfig.json"),
      JSON.stringify({
        extends: "./tsconfig.base.json",
        compilerOptions: {
          paths: { "@lib/*": ["src/overrides/*"] },
        },
      }),
    );
    await writeFile(join(cwd, "src", "overrides", "helper.ts"), `export const helper = 1;`);
    await writeFile(join(cwd, "src", "main.ts"), `import { helper } from "@lib/helper";`);

    const resolver = new ImportResolver(cwd);
    await resolver.initialize();
    const result = resolver.resolve("@lib/helper", "src/main.ts");
    expect(result.path).toBe("src/overrides/helper.ts");
  });

  it("handles missing extended config gracefully", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, "tsconfig.json"),
      JSON.stringify({
        extends: "./nonexistent.json",
        compilerOptions: { baseUrl: ".", paths: { "@app/*": ["src/*"] } },
      }),
    );
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "main.ts"), `export const main = 1;`);

    // Should not crash — inherits paths from child only
    const resolver = new ImportResolver(cwd);
    await resolver.initialize();
    const result = resolver.resolve("@app/main", "src/main.ts");
    expect(result.path).toBe("src/main.ts");
  });
});

describe("maxFileSize enforcement", () => {
  it("rejects files exceeding maxFileSize in classifyFiles", () => {
    const handler = new FileHandler({
      cwd: process.cwd(),
      maxFileSize: 1,
      disableGitIgnore: true,
      disableArchIgnore: true,
    });
    const result = handler.filterPaths(["package.json"]);
    expect(result.stats.accepted).toBe(0);
    expect(result.stats.rejected).toBe(1);
    expect(result.stats.byReason["exceeds max file size (1 bytes)"]).toBe(1);
  });

  it("accepts files within maxFileSize", () => {
    const handler = new FileHandler({
      cwd: process.cwd(),
      maxFileSize: 512000,
      disableGitIgnore: true,
      disableArchIgnore: true,
    });
    const result = handler.filterPaths(["package.json"]);
    expect(result.stats.accepted).toBe(1);
  });
});

// ── Lane D: Index Diagnostics UX ───────────────────────────────────────────

describe("explain-index diagnostics (Lane D)", () => {
  const makeProjectWithIndex = async (cwd: string, files: Record<string, string>) => {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "lane-d-test", version: "1.0.0" }),
    );
    for (const [relPath, content] of Object.entries(files)) {
      const fullPath = join(cwd, relPath);
      await mkdir(join(fullPath, ".."), { recursive: true });
      await writeFile(fullPath, content);
    }
    return buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );
  };

  it("JSON explain output is parseable", async () => {
    const cwd = await makeTempDir();
    const index = await makeProjectWithIndex(cwd, {
      "src/main.ts": `import { dep } from "./dep.js"; export const main = 1;`,
      "src/dep.ts": `export const dep = 1;`,
    });
    expect(index).not.toBeNull();

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      const code = await runIndexingCommand(
        { explainIndex: "src/main.ts", "index-format": "json", force: false },
        cwd,
      );

      expect(code).toBe(0);
      const jsonStr = logs.join("\n");
      const parsed = JSON.parse(jsonStr);
      expect(parsed).toBeDefined();
      expect(parsed.path).toBe("src/main.ts");
      expect(parsed.resolvedImports).toBeDefined();
      expect(parsed.unresolvedImports).toBeDefined();
      expect(parsed.externalImports).toBeDefined();
      expect(parsed.importedByCount).toBeDefined();
      expect(Array.isArray(parsed.resolvedImports)).toBe(true);
      expect(Array.isArray(parsed.unresolvedImports)).toBe(true);
      expect(Array.isArray(parsed.externalImports)).toBe(true);
    } finally {
      console.log = origLog;
      setLogQuietMode(false);
    }
  });

  it("resolved internal imports and unresolved local imports shown separately", async () => {
    const cwd = await makeTempDir();
    const index = await makeProjectWithIndex(cwd, {
      "src/main.ts": [
        `import { dep } from "./dep.js";          // resolved internal`,
        `import { missing } from "./nonexistent.js"; // unresolved local`,
        `export const main = 1;`,
      ].join("\n"),
      "src/dep.ts": `export const dep = 1;`,
    });
    expect(index).not.toBeNull();

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      setLogQuietMode(true);
      await runIndexingCommand(
        { explainIndex: "src/main.ts", "index-format": "json", force: false },
        cwd,
      );
      setLogQuietMode(false);

      const parsed = JSON.parse(logs.join("\n"));
      // resolvedImports contains original import specifiers
      expect(parsed.resolvedImports).toContain("./dep.js");
      // importsFrom contains actual resolved file paths
      expect(parsed.importsFrom).toContain("src/dep.ts");
      // unresolved local import
      expect(parsed.unresolvedImports).toContain("./nonexistent.js");
      // The resolved specifier should NOT appear in unresolvedImports
      expect(parsed.unresolvedImports).not.toContain("./dep.js");
      // The unresolved specifier should NOT appear in resolvedImports
      expect(parsed.resolvedImports).not.toContain("./nonexistent.js");
    } finally {
      console.log = origLog;
      setLogQuietMode(false);
    }
  });

  it("external package import reported as external, not internal graph edge", async () => {
    const cwd = await makeTempDir();
    const index = await makeProjectWithIndex(cwd, {
      "src/main.ts": `import _ from "lodash"; export const main = 1;`,
    });
    expect(index).not.toBeNull();

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      setLogQuietMode(true);
      await runIndexingCommand(
        { explainIndex: "src/main.ts", "index-format": "json", force: false },
        cwd,
      );
      setLogQuietMode(false);

      const parsed = JSON.parse(logs.join("\n"));
      expect(parsed.externalImports).toContain("lodash");
      // "lodash" should NOT appear as resolved internal import
      expect(parsed.resolvedImports).not.toContain("lodash");
      // importsFrom should NOT include lodash (it's external)
      expect(parsed.importsFrom).not.toContain("lodash");
      // importedByCount should be a number
      expect(typeof parsed.importedByCount).toBe("number");
    } finally {
      console.log = origLog;
      setLogQuietMode(false);
    }
  });

  it("file with parse errors includes parse error summary in explain output", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "lane-d-test", version: "1.0.0" }),
    );
    // One valid file to keep error rate <= 50%, one file with a syntax error
    await writeFile(join(cwd, "src", "ok.ts"), `export const ok = 1;`);
    await writeFile(join(cwd, "src", "bad.ts"), `export const bad = ;`);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      setLogQuietMode(true);
      await runIndexingCommand(
        { explainIndex: "src/bad.ts", "index-format": "json", force: true },
        cwd,
      );
      setLogQuietMode(false);

      const parsed = JSON.parse(logs.join("\n"));
      expect(parsed.path).toBe("src/bad.ts");
      expect(parsed.parseErrors).toBeDefined();
      expect(Array.isArray(parsed.parseErrors)).toBe(true);
      expect(parsed.parseErrors.length).toBeGreaterThan(0);
      expect(typeof parsed.parseErrors[0]).toBe("string");
    } finally {
      console.log = origLog;
      setLogQuietMode(false);
    }
  });

  it("console output is ASCII-safe", async () => {
    const cwd = await makeTempDir();
    const index = await makeProjectWithIndex(cwd, {
      "src/main.ts": `import { dep } from "./dep.js"; export const main = 1;`,
      "src/dep.ts": `export const dep = 1;`,
    });
    expect(index).not.toBeNull();

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      setLogQuietMode(true);
      await runIndexingCommand(
        { explainIndex: "src/main.ts", "index-format": "console", force: false },
        cwd,
      );
      setLogQuietMode(false);

      const allOutput = logs.join("\n");
      // eslint-disable-next-line no-control-regex -- ASCII range 0x00-0x7F
      const nonAscii = allOutput.replace(/[\x00-\x7F]/g, "");
      expect(nonAscii.length).toBe(0);
    } finally {
      console.log = origLog;
      setLogQuietMode(false);
    }
  });
});

// ── Lane A: find-symbol and find-import query CLI ─────────────────────────────

describe("find-symbol and find-import CLI args", () => {
  it("parses --find-symbol option", () => {
    process.argv = ["node", "mp-sentinel", "indexing", "--find-symbol", "buildSourceIndex"];

    const parsed = parseCliArgs();

    expect(parsed.command).toBe("indexing");
    expect(parsed.values.findSymbol).toBe("buildSourceIndex");
  });

  it("parses --find-import option", () => {
    process.argv = ["node", "mp-sentinel", "indexing", "--find-import", "zod"];

    const parsed = parseCliArgs();

    expect(parsed.command).toBe("indexing");
    expect(parsed.values.findImport).toBe("zod");
  });

  it("parses --find-symbol and --find-import together", () => {
    process.argv = [
      "node",
      "mp-sentinel",
      "indexing",
      "--find-symbol",
      "hello",
      "--find-import",
      "react",
    ];

    const parsed = parseCliArgs();

    expect(parsed.values.findSymbol).toBe("hello");
    expect(parsed.values.findImport).toBe("react");
  });

  it("parses --find-symbol with --index-format json", () => {
    process.argv = [
      "node",
      "mp-sentinel",
      "indexing",
      "--find-symbol",
      "hello",
      "--index-format",
      "json",
    ];

    const parsed = parseCliArgs();

    expect(parsed.values.findSymbol).toBe("hello");
    expect(parsed.values["index-format"]).toBe("json");
  });
});

describe("find-symbol query", () => {
  const makeProject = async (cwd: string) => {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "find-test", version: "1.0.0" }),
    );
    await writeFile(
      join(cwd, "src", "index.ts"),
      `export function hello() { return "hi"; }\n` +
        `export class HelloWorld { }\n` +
        `export interface IHello { }\n` +
        `export const helloConst = 1;\n`,
    );
    await writeFile(join(cwd, "src", "utils.ts"), `export function helper() { return true; }`);
  };

  it("finds symbols by exact name match", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      await runIndexingCommand({ findSymbol: "hello", "index-format": "json" }, cwd);

      const parsed = JSON.parse(logs.join("\n"));
      expect(parsed.query).toBe("hello");
      expect(parsed.results.length).toBeGreaterThanOrEqual(1);
      expect(
        parsed.results.some((r: { symbol: { name: string } }) => r.symbol.name === "hello"),
      ).toBe(true);
      const exactMatch = parsed.results.find(
        (r: { symbol: { name: string } }) => r.symbol.name === "hello",
      );
      expect(exactMatch.score).toBe(100);
    } finally {
      console.log = origLog;
    }
  });

  it("finds symbols by partial name match", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      await runIndexingCommand({ findSymbol: "Hello", "index-format": "json" }, cwd);

      const parsed = JSON.parse(logs.join("\n"));
      expect(parsed.query).toBe("Hello");
      // Should match HelloWorld (starts with), IHello (contains), hello (case-insensitive)
      expect(parsed.results.length).toBeGreaterThanOrEqual(3);
      const helloMatch = parsed.results.find(
        (r: { symbol: { name: string } }) => r.symbol.name === "hello",
      );
      expect(helloMatch).toBeDefined();
      expect(helloMatch.score).toBe(90);
    } finally {
      console.log = origLog;
    }
  });

  it("finds classes and interfaces by exact name", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      await runIndexingCommand({ findSymbol: "HelloWorld", "index-format": "json" }, cwd);

      const parsed = JSON.parse(logs.join("\n"));
      expect(parsed.results.length).toBeGreaterThanOrEqual(1);
      const classMatch = parsed.results.find(
        (r: { symbol: { type: string } }) => r.symbol.type === "class",
      );
      expect(classMatch).toBeDefined();
      expect(classMatch.symbol.name).toBe("HelloWorld");
      expect(classMatch.score).toBe(100);
    } finally {
      console.log = origLog;
    }
  });

  it("empty query result returns valid JSON with empty array", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      await runIndexingCommand(
        { findSymbol: "nonexistent_symbol_xyz", "index-format": "json" },
        cwd,
      );

      const parsed = JSON.parse(logs.join("\n"));
      expect(parsed.query).toBe("nonexistent_symbol_xyz");
      expect(parsed.results).toEqual([]);
    } finally {
      console.log = origLog;
    }
  });

  it("JSON output has no logs mixed into stdout", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      await runIndexingCommand({ findSymbol: "hello", "index-format": "json" }, cwd);

      const jsonStr = logs.join("\n");
      const parsed = JSON.parse(jsonStr);
      expect(parsed).toBeDefined();
      expect(jsonStr).not.toContain("[info]");
      expect(jsonStr).not.toContain("[warning]");
      expect(jsonStr).not.toContain("[error]");
    } finally {
      console.log = origLog;
    }
  });

  it("empty query string throws UserError", async () => {
    const cwd = await makeTempDir();
    await expect(
      runIndexingCommand({ findSymbol: "   ", "index-format": "json" }, cwd),
    ).rejects.toThrow("--find-symbol query must not be empty");
  });
});

describe("find-import query", () => {
  const makeProject = async (cwd: string) => {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "import-test", version: "1.0.0" }),
    );
    await writeFile(
      join(cwd, "src", "main.ts"),
      `import { z } from "zod";\nimport lodash from "lodash";\nexport const main = 1;\n`,
    );
    await writeFile(
      join(cwd, "src", "dep.ts"),
      `import { helper } from "./utils.js";\nexport const dep = 2;\n`,
    );
    await writeFile(join(cwd, "src", "utils.ts"), `export const helper = () => true;`);
  };

  it("finds files importing an external package", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      await runIndexingCommand({ findImport: "zod", "index-format": "json" }, cwd);

      const parsed = JSON.parse(logs.join("\n"));
      expect(parsed.query).toBe("zod");
      expect(parsed.results.length).toBeGreaterThanOrEqual(1);
      expect(
        parsed.results.some(
          (r: { importInfo: { source: string } }) => r.importInfo.source === "zod",
        ),
      ).toBe(true);
      const exactMatch = parsed.results.find(
        (r: { importInfo: { source: string } }) => r.importInfo.source === "zod",
      );
      expect(exactMatch.score).toBe(100);
      expect(exactMatch.file).toBe("src/main.ts");
    } finally {
      console.log = origLog;
    }
  });

  it("finds files importing an internal path", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      await runIndexingCommand({ findImport: "./utils.js", "index-format": "json" }, cwd);

      const parsed = JSON.parse(logs.join("\n"));
      expect(parsed.results.length).toBeGreaterThanOrEqual(1);
      expect(
        parsed.results.some(
          (r: { importInfo: { source: string } }) => r.importInfo.source === "./utils.js",
        ),
      ).toBe(true);
    } finally {
      console.log = origLog;
    }
  });

  it("finds imports by partial source match", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      await runIndexingCommand({ findImport: "lod", "index-format": "json" }, cwd);

      const parsed = JSON.parse(logs.join("\n"));
      expect(parsed.results.length).toBeGreaterThanOrEqual(1);
      const match = parsed.results.find(
        (r: { importInfo: { source: string } }) => r.importInfo.source === "lodash",
      );
      expect(match).toBeDefined();
      expect(match.score).toBe(70);
    } finally {
      console.log = origLog;
    }
  });

  it("finds imports by imported name match", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      await runIndexingCommand({ findImport: "helper", "index-format": "json" }, cwd);

      const parsed = JSON.parse(logs.join("\n"));
      // "helper" is imported as name from "./utils.js"
      expect(parsed.results.length).toBeGreaterThanOrEqual(1);
      expect(
        parsed.results.some((r: { importInfo: { names: string[] } }) =>
          r.importInfo.names.includes("helper"),
        ),
      ).toBe(true);
    } finally {
      console.log = origLog;
    }
  });

  it("empty query result returns valid JSON with empty array", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      await runIndexingCommand(
        { findImport: "nonexistent-package-xyz", "index-format": "json" },
        cwd,
      );

      const parsed = JSON.parse(logs.join("\n"));
      expect(parsed.query).toBe("nonexistent-package-xyz");
      expect(parsed.results).toEqual([]);
    } finally {
      console.log = origLog;
    }
  });

  it("JSON output has no logs mixed into stdout", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      await runIndexingCommand({ findImport: "zod", "index-format": "json" }, cwd);

      const jsonStr = logs.join("\n");
      const parsed = JSON.parse(jsonStr);
      expect(parsed).toBeDefined();
      expect(jsonStr).not.toContain("[info]");
      expect(jsonStr).not.toContain("[warning]");
      expect(jsonStr).not.toContain("[error]");
    } finally {
      console.log = origLog;
    }
  });

  it("empty query string throws UserError", async () => {
    const cwd = await makeTempDir();
    await expect(
      runIndexingCommand({ findImport: "   ", "index-format": "json" }, cwd),
    ).rejects.toThrow("--find-import query must not be empty");
  });
});

// ── Lane A: agent-context CLI ─────────────────────────────────────────────────

describe("agent-context CLI args", () => {
  it("parses --agent-context option", () => {
    process.argv = ["node", "mp-sentinel", "indexing", "--agent-context", "src/foo.ts"];

    const parsed = parseCliArgs();

    expect(parsed.command).toBe("indexing");
    expect(parsed.values.agentContext).toBe("src/foo.ts");
  });

  it("parses --agent-context with --index-format json", () => {
    process.argv = [
      "node",
      "mp-sentinel",
      "indexing",
      "--agent-context",
      "src/foo.ts",
      "--index-format",
      "json",
    ];

    const parsed = parseCliArgs();

    expect(parsed.values.agentContext).toBe("src/foo.ts");
    expect(parsed.values["index-format"]).toBe("json");
  });
});

describe("agent-context query", () => {
  const makeProject = async (cwd: string) => {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "agent-context-test", version: "1.0.0" }),
    );
    await writeFile(
      join(cwd, "src", "main.ts"),
      `import { helper } from "./helper.js";\n` +
        `import { z } from "zod";\n` +
        `export function main() { return helper(); }\n` +
        `export class MainClass { }\n`,
    );
    await writeFile(
      join(cwd, "src", "helper.ts"),
      `export function helper() { return "hello"; }\n`,
    );
    await writeFile(
      join(cwd, "src", "consumer.ts"),
      `import { main } from "./main.js";\n` + `export const result = main();\n`,
    );
  };

  it("JSON output is parseable and has expected shape", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      await runIndexingCommand({ agentContext: "src/main.ts", "index-format": "json" }, cwd);

      const parsed = JSON.parse(logs.join("\n"));
      // Top-level keys
      expect(parsed).toHaveProperty("file");
      expect(parsed).toHaveProperty("directImports");
      expect(parsed).toHaveProperty("directDependents");
      expect(parsed).toHaveProperty("hubFiles");
      expect(parsed).toHaveProperty("suggestedCommands");

      // File info
      expect(parsed.file.path).toBe("src/main.ts");
      expect(parsed.file.language).toBe("typescript");
      expect(Array.isArray(parsed.file.symbols)).toBe(true);
      expect(Array.isArray(parsed.file.imports)).toBe(true);
      expect(Array.isArray(parsed.file.exports)).toBe(true);
      expect(typeof parsed.file.symbolsTruncated).toBe("number");
      expect(typeof parsed.file.importsTruncated).toBe("number");
      expect(typeof parsed.file.exportsTruncated).toBe("number");

      // Direct imports and dependents
      expect(Array.isArray(parsed.directImports)).toBe(true);
      expect(Array.isArray(parsed.directDependents)).toBe(true);
      expect(typeof parsed.directImportsTruncated).toBe("number");
      expect(typeof parsed.directDependentsTruncated).toBe("number");

      // Hub files
      expect(Array.isArray(parsed.hubFiles)).toBe(true);
      expect(typeof parsed.hubFilesTruncated).toBe("number");

      // Suggested commands
      expect(Array.isArray(parsed.suggestedCommands)).toBe(true);
      for (const cmd of parsed.suggestedCommands) {
        expect(typeof cmd).toBe("string");
      }
    } finally {
      console.log = origLog;
    }
  });

  it("missing file returns error in JSON", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      await runIndexingCommand({ agentContext: "src/nonexistent.ts", "index-format": "json" }, cwd);

      const parsed = JSON.parse(logs.join("\n"));
      expect(parsed).toHaveProperty("error");
      expect(parsed.error).toContain("not found");
    } finally {
      console.log = origLog;
    }
  });

  it("known file returns direct imports and dependents", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      await runIndexingCommand({ agentContext: "src/main.ts", "index-format": "json" }, cwd);

      const parsed = JSON.parse(logs.join("\n"));
      // main.ts imports helper.ts
      expect(parsed.directImports).toContain("src/helper.ts");
      // consumer.ts imports main.ts — so main.ts has consumer.ts as a dependent
      expect(parsed.directDependents).toContain("src/consumer.ts");
    } finally {
      console.log = origLog;
    }
  });

  it("known file returns hub files imported by >1 file", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);

    // Make helper.ts a hub by adding another consumer
    await writeFile(
      join(cwd, "src", "consumer2.ts"),
      `import { helper } from "./helper.js";\n` + `export const result = helper();\n`,
    );

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      await runIndexingCommand(
        { agentContext: "src/main.ts", "index-format": "json", force: true },
        cwd,
      );

      const parsed = JSON.parse(logs.join("\n"));
      // helper.ts is imported by both main.ts and consumer2.ts -> hub file
      const hubPaths = parsed.hubFiles.map((h: { path: string }) => h.path);
      expect(hubPaths).toContain("src/helper.ts");
      const helperHub = parsed.hubFiles.find((h: { path: string }) => h.path === "src/helper.ts");
      expect(helperHub.importedByCount).toBeGreaterThanOrEqual(2);
    } finally {
      console.log = origLog;
    }
  });

  it("suggested commands include diagnostic follow-ups", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      await runIndexingCommand({ agentContext: "src/main.ts", "index-format": "json" }, cwd);

      const parsed = JSON.parse(logs.join("\n"));
      expect(parsed.suggestedCommands.length).toBeGreaterThan(0);

      // Should suggest find-symbol for main function or MainClass
      const hasFindSymbol = parsed.suggestedCommands.some((cmd: string) =>
        cmd.includes("--find-symbol"),
      );
      expect(hasFindSymbol).toBe(true);

      // Should suggest find-import for zod
      const hasFindImport = parsed.suggestedCommands.some(
        (cmd: string) => cmd.includes("--find-import") && cmd.includes("zod"),
      );
      expect(hasFindImport).toBe(true);

      // Should suggest agent-context for helper or consumer
      const hasAgentContext = parsed.suggestedCommands.some((cmd: string) =>
        cmd.includes("--agent-context"),
      );
      expect(hasAgentContext).toBe(true);
    } finally {
      console.log = origLog;
    }
  });

  it("JSON output has no logs mixed into stdout", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      await runIndexingCommand({ agentContext: "src/main.ts", "index-format": "json" }, cwd);

      const jsonStr = logs.join("\n");
      const parsed = JSON.parse(jsonStr);
      expect(parsed).toBeDefined();
      expect(jsonStr).not.toContain("[info]");
      expect(jsonStr).not.toContain("[warning]");
      expect(jsonStr).not.toContain("[error]");
    } finally {
      console.log = origLog;
    }
  });

  it("console output is ASCII-safe", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      setLogQuietMode(true);
      await runIndexingCommand({ agentContext: "src/main.ts", "index-format": "console" }, cwd);
      setLogQuietMode(false);

      const allOutput = logs.join("\n");
      // eslint-disable-next-line no-control-regex
      const nonAscii = allOutput.replace(/[\x00-\x7F]/g, "");
      expect(nonAscii.length).toBe(0);
    } finally {
      console.log = origLog;
      setLogQuietMode(false);
    }
  });

  it("empty query string throws UserError", async () => {
    const cwd = await makeTempDir();
    await expect(
      runIndexingCommand({ agentContext: "   ", "index-format": "json" }, cwd),
    ).rejects.toThrow("--agent-context file path must not be empty");
  });
});

// ── Query Service Tests ───────────────────────────────────────────────────────

describe("querySymbols (service)", () => {
  const makeProject = async (cwd: string) => {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "query-symbol-test", version: "1.0.0" }),
    );
    await writeFile(
      join(cwd, "src", "index.ts"),
      `export function hello() { return "hi"; }\n` +
        `export class HelloWorld { }\n` +
        `export interface IHello { }\n` +
        `export const helloConst = 1;\n`,
    );
    await writeFile(
      join(cwd, "src", "utils.ts"),
      `export function HelloHelper() { return true; }\n` +
        `export function goodbye() { return false; }\n`,
    );
  };

  it("returns empty results for null index", () => {
    const results = querySymbols(null, "hello");
    expect(results).toEqual([]);
  });

  it("returns empty results for empty index", () => {
    const emptyIndex: SourceIndex = {
      schemaVersion: "1.2",
      generatedAt: new Date().toISOString(),
      toolVersion: "1.0.0",
      project: {
        packageName: "test",
        dependencies: {},
        devDependencies: {},
        detectedFrameworks: [],
      },
      files: [],
      stats: { totalFiles: 0, indexedFiles: 0, skippedFiles: 0, parseErrors: 0 },
    };
    const results = querySymbols(emptyIndex, "hello");
    expect(results).toEqual([]);
  });

  it("returns results sorted by score descending", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);
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

    const results = querySymbols(index, "hello");
    expect(results.length).toBeGreaterThan(1);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
    }
  });

  it("caps results at 20", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "cap-test", version: "1.0.0" }),
    );
    let content = "";
    for (let i = 0; i < 50; i++) {
      content += `export const foo${i} = ${i};\n`;
    }
    await writeFile(join(cwd, "src", "many.ts"), content);
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

    const results = querySymbols(index!, "foo");
    expect(results.length).toBeLessThanOrEqual(20);
  });

  it("exact name match gives score 100", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);
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

    const results = querySymbols(index!, "hello");
    const exact = results.find((r) => r.symbol.name === "hello");
    expect(exact).toBeDefined();
    expect(exact!.score).toBe(100);
    expect(exact!.reason).toBe("exact name match");
  });

  it("case-insensitive match gives score 90", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);
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

    const results = querySymbols(index!, "Hello");
    const ciMatch = results.find((r) => r.symbol.name === "hello");
    expect(ciMatch).toBeDefined();
    expect(ciMatch!.score).toBe(90);
  });

  it("returns empty for nonexistent symbol", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);
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

    const results = querySymbols(index!, "nonexistent_xyz_abc");
    expect(results).toEqual([]);
  });
});

describe("queryImports (service)", () => {
  const makeProject = async (cwd: string) => {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "query-import-test", version: "1.0.0" }),
    );
    await writeFile(
      join(cwd, "src", "main.ts"),
      `import { z } from "zod";\n` +
        `import { helper } from "./helper.js";\n` +
        `import lodash from "lodash";\n` +
        `export const main = z.string();\n`,
    );
    await writeFile(
      join(cwd, "src", "helper.ts"),
      `export function helper() { return "hello"; }\n`,
    );
  };

  it("returns empty results for null index", () => {
    const results = queryImports(null, "zod");
    expect(results).toEqual([]);
  });

  it("returns empty results for empty index", () => {
    const emptyIndex: SourceIndex = {
      schemaVersion: "1.2",
      generatedAt: new Date().toISOString(),
      toolVersion: "1.0.0",
      project: {
        packageName: "test",
        dependencies: {},
        devDependencies: {},
        detectedFrameworks: [],
      },
      files: [],
      stats: { totalFiles: 0, indexedFiles: 0, skippedFiles: 0, parseErrors: 0 },
    };
    const results = queryImports(emptyIndex, "zod");
    expect(results).toEqual([]);
  });

  it("exact source match gives score 100", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);
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

    const results = queryImports(index!, "zod");
    expect(results.length).toBeGreaterThanOrEqual(1);
    const exact = results.find((r) => r.importInfo.source === "zod");
    expect(exact).toBeDefined();
    expect(exact!.score).toBe(100);
  });

  it("case-insensitive source match gives score 90", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);
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

    const results = queryImports(index!, "Zod");
    const ciMatch = results.find((r) => r.importInfo.source === "zod");
    expect(ciMatch).toBeDefined();
    expect(ciMatch!.score).toBe(90);
  });

  it("partial source match gives score 70", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);
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

    const results = queryImports(index!, "lod");
    expect(results.length).toBeGreaterThanOrEqual(1);
    const partial = results.find((r) => r.importInfo.source === "lodash");
    expect(partial).toBeDefined();
    expect(partial!.score).toBe(70);
  });

  it("results sorted by score descending", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);
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

    const results = queryImports(index!, "o");
    expect(results.length).toBeGreaterThan(1);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
    }
  });

  it("caps results at 20", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "import-cap-test", version: "1.0.0" }),
    );
    let content = "";
    for (let i = 0; i < 30; i++) {
      content += `import { foo } from "pkg-${i}";\n`;
    }
    content += `export const x = 1;\n`;
    await writeFile(join(cwd, "src", "many-imports.ts"), content);
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

    const results = queryImports(index!, "pkg");
    expect(results.length).toBeLessThanOrEqual(20);
  });

  it("returns empty for nonexistent import", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);
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

    const results = queryImports(index!, "nonexistent-pkg-xyz");
    expect(results).toEqual([]);
  });
});

describe("queryAgentContext (service)", () => {
  const makeProject = async (cwd: string) => {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "query-agent-test", version: "1.0.0" }),
    );
    await writeFile(
      join(cwd, "src", "main.ts"),
      `import { helper } from "./helper.js";\n` +
        `import { z } from "zod";\n` +
        `export function main() { return helper(); }\n` +
        `export class MainClass { }\n`,
    );
    await writeFile(
      join(cwd, "src", "helper.ts"),
      `export function helper() { return "hello"; }\n`,
    );
    await writeFile(
      join(cwd, "src", "consumer.ts"),
      `import { main } from "./main.js";\n` + `export const result = main();\n`,
    );
  };

  it("returns error for null index", () => {
    const ctx = queryAgentContext(null, "src/main.ts");
    expect(ctx.error).toBeDefined();
    expect(ctx.error).toBe("No index available");
    expect(ctx.file).toBeNull();
  });

  it("returns error for missing target file", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);
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

    const ctx = queryAgentContext(index!, "src/nonexistent.ts");
    expect(ctx.error).toBeDefined();
    expect(ctx.error).toContain("not found");
    expect(ctx.file).toBeNull();
  });

  it("has expected shape for known file", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);
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

    const ctx = queryAgentContext(index!, "src/main.ts");
    expect(ctx.error).toBeUndefined();
    expect(ctx.file).not.toBeNull();
    expect(ctx.file!.path).toBe("src/main.ts");
    expect(ctx.file!.language).toBe("typescript");
    expect(Array.isArray(ctx.file!.symbols)).toBe(true);
    expect(Array.isArray(ctx.file!.imports)).toBe(true);
    expect(Array.isArray(ctx.file!.exports)).toBe(true);
    expect(typeof ctx.file!.symbolsTruncated).toBe("number");
    expect(typeof ctx.file!.importsTruncated).toBe("number");
    expect(typeof ctx.file!.exportsTruncated).toBe("number");
    expect(Array.isArray(ctx.directImports)).toBe(true);
    expect(Array.isArray(ctx.directDependents)).toBe(true);
    expect(Array.isArray(ctx.hubFiles)).toBe(true);
    expect(Array.isArray(ctx.suggestedCommands)).toBe(true);
  });

  it("includes direct imports and dependents", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);
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

    const ctx = queryAgentContext(index!, "src/main.ts");
    // main.ts imports helper.ts
    expect(ctx.directImports).toContain("src/helper.ts");
    // consumer.ts imports main.ts
    expect(ctx.directDependents).toContain("src/consumer.ts");
  });

  it("suggested commands include diagnostic follow-ups", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);
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

    const ctx = queryAgentContext(index!, "src/main.ts");
    expect(ctx.suggestedCommands.length).toBeGreaterThan(0);

    const hasFindSymbol = ctx.suggestedCommands.some((cmd) => cmd.includes("--find-symbol"));
    expect(hasFindSymbol).toBe(true);

    const hasFindImport = ctx.suggestedCommands.some(
      (cmd) => cmd.includes("--find-import") && cmd.includes("zod"),
    );
    expect(hasFindImport).toBe(true);

    const hasAgentContext = ctx.suggestedCommands.some((cmd) => cmd.includes("--agent-context"));
    expect(hasAgentContext).toBe(true);
  });

  it("caps symbols at 30", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "agent-cap-test", version: "1.0.0" }),
    );
    let content = "";
    for (let i = 0; i < 50; i++) {
      content += `export function sym${i}() { return ${i}; }\n`;
    }
    await writeFile(join(cwd, "src", "huge.ts"), content);
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

    const ctx = queryAgentContext(index!, "src/huge.ts");
    expect(ctx.file!.symbols.length).toBeLessThanOrEqual(30);
    expect(ctx.file!.symbolsTruncated).toBeGreaterThan(0);
  });

  it("caps direct imports at 10 and direct dependents at 10", () => {
    const files: SourceIndex["files"] = [];
    // Create a file with 15 imports and 15 importedBy
    const mainFile = {
      path: "src/main.ts",
      language: "typescript" as const,
      sha256: "abc",
      sizeBytes: 100,
      mtimeMs: Date.now(),
      imports: [
        { source: "./a.js", kind: "named" as const, names: ["a"], line: 1 },
        { source: "./b.js", kind: "named" as const, names: ["b"], line: 2 },
        { source: "./c.js", kind: "named" as const, names: ["c"], line: 3 },
        { source: "./d.js", kind: "named" as const, names: ["d"], line: 4 },
        { source: "./e.js", kind: "named" as const, names: ["e"], line: 5 },
        { source: "./f.js", kind: "named" as const, names: ["f"], line: 6 },
        { source: "./g.js", kind: "named" as const, names: ["g"], line: 7 },
        { source: "./h.js", kind: "named" as const, names: ["h"], line: 8 },
        { source: "./i.js", kind: "named" as const, names: ["i"], line: 9 },
        { source: "./j.js", kind: "named" as const, names: ["j"], line: 10 },
        { source: "./k.js", kind: "named" as const, names: ["k"], line: 11 },
        { source: "./l.js", kind: "named" as const, names: ["l"], line: 12 },
        { source: "./m.js", kind: "named" as const, names: ["m"], line: 13 },
        { source: "./n.js", kind: "named" as const, names: ["n"], line: 14 },
        { source: "./o.js", kind: "named" as const, names: ["o"], line: 15 },
      ],
      exports: [],
      symbols: [],
      importsFrom: Array.from({ length: 15 }, (_, i) => `src/${String.fromCharCode(97 + i)}.ts`),
      importedBy: Array.from({ length: 15 }, (_, i) => `src/consumer${i + 1}.ts`),
    };
    files.push(mainFile);

    const index: SourceIndex = {
      schemaVersion: "1.2",
      generatedAt: new Date().toISOString(),
      toolVersion: "1.0.0",
      project: {
        packageName: "cap-test",
        dependencies: {},
        devDependencies: {},
        detectedFrameworks: [],
      },
      files,
      stats: { totalFiles: 1, indexedFiles: 1, skippedFiles: 0, parseErrors: 0 },
    };

    const ctx = queryAgentContext(index, "src/main.ts");
    expect(ctx.directImports.length).toBeLessThanOrEqual(10);
    expect(ctx.directImportsTruncated).toBe(5);
    expect(ctx.directDependents.length).toBeLessThanOrEqual(10);
    expect(ctx.directDependentsTruncated).toBe(5);
  });
});

// ── Path Robustness Tests (Lane A) ────────────────────────────────────────────

describe("queryAgentContext path robustness", () => {
  const makeProject = async (cwd: string) => {
    await mkdir(join(cwd, "src"), { recursive: true });
    await mkdir(join(cwd, "src", "lib"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "path-test", version: "1.0.0" }),
    );
    await writeFile(join(cwd, "src", "index.ts"), `export function hello() { return "hi"; }\n`);
    await writeFile(
      join(cwd, "src", "lib", "utils.ts"),
      `import { hello } from "../index.js";\n` + `export function helper() { return hello(); }\n`,
    );
  };

  it("accepts forward-slashed relative path", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);
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

    const ctx = queryAgentContext(index!, "src/index.ts", cwd);
    expect(ctx.error).toBeUndefined();
    expect(ctx.file!.path).toBe("src/index.ts");
  });

  it("accepts backslash path on any platform", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);
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

    const ctx = queryAgentContext(index!, "src\\index.ts", cwd);
    expect(ctx.error).toBeUndefined();
    expect(ctx.file!.path).toBe("src/index.ts");
  });

  it("accepts nested backslash path", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);
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

    const ctx = queryAgentContext(index!, "src\\lib\\utils.ts", cwd);
    expect(ctx.error).toBeUndefined();
    expect(ctx.file!.path).toBe("src/lib/utils.ts");
  });

  it("accepts absolute path inside project root", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);
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

    const absPath = join(cwd, "src", "index.ts");
    const ctx = queryAgentContext(index!, absPath, cwd);
    expect(ctx.error).toBeUndefined();
    expect(ctx.file!.path).toBe("src/index.ts");
  });

  it("returns canonical forward-slashed path for absolute Windows-style input", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);
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

    // Simulate a Windows-style absolute path with backslashes
    const winPath = cwd.replace(/\//g, "\\") + "\\src\\index.ts";
    const ctx = queryAgentContext(index!, winPath, cwd);
    expect(ctx.error).toBeUndefined();
    // Canonical path always uses forward slashes
    expect(ctx.file!.path).toBe("src/index.ts");
  });

  it("suggested commands use forward slashes", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);
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

    const ctx = queryAgentContext(index!, "src\\lib\\utils.ts", cwd);
    expect(ctx.error).toBeUndefined();
    for (const cmd of ctx.suggestedCommands) {
      expect(cmd).not.toContain("\\");
    }
  });

  it("path outside project root returns error", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);
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

    const ctx = queryAgentContext(index!, "/some/other/project/src/file.ts", cwd);
    expect(ctx.error).toBeDefined();
    expect(ctx.error).toContain("not found");
  });

  it("missing file returns user-facing error with original path", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd);
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

    const ctx = queryAgentContext(index!, "src\\nonexistent.ts", cwd);
    expect(ctx.error).toBeDefined();
    expect(ctx.error).toContain("not found");
    // Error message should reference the original user input
    expect(ctx.error).toContain("src\\nonexistent.ts");
  });
});
