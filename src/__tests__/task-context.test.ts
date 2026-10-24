import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import { parseCliArgs } from "../cli/args.js";
import { buildSourceIndex, runIndexingCommand } from "../commands/indexing.js";
import {
  buildTaskContext,
  extractTaskAnchors,
  MAX_TASK_FILES,
} from "../services/source-index/task-context.js";
import { stringifyCompactJson } from "../services/source-index/json-output.js";
import { packCapsule } from "../services/source-index/task-context-pack.js";
import { clearParserCache } from "../services/source-index/parser.js";
import { setLogQuietMode } from "../utils/logger.js";
import { estimateTokens } from "../utils/tokens.js";
import type { IndexableLanguage, SourceIndex } from "../types/index.js";
import type { TaskContextFile } from "../services/source-index/task-context.js";

const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "mp-sentinel-task-ctx-"));
  tempDirs.push(dir);
  return dir;
};

beforeEach(() => {
  clearParserCache();
  process.argv = ["node", "mp-sentinel"];
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
  maxRelatedFiles: 20,
};

const seedCorpus = async (cwd: string): Promise<SourceIndex> => {
  await mkdir(join(cwd, "src"), { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ name: "task-ctx", version: "1.0.0" }),
  );
  await writeFile(
    join(cwd, "src", "index.ts"),
    `import { z } from "zod";\n` +
      `export function hello() { return "hi"; }\n` +
      `export const parsed = z.string();\n`,
  );
  await writeFile(join(cwd, "src", "utils.ts"), `export function helper() { return true; }\n`);
  await writeFile(
    join(cwd, "src", "make-parser.ts"),
    `export function makeParser() { return { parse: () => 1 }; }\n`,
  );
  setLogQuietMode(true);
  const index = await buildSourceIndex(cwd, CONFIG, true);
  expect(index).not.toBeNull();
  if (!index) throw new Error("expected index");
  return index;
};

describe("extractTaskAnchors", () => {
  it("keeps path, identifier, flag, and package tokens", () => {
    const anchors = extractTaskAnchors(
      "please find parseFile in sidecar-carry.ts and --limit for zod",
    );
    expect(anchors).toContain("parseFile");
    expect(anchors).toContain("sidecar-carry.ts");
    expect(anchors).toContain("--limit");
    expect(anchors).toContain("zod");
    expect(anchors.length).toBeLessThanOrEqual(6);
  });

  it("drops Vietnamese and English stopwords", () => {
    const anchors = extractTaskAnchors("tìm hàm hello ở file nào");
    expect(anchors).toContain("hello");
    expect(anchors).not.toContain("tìm");
    expect(anchors).not.toContain("nào");
  });

  it("keeps domain tokens that used to be stopwords", () => {
    const anchors = extractTaskAnchors("copy-forward deleted sidecar rows from source");
    expect(anchors).toContain("deleted");
    expect(anchors).toContain("rows");
    expect(anchors).toContain("source");
  });
});

