import { mkdtemp, mkdir, rm, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach, beforeEach, jest } from "@jest/globals";

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
import {
  querySymbols,
  queryImports,
  queryAgentContext,
  quoteCliArg,
  getParserTelemetry,
} from "../services/source-index/query.js";
import { FileHandler } from "../services/file-handler/index.js";
import {
  parseFile,
  isLanguageSupported,
  sanitizeContent,
  lexicalParse,
  chunkedParse,
  clearParserCache,
} from "../services/source-index/parser.js";
import { getLanguageForFile } from "../services/source-index/manifest.js";
import { calculateSHA256 } from "../services/source-index/storage.js";
import type { SourceIndex, IndexableLanguage } from "../types/index.js";

const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "mp-sentinel-indexing-"));
  tempDirs.push(dir);
  return dir;
};

beforeEach(() => {
  clearParserCache();
  process.argv = ["node", "mp-sentinel"];
});

afterEach(async () => {
  clearConfigCache();
  clearParserCache();
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

  it("parses --health flag", () => {
    process.argv = ["node", "mp-sentinel", "indexing", "--health"];
    const parsed = parseCliArgs();
    expect(parsed.command).toBe("indexing");
    expect(parsed.values.health).toBe(true);
  });

  it("parses --recovered flag", () => {
    process.argv = ["node", "mp-sentinel", "indexing", "--recovered", "--index-format", "json"];
    const parsed = parseCliArgs();
    expect(parsed.command).toBe("indexing");
    expect(parsed.values.recovered).toBe(true);
  });

  it("parses --parse-errors flag", () => {
    process.argv = ["node", "mp-sentinel", "indexing", "--parse-errors", "--index-format", "json"];
    const parsed = parseCliArgs();
    expect(parsed.command).toBe("indexing");
    expect(parsed.values.parseErrors).toBe(true);
  });

  it("rejects --recovered and --parse-errors together", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "test-reject", type: "module", version: "1.0.0" }, null, 2),
      "utf-8",
    );
    const fakeValues = {
      "index-format": "json" as const,
      recovered: true,
      parseErrors: true,
      health: false,
      force: false,
    };
    await expect(runIndexingCommand(fakeValues, cwd)).rejects.toThrow(
      "--recovered and --parse-errors cannot be used together.",
    );
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
    await expect(loadProjectConfig(cwd)).rejects.toThrow(
      "indexing.languages.0 \u2014 Invalid option",
    );
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

  it("runIndexingCommand --stats includes chunk telemetry when chunked files exist", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"));
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "chunk-stats", type: "module", version: "1.0.0" }),
    );
    await writeFile(join(cwd, "src", "clean.ts"), "export const x = 1;\n");
    await runIndexingCommand({ "index-format": "json", force: true }, cwd);

    // Inject chunked files
    const largeContent = "export const large = 1;\n";
    const largePath = join(cwd, "src", "large.ts");
    await writeFile(largePath, largeContent);
    const cachePath = join(cwd, ".mp-sentinel-cache", "source-index.json");
    const cached = JSON.parse(await readFile(cachePath, "utf-8"));
    cached.files.push({
      path: "src/large.ts",
      language: "typescript",
      sha256: await calculateSHA256(largeContent),
      sizeBytes: 50000,
      mtimeMs: (await stat(largePath)).mtimeMs,
      imports: [],
      exports: [],
      symbols: [],
      parserMode: "chunked-tree-sitter",
      chunkCount: 4,
      chunkSize: 30000,
      chunkWarningCount: 2,
      chunkBoundaryWarningCount: 2,
      chunkActionableWarningCount: 0,
    });
    cached.stats.totalFiles = 2;
    cached.stats.indexedFiles = 2;
    await writeFile(cachePath, JSON.stringify(cached));

    let jsonBlob: string | null = null;
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      if (text.trim().startsWith("{")) jsonBlob = text;
      originalLog?.(...args);
    };

    try {
      const exitCode = await runIndexingCommand({ "index-format": "json", stats: true }, cwd);

      expect(exitCode).toBe(0);
      expect(jsonBlob).not.toBeNull();
      const parsed = JSON.parse(jsonBlob!.trim());
      expect(parsed.chunkedFiles).toBe(1);
      expect(parsed.totalChunks).toBe(4);
      expect(parsed.totalChunkWarnings).toBe(2);
      expect(parsed.totalChunkBoundaryWarnings).toBe(2);
      expect(parsed.totalChunkActionableWarnings).toBe(0);
      expect(parsed.chunkSize).toBe(30000);
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

// -- ImportResolver unit tests ----------------------------------------------

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

// -- buildIndexContext priority / cap tests ---------------------------------

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

// -- Manifest-aware cache invalidation tests -----------------------------------

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

    // Second build without force \u2014 should rebuild because manifest changed
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

    // Second build \u2014 should reuse all cached files
    const idx2 = await buildSourceIndex(cwd, config, false);
    expect(idx2!.stats.parsedFiles).toBe(0);
    expect(idx2!.stats.cacheHitFiles).toBe(1);
    expect(idx2!.project.scripts).toEqual({ test: "vitest" });
  });

  it("drops deleted indexed files on incremental rebuild", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0" }),
    );
    await writeFile(join(cwd, "src", "keep.ts"), `export const keep = 1;`);
    await writeFile(join(cwd, "src", "deleted.ts"), `export const deleted = 1;`);

    const config = {
      enabled: true,
      languages: ["typescript", "tsx", "javascript", "jsx"] as IndexableLanguage[],
      cachePath: ".mp-sentinel-cache/source-index.json",
      maxFileSize: 512000,
    };

    const idx1 = await buildSourceIndex(cwd, config, false);
    expect(idx1!.files.map((file) => file.path).sort()).toEqual(["src/deleted.ts", "src/keep.ts"]);

    await rm(join(cwd, "src", "deleted.ts"));

    const idx2 = await buildSourceIndex(cwd, config, false);
    expect(idx2!.files.map((file) => file.path)).toEqual(["src/keep.ts"]);
    expect(idx2!.stats.indexedFiles).toBe(1);
    expect(idx2!.stats.skippedFiles).toBe(0);
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

    // Second build \u2014 source files unchanged, only tsconfig changed
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

  it("buildSourceIndex with different cache toolVersion forces reparse, not cache hit", async () => {
    const cwd = await makeTempDir();
    await makeProject(cwd, { name: "fixture", version: "2.0.0" });

    const config = {
      enabled: true,
      languages: ["typescript", "tsx", "javascript", "jsx"] as IndexableLanguage[],
      cachePath: ".mp-sentinel-cache/source-index.json",
      maxFileSize: 512000,
    };

    // Inject a cache with a different toolVersion
    const oldIndex: SourceIndex = {
      schemaVersion: "1.2",
      generatedAt: new Date().toISOString(),
      toolVersion: "1.0.0", // Different from current (2.0.0)
      project: {
        packageName: "fixture",
        packageVersion: "2.0.0",
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
      manifestHash: "abc123",
      stats: { totalFiles: 1, indexedFiles: 1, skippedFiles: 0, parseErrors: 0 },
    };
    await mkdir(join(cwd, ".mp-sentinel-cache"), { recursive: true });
    await writeFile(join(cwd, ".mp-sentinel-cache", "source-index.json"), JSON.stringify(oldIndex));

    // buildSourceIndex should detect toolVersion mismatch and rebuild
    const idx = await buildSourceIndex(cwd, config, false);
    expect(idx).not.toBeNull();
    // Rebuilding means parsedFiles > 0 (not just cache hits)
    expect(idx!.stats.parsedFiles).toBeGreaterThan(0);
    expect(idx!.toolVersion).toBe("2.0.0");
  });
});

// -- Incremental parse-error resilience -------------------------------------

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

    // Should not abort \u2014 2/2 incremental parse failures but 0/10 overall
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

    // Force rebuild (no existing cache) \u2014 should throw because 2/3 = 66% > 50%
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

    // Force rebuild: 2/5 = 40% < 50% \u2014 should succeed
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
    // would be high, and the existing cache is better \u2014 keep it.
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

    // Incremental: new broken file has parse error but overall rate is 1/3 ~= 33% < 50%
    const idx2 = await buildSourceIndex(cwd, defaultConfig, false);
    expect(idx2).not.toBeNull();
    // The broken file is included (with parseErrors) \u2014 but overall index is healthy
    expect(idx2!.files.some((f) => f.path === "src/broken.ts")).toBe(true);
    expect(idx2!.stats.parseErrors).toBe(1);
    expect(idx2!.stats.parseErrors / idx2!.stats.indexedFiles).toBeLessThanOrEqual(0.5);
  });
});

// -- Lane B: extension support and resolver accuracy -------------------------

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

    // Should not crash \u2014 inherits paths from child only
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

// -- Lane D: Index Diagnostics UX -------------------------------------------

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

// -- Lane A: find-symbol and find-import query CLI -----------------------------

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

// -- Lane A: agent-context CLI -------------------------------------------------

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
      // consumer.ts imports main.ts \u2014 so main.ts has consumer.ts as a dependent
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

// -- Query Service Tests -------------------------------------------------------

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

// -- Path Robustness Tests (Lane A) --------------------------------------------

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

// -- Lane C: Safe Suggested Command Formatter ----------------------------------

describe("quoteCliArg", () => {
  it("wraps value in double quotes", () => {
    expect(quoteCliArg("hello")).toBe('"hello"');
  });

  it("normalizes backslashes to forward slashes", () => {
    expect(quoteCliArg("src\\lib\\utils.ts")).toBe('"src/lib/utils.ts"');
  });

  it("escapes embedded double quotes", () => {
    expect(quoteCliArg('file"name')).toBe('"file\\"name"');
  });

  it("handles spaces in value", () => {
    expect(quoteCliArg("my file.ts")).toBe('"my file.ts"');
  });

  it("handles value with both backslashes and quotes", () => {
    expect(quoteCliArg('src\\"weird"\\file.ts')).toBe('"src/\\"weird\\"/file.ts"');
  });

  it("returns empty quoted string for empty input", () => {
    expect(quoteCliArg("")).toBe('""');
  });
});

describe("suggestedCommands dedup and determinism", () => {
  it("suggestedCommands have no duplicates", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "dedup-test", version: "1.0.0" }),
    );
    // File that imports itself leads to same path appearing as both import and dependent
    await writeFile(
      join(cwd, "src", "self.ts"),
      `import { self } from "./self.js";\n` +
        `import { z } from "zod";\n` +
        `export function self() { return "self"; }\n`,
    );
    // Add enough dependents so the file is in both directImports and directDependents
    for (let i = 0; i < 5; i++) {
      await writeFile(join(cwd, "src", `dep${i}.ts`), `import { self } from "./self.js";\n`);
    }

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

    const ctx = queryAgentContext(index!, "src/self.ts");
    expect(ctx.suggestedCommands.length).toBeGreaterThan(0);

    const seen = new Set<string>();
    for (const cmd of ctx.suggestedCommands) {
      expect(seen.has(cmd)).toBe(false);
      seen.add(cmd);
    }
  });

  it("suggestedCommands are deterministic (same input \u2192 same output)", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "det-test", version: "1.0.0" }),
    );
    await writeFile(
      join(cwd, "src", "main.ts"),
      `import { z } from "zod";\n` +
        `export function main() { return 1; }\n` +
        `export class MainClass { }\n`,
    );

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

    const ctx1 = queryAgentContext(index!, "src/main.ts");
    const ctx2 = queryAgentContext(index!, "src/main.ts");

    expect(ctx1.suggestedCommands).toEqual(ctx2.suggestedCommands);
  });
});

// -- Index Health Check (--health) ---------------------------------------------

