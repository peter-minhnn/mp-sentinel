/**
 * Schema 1.5 light-cache tests: compact core + JSONL sidecars, hydration
 * levels, legacy compatibility, graceful sidecar failure, full mode,
 * streaming code search parity, fast cache validation, and size bounds.
 */

import { mkdtemp, mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";

import {
  readIndex,
  writeIndex,
  hydrateIndex,
  getSidecarStatus,
  streamCodeEntries,
  validateCache,
} from "../services/source-index/storage.js";
import { queryCode, queryCodeStream, queryAgentContext } from "../services/source-index/query.js";
import type { SourceIndex, SourceIndexFile } from "../types/index.js";

const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "mp-sentinel-light-cache-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const makeFile = (path: string, withPayload = true): SourceIndexFile =>
  ({
    path,
    language: "typescript",
    sha256: `sha-${path}`,
    sizeBytes: 100,
    mtimeMs: 1000,
    symbols: [{ name: "fn", type: "function", line: 1, column: 0 }],
    imports: [],
    exports: [{ kind: "named", names: ["fn"], line: 1 }],
    ...(withPayload && {
      codeSearch: [
        { line: 1, column: 0, text: `export function fn_${path}() {}`, nearestSymbol: "fn" },
        { line: 2, column: 0, text: `const value_${path} = 42;` },
      ],
      calls: [
        { callee: "doWork", line: 3, column: 2, inSymbol: "fn" },
        { callee: "svc.start", line: 4, column: 2 },
      ],
    }),
  }) as unknown as SourceIndexFile;

const makeIndex = (fileCount = 3): SourceIndex => ({
  schemaVersion: "1.5",
  generatedAt: "2026-06-01T00:00:00.000Z",
  toolVersion: "3.0.3",
  project: {
    packageName: "fixture",
    packageVersion: "1.0.0",
    detectedFrameworks: [],
    dependencies: {},
    devDependencies: {},
  } as unknown as SourceIndex["project"],
  files: Array.from({ length: fileCount }, (_, i) => makeFile(`src/f${i}.ts`)),
  stats: { totalFiles: fileCount, indexedFiles: fileCount, skippedFiles: 0, parseErrors: 0 },
});

describe("light cache write/read", () => {
  it("writes a compact core without inline payloads plus sidecars", async () => {
    const dir = await makeTempDir();
    const cachePath = join(dir, "source-index.json");
    await writeIndex(makeIndex(), cachePath);

    const raw = await readFile(cachePath, "utf-8");
    // Compact JSON: single line, no pretty-printing
    expect(raw.trim().split("\n")).toHaveLength(1);
    expect(raw).not.toContain('"codeSearch"');
    // No inline call-edge payloads (the sidecars metadata key "calls" is fine)
    expect(raw).not.toContain('"callee"');

    const core = JSON.parse(raw) as SourceIndex;
    expect(core.sidecars).toBeDefined();
    expect(core.sidecars!.code).toBeDefined();
    expect(core.sidecars!.calls).toBeDefined();
    expect(core.sidecars!.lookup).toBeDefined();

    const entries = await readdir(dir);
    expect(entries.some((e) => e.endsWith(".code.jsonl"))).toBe(true);
    expect(entries.some((e) => e.endsWith(".calls.jsonl"))).toBe(true);
    expect(entries.some((e) => e.endsWith(".lookup.json"))).toBe(true);
  });

  it("hydrates payloads on full read and skips them on core read", async () => {
    const dir = await makeTempDir();
    const cachePath = join(dir, "source-index.json");
    const original = makeIndex();
    await writeIndex(original, cachePath);

    const core = await readIndex(cachePath, { hydrate: "none" });
    expect(core!.files.every((f) => f.codeSearch === undefined && f.calls === undefined)).toBe(
      true,
    );

    const callsOnly = await readIndex(cachePath, { hydrate: "calls" });
    expect(callsOnly!.files[0]!.calls).toEqual(original.files[0]!.calls);
    expect(callsOnly!.files[0]!.codeSearch).toBeUndefined();

    const full = await readIndex(cachePath); // default full
    expect(full!.files[0]!.calls).toEqual(original.files[0]!.calls);
    expect(full!.files[0]!.codeSearch).toEqual(original.files[0]!.codeSearch);
  });

  it("replaces old-generation sidecars on rewrite (cleanup best-effort)", async () => {
    const dir = await makeTempDir();
    const cachePath = join(dir, "source-index.json");
    await writeIndex(makeIndex(), cachePath);
    const firstGen = (await readdir(dir)).filter((e) => e.includes(".code.jsonl"));
    await writeIndex(makeIndex(), cachePath);
    const entries = await readdir(dir);
    const codeSidecars = entries.filter((e) => e.endsWith(".code.jsonl"));
    expect(codeSidecars).toHaveLength(1);
    expect(codeSidecars[0]).not.toBe(firstGen[0]);
  });

  it("cacheMode full keeps inline payloads and writes no sidecars", async () => {
    const dir = await makeTempDir();
    const cachePath = join(dir, "source-index.json");
    await writeIndex(makeIndex(), cachePath, { cacheMode: "full" });

    const raw = await readFile(cachePath, "utf-8");
    expect(raw).toContain('"codeSearch"');
    expect(raw).toContain('"calls"');
    const parsed = JSON.parse(raw) as SourceIndex;
    expect(parsed.sidecars).toBeUndefined();
    const entries = await readdir(dir);
    expect(entries.filter((e) => e.includes(".jsonl"))).toHaveLength(0);

    const status = await getSidecarStatus(parsed, cachePath);
    expect(status.cacheMode).toBe("full");
    expect(status.sidecarsValid).toBe(true);
  });

  it("reads legacy 1.4 monolithic caches unchanged", async () => {
    const dir = await makeTempDir();
    const cachePath = join(dir, "source-index.json");
    const legacy = { ...makeIndex(), schemaVersion: "1.4" as const };
    await writeFile(cachePath, JSON.stringify(legacy, null, 2), "utf-8");

    const index = await readIndex(cachePath);
    expect(index).not.toBeNull();
    expect(index!.schemaVersion).toBe("1.4");
    expect(index!.files[0]!.codeSearch).toBeDefined();
    expect(index!.files[0]!.calls).toBeDefined();

    const status = await getSidecarStatus(index!, cachePath);
    expect(status.cacheMode).toBe("legacy");
    expect(status.sidecarsValid).toBe(true);
  });

  it("missing sidecar degrades gracefully and reports invalid status", async () => {
    const dir = await makeTempDir();
    const cachePath = join(dir, "source-index.json");
    await writeIndex(makeIndex(), cachePath);

    const callsSidecar = (await readdir(dir)).find((e) => e.endsWith(".calls.jsonl"))!;
    await unlink(join(dir, callsSidecar));

    // No crash; calls payload simply absent
    const index = await readIndex(cachePath); // full hydrate attempt
    expect(index).not.toBeNull();
    expect(index!.files[0]!.calls).toBeUndefined();
    expect(index!.files[0]!.codeSearch).toBeDefined(); // code sidecar intact

    const status = await getSidecarStatus(index!, cachePath);
    expect(status.sidecarsValid).toBe(false);
    expect(status.missing).toContain(callsSidecar);
  });
});

describe("streaming code search parity", () => {
  it("queryCodeStream over sidecars matches queryCode over inline payloads", async () => {
    const dir = await makeTempDir();
    const cachePath = join(dir, "source-index.json");
    const original = makeIndex(5);
    await writeIndex(original, cachePath);

    const inline = queryCode(original, "doWork");
    const core = await readIndex(cachePath, { hydrate: "none" });
    const streamed = await queryCodeStream(core, cachePath, "doWork");
    expect(streamed).toEqual(inline);

    const inline2 = queryCode(original, "export function fn_src/f1.ts");
    const streamed2 = await queryCodeStream(core, cachePath, "export function fn_src/f1.ts");
    expect(streamed2).toEqual(inline2);
    // Streaming must not have hydrated the core index
    expect(core!.files.every((f) => f.codeSearch === undefined)).toBe(true);
  });

  it("streamCodeEntries visits inline payloads for legacy caches", async () => {
    const dir = await makeTempDir();
    const cachePath = join(dir, "source-index.json");
    const legacy = { ...makeIndex(2), schemaVersion: "1.4" as const };
    await writeFile(cachePath, JSON.stringify(legacy), "utf-8");

    const seen: string[] = [];
    const ok = await streamCodeEntries(legacy, cachePath, (path) => seen.push(path));
    expect(ok).toBe(true);
    expect(seen).toEqual(["src/f0.ts", "src/f1.ts"]);
  });
});

describe("agent-context call hydration parity", () => {
  it("calls-hydrated core produces identical agent context to in-memory index", async () => {
    const dir = await makeTempDir();
    const cachePath = join(dir, "source-index.json");
    const original = makeIndex(3);
    // Make f1 call f0's exported symbol so incomingCalls matches textually
    original.files[1]!.calls = [{ callee: "fn", line: 7, column: 2, inSymbol: "caller" }];
    await writeIndex(original, cachePath);

    const hydrated = await readIndex(cachePath, { hydrate: "calls" });
    const fromLight = queryAgentContext(hydrated, "src/f0.ts", "/p");
    const fromMemory = queryAgentContext(original, "src/f0.ts", "/p");
    expect(fromLight).toEqual(fromMemory);
  });
});

describe("size bounds", () => {
  it("light core is much smaller than the monolithic full cache", async () => {
    const dir = await makeTempDir();
    const big = makeIndex(80);
    // Inflate payloads to dominate the cache like real-world codeSearch
    for (const f of big.files) {
      f.codeSearch = Array.from({ length: 40 }, (_, i) => ({
        line: i + 1,
        column: 0,
        text: `const padding_${f.path}_${i} = "${"x".repeat(80)}";`,
      }));
    }

    const lightPath = join(dir, "light", "source-index.json");
    const fullPath = join(dir, "full", "source-index.json");
    await mkdir(join(dir, "light"), { recursive: true });
    await mkdir(join(dir, "full"), { recursive: true });
    await writeIndex(big, lightPath);
    await writeIndex(big, fullPath, { cacheMode: "full" });

    const coreBytes = (await readFile(lightPath, "utf-8")).length;
    const fullBytes = (await readFile(fullPath, "utf-8")).length;
    expect(coreBytes).toBeLessThan(fullBytes / 4);

    // Core stays a single compact line; sidecar line count is bounded by file count
    const sidecar = (await readdir(join(dir, "light"))).find((e) => e.endsWith(".code.jsonl"))!;
    const sidecarLines = (await readFile(join(dir, "light", sidecar), "utf-8"))
      .trim()
      .split("\n").length;
    expect(sidecarLines).toBe(80);
  });
});

describe("fast cache validation", () => {
  it("fast mode skips hashing when size+mtime match; strict mode hashes", async () => {
    const dir = await makeTempDir();
    const cachePath = join(dir, "source-index.json");
    const index = makeIndex(2);
    await writeIndex(index, cachePath);

    let contentReads = 0;
    const getContent = async (): Promise<string> => {
      contentReads++;
      return "irrelevant";
    };
    const getMtime = async (): Promise<number> => 1000; // matches makeFile
    const getSize = async (): Promise<number> => 100; // matches makeFile

    const fast = await validateCache(
      cachePath,
      dir,
      ["src/f0.ts", "src/f1.ts"],
      getContent,
      getMtime,
      { mode: "fast", getFileSize: getSize },
    );
    expect(fast.valid).toBe(true);
    expect(contentReads).toBe(0);

    const strict = await validateCache(
      cachePath,
      dir,
      ["src/f0.ts", "src/f1.ts"],
      getContent,
      getMtime,
      { mode: "strict" },
    );
    expect(strict.valid).toBe(false); // hash of "irrelevant" != stored sha
    expect(contentReads).toBe(2);
  });

  it("fast mode falls back to hashing when stat differs", async () => {
    const dir = await makeTempDir();
    const cachePath = join(dir, "source-index.json");
    await writeIndex(makeIndex(1), cachePath);

    let contentReads = 0;
    const validity = await validateCache(
      cachePath,
      dir,
      ["src/f0.ts"],
      async () => {
        contentReads++;
        return "changed content";
      },
      async () => 2000, // newer mtime
      { mode: "fast", getFileSize: async () => 100 },
    );
    expect(contentReads).toBe(1);
    expect(validity.valid).toBe(false);
    expect(validity.modifiedFiles).toEqual(["src/f0.ts"]);
  });
});

describe("end-to-end via buildSourceIndex", () => {
  it("real project: light cache round-trips and importedBy graph is intact", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "fixture-light" }));
    await writeFile(
      join(cwd, "src", "a.ts"),
      `import { b } from "./b.js";\nexport const a = b();\n`,
    );
    await writeFile(join(cwd, "src", "b.ts"), `export function b() { return 1; }\n`);

    const { clearParserCache } = await import("../services/source-index/parser.js");
    const { setLogQuietMode } = await import("../utils/logger.js");
    clearParserCache();
    setLogQuietMode(true);
    try {
      const { buildSourceIndex } = await import("../commands/indexing.js");
      const built = await buildSourceIndex(
        cwd,
        {
          enabled: true,
          languages: ["typescript", "tsx", "javascript", "jsx"],
          cachePath: ".mp-sentinel-cache/source-index.json",
          maxFileSize: 512000,
        },
        true,
      );
      expect(built).not.toBeNull();

      const cachePath = join(cwd, ".mp-sentinel-cache", "source-index.json");
      expect(existsSync(cachePath)).toBe(true);

      const core = await readIndex(cachePath, { hydrate: "none" });
      expect(core!.schemaVersion).toBe("1.5");
      // One-pass reverse graph: b.ts is imported by a.ts
      const bFile = core!.files.find((f) => f.path === "src/b.ts");
      expect(bFile?.importedBy).toEqual(["src/a.ts"]);

      // Full hydration restores calls captured at parse time (a calls b())
      const full = await readIndex(cachePath);
      const aFile = full!.files.find((f) => f.path === "src/a.ts");
      expect(aFile?.calls?.some((c) => c.callee === "b")).toBe(true);
      await hydrateIndex(full!, cachePath, "full"); // idempotent
    } finally {
      clearParserCache();
      setLogQuietMode(false);
    }
  });
});