describe("buildTaskContext", () => {
  it("hits exact symbols and omits prompt echo and snippets", async () => {
    const cwd = await makeTempDir();
    const index = await seedCorpus(cwd);
    const result = await buildTaskContext(
      index,
      "hello",
      { maxFiles: 5, tokenBudget: 800 },
      join(cwd, CONFIG.cachePath),
    );
    expect(result.files.some((f) => f.file === "src/index.ts")).toBe(true);
    const json = stringifyCompactJson(result);
    expect(json).not.toContain("hello is defined");
    expect(result.files.every((f) => !("text" in f) && !("snippet" in f))).toBe(true);
    expect(result.usedTokens).toBeGreaterThan(0);
    expect(result.usedTokens).toBeLessThanOrEqual(800);
  });

  it("ranks makeParser from a task-shaped prompt", async () => {
    const cwd = await makeTempDir();
    const index = await seedCorpus(cwd);
    const result = await buildTaskContext(
      index,
      "where is makeParser implemented",
      { maxFiles: 5 },
      join(cwd, CONFIG.cachePath),
    );
    expect(result.files.some((f) => f.file === "src/make-parser.ts")).toBe(true);
  });

  it("ranks hello from a Vietnamese prompt", async () => {
    const cwd = await makeTempDir();
    const index = await seedCorpus(cwd);
    const result = await buildTaskContext(
      index,
      "hàm hello ở đâu",
      { maxFiles: 5 },
      join(cwd, CONFIG.cachePath),
    );
    expect(result.files.some((f) => f.file === "src/index.ts")).toBe(true);
  });

  it("returns an empty capsule for an empty prompt", async () => {
    const cwd = await makeTempDir();
    const index = await seedCorpus(cwd);
    const result = await buildTaskContext(index, "   ");
    expect(result.files).toEqual([]);
    expect(result.anchors).toEqual([]);
  });

  it("never exceeds a tight token budget on the emitted JSON", async () => {
    const cwd = await makeTempDir();
    const index = await seedCorpus(cwd);
    const result = await buildTaskContext(
      index,
      "hello makeParser helper",
      { maxFiles: 10, tokenBudget: 250 },
      join(cwd, CONFIG.cachePath),
    );
    const tokens = await estimateTokens(stringifyCompactJson(result));
    expect(result.usedTokens).toBeLessThanOrEqual(250);
    expect(tokens).toBeLessThanOrEqual(250);
  });

  it("keeps the hard budget when many files would bloat omittedFiles", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "task-ctx-wide", version: "1.0.0" }),
    );
    await mkdir(join(cwd, "src", "generated-long-module-directory-name"), {
      recursive: true,
    });
    for (let i = 0; i < 40; i++) {
      const name = `generated-long-module-name-${String(i).padStart(3, "0")}.ts`;
      await writeFile(
        join(cwd, "src", "generated-long-module-directory-name", name),
        `export function utilFn() { return ${i}; }\n`,
      );
    }
    setLogQuietMode(true);
    const index = await buildSourceIndex(cwd, CONFIG, true);
    expect(index).not.toBeNull();
    if (!index) return;

    const budget = 400;
    const result = await buildTaskContext(
      index,
      "generated-long-module-name",
      { maxFiles: 5, tokenBudget: budget },
      join(cwd, CONFIG.cachePath),
    );
    const tokens = await estimateTokens(stringifyCompactJson(result));
    expect(result.usedTokens).toBeLessThanOrEqual(budget);
    expect(tokens).toBeLessThanOrEqual(budget);
    expect(result.usedTokens).toBe(tokens);
    expect(result.files.length).toBeGreaterThanOrEqual(1);
    expect(result.omittedCount).toBeGreaterThan(0);
    expect(result.omittedCount).toBeGreaterThanOrEqual(result.omittedFiles.length);
    expect(result.truncated).toBe(true);
  });

  it("never returns a minimum envelope over a 100-token budget", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src", "generated-long-module-directory-name"), {
      recursive: true,
    });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "task-ctx-min", version: "1.0.0" }),
    );
    for (let i = 0; i < 40; i++) {
      const name = `generated-long-module-name-${String(i).padStart(3, "0")}.ts`;
      await writeFile(
        join(cwd, "src", "generated-long-module-directory-name", name),
        `export function utilFn() { return ${i}; }\n`,
      );
    }
    setLogQuietMode(true);
    const index = await buildSourceIndex(cwd, CONFIG, true);
    expect(index).not.toBeNull();
    if (!index) return;

    const budget = 100;
    const result = await buildTaskContext(
      index,
      "generated-long-module-name",
      { maxFiles: 10, tokenBudget: budget },
      join(cwd, CONFIG.cachePath),
    );
    const tokens = await estimateTokens(stringifyCompactJson(result));
    expect(result.usedTokens).toBeLessThanOrEqual(budget);
    expect(tokens).toBeLessThanOrEqual(budget);
  });

  it("counts an MCP status envelope against the token budget", async () => {
    const cwd = await makeTempDir();
    const index = await seedCorpus(cwd);
    const budget = 250;
    const envelope = { status: "ok" };
    const result = await buildTaskContext(
      index,
      "hello makeParser helper",
      { maxFiles: 10, tokenBudget: budget, emitEnvelope: envelope },
      join(cwd, CONFIG.cachePath),
    );
    const emitted = stringifyCompactJson({ ...envelope, ...result });
    const tokens = await estimateTokens(emitted);
    expect(result.usedTokens).toBeLessThanOrEqual(budget);
    expect(tokens).toBeLessThanOrEqual(budget);
    expect(result.usedTokens).toBe(tokens);
  });
});