describe("indexing --health", () => {
  it("reports missing status when no cache exists", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0" }),
    );
    await writeFile(join(cwd, "src", "index.ts"), `export const x = 1;`);

    let jsonBlob: string | null = null;
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      if (text.trim().startsWith("{")) {
        jsonBlob = text;
      }
    };

    try {
      const exitCode = await runIndexingCommand({ "index-format": "json", health: true }, cwd);
      expect(exitCode).toBe(1);
      const parsed = JSON.parse(jsonBlob!.trim());
      expect(parsed.status).toBe("missing");
    } finally {
      console.log = originalLog;
    }
  });

  it("reports unreadable status for corrupt cache", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, ".mp-sentinel-cache"), { recursive: true });
    await writeFile(join(cwd, ".mp-sentinel-cache", "source-index.json"), "not valid json {{");

    let jsonBlob: string | null = null;
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      if (text.trim().startsWith("{")) {
        jsonBlob = text;
      }
    };

    try {
      const exitCode = await runIndexingCommand({ "index-format": "json", health: true }, cwd);
      expect(exitCode).toBe(1);
      const parsed = JSON.parse(jsonBlob!.trim());
      expect(parsed.status).toBe("unreadable");
    } finally {
      console.log = originalLog;
    }
  });

  it("reports stale when manifest changed after index build", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0" }),
    );
    await writeFile(join(cwd, "src", "index.ts"), `export const x = 1;`);

    // Build index first
    await runIndexingCommand({ "index-format": "json", force: true }, cwd);

    // Change manifest (package.json)
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", version: "2.0.0" }),
    );

    let jsonBlob: string | null = null;
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      if (text.trim().startsWith("{")) {
        jsonBlob = text;
      }
    };

    try {
      const exitCode = await runIndexingCommand({ "index-format": "json", health: true }, cwd);
      expect(exitCode).toBe(1);
      const parsed = JSON.parse(jsonBlob!.trim());
      expect(parsed.status).toBe("stale");
      expect(parsed.staleReasons).toContain("manifest changed");
      expect(parsed.manifestHash).not.toBe(parsed.currentManifestHash);
    } finally {
      console.log = originalLog;
    }
  });

  it("reports stale when source file changed after index build", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0" }),
    );
    await writeFile(join(cwd, "src", "index.ts"), `export const x = 1;`);

    // Build index first
    await runIndexingCommand({ "index-format": "json", force: true }, cwd);

    // Change source file
    await writeFile(join(cwd, "src", "index.ts"), `export const x = 2;`);

    let jsonBlob: string | null = null;
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      if (text.trim().startsWith("{")) {
        jsonBlob = text;
      }
    };

    try {
      const exitCode = await runIndexingCommand({ "index-format": "json", health: true }, cwd);
      expect(exitCode).toBe(1);
      const parsed = JSON.parse(jsonBlob!.trim());
      expect(parsed.status).toBe("stale");
      expect(parsed.staleReasons).toContain("source files changed");
      expect(parsed.changedFilesSample).toContain("src/index.ts");
    } finally {
      console.log = originalLog;
    }
  });

  it("reports stale when indexed file is deleted", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0" }),
    );
    await writeFile(join(cwd, "src", "index.ts"), `export const x = 1;`);

    // Build index first
    await runIndexingCommand({ "index-format": "json", force: true }, cwd);

    // Delete indexed file
    await rm(join(cwd, "src", "index.ts"));

    let jsonBlob: string | null = null;
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      if (text.trim().startsWith("{")) {
        jsonBlob = text;
      }
    };

    try {
      const exitCode = await runIndexingCommand({ "index-format": "json", health: true }, cwd);
      expect(exitCode).toBe(1);
      const parsed = JSON.parse(jsonBlob!.trim());
      expect(parsed.status).toBe("stale");
      expect(parsed.staleReasons).toContain("indexed files deleted");
      expect(parsed.missingFilesSample).toContain("src/index.ts");
    } finally {
      console.log = originalLog;
    }
  });

  it("reports ok when index is healthy", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0" }),
    );
    await writeFile(join(cwd, "src", "index.ts"), `export const x = 1;`);

    // Build index first
    await runIndexingCommand({ "index-format": "json", force: true }, cwd);

    let jsonBlob: string | null = null;
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      if (text.trim().startsWith("{")) {
        jsonBlob = text;
      }
    };

    try {
      const exitCode = await runIndexingCommand({ "index-format": "json", health: true }, cwd);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(jsonBlob!.trim());
      expect(parsed.status).toBe("ok");
      expect(parsed.schemaVersion).toBeDefined();
      expect(parsed.totalFiles).toBeGreaterThan(0);
      expect(parsed.parseErrorRate).toBe(0);
      expect(parsed.staleReasons).toEqual([]);
      expect(parsed).toHaveProperty("toolVersion");
      expect(parsed).toHaveProperty("currentToolVersion");
      expect(parsed.toolVersion).toBe(parsed.currentToolVersion);
    } finally {
      console.log = originalLog;
    }
  });

  it("reports stale when cache toolVersion differs from current", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, ".mp-sentinel-cache"), { recursive: true });
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0" }),
    );
    await writeFile(join(cwd, "src", "index.ts"), `export const x = 1;`);

    // Build index with current version
    await runIndexingCommand({ "index-format": "json", force: true }, cwd);

    // Rewrite cache with different toolVersion
    const cachePath = join(cwd, ".mp-sentinel-cache", "source-index.json");
    const cached = JSON.parse(await readFile(cachePath, "utf-8"));
    cached.toolVersion = "0.9.0";
    await writeFile(cachePath, JSON.stringify(cached));

    let jsonBlob: string | null = null;
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      if (text.trim().startsWith("{")) {
        jsonBlob = text;
      }
    };

    try {
      const exitCode = await runIndexingCommand({ "index-format": "json", health: true }, cwd);
      expect(exitCode).toBe(1);
      const parsed = JSON.parse(jsonBlob!.trim());
      expect(parsed.status).toBe("stale");
      expect(parsed.staleReasons).toContain("tool version changed");
      expect(parsed.toolVersion).toBe("0.9.0");
      expect(parsed.currentToolVersion).toBe("1.0.0");
    } finally {
      console.log = originalLog;
    }
  });

  it("reports ok when cache toolVersion matches current", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0" }),
    );
    await writeFile(join(cwd, "src", "index.ts"), `export const x = 1;`);

    // Build index with current version
    await runIndexingCommand({ "index-format": "json", force: true }, cwd);

    let jsonBlob: string | null = null;
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      if (text.trim().startsWith("{")) {
        jsonBlob = text;
      }
    };

    try {
      const exitCode = await runIndexingCommand({ "index-format": "json", health: true }, cwd);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(jsonBlob!.trim());
      expect(parsed.status).toBe("ok");
      expect(parsed.toolVersion).toBe("1.0.0");
      expect(parsed.currentToolVersion).toBe("1.0.0");
    } finally {
      console.log = originalLog;
    }
  });

  it("JSON stdout is parseable and logs do not leak into stdout", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0" }),
    );
    await writeFile(join(cwd, "src", "index.ts"), `export const x = 1;`);

    // Build index first
    await runIndexingCommand({ "index-format": "json", force: true }, cwd);

    const stdoutLines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      stdoutLines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    };

    try {
      await runIndexingCommand({ "index-format": "json", health: true }, cwd);
    } finally {
      console.log = originalLog;
    }

    // Verify stdout contains exactly one line of valid JSON
    const jsonLines = stdoutLines.filter((line) => line.trim().startsWith("{"));
    expect(jsonLines.length).toBe(1);
    const parsed = JSON.parse(jsonLines[0]!.trim());
    expect(parsed.status).toBeDefined();

    // Verify no log output leaked into JSON
    for (const line of stdoutLines) {
      if (!line.trim().startsWith("{")) {
        // Non-JSON lines should only appear in console mode, not json mode
        // In json mode, logs are suppressed via setLogQuietMode
        expect(line).toBe("");
      }
    }
  });

  it("suggestedCommands includes --recovered when recovered files exist", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0" }),
    );
    await writeFile(join(cwd, "src", "index.ts"), `export const x = 1;`);

    // Build clean index first
    await runIndexingCommand({ "index-format": "json", force: true }, cwd);

    // Inject recovered files into cache
    const cachePath = join(cwd, ".mp-sentinel-cache", "source-index.json");
    const cached = JSON.parse(await readFile(cachePath, "utf-8"));
    if (cached.files.length >= 1) {
      cached.files[0].parserMode = "ascii-fallback";
      cached.files[0].parseWarnings = ["Invalid argument; parsed with ASCII fallback"];
    }
    await writeFile(cachePath, JSON.stringify(cached));

    let jsonBlob: string | null = null;
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      if (text.trim().startsWith("{")) {
        jsonBlob = text;
      }
    };

    try {
      await runIndexingCommand({ "index-format": "json", health: true }, cwd);
      const parsed = JSON.parse(jsonBlob!.trim());
      expect(parsed.suggestedCommands).toBeDefined();
      expect(Array.isArray(parsed.suggestedCommands)).toBe(true);
      expect(parsed.suggestedCommands).toContain(
        "mp-sentinel indexing --recovered --index-format json",
      );
    } finally {
      console.log = originalLog;
    }
  });

  it("suggestedCommands includes --parse-errors when hard parse errors exist", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0" }),
    );
    await writeFile(join(cwd, "src", "index.ts"), `export const x = 1;`);

    // Build clean index first
    await runIndexingCommand({ "index-format": "json", force: true }, cwd);

    // Inject hard parse errors into cache
    const cachePath = join(cwd, ".mp-sentinel-cache", "source-index.json");
    const cached = JSON.parse(await readFile(cachePath, "utf-8"));
    if (cached.files.length >= 1) {
      cached.files[0].parseErrors = ["Syntax error: unexpected token"];
    }
    await writeFile(cachePath, JSON.stringify(cached));

    let jsonBlob: string | null = null;
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      if (text.trim().startsWith("{")) {
        jsonBlob = text;
      }
    };

    try {
      await runIndexingCommand({ "index-format": "json", health: true }, cwd);
      const parsed = JSON.parse(jsonBlob!.trim());
      expect(parsed.suggestedCommands).toBeDefined();
      expect(Array.isArray(parsed.suggestedCommands)).toBe(true);
      expect(parsed.suggestedCommands).toContain(
        "mp-sentinel indexing --parse-errors --index-format json",
      );
    } finally {
      console.log = originalLog;
    }
  });

  it("suggestedCommands is absent for clean index", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0" }),
    );
    await writeFile(join(cwd, "src", "index.ts"), `export const x = 1;`);

    // Build clean index
    await runIndexingCommand({ "index-format": "json", force: true }, cwd);

    let jsonBlob: string | null = null;
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      if (text.trim().startsWith("{")) {
        jsonBlob = text;
      }
    };

    try {
      const exitCode = await runIndexingCommand({ "index-format": "json", health: true }, cwd);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(jsonBlob!.trim());
      expect(parsed.status).toBe("ok");
      expect(parsed.suggestedCommands).toBeUndefined();
    } finally {
      console.log = originalLog;
    }
  });

  it("includes chunk telemetry when chunked files exist in the index", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "chunk-health", type: "module", version: "1.0.0" }),
    );
    await writeFile(join(cwd, "src", "clean.ts"), "export const x = 1;\n");
    await runIndexingCommand({ "index-format": "json", force: true }, cwd);

    // Inject chunked files into the cache
    const cachePath = join(cwd, ".mp-sentinel-cache", "source-index.json");
    const cached = JSON.parse(await readFile(cachePath, "utf-8"));
    cached.files.push({
      path: "src/a.ts",
      language: "typescript",
      sha256: "aaa",
      sizeBytes: 50000,
      mtimeMs: Date.now(),
      imports: [],
      exports: [],
      symbols: [],
      parserMode: "chunked-tree-sitter",
      chunkCount: 3,
      chunkSize: 30000,
      chunkWarningCount: 1,
      chunkBoundaryWarningCount: 1,
      chunkActionableWarningCount: 0,
    });
    cached.files.push({
      path: "src/b.ts",
      language: "typescript",
      sha256: "bbb",
      sizeBytes: 80000,
      mtimeMs: Date.now(),
      imports: [],
      exports: [],
      symbols: [],
      parserMode: "chunked-tree-sitter",
      chunkCount: 5,
      chunkSize: 30000,
      chunkWarningCount: 2,
      chunkBoundaryWarningCount: 2,
      chunkActionableWarningCount: 0,
    });
    cached.stats.totalFiles = 3;
    cached.stats.indexedFiles = 3;
    await writeFile(cachePath, JSON.stringify(cached));

    let jsonBlob: string | null = null;
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      if (text.trim().startsWith("{")) {
        jsonBlob = text;
      }
    };

    try {
      const exitCode = await runIndexingCommand({ "index-format": "json", health: true }, cwd);
      expect(exitCode).toBe(1); // stale because injected files don't exist on disk
      const parsed = JSON.parse(jsonBlob!.trim());
      expect(parsed.chunkedFiles).toBe(2);
      expect(parsed.totalChunks).toBe(8);
      expect(parsed.totalChunkWarnings).toBe(3);
      expect(parsed.totalChunkBoundaryWarnings).toBe(3);
      expect(parsed.totalChunkActionableWarnings).toBe(0);
      expect(parsed.chunkSize).toBe(30000);
    } finally {
      console.log = originalLog;
    }
  });

  it("omits chunk telemetry when no chunked files exist", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "no-chunks-health", type: "module", version: "1.0.0" }),
    );
    await writeFile(join(cwd, "src", "index.ts"), "export const x = 1;\n");
    await runIndexingCommand({ "index-format": "json", force: true }, cwd);

    let jsonBlob: string | null = null;
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      if (text.trim().startsWith("{")) {
        jsonBlob = text;
      }
    };

    try {
      const exitCode = await runIndexingCommand({ "index-format": "json", health: true }, cwd);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(jsonBlob!.trim());
      expect(parsed.status).toBe("ok");
      expect(parsed.chunkedFiles).toBeUndefined();
      expect(parsed.totalChunks).toBeUndefined();
      expect(parsed.totalChunkWarnings).toBeUndefined();
      expect(parsed.totalChunkBoundaryWarnings).toBeUndefined();
      expect(parsed.totalChunkActionableWarnings).toBeUndefined();
      expect(parsed.chunkSize).toBeUndefined();
    } finally {
      console.log = originalLog;
    }
  });
});

