/**
 * Hydration must be atomic: a corrupt sidecar row after valid JSON must
 * not leave a prefix of files with payloads attached.
 */

import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "@jest/globals";

import { buildSourceIndex, runIndexingCommand } from "../commands/indexing.js";
import { runCreateSkillsCommand, type CreateSkillsValues } from "../commands/create-skills.js";
import { hydrateIndex, readIndex, writeIndex } from "../services/source-index/storage.js";
import { SidecarCarryError } from "../services/source-index/sidecar-carry.js";
import { getAgentContext } from "../services/mcp-server/service.js";
import { queryCodeStream } from "../services/source-index/query.js";
import { queryAgentContext } from "../services/source-index/agent-context-evidence.js";
import { setLogQuietMode } from "../utils/logger.js";
import { clearParserCache } from "../services/source-index/parser.js";
import type { IndexableLanguage, SourceIndex } from "../types/index.js";

const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "mp-sentinel-hydrate-atomic-"));
  tempDirs.push(dir);
  return dir;
};

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

const sidecarFile = async (dir: string, kind: "code" | "calls"): Promise<string> => {
  const cacheDir = join(dir, ".mp-sentinel-cache");
  const name = (await readdir(cacheDir)).find((e) => e.endsWith(`.${kind}.jsonl`));
  if (!name) throw new Error(`missing ${kind} sidecar`);
  return join(cacheDir, name);
};

const rewriteSidecarPath = async (
  file: string,
  fromPath: string,
  toPath: string,
): Promise<void> => {
  expect(fromPath.length).toBe(toPath.length);
  const raw = await readFile(file, "utf-8");
  const needle = JSON.stringify(fromPath);
  const idx = raw.indexOf(needle);
  expect(idx).toBeGreaterThanOrEqual(0);
  const next = `${raw.slice(0, idx)}${JSON.stringify(toPath)}${raw.slice(idx + needle.length)}`;
  expect(Buffer.byteLength(next)).toBe(Buffer.byteLength(raw));
  expect(next.split("\n").filter((line) => line.length > 0).length).toBe(
    raw.split("\n").filter((line) => line.length > 0).length,
  );
  await writeFile(file, next);
};

const makeCallsFixture = (fileCount = 2): SourceIndex => ({
  schemaVersion: "1.5",
  generatedAt: "2026-06-01T00:00:00.000Z",
  toolVersion: "3.2.7",
  project: {
    packageName: "fixture",
    ecosystem: "node",
    dependencies: {},
    devDependencies: {},
    detectedFrameworks: [],
  },
  files: Array.from({ length: fileCount }, (_, i) => ({
    path: `src/f${i}.ts`,
    language: "typescript" as const,
    sha256: `sha-${i}`,
    sizeBytes: 10,
    mtimeMs: 1,
    imports: [],
    exports: [],
    symbols: [{ name: `fn${i}`, type: "function" as const, line: 1, column: 0 }],
    calls: [{ callee: "doWork", line: 2, column: 0, inSymbol: `fn${i}` }],
  })),
  stats: { totalFiles: fileCount, indexedFiles: fileCount, skippedFiles: 0, parseErrors: 0 },
});

const corruptSameSize = async (file: string, rowIndex: number): Promise<void> => {
  const raw = await readFile(file, "utf-8");
  const lines = raw.split("\n").filter((line) => line.length > 0);
  const target = lines[rowIndex];
  if (!target) throw new Error(`no sidecar row ${rowIndex}`);
  lines[rowIndex] = `x${target.slice(1)}`;
  const corrupted = `${lines.join("\n")}\n`;
  expect(Buffer.byteLength(corrupted)).toBe(Buffer.byteLength(raw));
  await writeFile(file, corrupted);
};