describe("--explain-ranking", () => {
  it("parses the flag and requires --task-context", async () => {
    process.argv = [
      "node",
      "mp-sentinel",
      "indexing",
      "--task-context",
      "hydrate sidecar",
      "--explain-ranking",
    ];
    expect(parseCliArgs().values.explainRanking).toBe(true);

    const cwd = await mkdtemp(join(tmpdir(), "mp-sentinel-task-ctx-rank-flag-"));
    tempDirs.push(cwd);
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "task-ctx-rank-flag", version: "1.0.0" }),
    );
    await writeFile(join(cwd, "src", "a.ts"), "export function aFn() { return 1; }\n");
    setLogQuietMode(true);
    await buildSourceIndex(cwd, CONFIG, true);
    setLogQuietMode(false);

    await expect(
      runIndexingCommand({ explainRanking: true, "index-format": "json" }, cwd),
    ).rejects.toThrow(/--explain-ranking requires --task-context/);
  });

  it("lists candidates past the capsule cap so a miss can be traced", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mp-sentinel-task-ctx-rank-"));
    tempDirs.push(cwd);
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "task-ctx-rank", version: "1.0.0" }),
    );
    // 14 files match the anchor, so the ranked list runs past the 10-file
    // capsule cap that used to be the only view into ranking.
    for (let i = 0; i < 14; i++) {
      await writeFile(
        join(cwd, "src", `sidecar-module-${String(i).padStart(2, "0")}.ts`),
        `export function hydrateSidecarPart${i}() { return ${i}; }\n`,
      );
    }
    setLogQuietMode(true);
    const index = await buildSourceIndex(cwd, CONFIG, true);
    setLogQuietMode(false);
    expect(index).not.toBeNull();

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    let code: number;
    try {
      code = await runIndexingCommand(
        {
          taskContext: "hydrateSidecarPart",
          explainRanking: true,
          "index-format": "json",
          compact: true,
        },
        cwd,
      );
    } finally {
      console.log = origLog;
    }

    expect(code).toBe(0);
    const parsed = JSON.parse(logs.join("\n")) as {
      anchors: string[];
      candidateCount: number;
      truncated: boolean;
      candidates: Array<{ file: string; rank: number; score: number }>;
    };
    expect(parsed.candidates.length).toBeGreaterThan(MAX_TASK_FILES);
    expect(parsed.candidateCount).toBe(parsed.candidates.length);
    expect(parsed.truncated).toBe(false);
    expect(parsed.candidates[0]?.rank).toBe(1);
    // Ranks are dense and ordered, so a rank read from here is comparable to
    // the capsule's opened window.
    parsed.candidates.forEach((candidate, i) => expect(candidate.rank).toBe(i + 1));
  });
});