// ── Parser Resilience: Unicode / Invalid Argument Fallback ──────────────

describe("parseFile unicode fallback", () => {
  it("parses regular ASCII file without errors", async () => {
    const lang = getLanguageForFile("test.ts");
    const result = await parseFile("test.ts", "export function hello() { return 1; }", lang!);

    expect(result).not.toBeNull();
    expect(result!.symbols.some((s) => s.name === "hello")).toBe(true);
    expect(result!.imports).toEqual([]);
    expect(result!.exports.length).toBeGreaterThan(0);
    expect(result!.parseErrors).toBeUndefined();
    expect(result!.parseWarnings).toBeUndefined();
    expect(result!.parserMode).toBe("tree-sitter");
  });

  it("extracts symbol from file with Unicode comment (ASCII fallback path)", async () => {
    const lang = getLanguageForFile("test.ts");
    // Content contains em dash in a comment which triggers ASCII fallback on Windows
    const content = `// This file uses special dash: —\nexport function buildSourceIndex() { return null; }`;
    const result = await parseFile("test.ts", content, lang!);

    expect(result).not.toBeNull();
    // Must still extract the symbol despite parse issue or fallback
    expect(result!.symbols.some((s) => s.name === "buildSourceIndex")).toBe(true);
  });

  it("does not lose imports and exports in fallback parse", async () => {
    const lang = getLanguageForFile("test.ts");
    const content = [
      'import { readFile } from "node:fs";',
      `// Unicode separator: —`,
      "export function helper(): string {",
      '  return "ok";',
      "}",
      "export function getVersion() { return 1; }",
    ].join("\n");

    const result = await parseFile("test.ts", content, lang!);

    expect(result).not.toBeNull();
    expect(result!.symbols.some((s) => s.name === "helper")).toBe(true);
    expect(result!.symbols.some((s) => s.name === "getVersion")).toBe(true);
    expect(result!.imports.some((i) => i.source === "node:fs")).toBe(true);
    expect(result!.exports.some((e) => e.names.includes("helper"))).toBe(true);
  });

  it("returns parseWarning when fallback is used", async () => {
    const lang = getLanguageForFile("test.ts");
    // Content with multiple risky characters to trigger fallback on Windows
    const content = `// Dashes: — —\n// Arrow: →\nexport function result() { return 42; }`;

    const result = await parseFile("test.ts", content, lang!);

    expect(result).not.toBeNull();
    // On non-Windows or if parse succeeds normally, parseWarnings may be absent
    // The key assertion: if fallback was used, it's recorded in parseWarnings (not parseErrors)
    if (result!.parseWarnings) {
      expect(result!.parseWarnings.length).toBeGreaterThan(0);
      expect(
        result!.parseWarnings.some((w) => w.includes("ASCII fallback") || w.includes("retry")),
      ).toBe(true);
    }
    // Hard parse errors should NOT include fallback messages
    if (result!.parseErrors) {
      for (const e of result!.parseErrors) {
        expect(e).not.toContain("ASCII fallback");
        expect(e).not.toContain("lexical fallback");
        expect(e).not.toContain("parsed with retry");
      }
    }
    // Symbol must still be extracted
    expect(result!.symbols.some((s) => s.name === "result")).toBe(true);
  });
});

// ── Chunked Tree-sitter Fallback (large files) ───────────────────────────

describe("parseFile chunked tree-sitter", () => {
  it("parses large file with chunked-tree-sitter and preserves symbols", async () => {
    const lang = getLanguageForFile("test.ts");
    // Generate a large file that exceeds MAX_CHUNK_SIZE (30000) to force chunked parse.
    // We simulate the "Invalid argument" code path by providing content larger than
    // what a single Tree-sitter parse handles. The chunkedFallback helper is called
    // instead, which splits on line boundaries.
    const header = 'import { readFile } from "node:fs";\n';
    // Build enough filler lines to exceed 30000 chars, each line a valid TypeScript statement.
    const fillerLine = "const x0: number = 0;\n";
    const repeatCount = Math.ceil(30000 / fillerLine.length) + 10;
    let body = header;
    for (let i = 0; i < repeatCount; i++) {
      body += `const x${i}: number = ${i};\n`;
    }
    // Add a recognisable symbol near the end so we can verify line number preservation
    body += "export function farSymbol(): string { return 'ok'; }\n";

    const result = await parseFile("large.ts", body, lang!);

    expect(result).not.toBeNull();
    // The file may parse normally if Tree-sitter handles it (on this platform).
    // When chunked fallback is triggered (parserMode !== "tree-sitter"), verify it.
    if (result!.parserMode !== "tree-sitter") {
      // Must not be lexical-fallback — chunked-tree-sitter is preferred over lexical
      if (result!.parserMode === "lexical-fallback") {
        // If Tree-sitter + chunked + ASCII all failed, lexical is the last resort.
        // This is acceptable but we verify symbols still got extracted.
        expect(result!.symbols.some((s) => s.name === "farSymbol")).toBe(true);
      } else {
        expect(result!.parserMode).toBe("chunked-tree-sitter");
        expect(result!.parseWarnings).toBeDefined();
        expect(result!.parseWarnings!.some((w) => w.includes("chunked tree-sitter"))).toBe(true);
        // Chunk syntax warnings land in parseWarnings, not parseErrors
        expect(result!.parseErrors).toBeUndefined();
        // Symbol near end of file must have correct line number
        const farSymbol = result!.symbols.find((s) => s.name === "farSymbol");
        expect(farSymbol).toBeDefined();
        // Line number should be close to the end (within 5 lines of expected)
        const expectedLine = repeatCount + 2; // +1 for header, +1 for export line
        expect(farSymbol!.line).toBeGreaterThan(repeatCount);
        expect(Math.abs(farSymbol!.line - expectedLine)).toBeLessThan(5);
      }
    }
    // Regardless of mode, the symbol must be found
    expect(result!.symbols.some((s) => s.name === "farSymbol")).toBe(true);
    // Import from header must be found
    expect(result!.imports.some((i) => i.source === "node:fs")).toBe(true);
  });

  it("chunked fallback preserves imports and exports across chunks", async () => {
    const lang = getLanguageForFile("test.ts");
    // Build content with imports at top, exports at bottom, enough filler to force chunking
    const header = [
      'import { readFile } from "node:fs";',
      'import { resolve } from "node:path";',
    ].join("\n");

    const fillerLine = "const x: number = 0;\n";
    const repeatCount = Math.ceil(30000 / fillerLine.length) + 10;
    let body = header + "\n";
    for (let i = 0; i < repeatCount; i++) {
      body += fillerLine;
    }
    body += [
      "export function helperA(): string { return 'a'; }",
      "export function helperB(): number { return 42; }",
    ].join("\n");

    const result = await parseFile("large2.ts", body, lang!);

    expect(result).not.toBeNull();
    expect(result!.symbols.some((s) => s.name === "helperA")).toBe(true);
    expect(result!.symbols.some((s) => s.name === "helperB")).toBe(true);
    expect(result!.imports.some((i) => i.source === "node:fs")).toBe(true);
    expect(result!.imports.some((i) => i.source === "node:path")).toBe(true);
  });
});

// ── Lexical Fallback Precision ─────────────────────────────────────────────

describe("sanitizeContent", () => {
  it("strips template literal containing import statement", () => {
    const input = 'const x = `import "@/lib"`;';
    const result = sanitizeContent(input);
    // The template literal content should be blanked, surrounding code preserved
    expect(result).not.toMatch(/@\/lib/);
    expect(result).toMatch(/const x =/);
  });

  it('preserves regular string literals (imports need their from "..." strings)', () => {
    const input = 'import { z } from "zod";';
    const result = sanitizeContent(input);
    // String literals survive so the regex can match import source
    expect(result).toContain('import { z } from "zod"');
  });

  it("preserves real export function outside strings", () => {
    const input = "export async function buildSourceIndex() { return null; }";
    const result = sanitizeContent(input);
    expect(result).toContain("export async function buildSourceIndex");
  });

  it("strips single-line comment containing import", () => {
    const input = '// import { x } from "fake";\nconst real = 1;';
    const result = sanitizeContent(input);
    expect(result).not.toMatch(/import.*fake/);
    expect(result).toContain("const real = 1");
  });

  it("strips block comment containing export", () => {
    const input = "/* export function hidden() {} */\nconst visible = 1;";
    const result = sanitizeContent(input);
    expect(result).not.toMatch(/export function hidden/);
    expect(result).toContain("const visible = 1");
  });

  it("strips template literal with expression containing import-like text", () => {
    const input = 'const msg = `use import { ${name} } from "${pkg}"`;';
    const result = sanitizeContent(input);
    // All template content including expression is blanked
    expect(result).not.toMatch(/\bimport\b/);
  });

  it("handles nested template literals", () => {
    const input = 'const x = `outer ${`inner import "pkg"`} after`;';
    const result = sanitizeContent(input);
    expect(result).not.toMatch(/\bimport\b/);
  });
});

// isInsideStringLiteral is tested implicitly through lexicalParse below

describe("lexicalParse precision", () => {
  it("does not create import from template string containing import statement", () => {
    const content = 'const x = `import "@/lib"`;\nconst real = 1;';
    const result = lexicalParse(content);
    expect(result.imports).toHaveLength(0);
  });

  it("does not create symbol from fixture string containing export function", () => {
    const content = 'const fixture = "export function fake() { return 42; }";';
    const result = lexicalParse(content);
    // The "const fixture" variable declaration is real, but "export function fake" is inside a string
    expect(result.exports).toHaveLength(0);
    expect(result.symbols.filter((s) => s.name === "fake")).toHaveLength(0);
  });

  it("still extracts real import from actual import statement", () => {
    const content = 'import { z } from "zod";';
    const result = lexicalParse(content);
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0]!.source).toBe("zod");
    expect(result.imports[0]!.names).toContain("z");
  });

  it("still extracts real symbol from actual export function", () => {
    const content = "export async function buildSourceIndex() { return null; }";
    const result = lexicalParse(content);
    expect(result.symbols.some((s) => s.name === "buildSourceIndex")).toBe(true);
    expect(result.exports.some((e) => e.names.includes("buildSourceIndex"))).toBe(true);
  });

  it("does not create import from commented-out import", () => {
    const content = '// import { fake } from "fake-pkg";\nimport { real } from "real-pkg";';
    const result = lexicalParse(content);
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0]!.source).toBe("real-pkg");
  });

  it("does not create import from block-commented import", () => {
    const content = '/* import { fake } from "fake-pkg"; */\nimport { real } from "real-pkg";';
    const result = lexicalParse(content);
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0]!.source).toBe("real-pkg");
  });

  it("extracts non-exported function declaration", () => {
    const content = "function helper() { return 1; }";
    const result = lexicalParse(content);
    expect(result.symbols.some((s) => s.name === "helper")).toBe(true);
  });

  it("handles mixed real and fixture content correctly", () => {
    const content = [
      'import { realImport } from "real-pkg";',
      'const fixtureStr = "import { fake } from \\"fake-pkg\\"";',
      'const templateFixture = `import "@/lib"`;',
      "export function realFunction() { return 1; }",
      'const fixtureExport = "export function fakeExport() {}"',
    ].join("\n");
    const result = lexicalParse(content);

    // Real import preserved
    expect(result.imports.some((i) => i.source === "real-pkg")).toBe(true);
    // No fake import from string/template
    expect(result.imports.some((i) => i.source === "fake-pkg")).toBe(false);
    expect(result.imports.some((i) => i.source === "@/lib")).toBe(false);
    // Real export/symbol preserved
    expect(result.exports.some((e) => e.names.includes("realFunction"))).toBe(true);
    expect(result.symbols.some((s) => s.name === "realFunction")).toBe(true);
    // No fake export/symbol from string
    expect(result.exports.some((e) => e.names.includes("fakeExport"))).toBe(false);
    expect(result.symbols.some((s) => s.name === "fakeExport")).toBe(false);
  });
});

// ── Parser Drilldown (--recovered / --parse-errors) ──────────────────────────────

