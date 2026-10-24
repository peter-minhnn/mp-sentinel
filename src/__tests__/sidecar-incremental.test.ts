/**
 * Incremental light-cache rebuilds must not drop sidecar payloads for
 * unchanged files. If the previous sidecar is missing/corrupt, the next
 * write is a full reindex — never a self-consistent generation with only
 * the files that were just parsed.
 */

import { mkdtemp, mkdir, readdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import { buildSourceIndex, runIndexingCommand } from "../commands/indexing.js";
import { readIndex } from "../services/source-index/storage.js";
import { queryCodeStream } from "../services/source-index/query.js";
import {
  carryPreviousSidecarPayloads,
  isSparseCodeSidecar,
} from "../services/source-index/sidecar-carry.js";
import { clearParserCache } from "../services/source-index/parser.js";
import { setLogQuietMode } from "../utils/logger.js";
import type { IndexableLanguage, SourceIndex, SourceIndexFile } from "../types/index.js";

const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "mp-sentinel-sidecar-inc-"));
  tempDirs.push(dir);
  return dir;
};

beforeEach(() => {
  clearParserCache();
});

afterEach(async () => {
  clearParserCache();
  setLogQuietMode(false);
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const CONFIG = {
  enabled: true,
  languages: ["typescript", "tsx", "javascript", "jsx"] as IndexableLanguage[],
  cachePath: ".mp-sentinel-cache/source-index.json",
  maxFileSize: 512000,
};

const sidecarFile = async (dir: string, kind: "code" | "calls"): Promise<string | null> => {
  const cacheDir = join(dir, ".mp-sentinel-cache");
  const name = (await readdir(cacheDir)).find((e) => e.endsWith(`.${kind}.jsonl`));
  return name ? join(cacheDir, name) : null;
};

const sidecarLines = async (dir: string, kind: "code" | "calls"): Promise<number> => {
  const file = await sidecarFile(dir, kind);
  if (!file) return 0;
  const raw = await readFile(file, "utf-8");
  return raw.split("\n").filter((line) => line.length > 0).length;
};

const seedProject = async (cwd: string, fileCount: number): Promise<void> => {
  await mkdir(join(cwd, "src"), { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ name: "sidecar-inc", version: "1.0.0" }),
  );
  for (let i = 0; i < fileCount; i++) {
    await writeFile(join(cwd, "src", `mod${i}.ts`), `export const fn${i} = () => ${i};\n`);
  }
};

describe("incremental sidecar carry", () => {
  it("keeps code-search hits for unchanged files after incremental rebuild", async () => {
    const cwd = await makeTempDir();
    await seedProject(cwd, 4);
    setLogQuietMode(true);

    const first = await buildSourceIndex(cwd, CONFIG, true);
    expect(first).not.toBeNull();
    expect(await sidecarLines(cwd, "code")).toBeGreaterThanOrEqual(4);

    const cachePath = join(cwd, CONFIG.cachePath);
    const core = await readIndex(cachePath, { hydrate: "none" });
    const before = await queryCodeStream(core, cachePath, "fn0");
    expect(before.some((r) => r.file === "src/mod0.ts")).toBe(true);

    await writeFile(join(cwd, "src", "mod3.ts"), `export const fn3 = () => 99;\n`);
    const second = await buildSourceIndex(cwd, CONFIG, false);
    expect(second!.stats.parsedFiles).toBe(1);
    expect(second!.stats.cacheHitFiles).toBe(3);
    expect(await sidecarLines(cwd, "code")).toBeGreaterThanOrEqual(4);

    const core2 = await readIndex(cachePath, { hydrate: "none" });
    const after = await queryCodeStream(core2, cachePath, "fn0");
    expect(after.some((r) => r.file === "src/mod0.ts")).toBe(true);
  });

  it("full-reparses instead of writing a partial sidecar when the previous sidecar is gone", async () => {
    const cwd = await makeTempDir();
    await seedProject(cwd, 4);
    setLogQuietMode(true);

    await buildSourceIndex(cwd, CONFIG, true);
    const cacheDir = join(cwd, ".mp-sentinel-cache");
    const codeSidecar = (await readdir(cacheDir)).find((e) => e.endsWith(".code.jsonl"))!;
    await unlink(join(cacheDir, codeSidecar));

    await writeFile(join(cwd, "src", "mod3.ts"), `export const fn3 = () => 77;\n`);
    const second = await buildSourceIndex(cwd, CONFIG, false);
    expect(second).not.toBeNull();
    // Forced full reindex: every file is parsed, sidecar is complete again
    expect(second!.stats.parsedFiles).toBe(4);
    expect(second!.stats.cacheHitFiles).toBe(0);
    expect(await sidecarLines(cwd, "code")).toBeGreaterThanOrEqual(4);

    const cachePath = join(cwd, CONFIG.cachePath);
    const core = await readIndex(cachePath, { hydrate: "none" });
    const hits = await queryCodeStream(core, cachePath, "fn0");
    expect(hits.some((r) => r.file === "src/mod0.ts")).toBe(true);
  });

  it("health reports stale when code sidecar coverage has dropped", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, ".mp-sentinel-cache"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "sparse", version: "1.0.0" }),
    );

    const files = Array.from({ length: 12 }, (_, i) => ({
      path: `src/f${i}.ts`,
      language: "typescript" as const,
      sha256: "abc",
      sizeBytes: 10,
      mtimeMs: 0,
      imports: [],
      exports: [],
      symbols: [],
    }));
    const sparse: SourceIndex = {
      schemaVersion: "1.5",
      generatedAt: new Date().toISOString(),
      toolVersion: "3.2.7",
      project: {
        packageName: "sparse",
        ecosystem: "node",
        dependencies: {},
        devDependencies: {},
        detectedFrameworks: [],
      },
      files,
      stats: { totalFiles: 12, indexedFiles: 12, skippedFiles: 0, parseErrors: 0 },
      sidecars: {
        storageId: "deadbeef",
        code: { file: "source-index.deadbeef.code.jsonl", bytes: 10, entryCount: 2 },
      },
    };
    expect(isSparseCodeSidecar(sparse)).toBe(true);
    await writeFile(join(cwd, ".mp-sentinel-cache", "source-index.json"), JSON.stringify(sparse));

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      await runIndexingCommand({ health: true, "index-format": "json", compact: true }, cwd);
      const parsed = JSON.parse(logs.join("\n")) as { status: string; staleReasons?: string[] };
      expect(parsed.status).toBe("stale");
      expect(parsed.staleReasons).toContain("code sidecar coverage drop");
    } finally {
      console.log = origLog;
    }
  });

  it("does not resurrect snippets after a changed file is emptied", async () => {
    const cwd = await makeTempDir();
    await seedProject(cwd, 4);
    setLogQuietMode(true);

    await buildSourceIndex(cwd, CONFIG, true);
    const cachePath = join(cwd, CONFIG.cachePath);
    const before = await queryCodeStream(
      await readIndex(cachePath, { hydrate: "none" }),
      cachePath,
      "fn0",
    );
    expect(before.some((r) => r.file === "src/mod0.ts")).toBe(true);

    await writeFile(join(cwd, "src", "mod0.ts"), "");
    const second = await buildSourceIndex(cwd, CONFIG, false);
    expect(second!.stats.parsedFiles).toBe(1);
    expect(second!.stats.cacheHitFiles).toBe(3);

    const afterEmpty = await queryCodeStream(
      await readIndex(cachePath, { hydrate: "none" }),
      cachePath,
      "fn0",
    );
    expect(afterEmpty.some((r) => r.file === "src/mod0.ts")).toBe(false);

    const unchanged = await queryCodeStream(
      await readIndex(cachePath, { hydrate: "none" }),
      cachePath,
      "fn1",
    );
    expect(unchanged.some((r) => r.file === "src/mod1.ts")).toBe(true);
  });

  it("full-reparses when a sidecar JSONL line is truncated mid-line", async () => {
    const cwd = await makeTempDir();
    await seedProject(cwd, 4);
    setLogQuietMode(true);

    await buildSourceIndex(cwd, CONFIG, true);
    const codePath = await sidecarFile(cwd, "code");
    expect(codePath).not.toBeNull();
    const raw = await readFile(codePath!, "utf-8");
    const lines = raw.split("\n").filter((line) => line.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const target = lines[1]!;
    lines[1] = target.slice(0, Math.max(8, Math.floor(target.length / 2)));
    await writeFile(codePath!, `${lines.join("\n")}\n`);

    await writeFile(join(cwd, "src", "mod3.ts"), `export const fn3 = () => 55;\n`);
    const second = await buildSourceIndex(cwd, CONFIG, false);
    expect(second).not.toBeNull();
    expect(second!.stats.parsedFiles).toBe(4);
    expect(second!.stats.cacheHitFiles).toBe(0);
    expect(await sidecarLines(cwd, "code")).toBeGreaterThanOrEqual(4);

    const cachePath = join(cwd, CONFIG.cachePath);
    const hits = await queryCodeStream(
      await readIndex(cachePath, { hydrate: "none" }),
      cachePath,
      "fn0",
    );
    expect(hits.some((r) => r.file === "src/mod0.ts")).toBe(true);
  });

  it("rebuilds a sparse sidecar even when no source file changed", async () => {
    const cwd = await makeTempDir();
    await seedProject(cwd, 12);
    setLogQuietMode(true);

    const first = await buildSourceIndex(cwd, CONFIG, true);
    expect(first!.stats.parsedFiles).toBe(12);
    expect(await sidecarLines(cwd, "code")).toBeGreaterThanOrEqual(12);

    const codePath = await sidecarFile(cwd, "code");
    expect(codePath).not.toBeNull();
    const raw = await readFile(codePath!, "utf-8");
    const kept = raw
      .split("\n")
      .filter((line) => line.length > 0)
      .slice(0, 2);
    await writeFile(codePath!, `${kept.join("\n")}\n`);

    const cachePath = join(cwd, CONFIG.cachePath);
    const core = JSON.parse(await readFile(cachePath, "utf-8")) as SourceIndex;
    if (core.sidecars?.code) {
      core.sidecars.code.entryCount = 2;
      core.sidecars.code.bytes = 10;
    }
    expect(isSparseCodeSidecar(core)).toBe(true);
    await writeFile(cachePath, JSON.stringify(core));

    const second = await buildSourceIndex(cwd, CONFIG, false);
    expect(second).not.toBeNull();
    expect(second!.stats.parsedFiles).toBe(12);
    expect(second!.stats.cacheHitFiles).toBe(0);
    expect(await sidecarLines(cwd, "code")).toBeGreaterThanOrEqual(12);
    expect(isSparseCodeSidecar(second!)).toBe(false);

    const hits = await queryCodeStream(
      await readIndex(cachePath, { hydrate: "none" }),
      cachePath,
      "fn0",
    );
    expect(hits.some((r) => r.file === "src/mod0.ts")).toBe(true);
  });

  it("rebuilds when the code sidecar is missing even if sources are unchanged", async () => {
    const cwd = await makeTempDir();
    await seedProject(cwd, 4);
    setLogQuietMode(true);

    await buildSourceIndex(cwd, CONFIG, true);
    const codePath = await sidecarFile(cwd, "code");
    expect(codePath).not.toBeNull();
    await unlink(codePath!);

    const second = await buildSourceIndex(cwd, CONFIG, false);
    expect(second).not.toBeNull();
    expect(second!.stats.parsedFiles).toBe(4);
    expect(second!.stats.cacheHitFiles).toBe(0);
    expect(await sidecarLines(cwd, "code")).toBeGreaterThanOrEqual(4);

    const cachePath = join(cwd, CONFIG.cachePath);
    const hits = await queryCodeStream(
      await readIndex(cachePath, { hydrate: "none" }),
      cachePath,
      "fn0",
    );
    expect(hits.some((r) => r.file === "src/mod0.ts")).toBe(true);
  });

  it("does not copy sidecar rows onto a hard-error reparse (cacheHitPaths gate)", async () => {
    const cwd = await makeTempDir();
    await seedProject(cwd, 4);
    setLogQuietMode(true);

    await buildSourceIndex(cwd, CONFIG, true);
    const cachePath = join(cwd, CONFIG.cachePath);
    const hydrated = await readIndex(cachePath, { hydrate: "full" });
    expect(hydrated).not.toBeNull();

    const reparsed: SourceIndexFile = {
      path: "src/mod0.ts",
      language: "typescript",
      sha256: "deadbeef",
      sizeBytes: 1,
      mtimeMs: Date.now(),
      imports: [],
      exports: [],
      symbols: [],
      parseErrors: ["hard failure"],
    };
    const cacheHits = hydrated!.files.filter((f) => f.path !== "src/mod0.ts");
    const mixed: SourceIndex = {
      ...hydrated!,
      files: [reparsed, ...cacheHits],
    };

    await carryPreviousSidecarPayloads(mixed, cachePath, new Set(cacheHits.map((f) => f.path)));
    expect(reparsed.codeSearch).toBeUndefined();
    expect(reparsed.calls).toBeUndefined();
  });

  it("does not resurrect snippets after a lexical-fallback file is emptied", async () => {
    const cwd = await makeTempDir();
    await seedProject(cwd, 3);
    await writeFile(
      join(cwd, "src", "Widget.svelte"),
      `<script lang="ts">\nexport const widgetFn = () => 1;\n</script>\n<div>hi</div>\n`,
    );
    setLogQuietMode(true);

    const first = await buildSourceIndex(cwd, CONFIG, true);
    const svelte = first!.files.find((f) => f.path === "src/Widget.svelte");
    expect(svelte?.parserMode).toBe("lexical-fallback");
    const cachePath = join(cwd, CONFIG.cachePath);
    const before = await queryCodeStream(
      await readIndex(cachePath, { hydrate: "none" }),
      cachePath,
      "widgetFn",
    );
    expect(before.some((r) => r.file === "src/Widget.svelte")).toBe(true);

    await writeFile(join(cwd, "src", "Widget.svelte"), `<div></div>\n`);
    const second = await buildSourceIndex(cwd, CONFIG, false);
    expect(second!.files.find((f) => f.path === "src/Widget.svelte")?.parserMode).toBe(
      "lexical-fallback",
    );
    const after = await queryCodeStream(
      await readIndex(cachePath, { hydrate: "none" }),
      cachePath,
      "widgetFn",
    );
    expect(after.some((r) => r.file === "src/Widget.svelte")).toBe(false);
  });

  it("rebuilds when a JSONL row is deleted but remaining lines stay valid JSON", async () => {
    const cwd = await makeTempDir();
    await seedProject(cwd, 4);
    setLogQuietMode(true);

    await buildSourceIndex(cwd, CONFIG, true);
    const codePath = await sidecarFile(cwd, "code");
    expect(codePath).not.toBeNull();
    const raw = await readFile(codePath!, "utf-8");
    const lines = raw.split("\n").filter((line) => line.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    await writeFile(codePath!, `${lines.slice(1).join("\n")}\n`);

    const second = await buildSourceIndex(cwd, CONFIG, false);
    expect(second).not.toBeNull();
    expect(second!.stats.parsedFiles).toBe(4);
    expect(second!.stats.cacheHitFiles).toBe(0);
    expect(await sidecarLines(cwd, "code")).toBeGreaterThanOrEqual(4);

    const cachePath = join(cwd, CONFIG.cachePath);
    const hits = await queryCodeStream(
      await readIndex(cachePath, { hydrate: "none" }),
      cachePath,
      "fn0",
    );
    expect(hits.some((r) => r.file === "src/mod0.ts")).toBe(true);
  });

  it("compact find-file does not rebuild a missing code sidecar", async () => {
    const cwd = await makeTempDir();
    await seedProject(cwd, 4);
    setLogQuietMode(true);

    await buildSourceIndex(cwd, CONFIG, true);
    const codePath = await sidecarFile(cwd, "code");
    expect(codePath).not.toBeNull();
    await unlink(codePath!);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      await runIndexingCommand({ findFile: "mod0", "index-format": "json", compact: true }, cwd);
      const parsed = JSON.parse(logs.join("\n")) as {
        results?: Array<{ file: string }>;
      };
      expect(parsed.results?.some((r) => r.file === "src/mod0.ts")).toBe(true);
    } finally {
      console.log = origLog;
    }

    expect(await sidecarFile(cwd, "code")).toBeNull();
  });

  it("does not return partial code hits when a later JSONL row is corrupt at the same byte size", async () => {
    const cwd = await makeTempDir();
    await seedProject(cwd, 4);
    setLogQuietMode(true);

    await buildSourceIndex(cwd, CONFIG, true);
    const codePath = await sidecarFile(cwd, "code");
    expect(codePath).not.toBeNull();
    const raw = await readFile(codePath!, "utf-8");
    const lines = raw.split("\n").filter((line) => line.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const target = lines[1]!;
    lines[1] = `x${target.slice(1)}`;
    const corrupted = `${lines.join("\n")}\n`;
    expect(Buffer.byteLength(corrupted)).toBe(Buffer.byteLength(raw));
    await writeFile(codePath!, corrupted);

    const cachePath = join(cwd, CONFIG.cachePath);
    await expect(
      queryCodeStream(await readIndex(cachePath, { hydrate: "none" }), cachePath, "fn0"),
    ).rejects.toThrow(/partial code-search/);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      const code = await runIndexingCommand(
        { findCode: "fn0", "index-format": "json", compact: true },
        cwd,
      );
      expect(code).toBe(2);
      const parsed = JSON.parse(logs.join("\n")) as { status?: string };
      expect(parsed.status).toBe("ERROR");
    } finally {
      console.log = origLog;
    }
  });

  it("health reports stale when sidecar on-disk size differs from metadata", async () => {
    const cwd = await makeTempDir();
    await seedProject(cwd, 4);
    setLogQuietMode(true);

    await buildSourceIndex(cwd, CONFIG, true);
    const codePath = await sidecarFile(cwd, "code");
    expect(codePath).not.toBeNull();
    const raw = await readFile(codePath!, "utf-8");
    await writeFile(codePath!, `${raw} \n`);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      await runIndexingCommand({ health: true, "index-format": "json", compact: true }, cwd);
      const parsed = JSON.parse(logs.join("\n")) as { status: string; staleReasons?: string[] };
      expect(parsed.status).toBe("stale");
      expect(parsed.staleReasons).toContain("sidecar size mismatch");
    } finally {
      console.log = origLog;
    }
  });
});