describe("task-context ranking priors", () => {
  it("ranks source above the build artifact that mirrors it", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mp-sentinel-task-ctx-artifact-"));
    tempDirs.push(cwd);
    await mkdir(join(cwd, "src"), { recursive: true });
    await mkdir(join(cwd, "dist-test", "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "task-ctx-artifact", version: "1.0.0" }),
    );
    const body = `export function reviewCapsulePayload() { return 1; }\n`;
    await writeFile(join(cwd, "src", "capsule-service.ts"), body);
    await writeFile(join(cwd, "dist-test", "src", "capsule-service.js"), body);

    setLogQuietMode(true);
    const index = await buildSourceIndex(cwd, CONFIG, true);
    setLogQuietMode(false);
    expect(index).not.toBeNull();

    const result = await buildTaskContext(
      index,
      "reviewCapsulePayload",
      { maxFiles: 5, tokenBudget: 800 },
      join(cwd, CONFIG.cachePath),
    );
    const files = result.files.map((f) => f.file);
    expect(files[0]).toBe("src/capsule-service.ts");
    const artifactRank = files.indexOf("dist-test/src/capsule-service.js");
    if (artifactRank !== -1) expect(artifactRank).toBeGreaterThan(0);
  });

  it("does not hand a generic index.ts the basename boost", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mp-sentinel-task-ctx-generic-"));
    tempDirs.push(cwd);
    await mkdir(join(cwd, "src", "types"), { recursive: true });
    await mkdir(join(cwd, "src", "services"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "task-ctx-generic", version: "1.0.0" }),
    );
    // The barrel matches the query in more places than the implementation --
    // it used to win on the `index` basename alone.
    await writeFile(
      join(cwd, "src", "types", "index.ts"),
      `export interface IndexCacheEntry { id: string }\n` +
        `export interface IndexCacheStats { hits: number }\n` +
        `export interface IndexCacheOptions { ttl: number }\n` +
        `export interface IndexCacheKey { key: string }\n` +
        `export interface IndexCacheLookup { hit: boolean }\n`,
    );
    await writeFile(
      join(cwd, "src", "services", "index-cache.ts"),
      `export function lookupCache() { return null; }\n`,
    );

    setLogQuietMode(true);
    const index = await buildSourceIndex(cwd, CONFIG, true);
    setLogQuietMode(false);
    expect(index).not.toBeNull();

    const result = await buildTaskContext(
      index,
      "index cache lookup",
      { maxFiles: 5, tokenBudget: 800 },
      join(cwd, CONFIG.cachePath),
    );
    const files = result.files.map((f) => f.file);
    expect(files[0]).toBe("src/services/index-cache.ts");
  });

  it("keeps a test file below the implementation it covers", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mp-sentinel-task-ctx-testfile-"));
    tempDirs.push(cwd);
    await mkdir(join(cwd, "src", "__tests__"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "task-ctx-testfile", version: "1.0.0" }),
    );
    await writeFile(
      join(cwd, "src", "sidecar-carry.ts"),
      `export function collectValidSidecarRows() { return []; }\n`,
    );
    await writeFile(
      join(cwd, "src", "__tests__", "sidecar-carry.test.ts"),
      `import { collectValidSidecarRows } from "../sidecar-carry.js";\n` +
        `export function testCollectValidSidecarRows() { return collectValidSidecarRows(); }\n`,
    );

    setLogQuietMode(true);
    const index = await buildSourceIndex(cwd, CONFIG, true);
    setLogQuietMode(false);
    expect(index).not.toBeNull();

    const result = await buildTaskContext(
      index,
      "collectValidSidecarRows",
      { maxFiles: 5, tokenBudget: 800 },
      join(cwd, CONFIG.cachePath),
    );
    expect(result.files[0]?.file).toBe("src/sidecar-carry.ts");
  });
});