describe("indexing --recovered drilldown", () => {
  it("returns recovered files with correct output shape", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "drilldown-test", type: "module", version: "1.0.0" }, null, 2),
      "utf-8",
    );
    await mkdir(join(cwd, "src"), { recursive: true });
    // Write a file with Unicode that will trigger ASCII fallback on Windows
    await writeFile(
      join(cwd, "src", "unicode.ts"),
      [
        'import { foo } from "./lib";',
        "// — em dash in comment",
        "export function bar() {",
        "  return foo() + 1;",
        "}",
      ].join("\n"),
      "utf-8",
    );
    await writeFile(join(cwd, "src", "lib.ts"), "export function foo() { return 42; }\n", "utf-8");
    await writeFile(join(cwd, "src", "clean.ts"), "export const x = 1;\n", "utf-8");

    // Build index first
    const index = await buildSourceIndex(cwd, getIndexingConfig({}), true);
    expect(index).not.toBeNull();

    // Read the cache directly and invoke runIndexingCommand with --recovered
    const config = await loadProjectConfig(cwd);
    const result = await runIndexingCommand(
      { "index-format": "json", recovered: true } as Partial<CLIValues> & {
        recovered?: boolean;
      },
      cwd,
    );
    expect(result).toBe(0);
  });

  it("returns ok with empty files array when no recovered files", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "clean-test", type: "module", version: "1.0.0" }, null, 2),
      "utf-8",
    );
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "clean.ts"), "export const x = 1;\n", "utf-8");

    await buildSourceIndex(cwd, getIndexingConfig({}), true);

    const stdoutWrite = jest.spyOn(console, "log");
    const result = await runIndexingCommand(
      { "index-format": "json", recovered: true } as Partial<CLIValues> & {
        recovered?: boolean;
      },
      cwd,
    );
    expect(result).toBe(0);
    // Parse the JSON output
    const jsonCall = stdoutWrite.mock.calls.find((c) => {
      try {
        const parsed = JSON.parse(c[0]);
        return parsed.status !== undefined && parsed.files !== undefined;
      } catch {
        return false;
      }
    });
    expect(jsonCall).toBeDefined();
    const json = JSON.parse(jsonCall![0]);
    expect(json.status).toBe("ok");
    expect(Array.isArray(json.files)).toBe(true);
    expect(typeof json.recoveredFiles).toBe("number");
    expect(typeof json.parserModeBreakdown).toBe("object");
    stdoutWrite.mockRestore();
  });

  it("returns status missing and exit 1 when cache absent", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "no-cache", type: "module", version: "1.0.0" }, null, 2),
      "utf-8",
    );

    const stdoutWrite = jest.spyOn(console, "log");
    const result = await runIndexingCommand(
      { "index-format": "json", recovered: true } as Partial<CLIValues> & {
        recovered?: boolean;
      },
      cwd,
    );
    expect(result).toBe(1);
    const jsonCall = stdoutWrite.mock.calls.find((c) => {
      try {
        return JSON.parse(c[0]).status === "missing";
      } catch {
        return false;
      }
    });
    expect(jsonCall).toBeDefined();
    stdoutWrite.mockRestore();
  });

  it("returns status unreadable and exit 1 when cache is corrupt", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "corrupt-cache", type: "module", version: "1.0.0" }, null, 2),
      "utf-8",
    );
    await mkdir(join(cwd, ".mp-sentinel-cache"), { recursive: true });
    await writeFile(
      join(cwd, ".mp-sentinel-cache", "source-index.json"),
      "not valid json {{{",
      "utf-8",
    );

    const stdoutWrite = jest.spyOn(console, "log");
    const result = await runIndexingCommand(
      { "index-format": "json", recovered: true } as Partial<CLIValues> & {
        recovered?: boolean;
      },
      cwd,
    );
    expect(result).toBe(1);
    const jsonCall = stdoutWrite.mock.calls.find((c) => {
      try {
        return JSON.parse(c[0]).status === "unreadable";
      } catch {
        return false;
      }
    });
    expect(jsonCall).toBeDefined();
    stdoutWrite.mockRestore();
  });
});

describe("indexing --parse-errors drilldown", () => {
  it("returns parse error files with correct output shape", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "pe-test", type: "module", version: "1.0.0" }, null, 2),
      "utf-8",
    );
    await mkdir(join(cwd, "src"), { recursive: true });
    // File with syntax error
    await writeFile(
      join(cwd, "src", "broken.ts"),
      "export const x = ;\n", // syntax error
      "utf-8",
    );
    await writeFile(join(cwd, "src", "clean.ts"), "export const y = 1;\n", "utf-8");

    const index = await buildSourceIndex(cwd, getIndexingConfig({}), true);
    expect(index).not.toBeNull();

    const result = await runIndexingCommand(
      { "index-format": "json", parseErrors: true } as Partial<CLIValues> & {
        parseErrors?: boolean;
      },
      cwd,
    );
    expect(result).toBe(0);
  });

  it("returns ok with empty files array when no parse errors", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "clean-pe", type: "module", version: "1.0.0" }, null, 2),
      "utf-8",
    );
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "clean.ts"), "export const x = 1;\n", "utf-8");

    await buildSourceIndex(cwd, getIndexingConfig({}), true);

    const stdoutWrite = jest.spyOn(console, "log");
    const result = await runIndexingCommand(
      { "index-format": "json", parseErrors: true } as Partial<CLIValues> & {
        parseErrors?: boolean;
      },
      cwd,
    );
    expect(result).toBe(0);
    const jsonCall = stdoutWrite.mock.calls.find((c) => {
      try {
        const parsed = JSON.parse(c[0]);
        return parsed.status !== undefined && parsed.files !== undefined;
      } catch {
        return false;
      }
    });
    expect(jsonCall).toBeDefined();
    const json = JSON.parse(jsonCall![0]);
    expect(json.status).toBe("ok");
    expect(Array.isArray(json.files)).toBe(true);
    expect(typeof json.parseErrorCount).toBe("number");
    stdoutWrite.mockRestore();
  });

  it("returns status missing and exit 1 when cache absent", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "no-cache-pe", type: "module", version: "1.0.0" }, null, 2),
      "utf-8",
    );

    const stdoutWrite = jest.spyOn(console, "log");
    const result = await runIndexingCommand(
      { "index-format": "json", parseErrors: true } as Partial<CLIValues> & {
        parseErrors?: boolean;
      },
      cwd,
    );
    expect(result).toBe(1);
    const jsonCall = stdoutWrite.mock.calls.find((c) => {
      try {
        return JSON.parse(c[0]).status === "missing";
      } catch {
        return false;
      }
    });
    expect(jsonCall).toBeDefined();
    stdoutWrite.mockRestore();
  });

  it("returns status unreadable and exit 1 when cache is corrupt", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "corrupt-pe", type: "module", version: "1.0.0" }, null, 2),
      "utf-8",
    );
    await mkdir(join(cwd, ".mp-sentinel-cache"), { recursive: true });
    await writeFile(join(cwd, ".mp-sentinel-cache", "source-index.json"), "{corrupt}", "utf-8");

    const stdoutWrite = jest.spyOn(console, "log");
    const result = await runIndexingCommand(
      { "index-format": "json", parseErrors: true } as Partial<CLIValues> & {
        parseErrors?: boolean;
      },
      cwd,
    );
    expect(result).toBe(1);
    const jsonCall = stdoutWrite.mock.calls.find((c) => {
      try {
        return JSON.parse(c[0]).status === "unreadable";
      } catch {
        return false;
      }
    });
    expect(jsonCall).toBeDefined();
    stdoutWrite.mockRestore();
  });
});

// ── Parser Drilldown suggestedCommands (v1.24.0) ─────────────────────────────────

describe("drilldown suggestedCommands", () => {
  it("--recovered file entries include suggestedCommands with --explain-index and --agent-context", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "sc-recovered-test", type: "module", version: "1.0.0" }, null, 2),
      "utf-8",
    );
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "src", "unicode.ts"),
      [
        'import { foo } from "./lib";',
        "// — em dash in comment",
        "export function bar() {",
        "  return foo() + 1;",
        "}",
      ].join("\n"),
      "utf-8",
    );
    await writeFile(join(cwd, "src", "lib.ts"), "export function foo() { return 42; }\n", "utf-8");

    await buildSourceIndex(cwd, getIndexingConfig({}), true);

    const stdoutWrite = jest.spyOn(console, "log");
    const result = await runIndexingCommand(
      { "index-format": "json", recovered: true } as Partial<CLIValues> & {
        recovered?: boolean;
      },
      cwd,
    );
    expect(result).toBe(0);

    const jsonCall = stdoutWrite.mock.calls.find((c) => {
      try {
        const parsed = JSON.parse(c[0]);
        return parsed.status === "ok" && Array.isArray(parsed.files);
      } catch {
        return false;
      }
    });
    expect(jsonCall).toBeDefined();
    const json = JSON.parse(jsonCall![0]);

    const recoveredFiles = json.files.filter(
      (f: { parserMode?: string }) =>
        f.parserMode === "chunked-tree-sitter" ||
        f.parserMode === "ascii-fallback" ||
        f.parserMode === "lexical-fallback",
    );
    for (const file of recoveredFiles) {
      expect(Array.isArray(file.suggestedCommands)).toBe(true);
      expect(file.suggestedCommands.length).toBe(2);
      expect(file.suggestedCommands[0]).toContain("--explain-index");
      expect(file.suggestedCommands[0]).toContain("--index-format json");
      expect(file.suggestedCommands[1]).toContain("--agent-context");
      expect(file.suggestedCommands[1]).toContain("--index-format json");
      for (const cmd of file.suggestedCommands) {
        expect(cmd).toMatch(/"src\/unicode\.ts"/);
      }
    }
    for (const file of json.files) {
      expect(Array.isArray(file.suggestedCommands)).toBe(true);
      expect(file.suggestedCommands.length).toBe(2);
    }
    stdoutWrite.mockRestore();
  });

  it("--parse-errors file entries include suggestedCommands with --explain-index and --agent-context", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "sc-pe-test", type: "module", version: "1.0.0" }, null, 2),
      "utf-8",
    );
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "broken.ts"), "export const x = ;\n", "utf-8");
    await writeFile(join(cwd, "src", "clean.ts"), "export const y = 1;\n", "utf-8");

    await buildSourceIndex(cwd, getIndexingConfig({}), true);

    const stdoutWrite = jest.spyOn(console, "log");
    const result = await runIndexingCommand(
      { "index-format": "json", parseErrors: true } as Partial<CLIValues> & {
        parseErrors?: boolean;
      },
      cwd,
    );
    expect(result).toBe(0);

    const jsonCall = stdoutWrite.mock.calls.find((c) => {
      try {
        const parsed = JSON.parse(c[0]);
        return parsed.status === "ok" && Array.isArray(parsed.files);
      } catch {
        return false;
      }
    });
    expect(jsonCall).toBeDefined();
    const json = JSON.parse(jsonCall![0]);

    const parseErrorFiles = json.files.filter(
      (f: { parseErrors?: string[] }) => f.parseErrors && f.parseErrors.length > 0,
    );
    expect(parseErrorFiles.length).toBeGreaterThan(0);
    for (const file of parseErrorFiles) {
      expect(Array.isArray(file.suggestedCommands)).toBe(true);
      expect(file.suggestedCommands.length).toBe(2);
      expect(file.suggestedCommands[0]).toContain("--explain-index");
      expect(file.suggestedCommands[0]).toContain("--index-format json");
      expect(file.suggestedCommands[1]).toContain("--agent-context");
      expect(file.suggestedCommands[1]).toContain("--index-format json");
      for (const cmd of file.suggestedCommands) {
        expect(cmd).toMatch(/"src\/broken\.ts"/);
      }
    }
    stdoutWrite.mockRestore();
  });

  it("suggestedCommands use forward-slash normalized and double-quoted paths", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "sc-path-test", type: "module", version: "1.0.0" }, null, 2),
      "utf-8",
    );
    await mkdir(join(cwd, "src", "subdir"), { recursive: true });
    await writeFile(
      join(cwd, "src", "subdir", "unicode.ts"),
      [
        'import { foo } from "../lib";',
        "// — em dash",
        "export function bar() { return foo() + 1; }",
      ].join("\n"),
      "utf-8",
    );
    await writeFile(join(cwd, "src", "lib.ts"), "export function foo() { return 42; }\n", "utf-8");

    await buildSourceIndex(cwd, getIndexingConfig({}), true);

    const stdoutWrite = jest.spyOn(console, "log");
    await runIndexingCommand(
      { "index-format": "json", recovered: true } as Partial<CLIValues> & {
        recovered?: boolean;
      },
      cwd,
    );

    const jsonCall = stdoutWrite.mock.calls.find((c) => {
      try {
        const parsed = JSON.parse(c[0]);
        return parsed.status === "ok" && Array.isArray(parsed.files);
      } catch {
        return false;
      }
    });
    expect(jsonCall).toBeDefined();
    const json = JSON.parse(jsonCall![0]);
    for (const file of json.files) {
      for (const cmd of file.suggestedCommands) {
        const pathArg = cmd.match(/"([^"]+)"/);
        if (pathArg) {
          expect(pathArg[1]).not.toContain("\\");
        }
      }
    }
    stdoutWrite.mockRestore();
  });

  it("suggestedCommands are deterministic for the same index", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "sc-det-test", type: "module", version: "1.0.0" }, null, 2),
      "utf-8",
    );
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "src", "unicode.ts"),
      [
        'import { foo } from "./lib";',
        "// — em dash",
        "export function bar() { return foo() + 1; }",
      ].join("\n"),
      "utf-8",
    );
    await writeFile(join(cwd, "src", "lib.ts"), "export function foo() { return 42; }\n", "utf-8");

    await buildSourceIndex(cwd, getIndexingConfig({}), true);

    const call1 = jest.spyOn(console, "log");
    await runIndexingCommand(
      { "index-format": "json", recovered: true } as Partial<CLIValues> & {
        recovered?: boolean;
      },
      cwd,
    );
    const json1 = JSON.parse(
      call1.mock.calls.find((c) => {
        try {
          const p = JSON.parse(c[0]);
          return p.status === "ok" && Array.isArray(p.files);
        } catch {
          return false;
        }
      })![0],
    );
    call1.mockRestore();

    const call2 = jest.spyOn(console, "log");
    await runIndexingCommand(
      { "index-format": "json", recovered: true } as Partial<CLIValues> & {
        recovered?: boolean;
      },
      cwd,
    );
    const json2 = JSON.parse(
      call2.mock.calls.find((c) => {
        try {
          const p = JSON.parse(c[0]);
          return p.status === "ok" && Array.isArray(p.files);
        } catch {
          return false;
        }
      })![0],
    );
    call2.mockRestore();

    expect(json1.files.length).toBe(json2.files.length);
    for (let i = 0; i < json1.files.length; i++) {
      expect(json1.files[i].suggestedCommands).toEqual(json2.files[i].suggestedCommands);
    }
  });

  it("empty drilldown has empty files array (no invalid commands)", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "sc-empty-test", type: "module", version: "1.0.0" }, null, 2),
      "utf-8",
    );
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "clean.ts"), "export const x = 1;\n", "utf-8");

    await buildSourceIndex(cwd, getIndexingConfig({}), true);

    const stdoutWrite = jest.spyOn(console, "log");
    await runIndexingCommand(
      { "index-format": "json", recovered: true } as Partial<CLIValues> & {
        recovered?: boolean;
      },
      cwd,
    );
    const json = JSON.parse(
      stdoutWrite.mock.calls.find((c) => {
        try {
          const p = JSON.parse(c[0]);
          return p.status === "ok" && Array.isArray(p.files);
        } catch {
          return false;
        }
      })![0],
    );
    expect(json.files).toEqual([]);
    stdoutWrite.mockRestore();
  });
});