describe("incremental re-parse of error-parsing files", () => {
  it("keeps the fresh parse when the cached entry also has parse errors", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "fixture-zombie" }));
    // Healthy files keep the overall parse-error rate under the abort gate
    await writeFile(join(cwd, "src", "ok1.ts"), "export const ok1 = 1;\n");
    await writeFile(join(cwd, "src", "ok2.ts"), "export const ok2 = 2;\n");
    // Deliberately unparseable content — tree-sitter records parse errors
    await writeFile(join(cwd, "src", "broken.ts"), "function {{{ totally broken v1\n");

    const { clearParserCache } = await import("../services/source-index/parser.js");
    const { setLogQuietMode } = await import("../utils/logger.js");
    clearParserCache();
    setLogQuietMode(true);
    try {
      const { buildSourceIndex } = await import("../commands/indexing.js");
      const config = {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"] as Array<
          "typescript" | "tsx" | "javascript" | "jsx"
        >,
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      };
      const first = await buildSourceIndex(cwd, config, true);
      const firstSha = first!.files.find((f) => f.path === "src/broken.ts")!.sha256;

      // Change the (still broken) file, then incremental rebuild
      await writeFile(join(cwd, "src", "broken.ts"), "function {{{ totally broken v2 longer\n");
      const second = await buildSourceIndex(cwd, config, false);
      const entry = second!.files.find((f) => f.path === "src/broken.ts")!;

      // The fresh error-parse must win over the stale error-parse zombie
      expect(entry.sha256).not.toBe(firstSha);
      const { calculateSHA256 } = await import("../services/source-index/storage.js");
      const actualSha = await calculateSHA256("function {{{ totally broken v2 longer\n");
      expect(entry.sha256).toBe(actualSha);
    } finally {
      clearParserCache();
      setLogQuietMode(false);
    }
  });
});
