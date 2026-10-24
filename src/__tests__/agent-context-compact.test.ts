/**
 * Compact, token-budgeted agent context.
 *
 * Locks: legacy CLI output stays byte-identical without `--token-budget`,
 * the compact capsule never exceeds the budget on the JSON that is actually
 * emitted (compact, pretty and MCP), and `focus` can pull evidence that the
 * legacy caps/source order would have dropped.
 */

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import { parseCliArgs } from "../cli/args.js";
import { buildSourceIndex, runIndexingCommand } from "../commands/indexing.js";
import { queryAgentContext } from "../services/source-index/agent-context-evidence.js";
import {
  buildCompactAgentContext,
  clampAgentContextBudget,
  normalizeFocus,
  DEFAULT_AGENT_CONTEXT_TOKEN_BUDGET,
} from "../services/source-index/agent-context-pack.js";
import { getAgentContext } from "../services/mcp-server/service.js";
import { clearParserCache } from "../services/source-index/parser.js";
import { setLogQuietMode } from "../utils/logger.js";
import { clearConfigCache } from "../utils/config.js";
import { estimateTokens } from "../utils/tokens.js";
import type { IndexableLanguage } from "../types/index.js";

const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "mp-sentinel-agentctx-"));
  tempDirs.push(dir);
  return dir;
};

const CONFIG = {
  enabled: true,
  languages: ["typescript", "tsx", "javascript", "jsx"] as IndexableLanguage[],
  cachePath: ".mp-sentinel-cache/source-index.json",
  maxFileSize: 512000,
  maxRelatedFiles: 20,
};

const FAT_FILE = "src/fat-module-under-inspection.ts";
const DEP_COUNT = 25;
const SYMBOL_COUNT = 60;
const CONSUMER_COUNT = 8;
/** Beyond the 30-symbol legacy cap and late in source order. */
const DEEP_SYMBOL = `generatedHandlerFunctionNumber${SYMBOL_COUNT - 5}`;

const captureStdout = async (fn: () => Promise<number>): Promise<{ code: number; out: string }> => {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    const code = await fn();
    return { code, out: logs.join("\n") };
  } finally {
    console.log = origLog;
  }
};

/**
 * A file whose evidence overflows every legacy cap: 60 symbols, 25 imports,
 * 60 exports, many outbound calls, and 8 files calling back into it.
 */
const makeFatProject = async (cwd: string): Promise<void> => {
  await mkdir(join(cwd, "src"), { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ name: "agent-context-compact-fixture", version: "1.0.0" }),
  );

  for (let i = 0; i < DEP_COUNT; i++) {
    await writeFile(
      join(cwd, "src", `dep-module-with-a-long-name-${i}.ts`),
      `export function dependencyHelperNumber${i}() { return ${i}; }\n`,
    );
  }

  const lines: string[] = [];
  for (let i = 0; i < DEP_COUNT; i++) {
    lines.push(
      `import { dependencyHelperNumber${i} } from "./dep-module-with-a-long-name-${i}.js";`,
    );
  }
  for (let i = 0; i < SYMBOL_COUNT; i++) {
    lines.push(
      `export function generatedHandlerFunctionNumber${i}() { return dependencyHelperNumber${i % DEP_COUNT}(); }`,
    );
  }
  await writeFile(join(cwd, FAT_FILE), `${lines.join("\n")}\n`);

  for (let j = 0; j < CONSUMER_COUNT; j++) {
    const calls = Array.from(
      { length: 5 },
      (_, k) => `  generatedHandlerFunctionNumber${(j * 5 + k) % SYMBOL_COUNT}();`,
    ).join("\n");
    await writeFile(
      join(cwd, "src", `consumer-module-number-${j}.ts`),
      `import { generatedHandlerFunctionNumber0 } from "./fat-module-under-inspection.js";\n` +
        `export function consumerEntryPointNumber${j}() {\n${calls}\n  generatedHandlerFunctionNumber0();\n}\n`,
    );
  }
};