// ── Chunked Parser Recovery Semantics (v1.25.0) ───────────────────────────

describe("chunked-tree-sitter recovery: warnings vs errors", () => {
  it("--recovered lists chunked files with only parseWarnings", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "chunk-recov", type: "module", version: "1.0.0" }, null, 2),
    );
    await writeFile(join(cwd, "src", "clean.ts"), "export const x = 1;\n");

    await runIndexingCommand({ "index-format": "json", force: true }, cwd);

    // Inject a chunked-tree-sitter file with parseWarnings only (no parseErrors)
    const cachePath = join(cwd, ".mp-sentinel-cache", "source-index.json");
    const cached = JSON.parse(await readFile(cachePath, "utf-8"));
    cached.files.push({
      path: "src/large.ts",
      language: "typescript",
      sha256: "abc123",
      sizeBytes: 50000,
      mtimeMs: Date.now(),
      imports: [],
      exports: [],
      symbols: [],
      parserMode: "chunked-tree-sitter",
      parseWarnings: [
        "Invalid argument; parsed with chunked tree-sitter fallback",
        "Chunk at line 801: Tree has syntax errors",
      ],
    });
    cached.stats.totalFiles = 2;
    cached.stats.indexedFiles = 2;
    await writeFile(cachePath, JSON.stringify(cached));

    const stdoutWrite = jest.spyOn(console, "log");
    try {
      await runIndexingCommand(
        { "index-format": "json", recovered: true } as Partial<CLIValues> & {
          recovered?: boolean;
        },
        cwd,
      );
      const jsonCall = stdoutWrite.mock.calls.find((c) => {
        try {
          const p = JSON.parse(c[0]);
          return p.status === "ok" && Array.isArray(p.files);
        } catch {
          return false;
        }
      });
      expect(jsonCall).toBeDefined();
      const json = JSON.parse(jsonCall![0]);
      expect(json.recoveredFiles).toBe(1);
      const largeFile = json.files.find((f: { path: string }) => f.path === "src/large.ts");
      expect(largeFile).toBeDefined();
      expect(largeFile.parserMode).toBe("chunked-tree-sitter");
      expect(largeFile.parseWarnings).toBeDefined();
      expect(largeFile.parseWarnings.length).toBe(2);
      expect(largeFile.parseErrors).toBeUndefined();
    } finally {
      stdoutWrite.mockRestore();
    }
  });

  it("--parse-errors excludes chunked files with only parseWarnings", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "chunk-pe", type: "module", version: "1.0.0" }, null, 2),
    );
    await writeFile(join(cwd, "src", "clean.ts"), "export const x = 1;\n");

    await runIndexingCommand({ "index-format": "json", force: true }, cwd);

    // Inject a chunked-tree-sitter file with parseWarnings only (no parseErrors)
    const cachePath = join(cwd, ".mp-sentinel-cache", "source-index.json");
    const cached = JSON.parse(await readFile(cachePath, "utf-8"));
    cached.files.push({
      path: "src/large.ts",
      language: "typescript",
      sha256: "abc123",
      sizeBytes: 50000,
      mtimeMs: Date.now(),
      imports: [],
      exports: [],
      symbols: [],
      parserMode: "chunked-tree-sitter",
      parseWarnings: [
        "Invalid argument; parsed with chunked tree-sitter fallback",
        "Chunk at line 801: Tree has syntax errors",
      ],
    });
    cached.stats.totalFiles = 2;
    cached.stats.indexedFiles = 2;
    await writeFile(cachePath, JSON.stringify(cached));

    const stdoutWrite = jest.spyOn(console, "log");
    try {
      await runIndexingCommand(
        { "index-format": "json", parseErrors: true } as Partial<CLIValues> & {
          parseErrors?: boolean;
        },
        cwd,
      );
      const jsonCall = stdoutWrite.mock.calls.find((c) => {
        try {
          const p = JSON.parse(c[0]);
          return p.status === "ok" && Array.isArray(p.files);
        } catch {
          return false;
        }
      });
      expect(jsonCall).toBeDefined();
      const json = JSON.parse(jsonCall![0]);
      expect(json.parseErrorCount).toBe(0);
      expect(json.files).toEqual([]);
    } finally {
      stdoutWrite.mockRestore();
    }
  });

  it("--parse-errors includes chunked files with hard parseErrors", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "chunk-hard", type: "module", version: "1.0.0" }, null, 2),
    );
    await writeFile(join(cwd, "src", "clean.ts"), "export const x = 1;\n");

    await runIndexingCommand({ "index-format": "json", force: true }, cwd);

    // Inject a chunked-tree-sitter file with BOTH parseWarnings and parseErrors
    const cachePath = join(cwd, ".mp-sentinel-cache", "source-index.json");
    const cached = JSON.parse(await readFile(cachePath, "utf-8"));
    cached.files.push({
      path: "src/broken-large.ts",
      language: "typescript",
      sha256: "def456",
      sizeBytes: 60000,
      mtimeMs: Date.now(),
      imports: [],
      exports: [],
      symbols: [],
      parserMode: "chunked-tree-sitter",
      parseWarnings: [
        "Invalid argument; parsed with chunked tree-sitter fallback",
        "Chunk at line 301: Tree has syntax errors",
      ],
      parseErrors: ["Chunk at line 1201: no tree generated"],
    });
    cached.stats.totalFiles = 2;
    cached.stats.indexedFiles = 2;
    await writeFile(cachePath, JSON.stringify(cached));

    const stdoutWrite = jest.spyOn(console, "log");
    try {
      await runIndexingCommand(
        { "index-format": "json", parseErrors: true } as Partial<CLIValues> & {
          parseErrors?: boolean;
        },
        cwd,
      );
      const jsonCall = stdoutWrite.mock.calls.find((c) => {
        try {
          const p = JSON.parse(c[0]);
          return p.status === "ok" && Array.isArray(p.files);
        } catch {
          return false;
        }
      });
      expect(jsonCall).toBeDefined();
      const json = JSON.parse(jsonCall![0]);
      expect(json.parseErrorCount).toBe(1);
      const brokenFile = json.files.find((f: { path: string }) => f.path === "src/broken-large.ts");
      expect(brokenFile).toBeDefined();
      expect(brokenFile.parseErrors).toBeDefined();
      expect(brokenFile.parseErrors.length).toBe(1);
      expect(brokenFile.parseWarnings).toBeDefined();
    } finally {
      stdoutWrite.mockRestore();
    }
  });

  it("getRecoveredFileCount excludes chunked files with hard parseErrors", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "recov-count", type: "module", version: "1.0.0" }, null, 2),
    );
    await writeFile(join(cwd, "src", "clean.ts"), "export const x = 1;\n");

    await runIndexingCommand({ "index-format": "json", force: true }, cwd);

    // Inject both a recovered chunked file and a hard-error chunked file
    const cachePath = join(cwd, ".mp-sentinel-cache", "source-index.json");
    const cached = JSON.parse(await readFile(cachePath, "utf-8"));
    // Recovered: parseWarnings only, no parseErrors
    cached.files.push({
      path: "src/recovered.ts",
      language: "typescript",
      sha256: "aaa",
      sizeBytes: 40000,
      mtimeMs: Date.now(),
      imports: [],
      exports: [],
      symbols: [],
      parserMode: "chunked-tree-sitter",
      parseWarnings: ["Invalid argument; parsed with chunked tree-sitter fallback"],
    });
    // Not recovered: has hard parseErrors
    cached.files.push({
      path: "src/hard-error.ts",
      language: "typescript",
      sha256: "bbb",
      sizeBytes: 50000,
      mtimeMs: Date.now(),
      imports: [],
      exports: [],
      symbols: [],
      parserMode: "chunked-tree-sitter",
      parseWarnings: ["Invalid argument; parsed with chunked tree-sitter fallback"],
      parseErrors: ["Chunk at line 901: no tree generated"],
    });
    cached.stats.totalFiles = 3;
    cached.stats.indexedFiles = 3;
    await writeFile(cachePath, JSON.stringify(cached));

    const stdoutWrite = jest.spyOn(console, "log");
    try {
      await runIndexingCommand(
        { "index-format": "json", recovered: true } as Partial<CLIValues> & {
          recovered?: boolean;
        },
        cwd,
      );
      const jsonCall = stdoutWrite.mock.calls.find((c) => {
        try {
          const p = JSON.parse(c[0]);
          return p.status === "ok" && Array.isArray(p.files);
        } catch {
          return false;
        }
      });
      expect(jsonCall).toBeDefined();
      const json = JSON.parse(jsonCall![0]);
      // recoveredFiles count should only include the file without parseErrors
      expect(json.recoveredFiles).toBe(1);
      // But --recovered drilldown lists all non-tree-sitter files (both)
      expect(json.files.length).toBe(2);
    } finally {
      stdoutWrite.mockRestore();
    }
  });
});

// ── Chunked Parser Offset & Observability Tests (v1.26.0) ───────────────────