const seedCallGraph = async (cwd: string): Promise<void> => {
  await mkdir(join(cwd, "src"), { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ name: "hydrate-atomic", version: "1.0.0" }),
  );
  await writeFile(join(cwd, "src", "mod0.ts"), `export function fn0() { return 0; }\n`);
  await writeFile(
    join(cwd, "src", "mod1.ts"),
    `import { fn0 } from "./mod0.js";\nexport function fn1() { return fn0(); }\n`,
  );
  await writeFile(
    join(cwd, "src", "mod2.ts"),
    `import { fn0 } from "./mod0.js";\nexport function fn2() { return fn0(); }\n`,
  );
  await writeFile(
    join(cwd, "src", "mod3.ts"),
    `import { fn0 } from "./mod0.js";\nexport function fn3() { return fn0(); }\n`,
  );
};

describe("atomic sidecar hydration", () => {
  it("does not attach calls from rows before a same-byte-size corrupt line", async () => {
    const dir = await makeTempDir();
    const cachePath = join(dir, "source-index.json");
    const files = Array.from({ length: 4 }, (_, i) => ({
      path: `src/f${i}.ts`,
      language: "typescript" as const,
      sha256: `sha-${i}`,
      sizeBytes: 10,
      mtimeMs: 1,
      imports: [],
      exports: [],
      symbols: [{ name: `fn${i}`, type: "function" as const, line: 1, column: 0 }],
      calls: [{ callee: "doWork", line: 2, column: 0, inSymbol: `fn${i}` }],
    }));
    const index: SourceIndex = {
      schemaVersion: "1.5",
      generatedAt: "2026-06-01T00:00:00.000Z",
      toolVersion: "3.2.7",
      project: {
        packageName: "fixture",
        ecosystem: "node",
        dependencies: {},
        devDependencies: {},
        detectedFrameworks: [],
      },
      files,
      stats: { totalFiles: 4, indexedFiles: 4, skippedFiles: 0, parseErrors: 0 },
    };
    await writeIndex(index, cachePath);
    const callsSidecar = (await readdir(dir)).find((e) => e.endsWith(".calls.jsonl"))!;
    await corruptSameSize(join(dir, callsSidecar), 1);

    const core = await readIndex(cachePath, { hydrate: "none" });
    const ok = await hydrateIndex(core!, cachePath, "calls");
    expect(ok).toBe(false);
    expect(core!.files.every((f) => f.calls === undefined)).toBe(true);
  });

  it("agent-context does not return a prefix-only caller graph", async () => {
    const cwd = await makeTempDir();
    await seedCallGraph(cwd);
    setLogQuietMode(true);
    await buildSourceIndex(cwd, CONFIG, true);

    const healthyIndex = await readIndex(join(cwd, CONFIG.cachePath), { hydrate: "calls" });
    expect(healthyIndex).not.toBeNull();
    const healthy = queryAgentContext(healthyIndex, "src/mod0.ts", cwd);
    expect(healthy.incomingCalls.length).toBeGreaterThanOrEqual(2);

    await corruptSameSize(await sidecarFile(cwd, "calls"), 1);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      const code = await runIndexingCommand(
        { agentContext: "src/mod0.ts", "index-format": "json", compact: true },
        cwd,
      );
      // Rebuild on hydrate failure is allowed; a prefix-only graph is not.
      expect(code === 0 || code === 2).toBe(true);
      if (code === 0) {
        const parsed = JSON.parse(logs.join("\n")) as {
          incomingCalls?: Array<{ fromFile: string }>;
        };
        const callers = new Set((parsed.incomingCalls ?? []).map((c) => c.fromFile));
        expect(callers.has("src/mod1.ts")).toBe(true);
        expect(callers.has("src/mod2.ts") || callers.has("src/mod3.ts")).toBe(true);
      }
    } finally {
      console.log = origLog;
    }

    const mcp = await getAgentContext(cwd, "src/mod0.ts");
    if ("error" in mcp && mcp.error) {
      expect(String(mcp.error)).toMatch(/corrupt|partial/i);
    } else {
      const incoming = mcp.incomingCalls as Array<{ fromFile: string }> | undefined;
      const callers = new Set((incoming ?? []).map((c) => c.fromFile));
      expect(callers.has("src/mod1.ts")).toBe(true);
      expect(callers.has("src/mod2.ts") || callers.has("src/mod3.ts")).toBe(true);
    }
  });

  it("compact agent-context does not return a prefix-only caller graph", async () => {
    const cwd = await makeTempDir();
    await seedCallGraph(cwd);
    setLogQuietMode(true);
    await buildSourceIndex(cwd, CONFIG, true);

    await corruptSameSize(await sidecarFile(cwd, "calls"), 1);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      // A budget well above this fixture's payload, so anything missing from
      // the capsule is a hydration failure rather than a budget drop.
      const code = await runIndexingCommand(
        {
          agentContext: "src/mod0.ts",
          "index-format": "json",
          compact: true,
          tokenBudget: "4000",
        },
        cwd,
      );
      expect(code === 0 || code === 2).toBe(true);
      if (code === 0) {
        const parsed = JSON.parse(logs.join("\n")) as {
          incomingCalls?: Array<{ fromFile: string }>;
          usedTokens?: number;
        };
        const callers = new Set((parsed.incomingCalls ?? []).map((c) => c.fromFile));
        expect(callers.has("src/mod1.ts")).toBe(true);
        expect(callers.has("src/mod2.ts") || callers.has("src/mod3.ts")).toBe(true);
        expect(parsed.usedTokens).toBeLessThanOrEqual(4000);
      }
    } finally {
      console.log = origLog;
    }
  });

  it("full-index refuses to export a half-hydrated index", async () => {
    const cwd = await makeTempDir();
    await seedCallGraph(cwd);
    setLogQuietMode(true);
    await buildSourceIndex(cwd, CONFIG, true);
    await corruptSameSize(await sidecarFile(cwd, "calls"), 1);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      const code = await runIndexingCommand(
        { fullIndex: true, "index-format": "json", compact: true },
        cwd,
      );
      expect(code === 0 || code === 2).toBe(true);
      const parsed = JSON.parse(logs.join("\n")) as {
        status?: string;
        files?: Array<{ path: string; calls?: unknown[] }>;
      };
      if (code === 2) {
        expect(parsed.status).toBe("ERROR");
      } else {
        const withCalls = (parsed.files ?? []).filter((f) => f.calls && f.calls.length > 0);
        expect(withCalls.length).toBeGreaterThanOrEqual(3);
      }
    } finally {
      console.log = origLog;
    }
  });

  it("create-skills --skip-index-refresh fails on a corrupt calls sidecar", async () => {
    const cwd = await makeTempDir();
    await seedCallGraph(cwd);
    setLogQuietMode(true);
    await buildSourceIndex(cwd, CONFIG, true);
    await corruptSameSize(await sidecarFile(cwd, "calls"), 1);

    const values: CreateSkillsValues = {
      "all-agents": false,
      "create-skills-force": false,
      "skip-index-refresh": true,
      "create-skills-no-ai-enrich": true,
      agent: "claude",
      "create-skills-format": "json",
    };
    const code = await runCreateSkillsCommand(values, cwd);
    expect(code).toBe(2);
  });

  it("rejects a calls sidecar that is missing a whole JSONL row", async () => {
    const cwd = await makeTempDir();
    await seedCallGraph(cwd);
    setLogQuietMode(true);
    await buildSourceIndex(cwd, CONFIG, true);

    const callsPath = await sidecarFile(cwd, "calls");
    const raw = await readFile(callsPath, "utf-8");
    const lines = raw.split("\n").filter((line) => line.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    await writeFile(callsPath, `${lines.slice(1).join("\n")}\n`);

    const cachePath = join(cwd, CONFIG.cachePath);
    const core = await readIndex(cachePath, { hydrate: "none" });
    expect(core).not.toBeNull();
    const ok = await hydrateIndex(core!, cachePath, "calls");
    expect(ok).toBe(false);
    expect(core!.files.every((f) => f.calls === undefined)).toBe(true);

    const mcp = await getAgentContext(cwd, "src/mod0.ts");
    expect(String(mcp.error)).toMatch(/corrupt|partial/i);
    expect(mcp.incomingCalls).toBeUndefined();

    const values: CreateSkillsValues = {
      "all-agents": false,
      "create-skills-force": false,
      "skip-index-refresh": true,
      "create-skills-no-ai-enrich": true,
      agent: "claude",
      "create-skills-format": "json",
    };
    expect(await runCreateSkillsCommand(values, cwd)).toBe(2);
  });

  it("rejects a sidecar row whose path is not in the core index (same bytes and row count)", async () => {
    const dir = await makeTempDir();
    const cachePath = join(dir, "source-index.json");
    await writeIndex(makeCallsFixture(2), cachePath);
    const callsSidecar = (await readdir(dir)).find((e) => e.endsWith(".calls.jsonl"))!;
    await rewriteSidecarPath(join(dir, callsSidecar), "src/f1.ts", "src/xx.ts");

    const core = await readIndex(cachePath, { hydrate: "none" });
    const ok = await hydrateIndex(core!, cachePath, "calls");
    expect(ok).toBe(false);
    expect(core!.files.every((f) => f.calls === undefined)).toBe(true);
  });

  it("rejects a sidecar with a duplicate path (same bytes and row count)", async () => {
    const dir = await makeTempDir();
    const cachePath = join(dir, "source-index.json");
    await writeIndex(makeCallsFixture(2), cachePath);
    const callsSidecar = (await readdir(dir)).find((e) => e.endsWith(".calls.jsonl"))!;
    await rewriteSidecarPath(join(dir, callsSidecar), "src/f1.ts", "src/f0.ts");

    const core = await readIndex(cachePath, { hydrate: "none" });
    const ok = await hydrateIndex(core!, cachePath, "calls");
    expect(ok).toBe(false);
    expect(core!.files.every((f) => f.calls === undefined)).toBe(true);
  });

  it("copy-forward refuses an unknown path instead of attaching the remaining rows", async () => {
    const dir = await makeTempDir();
    const cachePath = join(dir, "source-index.json");
    const original = makeCallsFixture(2);
    await writeIndex(original, cachePath);
    const callsSidecar = (await readdir(dir)).find((e) => e.endsWith(".calls.jsonl"))!;
    await rewriteSidecarPath(join(dir, callsSidecar), "src/f1.ts", "src/xx.ts");

    const core = await readIndex(cachePath, { hydrate: "none" });
    await expect(
      writeIndex(core!, cachePath, {
        cacheHitPaths: new Set(core!.files.map((f) => f.path)),
      }),
    ).rejects.toThrow(SidecarCarryError);
    expect(core!.files.every((f) => f.calls === undefined)).toBe(true);
  });

  it("incremental delete skips the removed file without a full reindex", async () => {
    const cwd = await makeTempDir();
    await seedCallGraph(cwd);
    setLogQuietMode(true);
    const first = await buildSourceIndex(cwd, CONFIG, true);
    expect(first!.files.some((f) => f.path === "src/mod3.ts")).toBe(true);

    await rm(join(cwd, "src", "mod3.ts"));
    const second = await buildSourceIndex(cwd, CONFIG, false);
    expect(second!.stats.parsedFiles).toBe(0);
    expect(second!.stats.cacheHitFiles).toBeGreaterThanOrEqual(3);
    expect(second!.files.map((f) => f.path).sort()).toEqual([
      "src/mod0.ts",
      "src/mod1.ts",
      "src/mod2.ts",
    ]);

    const cachePath = join(cwd, CONFIG.cachePath);
    const hydrated = await readIndex(cachePath, { hydrate: "full" });
    const keep = hydrated!.files.find((f) => f.path === "src/mod1.ts");
    expect(keep?.calls?.some((c) => c.callee === "fn0")).toBe(true);
    const codeHits = await queryCodeStream(hydrated, cachePath, "fn0");
    expect(codeHits.some((r) => r.file === "src/mod0.ts")).toBe(true);
    expect(codeHits.some((r) => r.file === "src/mod3.ts")).toBe(false);
  });
});