describe("packCapsule single-file invariant", () => {
  const dir = "src/generated-long-module-directory-name/nested-generated-area";
  const makeRecord = (i: number): TaskContextFile => ({
    file: `${dir}/generated-long-module-name-${String(i).padStart(3, "0")}.ts`,
    rank: i + 1,
    score: Math.round((0.9876 - i / 1000) * 10000) / 10000,
    anchors: [
      "generatedLongModuleAnchorAlpha",
      "generatedLongModuleAnchorBravo",
      "generatedLongModuleAnchorCharlie",
      "generatedLongModuleAnchorDelta",
    ],
    graph: {
      imports: [
        `${dir}/generated-long-module-name-100.ts`,
        `${dir}/generated-long-module-name-101.ts`,
        `${dir}/generated-long-module-name-102.ts`,
      ],
      dependents: [
        `${dir}/generated-long-module-name-200.ts`,
        `${dir}/generated-long-module-name-201.ts`,
        `${dir}/generated-long-module-name-202.ts`,
      ],
    },
  });
  const records = Array.from({ length: 12 }, (_, i) => makeRecord(i));
  const anchors = ["generatedLongModuleAnchorAlpha", "generatedLongModuleAnchorBravo"];
  const warnings = ["index is stale relative to the working tree; results may be incomplete"];

  it("keeps the top file by slimming metadata when the full record cannot fit", async () => {
    const budget = 120;
    const result = await packCapsule(records, {
      maxFiles: 5,
      tokenBudget: budget,
      anchors,
      warnings,
    });
    const tokens = await estimateTokens(stringifyCompactJson(result));

    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.file).toBe(records[0]?.file);
    expect(result.files[0]?.rank).toBe(1);
    expect(result.usedTokens).toBeLessThanOrEqual(budget);
    expect(result.usedTokens).toBe(tokens);
    expect(result.truncated).toBe(true);
    expect(result.omittedCount).toBe(records.length - 1);
  });

  it("keeps the top file under an MCP envelope by slimming metadata", async () => {
    const budget = 120;
    const envelope = { status: "ok" };
    const result = await packCapsule(records, {
      maxFiles: 5,
      tokenBudget: budget,
      anchors,
      warnings,
      emitEnvelope: envelope,
    });
    const tokens = await estimateTokens(stringifyCompactJson({ ...envelope, ...result }));

    expect(result.files).toHaveLength(1);
    expect(result.usedTokens).toBeLessThanOrEqual(budget);
    expect(result.usedTokens).toBe(tokens);
  });

  it("returns an empty capsule when not even a bare single-file envelope fits", async () => {
    const budget = 60;
    const result = await packCapsule(records, {
      maxFiles: 5,
      tokenBudget: budget,
      anchors,
      warnings,
    });

    expect(result.files).toEqual([]);
    expect(result.usedTokens).toBeLessThanOrEqual(budget);
    expect(result.usedTokens).toBe(await estimateTokens(stringifyCompactJson(result)));
  });
});

describe("CLI --task-context --pretty budget", () => {
  it("counts pretty-print whitespace against the token budget", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mp-sentinel-task-ctx-pretty-"));
    tempDirs.push(cwd);
    await mkdir(join(cwd, "src", "generated-long-module-directory-name"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "task-ctx-pretty", version: "1.0.0" }),
    );
    for (let i = 0; i < 40; i++) {
      const name = `generated-long-module-name-${String(i).padStart(3, "0")}.ts`;
      await writeFile(
        join(cwd, "src", "generated-long-module-directory-name", name),
        `export function utilFn() { return ${i}; }\n`,
      );
    }
    setLogQuietMode(true);
    const index = await buildSourceIndex(cwd, CONFIG, true);
    expect(index).not.toBeNull();
    setLogQuietMode(false);

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    let code: number;
    try {
      code = await runIndexingCommand(
        {
          taskContext: "generated-long-module-name",
          "index-format": "json",
          pretty: true,
          tokenBudget: "800",
        },
        cwd,
      );
    } finally {
      console.log = origLog;
    }

    expect(code).toBe(0);
    const out = logs.join("\n");
    expect(out).toContain("\n  ");
    const parsed = JSON.parse(out) as { usedTokens: number };
    const tokens = await estimateTokens(out);
    expect(tokens).toBeLessThanOrEqual(800);
    expect(parsed.usedTokens).toBe(tokens);
  });
});

describe("CLI --task-context", () => {
  it("parses the flag", () => {
    process.argv = ["node", "mp-sentinel", "indexing", "--task-context", "hydrate sidecar"];
    const parsed = parseCliArgs();
    expect(parsed.command).toBe("indexing");
    expect(parsed.values.taskContext).toBe("hydrate sidecar");
  });
});