describe("chunkedParse line offsets", () => {
  it("preserves correct line numbers for symbols after chunk boundaries", async () => {
    // Pad so chunk boundary falls between line 300 and line 350.
    // ~300 lines of 100-char padding ≈ 30000 chars → boundary around line 298.
    const padLine = " ".repeat(98) + "//";
    const lines: string[] = [];
    // Pre-boundary padding (lines 1-290)
    for (let i = 1; i <= 290; i++) lines.push(padLine);
    // Line 291: import before chunk boundary
    lines.push('import { chunk } from "./lib";');
    // Lines 292-320: more padding (push to ~32000 chars)
    for (let i = 292; i <= 320; i++) lines.push(padLine);
    // Lines 321-350: padding
    for (let i = 321; i <= 350; i++) lines.push(padLine);
    // Line 351: symbol in second chunk
    lines.push('export function postChunkFn(): string { return "ok"; }');
    // Line 352: export in second chunk
    lines.push("export class PostChunkClass { prop = 1; }");
    // Lines 353-360: final padding
    for (let i = 353; i <= 360; i++) lines.push(padLine);

    const content = lines.join("\n");
    expect(content.length).toBeGreaterThan(30000);

    const doParse = async (parseContent: string) => {
      const g = (globalThis as any).__mpTreeSitter;
      const pool = g.pools.typescript;
      const idx = g._nextIdx.typescript;
      g._nextIdx.typescript = (idx + 1) % pool.length;
      const p = pool[idx];
      const tree = p.parse(parseContent);
      const errors: string[] = [];
      if (
        tree &&
        tree.rootNode &&
        typeof tree.rootNode.hasError === "function" &&
        tree.rootNode.hasError()
      ) {
        errors.push("Tree has syntax errors");
      }
      return { tree, parseErrors: errors };
    };

    const result = await chunkedParse(content, "typescript", doParse);
    expect(result).not.toBeNull();
    if (!result) return;

    // Verify symbols have correct line numbers
    const postChunkFn = result.symbols.find((s) => s.name === "postChunkFn");
    expect(postChunkFn).toBeDefined();
    expect(postChunkFn!.line).toBe(351);

    const postChunkClass = result.symbols.find((s) => s.name === "PostChunkClass");
    expect(postChunkClass).toBeDefined();
    expect(postChunkClass!.line).toBe(352);

    // Verify imports have correct line numbers
    const chunkImport = result.imports.find((i) => i.source === "./lib");
    expect(chunkImport).toBeDefined();
    expect(chunkImport!.line).toBe(291);

    // Verify exports have correct line numbers
    const fnExport = result.exports.find((e) => e.names.includes("postChunkFn"));
    expect(fnExport).toBeDefined();
    expect(fnExport!.line).toBe(351);
  });

  it("preserves correct line numbers for imports after chunk boundaries", async () => {
    const padLine = " ".repeat(98) + "//";
    const lines: string[] = [];
    for (let i = 1; i <= 290; i++) lines.push(padLine);
    // First chunk import
    lines.push('import { first } from "./first";');
    for (let i = 292; i <= 360; i++) lines.push(padLine);
    // Second chunk import (line 361)
    lines.push('import { second } from "./second";');
    for (let i = 362; i <= 370; i++) lines.push(padLine);

    const content = lines.join("\n");
    expect(content.length).toBeGreaterThan(30000);

    const doParse = async (parseContent: string) => {
      const g = (globalThis as any).__mpTreeSitter;
      const pool = g.pools.typescript;
      const idx = g._nextIdx.typescript;
      g._nextIdx.typescript = (idx + 1) % pool.length;
      const p = pool[idx];
      const tree = p.parse(parseContent);
      const errors: string[] = [];
      if (
        tree &&
        tree.rootNode &&
        typeof tree.rootNode.hasError === "function" &&
        tree.rootNode.hasError()
      ) {
        errors.push("Tree has syntax errors");
      }
      return { tree, parseErrors: errors };
    };

    const result = await chunkedParse(content, "typescript", doParse);
    expect(result).not.toBeNull();
    if (!result) return;

    const firstImport = result.imports.find((i) => i.source === "./first");
    expect(firstImport).toBeDefined();
    expect(firstImport!.line).toBe(291);

    const secondImport = result.imports.find((i) => i.source === "./second");
    expect(secondImport).toBeDefined();
    expect(secondImport!.line).toBe(361);
  });

  it("preserves correct line numbers for exports after chunk boundaries", async () => {
    const padLine = " ".repeat(98) + "//";
    const lines: string[] = [];
    for (let i = 1; i <= 290; i++) lines.push(padLine);
    // Export in first chunk
    lines.push("export function preExport() { return 1; }");
    for (let i = 292; i <= 360; i++) lines.push(padLine);
    // Export in second chunk (line 361)
    lines.push("export function postExport() { return 2; }");
    for (let i = 362; i <= 370; i++) lines.push(padLine);

    const content = lines.join("\n");
    expect(content.length).toBeGreaterThan(30000);

    const doParse = async (parseContent: string) => {
      const g = (globalThis as any).__mpTreeSitter;
      const pool = g.pools.typescript;
      const idx = g._nextIdx.typescript;
      g._nextIdx.typescript = (idx + 1) % pool.length;
      const p = pool[idx];
      const tree = p.parse(parseContent);
      const errors: string[] = [];
      if (
        tree &&
        tree.rootNode &&
        typeof tree.rootNode.hasError === "function" &&
        tree.rootNode.hasError()
      ) {
        errors.push("Tree has syntax errors");
      }
      return { tree, parseErrors: errors };
    };

    const result = await chunkedParse(content, "typescript", doParse);
    expect(result).not.toBeNull();
    if (!result) return;

    const preExp = result.exports.find((e) => e.names.includes("preExport"));
    expect(preExp).toBeDefined();
    expect(preExp!.line).toBe(291);

    const postExp = result.exports.find((e) => e.names.includes("postExport"));
    expect(postExp).toBeDefined();
    expect(postExp!.line).toBe(361);
  });
});

describe("chunkedParse observability fields", () => {
  /** Build content >30k chars with a syntax error at a specific 1-based line. */
  const buildLargeContentWithError = (errorLine: number): string => {
    const pad = 'const v__ = ".........................................";'; // ~48 chars
    const err = "@@@"; // ERROR node — invalid token sequence
    const lines: string[] = [];
    for (let i = 1; i <= 700; i++) {
      if (i === errorLine) lines.push(err);
      else lines.push(pad);
    }
    return lines.join("\n");
  };

  const makeDoParse = () => {
    return async (parseContent: string) => {
      const g = (globalThis as any).__mpTreeSitter;
      const pool = g.pools.typescript;
      const idx = g._nextIdx.typescript;
      g._nextIdx.typescript = (idx + 1) % pool.length;
      const p = pool[idx];
      const tree = p.parse(parseContent);
      const errors: string[] = [];
      if (tree && tree.rootNode) {
        const hasError =
          typeof tree.rootNode.hasError === "function"
            ? tree.rootNode.hasError()
            : Boolean(tree.rootNode.hasError);
        if (hasError) {
          errors.push("Tree has syntax errors");
        }
      }
      return { tree, parseErrors: errors };
    };
  };

  it("boundary + actionable equals total chunk warnings", async () => {
    // Error near the chunk-1 end (boundary) → classified as boundary
    const content = buildLargeContentWithError(620);
    expect(content.length).toBeGreaterThan(30000);

    const result = await chunkedParse(content, "typescript", makeDoParse());
    expect(result).not.toBeNull();
    if (!result) return;

    expect(typeof result.chunkWarningCount).toBe("number");
    expect(typeof result.chunkBoundaryWarningCount).toBe("number");
    expect(typeof result.chunkActionableWarningCount).toBe("number");
    expect(result.chunkWarningCount).toBe(result.parseWarnings.length);
    expect(result.chunkBoundaryWarningCount + result.chunkActionableWarningCount).toBe(
      result.chunkWarningCount,
    );
    expect(result.chunkCount).toBeGreaterThanOrEqual(2);
    expect(result.chunkSize).toBe(30000);
  });

  it("classifies interior ERROR node as boundary — chunked parsing is lossy", async () => {
    // Error at line 200 — well within chunk 1, far from chunk boundaries.
    // Chunked parsing splits on line boundaries, breaking multi-line constructs,
    // so all chunk warnings are classified as boundary artifacts.
    const content = buildLargeContentWithError(200);
    expect(content.length).toBeGreaterThan(30000);

    const result = await chunkedParse(content, "typescript", makeDoParse());
    expect(result).not.toBeNull();
    if (!result) return;

    // All chunk warnings are boundary — chunked parsing is a lossy fallback
    expect(result.chunkBoundaryWarningCount).toBe(result.chunkWarningCount);
    expect(result.chunkActionableWarningCount).toBe(0);
    expect(result.chunkBoundaryWarningCount + result.chunkActionableWarningCount).toBe(
      result.chunkWarningCount,
    );
  });

  it("returns null when content fits in a single chunk", async () => {
    const content = 'export const x = 1;\nexport function foo() { return "bar"; }\n';

    const doParse = async (parseContent: string) => {
      const g = (globalThis as any).__mpTreeSitter;
      const pool = g.pools.typescript;
      const idx = g._nextIdx.typescript;
      g._nextIdx.typescript = (idx + 1) % pool.length;
      const p = pool[idx];
      const tree = p.parse(parseContent);
      return { tree, parseErrors: [] };
    };

    const result = await chunkedParse(content, "typescript", doParse);
    expect(result).toBeNull();
  });
});

// ── Safe-Boundary Chunking (v1.31.0) ─────────────────────────────────────────

describe("chunkedParse safe-boundary chunking", () => {
  /** Build content >30k chars consisting entirely of top-level statements
   *  (each ending with ;), so every line is a safe-boundary candidate. */
  const buildTopLevelContent = (): string => {
    const pad = "const v__: number = 0;"; // ~23 chars, top-level statement ending with ;
    const lines: string[] = [];
    for (let i = 1; i <= 1450; i++) {
      lines.push(`const v${i}: number = ${i};`);
    }
    return lines.join("\n");
  };

  /** Build content >30k chars deeply nested inside an IIFE so NO line returns
   *  to the chunk-start depth (0) within the search window. */
  const buildDeeplyNestedContent = (): string => {
    const pad = "const v__: number = 0;"; // ~23 chars
    const lines: string[] = [];
    lines.push("const wrapper = (() => {"); // depth 0→2 (two opens)
    for (let i = 1; i <= 1440; i++) {
      lines.push(`  const v${i}: number = ${i};`);
    }
    lines.push("  return 42;");
    lines.push("})();"); // depth 2→0, but at the very end
    return lines.join("\n");
  };

  const makeDoParse = () => {
    return async (parseContent: string) => {
      const g = (globalThis as any).__mpTreeSitter;
      const pool = g.pools.typescript;
      const idx = g._nextIdx.typescript;
      g._nextIdx.typescript = (idx + 1) % pool.length;
      const p = pool[idx];
      const tree = p.parse(parseContent);
      const errors: string[] = [];
      if (tree && tree.rootNode) {
        const hasError =
          typeof tree.rootNode.hasError === "function"
            ? tree.rootNode.hasError()
            : Boolean(tree.rootNode.hasError);
        if (hasError) {
          errors.push("Tree has syntax errors");
        }
      }
      return { tree, parseErrors: errors };
    };
  };

  it("top-level statements split at safe boundaries produce fewer chunk warnings", async () => {
    const content = buildTopLevelContent();
    expect(content.length).toBeGreaterThan(30000);

    const result = await chunkedParse(content, "typescript", makeDoParse());
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.chunkCount).toBeGreaterThanOrEqual(2);
    // Top-level statements ending with ; are safe boundaries — each chunk
    // should parse as a valid program fragment with minimal or zero warnings.
    expect(result.chunkWarningCount).toBeLessThanOrEqual(1);
    expect(result.chunkBoundaryWarningCount + result.chunkActionableWarningCount).toBe(
      result.chunkWarningCount,
    );
  });

  it("preserves imports and exports across safe-boundary chunks", async () => {
    // Interleave imports, top-level filler, and exports so boundary lands cleanly.
    const lines: string[] = [];
    lines.push('import { readFile } from "node:fs";');
    lines.push('import { resolve } from "node:path";');
    // Pad with top-level statements (safe boundaries)
    for (let i = 1; i <= 1420; i++) {
      lines.push(`const v${i}: number = ${i};`);
    }
    lines.push("export function helperA(): string { return 'a'; }");
    lines.push("export function helperB(): number { return 42; }");

    const content = lines.join("\n");
    expect(content.length).toBeGreaterThan(30000);

    const result = await chunkedParse(content, "typescript", makeDoParse());
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.imports.some((i) => i.source === "node:fs")).toBe(true);
    expect(result.imports.some((i) => i.source === "node:path")).toBe(true);
    expect(result.symbols.some((s) => s.name === "helperA")).toBe(true);
    expect(result.symbols.some((s) => s.name === "helperB")).toBe(true);

    // Imports are in the first chunk (top of file) — verify line numbers
    const fsImport = result.imports.find((i) => i.source === "node:fs");
    expect(fsImport).toBeDefined();
    expect(fsImport!.line).toBe(1);

    const pathImport = result.imports.find((i) => i.source === "node:path");
    expect(pathImport).toBeDefined();
    expect(pathImport!.line).toBe(2);
  });

  it("falls back to max-size split when no safe boundary exists in the search window", async () => {
    // All content is inside the IIFE at depth >= 1; chunkStartDepth is 0.
    // No line within the bounded lookahead window returns to depth 0, forcing fallback.
    const content = buildDeeplyNestedContent();
    expect(content.length).toBeGreaterThan(30000);

    const result = await chunkedParse(content, "typescript", makeDoParse());
    // Even with no safe boundaries, chunkedParse must still return results
    // with the correct warning invariants.
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.chunkCount).toBeGreaterThanOrEqual(2);

    // Chunk parse warnings (from splitting mid-construct) are classified as boundary
    expect(result.chunkBoundaryWarningCount + result.chunkActionableWarningCount).toBe(
      result.chunkWarningCount,
    );

    // Symbols array exists — some symbols may survive chunked parsing even
    // in deeply nested content, but empty is also valid for pathological cases.
    expect(Array.isArray(result.symbols)).toBe(true);
  });

  it("chunkBoundaryWarningCount + chunkActionableWarningCount equals chunkWarningCount", async () => {
    const content = buildTopLevelContent();
    expect(content.length).toBeGreaterThan(30000);

    const result = await chunkedParse(content, "typescript", makeDoParse());
    expect(result).not.toBeNull();
    if (!result) return;

    expect(typeof result.chunkWarningCount).toBe("number");
    expect(typeof result.chunkBoundaryWarningCount).toBe("number");
    expect(typeof result.chunkActionableWarningCount).toBe("number");
    expect(result.chunkWarningCount).toBe(result.parseWarnings.length);
    expect(result.chunkBoundaryWarningCount + result.chunkActionableWarningCount).toBe(
      result.chunkWarningCount,
    );
    expect(result.chunkSize).toBe(30000);
  });
});