const buildFatIndex = async (cwd: string) => {
  setLogQuietMode(true);
  const index = await buildSourceIndex(cwd, CONFIG, true);
  setLogQuietMode(false);
  if (!index) throw new Error("fixture index failed to build");
  return index;
};

beforeEach(() => {
  clearParserCache();
  clearConfigCache();
  process.argv = ["node", "mp-sentinel"];
});

afterEach(async () => {
  clearParserCache();
  clearConfigCache();
  setLogQuietMode(false);
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("focus normalization", () => {
  it("trims and dedupes anchors", () => {
    expect(normalizeFocus(["  packCapsule ", "packCapsule", "emitPolicyJson"])).toEqual([
      "packCapsule",
      "emitPolicyJson",
    ]);
  });

  it("returns an empty list when no focus is given", () => {
    expect(normalizeFocus(undefined)).toEqual([]);
    expect(normalizeFocus([])).toEqual([]);
  });

  it("rejects an empty anchor", () => {
    expect(() => normalizeFocus(["ok", "   "])).toThrow(/must not be empty/);
  });

  it("rejects more than six anchors", () => {
    expect(() => normalizeFocus(["a", "b", "c", "d", "e", "f", "g"])).toThrow(/at most 6/);
  });
});

describe("token budget validation", () => {
  it("defaults to the MCP budget", () => {
    expect(clampAgentContextBudget(undefined)).toBe(DEFAULT_AGENT_CONTEXT_TOKEN_BUDGET);
  });

  it("clamps into [100, 4000]", () => {
    expect(clampAgentContextBudget(10)).toBe(100);
    expect(clampAgentContextBudget(99999)).toBe(4000);
  });

  it("rejects a non-integer or non-positive budget", () => {
    expect(() => clampAgentContextBudget(0)).toThrow(/integer >= 1/);
    expect(() => clampAgentContextBudget(12.5)).toThrow(/integer >= 1/);
  });
});

/**
 * Small, fully-enumerated project. The legacy payload for `src/legacy-target.ts`
 * is snapshotted as raw compact JSON, so the recorded bytes -- not the current
 * implementation -- are the oracle for backward compatibility.
 */
const makeLegacyProject = async (cwd: string): Promise<void> => {
  await mkdir(join(cwd, "src"), { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ name: "agent-context-legacy-fixture", version: "1.0.0" }),
  );
  await writeFile(
    join(cwd, "src", "legacy-helper.ts"),
    `export function legacyHelper(n: number) { return n + 1; }\n`,
  );
  await writeFile(
    join(cwd, "src", "legacy-target.ts"),
    `import { legacyHelper } from "./legacy-helper.js";\n` +
      `import { z } from "zod";\n` +
      `export function legacyEntryPoint() { return legacyHelper(1); }\n` +
      `export class LegacyService {}\n` +
      `export const legacySchema = z;\n`,
  );
  await writeFile(
    join(cwd, "src", "legacy-consumer.ts"),
    `import { legacyEntryPoint } from "./legacy-target.js";\n` +
      `export function legacyConsumer() { return legacyEntryPoint(); }\n`,
  );
};

describe("compact agent context", () => {
  it("keeps the legacy CLI payload byte-identical without --token-budget", async () => {
    const cwd = await makeTempDir();
    await makeLegacyProject(cwd);
    await buildFatIndex(cwd);

    const { code, out } = await captureStdout(() =>
      runIndexingCommand(
        { agentContext: "src/legacy-target.ts", "index-format": "json", compact: true },
        cwd,
      ),
    );
    expect(code).toBe(0);
    // Raw string: key order and formatting are part of the contract, and
    // JSON.parse would hide a change in either.
    expect(out).toMatchSnapshot("legacy-agent-context-compact-json");
  });

  it("still emits suggestedCommands and no budget fields on the legacy path", async () => {
    const cwd = await makeTempDir();
    await makeFatProject(cwd);
    await buildFatIndex(cwd);

    const { code, out } = await captureStdout(() =>
      runIndexingCommand({ agentContext: FAT_FILE, "index-format": "json", compact: true }, cwd),
    );
    expect(code).toBe(0);

    const parsed = JSON.parse(out);
    expect(parsed.suggestedCommands.length).toBeGreaterThan(0);
    expect(parsed.usedTokens).toBeUndefined();
    expect(parsed.truncated).toBeUndefined();
    expect(parsed.file.symbols).toHaveLength(30);
  });

  it("skips an oversized record and keeps packing smaller relevant evidence", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "agent-context-oversized", version: "1.0.0" }),
    );
    // One focused symbol whose record alone blows a 300-token budget, ahead of
    // a focused import that fits comfortably.
    const hugeName = `focusedEnormousSymbol${Array.from({ length: 130 }, (_, i) => `Seg${i}`).join("")}`;
    await writeFile(
      join(cwd, "src", "oversized-record-module.ts"),
      `import { z } from "zod";\n` +
        `export function ${hugeName}() { return z; }\n` +
        `export function tinyHelper() { return 1; }\n`,
    );
    const index = await buildFatIndex(cwd);

    const capsule = await buildCompactAgentContext(
      index,
      "src/oversized-record-module.ts",
      { tokenBudget: 300, focus: [hugeName, "zod"] },
      cwd,
    );

    expect(capsule.usedTokens).toBeLessThanOrEqual(300);
    expect(capsule.file?.symbols.some((s) => s.name === hugeName)).toBe(false);
    expect(capsule.file?.imports.map((i) => i.source)).toContain("zod");
    expect(capsule.file?.symbolsTruncated).toBeGreaterThan(0);
  });

  it("packs under the budget and drops suggestedCommands", async () => {
    const cwd = await makeTempDir();
    await makeFatProject(cwd);
    const index = await buildFatIndex(cwd);

    const budget = 900;
    const capsule = await buildCompactAgentContext(index, FAT_FILE, { tokenBudget: budget }, cwd);
    const tokens = await estimateTokens(JSON.stringify(capsule));

    expect(capsule.error).toBeUndefined();
    expect(capsule).not.toHaveProperty("suggestedCommands");
    expect(capsule.usedTokens).toBe(tokens);
    expect(capsule.usedTokens).toBeLessThanOrEqual(budget);
    expect(capsule.truncated).toBe(true);
    expect(capsule.file?.path).toBe(FAT_FILE);
    expect(capsule.file?.language).toBe("typescript");
  });

  it("counts both the legacy cap and budget-dropped items in *Truncated", async () => {
    const cwd = await makeTempDir();
    await makeFatProject(cwd);
    const index = await buildFatIndex(cwd);

    const capsule = await buildCompactAgentContext(index, FAT_FILE, { tokenBudget: 600 }, cwd);
    const emittedSymbols = capsule.file?.symbols.length ?? 0;
    // 60 symbols exist; the capsule reports every one it did not emit,
    // whether the legacy cap or the budget dropped it.
    expect(emittedSymbols + (capsule.file?.symbolsTruncated ?? 0)).toBe(SYMBOL_COUNT);
    expect(capsule.directImports.length + capsule.directImportsTruncated).toBe(DEP_COUNT);
    expect(capsule.directDependents.length + capsule.directDependentsTruncated).toBe(
      CONSUMER_COUNT,
    );
  });

  it("pulls focus-matched evidence past the legacy cap and source order", async () => {
    const cwd = await makeTempDir();
    await makeFatProject(cwd);
    const index = await buildFatIndex(cwd);

    const legacy = queryAgentContext(index, FAT_FILE, cwd);
    expect(legacy.file?.symbols.some((s) => s.name === DEEP_SYMBOL)).toBe(false);

    const capsule = await buildCompactAgentContext(
      index,
      FAT_FILE,
      { tokenBudget: 900, focus: [DEEP_SYMBOL] },
      cwd,
    );
    expect(capsule.file?.symbols[0]?.name).toBe(DEEP_SYMBOL);
    expect(capsule.usedTokens).toBeLessThanOrEqual(900);
  });

  it("ranks exact matches ahead of case-insensitive substring matches", async () => {
    const cwd = await makeTempDir();
    await makeFatProject(cwd);
    const index = await buildFatIndex(cwd);

    const capsule = await buildCompactAgentContext(
      index,
      FAT_FILE,
      { tokenBudget: 4000, focus: ["generatedHandlerFunctionNumber1"] },
      cwd,
    );
    const names = (capsule.file?.symbols ?? []).map((s) => s.name);
    // Exact hit first, then the substring hits (…10 … …19) in source order,
    // then everything else in the index's own order.
    expect(names[0]).toBe("generatedHandlerFunctionNumber1");
    expect(names.slice(1, 11)).toEqual(
      Array.from({ length: 10 }, (_, i) => `generatedHandlerFunctionNumber1${i}`),
    );
    expect(names.indexOf("generatedHandlerFunctionNumber19")).toBeLessThan(
      names.indexOf("generatedHandlerFunctionNumber0"),
    );
  });

  it("reports unknown files without packing", async () => {
    const cwd = await makeTempDir();
    await makeFatProject(cwd);
    const index = await buildFatIndex(cwd);

    const capsule = await buildCompactAgentContext(index, "src/nope.ts", { tokenBudget: 900 }, cwd);
    expect(capsule.error).toMatch(/File not found in index/);
    expect(capsule.file).toBeNull();
  });

  it("accepts a Windows-style absolute path", async () => {
    const cwd = await makeTempDir();
    await makeFatProject(cwd);
    const index = await buildFatIndex(cwd);

    const capsule = await buildCompactAgentContext(
      index,
      FAT_FILE.replace(/\//g, "\\"),
      { tokenBudget: 900 },
      cwd,
    );
    expect(capsule.error).toBeUndefined();
    expect(capsule.file?.path).toBe(FAT_FILE);
  });

  it("refuses a budget that cannot hold the file identity", async () => {
    const cwd = await makeTempDir();
    const deep =
      "src/" + Array.from({ length: 8 }, (_, i) => `very-long-directory-segment-${i}`).join("/");
    await mkdir(join(cwd, deep), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "agent-context-deep", version: "1.0.0" }),
    );
    const deepFile = `${deep}/module-with-a-deliberately-long-basename.ts`;
    await writeFile(join(cwd, deepFile), "export function deepFn() { return 1; }\n");
    const index = await buildFatIndex(cwd);

    await expect(
      buildCompactAgentContext(index, deepFile, { tokenBudget: 100 }, cwd),
    ).rejects.toThrow(/too small/);
  });
});