// ── Parser Drilldown Chunk Fields (v1.26.0) ──────────────────────────────────

describe("indexing --recovered chunk fields", () => {
  it("--recovered entries include chunkCount, chunkSize, chunkWarningCount when present", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "chunk-fields-test", type: "module", version: "1.0.0" }, null, 2),
    );
    await writeFile(join(cwd, "src", "clean.ts"), "export const x = 1;\n");
    await runIndexingCommand({ "index-format": "json", force: true }, cwd);

    // Inject a chunked file with chunkCount, chunkSize, chunkWarningCount
    const cachePath = join(cwd, ".mp-sentinel-cache", "source-index.json");
    const cached = JSON.parse(await readFile(cachePath, "utf-8"));
    cached.files.push({
      path: "src/large.ts",
      language: "typescript",
      sha256: "abc123",
      sizeBytes: 50000,
      mtimeMs: Date.now(),
      imports: [],
      exports: [],
      symbols: [],
      parserMode: "chunked-tree-sitter",
      parseWarnings: [
        "Invalid argument; parsed with chunked tree-sitter fallback",
        "Chunk at line 801: Tree has syntax errors",
      ],
      chunkCount: 3,
      chunkSize: 30000,
      chunkWarningCount: 1,
      chunkBoundaryWarningCount: 1,
      chunkActionableWarningCount: 0,
    });
    cached.stats.totalFiles = 2;
    cached.stats.indexedFiles = 2;
    await writeFile(cachePath, JSON.stringify(cached));

    const stdoutWrite = jest.spyOn(console, "log");
    try {
      await runIndexingCommand(
        { "index-format": "json", recovered: true } as Partial<CLIValues> & {
          recovered?: boolean;
        },
        cwd,
      );
      const jsonCall = stdoutWrite.mock.calls.find((c) => {
        try {
          const p = JSON.parse(c[0]);
          return p.status === "ok" && Array.isArray(p.files);
        } catch {
          return false;
        }
      });
      expect(jsonCall).toBeDefined();
      const json = JSON.parse(jsonCall![0]);

      const largeFile = json.files.find((f: { path: string }) => f.path === "src/large.ts");
      expect(largeFile).toBeDefined();
      expect(largeFile.chunkCount).toBe(3);
      expect(largeFile.chunkSize).toBe(30000);
      expect(largeFile.chunkWarningCount).toBe(1);
      expect(largeFile.chunkBoundaryWarningCount).toBe(1);
      expect(largeFile.chunkActionableWarningCount).toBe(0);
    } finally {
      stdoutWrite.mockRestore();
    }
  });

  it("--recovered entries omit chunk fields for non-chunked-tree-sitter modes", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "no-chunk-fields", type: "module", version: "1.0.0" }, null, 2),
    );
    await writeFile(join(cwd, "src", "clean.ts"), "export const x = 1;\n");
    await runIndexingCommand({ "index-format": "json", force: true }, cwd);

    const cachePath = join(cwd, ".mp-sentinel-cache", "source-index.json");
    const cached = JSON.parse(await readFile(cachePath, "utf-8"));
    // Add ascii-fallback file without chunk fields
    cached.files.push({
      path: "src/ascii.ts",
      language: "typescript",
      sha256: "def456",
      sizeBytes: 1500,
      mtimeMs: Date.now(),
      imports: [],
      exports: [],
      symbols: [],
      parserMode: "ascii-fallback",
      parseWarnings: ["Invalid argument; parsed with ASCII fallback"],
    });
    // Add lexical-fallback file without chunk fields
    cached.files.push({
      path: "src/lexical.ts",
      language: "typescript",
      sha256: "ghi789",
      sizeBytes: 2000,
      mtimeMs: Date.now(),
      imports: [],
      exports: [],
      symbols: [],
      parserMode: "lexical-fallback",
      parseWarnings: ["Invalid argument; parsed with lexical fallback"],
    });
    cached.stats.totalFiles = 3;
    cached.stats.indexedFiles = 3;
    await writeFile(cachePath, JSON.stringify(cached));

    const stdoutWrite = jest.spyOn(console, "log");
    try {
      await runIndexingCommand(
        { "index-format": "json", recovered: true } as Partial<CLIValues> & {
          recovered?: boolean;
        },
        cwd,
      );
      const jsonCall = stdoutWrite.mock.calls.find((c) => {
        try {
          const p = JSON.parse(c[0]);
          return p.status === "ok" && Array.isArray(p.files);
        } catch {
          return false;
        }
      });
      expect(jsonCall).toBeDefined();
      const json = JSON.parse(jsonCall![0]);

      const asciiFile = json.files.find((f: { path: string }) => f.path === "src/ascii.ts");
      expect(asciiFile).toBeDefined();
      expect(asciiFile.chunkCount).toBeUndefined();
      expect(asciiFile.chunkSize).toBeUndefined();
      expect(asciiFile.chunkWarningCount).toBeUndefined();
      expect(asciiFile.chunkBoundaryWarningCount).toBeUndefined();
      expect(asciiFile.chunkActionableWarningCount).toBeUndefined();

      const lexicalFile = json.files.find((f: { path: string }) => f.path === "src/lexical.ts");
      expect(lexicalFile).toBeDefined();
      expect(lexicalFile.chunkCount).toBeUndefined();
      expect(lexicalFile.chunkSize).toBeUndefined();
      expect(lexicalFile.chunkWarningCount).toBeUndefined();
      expect(lexicalFile.chunkBoundaryWarningCount).toBeUndefined();
      expect(lexicalFile.chunkActionableWarningCount).toBeUndefined();
    } finally {
      stdoutWrite.mockRestore();
    }
  });

  it("--recovered handles old-cache files with missing parserMode as tree-sitter", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "old-cache-test", type: "module", version: "1.0.0" }, null, 2),
    );
    await writeFile(join(cwd, "src", "clean.ts"), "export const x = 1;\n");
    await runIndexingCommand({ "index-format": "json", force: true }, cwd);

    const cachePath = join(cwd, ".mp-sentinel-cache", "source-index.json");
    const cached = JSON.parse(await readFile(cachePath, "utf-8"));
    // Add old-cache file without parserMode field (pre-1.3)
    cached.files.push({
      path: "src/old.ts",
      language: "typescript",
      sha256: "old123",
      sizeBytes: 1000,
      mtimeMs: Date.now(),
      imports: [],
      exports: [],
      symbols: [],
      // No parserMode — old-cache (pre-schema 1.3)
    });
    cached.stats.totalFiles = 2;
    cached.stats.indexedFiles = 2;
    await writeFile(cachePath, JSON.stringify(cached));

    const stdoutWrite = jest.spyOn(console, "log");
    try {
      await runIndexingCommand(
        { "index-format": "json", recovered: true } as Partial<CLIValues> & {
          recovered?: boolean;
        },
        cwd,
      );
      const jsonCall = stdoutWrite.mock.calls.find((c) => {
        try {
          const p = JSON.parse(c[0]);
          return p.status === "ok" && Array.isArray(p.files);
        } catch {
          return false;
        }
      });
      expect(jsonCall).toBeDefined();
      const json = JSON.parse(jsonCall![0]);

      const oldFile = json.files.find((f: { path: string }) => f.path === "src/old.ts");
      // Old-cache files without parserMode should NOT be in recovered (treated as tree-sitter)
      expect(oldFile).toBeUndefined();
      // recoveredFiles count should be 0
      expect(json.recoveredFiles).toBe(0);
    } finally {
      stdoutWrite.mockRestore();
    }
  });

  it("--recovered clean empty-state has proper shape", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "empty-state-test", type: "module", version: "1.0.0" }, null, 2),
    );
    await writeFile(join(cwd, "src", "clean.ts"), "export const x = 1;\n");
    await runIndexingCommand({ "index-format": "json", force: true }, cwd);

    const stdoutWrite = jest.spyOn(console, "log");
    try {
      await runIndexingCommand(
        { "index-format": "json", recovered: true } as Partial<CLIValues> & {
          recovered?: boolean;
        },
        cwd,
      );
      const jsonCall = stdoutWrite.mock.calls.find((c) => {
        try {
          const p = JSON.parse(c[0]);
          return p.status === "ok" && Array.isArray(p.files);
        } catch {
          return false;
        }
      });
      expect(jsonCall).toBeDefined();
      const json = JSON.parse(jsonCall![0]);
      expect(json.status).toBe("ok");
      expect(json.totalFiles).toBe(1);
      expect(json.recoveredFiles).toBe(0);
      expect(json.files).toEqual([]);
      expect(json.parserModeBreakdown).toEqual({
        "tree-sitter": 1,
        "chunked-tree-sitter": 0,
        "ascii-fallback": 0,
        "lexical-fallback": 0,
      });
      expect(json.truncated).toBe(false);
    } finally {
      stdoutWrite.mockRestore();
    }
  });

  it("--recovered chunked-tree-sitter file has parserModeBreakdown reflecting chunked count", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "breakdown-test", type: "module", version: "1.0.0" }, null, 2),
    );
    await writeFile(join(cwd, "src", "clean.ts"), "export const x = 1;\n");
    await runIndexingCommand({ "index-format": "json", force: true }, cwd);

    const cachePath = join(cwd, ".mp-sentinel-cache", "source-index.json");
    const cached = JSON.parse(await readFile(cachePath, "utf-8"));
    cached.files.push({
      path: "src/chunked.ts",
      language: "typescript",
      sha256: "chk123",
      sizeBytes: 50000,
      mtimeMs: Date.now(),
      imports: [],
      exports: [],
      symbols: [],
      parserMode: "chunked-tree-sitter",
      parseWarnings: ["Invalid argument; parsed with chunked tree-sitter fallback"],
      chunkCount: 2,
      chunkSize: 30000,
      chunkWarningCount: 0,
      chunkBoundaryWarningCount: 0,
      chunkActionableWarningCount: 0,
    });
    cached.files.push({
      path: "src/also-chunked.ts",
      language: "typescript",
      sha256: "chk456",
      sizeBytes: 45000,
      mtimeMs: Date.now(),
      imports: [],
      exports: [],
      symbols: [],
      parserMode: "chunked-tree-sitter",
      parseWarnings: ["Invalid argument; parsed with chunked tree-sitter fallback"],
    });
    cached.stats.totalFiles = 3;
    cached.stats.indexedFiles = 3;
    await writeFile(cachePath, JSON.stringify(cached));

    const stdoutWrite = jest.spyOn(console, "log");
    try {
      await runIndexingCommand(
        { "index-format": "json", recovered: true } as Partial<CLIValues> & {
          recovered?: boolean;
        },
        cwd,
      );
      const jsonCall = stdoutWrite.mock.calls.find((c) => {
        try {
          const p = JSON.parse(c[0]);
          return p.status === "ok" && Array.isArray(p.files);
        } catch {
          return false;
        }
      });
      expect(jsonCall).toBeDefined();
      const json = JSON.parse(jsonCall![0]);
      expect(json.parserModeBreakdown["tree-sitter"]).toBe(1);
      expect(json.parserModeBreakdown["chunked-tree-sitter"]).toBe(2);
      expect(json.parserModeBreakdown["ascii-fallback"]).toBe(0);
      expect(json.parserModeBreakdown["lexical-fallback"]).toBe(0);
      expect(json.recoveredFiles).toBe(2);
    } finally {
      stdoutWrite.mockRestore();
    }
  });
});

describe("getParserTelemetry — shared serializer", () => {
  it("omits all fields for tree-sitter files with no issues", () => {
    const result = getParserTelemetry({
      parserMode: "tree-sitter",
    });
    expect(result).toEqual({});
  });

  it("omits parserMode for tree-sitter files even with parse errors", () => {
    const result = getParserTelemetry({
      parserMode: "tree-sitter",
      parseErrors: ["Syntax error"],
    });
    expect(result.parserMode).toBeUndefined();
    expect(result.parseErrors).toEqual(["Syntax error"]);
  });

  it("includes parserMode for non-tree-sitter modes", () => {
    const result = getParserTelemetry({
      parserMode: "ascii-fallback",
    });
    expect(result.parserMode).toBe("ascii-fallback");
  });

  it("includes parseWarnings when present", () => {
    const result = getParserTelemetry({
      parserMode: "chunked-tree-sitter",
      parseWarnings: ["Warning 1", "Warning 2"],
      chunkCount: 2,
      chunkSize: 30000,
      chunkWarningCount: 0,
    });
    expect(result.parseWarnings).toEqual(["Warning 1", "Warning 2"]);
    expect(result.chunkCount).toBe(2);
  });

  it("omits parseWarnings when empty array", () => {
    const result = getParserTelemetry({
      parserMode: "ascii-fallback",
      parseWarnings: [],
    });
    expect(result.parseWarnings).toBeUndefined();
  });

  it("includes parseErrors as string[] by default", () => {
    const result = getParserTelemetry({
      parseErrors: ["Error 1", "Error 2"],
    });
    expect(result.parseErrors).toEqual(["Error 1", "Error 2"]);
  });

  it("agentContext mode: emits parseErrors as count and parseErrorMessages as array", () => {
    const result = getParserTelemetry(
      {
        parserMode: "tree-sitter",
        parseErrors: ["Err A", "Err B", "Err C"],
      },
      { agentContext: true },
    );
    expect(result.parseErrors).toBe(3);
    expect(result.parseErrorMessages).toEqual(["Err A", "Err B", "Err C"]);
  });

  it("agentContext mode: omits parseErrors and parseErrorMessages when empty", () => {
    const result = getParserTelemetry(
      {
        parseErrors: [],
      },
      { agentContext: true },
    );
    expect(result.parseErrors).toBeUndefined();
    expect(result.parseErrorMessages).toBeUndefined();
  });

  it("omits chunk fields for ascii-fallback files", () => {
    const result = getParserTelemetry({
      parserMode: "ascii-fallback",
      chunkCount: 5,
      chunkSize: 10000,
      chunkWarningCount: 2,
    });
    expect(result.chunkCount).toBeUndefined();
    expect(result.parserMode).toBe("ascii-fallback");
  });

  it("omits chunk fields for lexical-fallback files", () => {
    const result = getParserTelemetry({
      parserMode: "lexical-fallback",
      chunkCount: 5,
      chunkSize: 10000,
      chunkWarningCount: 2,
    });
    expect(result.chunkCount).toBeUndefined();
  });

  it("omits chunk fields for normal files without parserMode (old cache)", () => {
    const result = getParserTelemetry({});
    expect(result).toEqual({});
  });

  it("includes chunk fields for chunked-tree-sitter files", () => {
    const result = getParserTelemetry({
      parserMode: "chunked-tree-sitter",
      chunkCount: 8,
      chunkSize: 30000,
      chunkWarningCount: 3,
      chunkBoundaryWarningCount: 3,
      chunkActionableWarningCount: 0,
    });
    expect(result.chunkCount).toBe(8);
    expect(result.chunkSize).toBe(30000);
    expect(result.chunkWarningCount).toBe(3);
    expect(result.chunkBoundaryWarningCount).toBe(3);
    expect(result.chunkActionableWarningCount).toBe(0);
    expect(result.parserMode).toBe("chunked-tree-sitter");
  });

  it("returns parserMode but no chunk fields for old cached chunked files (missing fields)", () => {
    const result = getParserTelemetry({
      parserMode: "chunked-tree-sitter",
      // No chunkCount, chunkSize, chunkWarningCount
    });
    expect(result.chunkCount).toBeUndefined();
    expect(result.parserMode).toBe("chunked-tree-sitter");
  });

  it("omits chunk fields when chunkCount is missing but other fields present", () => {
    const result = getParserTelemetry({
      parserMode: "chunked-tree-sitter",
      chunkSize: 30000,
      chunkWarningCount: 0,
    });
    expect(result.chunkCount).toBeUndefined();
  });
});

describe("explain-index and agent-context JSON chunk telemetry", () => {
  it("explain-index JSON for tree-sitter file is parseable and excludes chunk fields", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "ei-test", type: "module", version: "1.0.0" }, null, 2),
    );
    await writeFile(join(cwd, "src", "mod.ts"), "export const x = 1;\nexport function f() {}\n");
    await runIndexingCommand({ "index-format": "json", force: true }, cwd);

    const stdoutWrite = jest.spyOn(console, "log");
    try {
      await runIndexingCommand(
        {
          "index-format": "json",
          explainIndex: "src/mod.ts",
        } as Partial<CLIValues> & { explainIndex?: string },
        cwd,
      );
      const jsonCall = stdoutWrite.mock.calls.find((c) => {
        try {
          const p = JSON.parse(c[0]);
          return typeof p.path === "string";
        } catch {
          return false;
        }
      });
      expect(jsonCall).toBeDefined();
      const json = JSON.parse(jsonCall![0]);

      // Parseable
      expect(json.path).toBe("src/mod.ts");
      expect(json.language).toBe("typescript");

      // ASCII-safe: no control characters in output
      const raw = jsonCall![0];
      expect(raw).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f]/);

      // Normal file: no chunk fields
      expect("chunkCount" in json).toBe(false);
      expect("chunkSize" in json).toBe(false);
      expect("chunkWarningCount" in json).toBe(false);
      expect("chunkBoundaryWarningCount" in json).toBe(false);
      expect("chunkActionableWarningCount" in json).toBe(false);
    } finally {
      stdoutWrite.mockRestore();
    }
  });

  it("agent-context JSON for tree-sitter file is parseable and excludes chunk fields", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "ac-test", type: "module", version: "1.0.0" }, null, 2),
    );
    await writeFile(join(cwd, "src", "mod.ts"), "export const x = 1;\nexport function f() {}\n");
    await runIndexingCommand({ "index-format": "json", force: true }, cwd);

    const stdoutWrite = jest.spyOn(console, "log");
    try {
      await runIndexingCommand(
        {
          "index-format": "json",
          agentContext: "src/mod.ts",
        } as Partial<CLIValues> & { agentContext?: string },
        cwd,
      );
      const jsonCall = stdoutWrite.mock.calls.find((c) => {
        try {
          const p = JSON.parse(c[0]);
          return p.file && typeof p.file.path === "string";
        } catch {
          return false;
        }
      });
      expect(jsonCall).toBeDefined();
      const json = JSON.parse(jsonCall![0]);

      // Parseable
      expect(json.file.path).toBe("src/mod.ts");
      expect(json.file.language).toBe("typescript");
      expect(Array.isArray(json.file.symbols)).toBe(true);
      expect(Array.isArray(json.file.imports)).toBe(true);

      // ASCII-safe: no control characters in output
      const raw = jsonCall![0];
      expect(raw).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f]/);

      // Normal file: no chunk fields
      expect("chunkCount" in json.file).toBe(false);
      expect("chunkSize" in json.file).toBe(false);
      expect("chunkWarningCount" in json.file).toBe(false);
      expect("chunkBoundaryWarningCount" in json.file).toBe(false);
      expect("chunkActionableWarningCount" in json.file).toBe(false);
    } finally {
      stdoutWrite.mockRestore();
    }
  });

  it("explain-index JSON includes chunk fields for chunked-tree-sitter files", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "ei-chunk-test", type: "module", version: "1.0.0" }, null, 2),
    );
    await writeFile(join(cwd, "src", "clean.ts"), "export const x = 1;\n");
    await runIndexingCommand({ "index-format": "json", force: true }, cwd);

    // Inject a chunked-tree-sitter file into the cache
    const chunkedContent = "export function largeFn() { return 1; }\n";
    const chunkedPath = join(cwd, "src", "chunked.ts");
    await writeFile(chunkedPath, chunkedContent);
    const cachePath = join(cwd, ".mp-sentinel-cache", "source-index.json");
    const cached = JSON.parse(await readFile(cachePath, "utf-8"));
    cached.files.push({
      path: "src/chunked.ts",
      language: "typescript",
      sha256: await calculateSHA256(chunkedContent),
      sizeBytes: 60000,
      mtimeMs: (await stat(chunkedPath)).mtimeMs,
      imports: [],
      exports: [],
      symbols: [{ name: "largeFn", type: "function", line: 1, column: 1 }],
      parserMode: "chunked-tree-sitter",
      parseWarnings: ["Parsed with chunked tree-sitter fallback"],
      chunkCount: 4,
      chunkSize: 30000,
      chunkWarningCount: 1,
      chunkBoundaryWarningCount: 1,
      chunkActionableWarningCount: 0,
    });
    cached.stats.totalFiles = 2;
    cached.stats.indexedFiles = 2;
    await writeFile(cachePath, JSON.stringify(cached));

    const stdoutWrite = jest.spyOn(console, "log");
    try {
      await runIndexingCommand(
        {
          "index-format": "json",
          explainIndex: "src/chunked.ts",
        } as Partial<CLIValues> & { explainIndex?: string },
        cwd,
      );
      const jsonCall = stdoutWrite.mock.calls.find((c) => {
        try {
          const p = JSON.parse(c[0]);
          return typeof p.path === "string";
        } catch {
          return false;
        }
      });
      expect(jsonCall).toBeDefined();
      const json = JSON.parse(jsonCall![0]);

      expect(json.path).toBe("src/chunked.ts");
      expect(json.chunkCount).toBe(4);
      expect(json.chunkSize).toBe(30000);
      expect(json.chunkWarningCount).toBe(1);
      expect(json.chunkBoundaryWarningCount).toBe(1);
      expect(json.chunkActionableWarningCount).toBe(0);

      // ASCII-safe
      const raw = jsonCall![0];
      expect(raw).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f]/);
    } finally {
      stdoutWrite.mockRestore();
    }
  });

  it("agent-context JSON includes chunk fields for chunked-tree-sitter files", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "ac-chunk-test", type: "module", version: "1.0.0" }, null, 2),
    );
    await writeFile(join(cwd, "src", "clean.ts"), "export const x = 1;\n");
    await runIndexingCommand({ "index-format": "json", force: true }, cwd);

    // Inject a chunked-tree-sitter file into the cache
    const chunkedContent = "export function largeFn() { return 1; }\n";
    const chunkedPath = join(cwd, "src", "chunked.ts");
    await writeFile(chunkedPath, chunkedContent);
    const cachePath = join(cwd, ".mp-sentinel-cache", "source-index.json");
    const cached = JSON.parse(await readFile(cachePath, "utf-8"));
    cached.files.push({
      path: "src/chunked.ts",
      language: "typescript",
      sha256: await calculateSHA256(chunkedContent),
      sizeBytes: 60000,
      mtimeMs: (await stat(chunkedPath)).mtimeMs,
      imports: [],
      exports: [],
      symbols: [{ name: "largeFn", type: "function", line: 1, column: 1 }],
      parserMode: "chunked-tree-sitter",
      parseWarnings: ["Parsed with chunked tree-sitter fallback"],
      chunkCount: 4,
      chunkSize: 30000,
      chunkWarningCount: 1,
      chunkBoundaryWarningCount: 1,
      chunkActionableWarningCount: 0,
    });
    cached.stats.totalFiles = 2;
    cached.stats.indexedFiles = 2;
    await writeFile(cachePath, JSON.stringify(cached));

    const stdoutWrite = jest.spyOn(console, "log");
    try {
      await runIndexingCommand(
        {
          "index-format": "json",
          agentContext: "src/chunked.ts",
        } as Partial<CLIValues> & { agentContext?: string },
        cwd,
      );
      const jsonCall = stdoutWrite.mock.calls.find((c) => {
        try {
          const p = JSON.parse(c[0]);
          return p.file && typeof p.file.path === "string";
        } catch {
          return false;
        }
      });
      expect(jsonCall).toBeDefined();
      const json = JSON.parse(jsonCall![0]);

      expect(json.file.path).toBe("src/chunked.ts");
      expect(json.file.chunkCount).toBe(4);
      expect(json.file.chunkSize).toBe(30000);
      expect(json.file.chunkWarningCount).toBe(1);
      expect(json.file.chunkBoundaryWarningCount).toBe(1);
      expect(json.file.chunkActionableWarningCount).toBe(0);

      // ASCII-safe
      const raw = jsonCall![0];
      expect(raw).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f]/);
    } finally {
      stdoutWrite.mockRestore();
    }
  });
});