describe("emitted-JSON budget", () => {
  it("holds for compact CLI output", async () => {
    const cwd = await makeTempDir();
    await makeFatProject(cwd);
    await buildFatIndex(cwd);

    const budget = 800;
    const { code, out } = await captureStdout(() =>
      runIndexingCommand(
        {
          agentContext: FAT_FILE,
          "index-format": "json",
          compact: true,
          tokenBudget: String(budget),
        },
        cwd,
      ),
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(out);
    expect(await estimateTokens(out)).toBeLessThanOrEqual(budget);
    expect(parsed.usedTokens).toBe(await estimateTokens(out));
  });

  it("holds for pretty CLI output, whitespace included", async () => {
    const cwd = await makeTempDir();
    await makeFatProject(cwd);
    await buildFatIndex(cwd);

    const budget = 800;
    const { code, out } = await captureStdout(() =>
      runIndexingCommand(
        {
          agentContext: FAT_FILE,
          "index-format": "json",
          pretty: true,
          tokenBudget: String(budget),
        },
        cwd,
      ),
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(out);
    expect(out).toContain("\n  ");
    expect(await estimateTokens(out)).toBeLessThanOrEqual(budget);
    expect(parsed.usedTokens).toBe(await estimateTokens(out));
  });

  it("holds for the MCP default budget", async () => {
    const cwd = await makeTempDir();
    await makeFatProject(cwd);
    await buildFatIndex(cwd);

    const result = await getAgentContext(cwd, FAT_FILE);
    const emitted = JSON.stringify(result);
    expect(result.error).toBeUndefined();
    expect(result).not.toHaveProperty("suggestedCommands");
    expect(await estimateTokens(emitted)).toBeLessThanOrEqual(DEFAULT_AGENT_CONTEXT_TOKEN_BUDGET);
    expect(result.usedTokens).toBe(await estimateTokens(emitted));
  });

  it("honours a custom MCP budget and focus", async () => {
    const cwd = await makeTempDir();
    await makeFatProject(cwd);
    await buildFatIndex(cwd);

    const result = (await getAgentContext(cwd, FAT_FILE, {
      tokenBudget: 400,
      focus: [DEEP_SYMBOL, DEEP_SYMBOL],
    })) as unknown as { usedTokens: number; file: { symbols: Array<{ name: string }> } };
    expect(await estimateTokens(JSON.stringify(result))).toBeLessThanOrEqual(400);
    expect(result.usedTokens).toBeLessThanOrEqual(400);
    expect(result.file.symbols[0]?.name).toBe(DEEP_SYMBOL);
  });

  it("rejects more than six MCP focus anchors", async () => {
    const cwd = await makeTempDir();
    await makeFatProject(cwd);
    await buildFatIndex(cwd);

    await expect(
      getAgentContext(cwd, FAT_FILE, { focus: ["a", "b", "c", "d", "e", "f", "g"] }),
    ).rejects.toThrow(/at most 6/);
  });

  it("rejects an invalid MCP budget", async () => {
    const cwd = await makeTempDir();
    await makeFatProject(cwd);
    await buildFatIndex(cwd);

    await expect(getAgentContext(cwd, FAT_FILE, { tokenBudget: 0 })).rejects.toThrow(
      /integer >= 1/,
    );
  });
});

describe("CLI --focus wiring", () => {
  it("parses repeated flags", () => {
    process.argv = [
      "node",
      "mp-sentinel",
      "indexing",
      "--agent-context",
      "src/a.ts",
      "--token-budget",
      "900",
      "--focus",
      "alpha",
      "--focus",
      "beta",
    ];
    const parsed = parseCliArgs();
    expect(parsed.values.focus).toEqual(["alpha", "beta"]);
  });

  it("requires --agent-context", async () => {
    const cwd = await makeTempDir();
    await makeFatProject(cwd);
    await buildFatIndex(cwd);

    await expect(
      runIndexingCommand(
        { taskContext: "anything", "index-format": "json", focus: ["alpha"] },
        cwd,
      ),
    ).rejects.toThrow(/--focus requires --agent-context/);
  });

  it("requires --token-budget", async () => {
    const cwd = await makeTempDir();
    await makeFatProject(cwd);
    await buildFatIndex(cwd);

    await expect(
      runIndexingCommand({ agentContext: FAT_FILE, "index-format": "json", focus: ["alpha"] }, cwd),
    ).rejects.toThrow(/--focus requires --token-budget/);
  });

  it("rejects an empty anchor", async () => {
    const cwd = await makeTempDir();
    await makeFatProject(cwd);
    await buildFatIndex(cwd);

    await expect(
      runIndexingCommand(
        { agentContext: FAT_FILE, "index-format": "json", tokenBudget: "900", focus: ["  "] },
        cwd,
      ),
    ).rejects.toThrow(/must not be empty/);
  });
});
