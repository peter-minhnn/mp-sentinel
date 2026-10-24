/**
 * Golden-corpus contract + CI smoke gate for compact agent context.
 *
 * `npm run agentctx:bench` runs the same gates against this repo's real
 * index. This test locks the corpus file's shape and re-runs the gates on a
 * deterministic fixture so CI catches a retention/budget regression without
 * needing a built dist or a fresh cache.
 */

import { existsSync } from "node:fs";
import { readFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import { buildSourceIndex } from "../commands/indexing.js";
import { queryAgentContext } from "../services/source-index/agent-context-evidence.js";
import {
  buildCompactAgentContext,
  DEFAULT_AGENT_CONTEXT_TOKEN_BUDGET,
  MAX_FOCUS_ANCHORS,
  type CompactAgentContextResult,
} from "../services/source-index/agent-context-pack.js";
import { clearParserCache } from "../services/source-index/parser.js";
import { clearConfigCache } from "../utils/config.js";
import { setLogQuietMode } from "../utils/logger.js";
import { estimateTokens } from "../utils/tokens.js";
import type { AgentContextResult } from "../services/source-index/agent-context-evidence.js";
import type { IndexableLanguage } from "../types/index.js";

const GOLDEN_PATH = resolve(process.cwd(), "scripts/agent-context-golden.json");
const RETENTION_MIN = 0.85;
const ROW_RETENTION_MIN = 0.6;
const REDUCTION_MIN = 0.3;

interface GoldenRow {
  file: string;
  focus: string[];
  required: string[];
}

const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "mp-sentinel-agentctx-golden-"));
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

const PARSER_FIELDS = [
  "parserMode",
  "parseWarnings",
  "parseErrors",
  "parseErrorMessages",
  "chunkCount",
  "chunkSize",
  "chunkWarningCount",
  "chunkBoundaryWarningCount",
  "chunkActionableWarningCount",
] as const;

/** Every string an agent could match required evidence against. */
const evidenceStrings = (payload: AgentContextResult | CompactAgentContextResult): Set<string> => {
  const out = new Set<string>();
  const file = payload.file;
  if (file) {
    for (const s of file.symbols) {
      out.add(s.name);
      if (s.parent) out.add(s.parent);
    }
    for (const i of file.imports) {
      out.add(i.source);
      for (const n of i.names) out.add(n);
    }
    for (const e of file.exports) {
      if (e.source) out.add(e.source);
      for (const n of e.names) out.add(n);
    }
    for (const c of file.calls ?? []) {
      out.add(c.callee);
      if (c.inSymbol) out.add(c.inSymbol);
    }
  }
  for (const c of payload.incomingCalls) {
    out.add(c.fromFile);
    out.add(c.callee);
    if (c.inSymbol) out.add(c.inSymbol);
  }
  for (const p of payload.directImports) out.add(p);
  for (const p of payload.directDependents) out.add(p);
  for (const h of payload.hubFiles) out.add(h.path);
  return out;
};

const parserHealth = (payload: AgentContextResult | CompactAgentContextResult): string => {
  const file = (payload.file ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of PARSER_FIELDS) {
    if (file[key] !== undefined) out[key] = file[key];
  }
  return JSON.stringify(out);
};

beforeEach(() => {
  clearParserCache();
  clearConfigCache();
});

afterEach(async () => {
  clearParserCache();
  clearConfigCache();
  setLogQuietMode(false);
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("agent-context golden corpus contract", () => {
  it("is a non-empty array of usable rows", async () => {
    const rows = JSON.parse(await readFile(GOLDEN_PATH, "utf-8")) as GoldenRow[];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);

    const files = new Set<string>();
    for (const row of rows) {
      expect(typeof row.file).toBe("string");
      expect(row.file.length).toBeGreaterThan(0);
      expect(files.has(row.file)).toBe(false);
      files.add(row.file);
      expect(existsSync(resolve(process.cwd(), row.file))).toBe(true);

      expect(Array.isArray(row.focus)).toBe(true);
      expect(row.focus.length).toBeGreaterThan(0);
      expect(row.focus.length).toBeLessThanOrEqual(MAX_FOCUS_ANCHORS);
      for (const anchor of row.focus) expect(anchor.trim()).toBe(anchor);

      expect(Array.isArray(row.required)).toBe(true);
      expect(row.required.length).toBeGreaterThan(0);
      expect(new Set(row.required).size).toBe(row.required.length);
    }
  });
});

describe("agent-context compaction gates (fixture)", () => {
  it("keeps identity, parser health and required evidence while shrinking the payload", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "agent-context-golden-fixture", version: "1.0.0" }),
    );

    const moduleCount = 4;
    const symbolCount = 45;
    for (let m = 0; m < moduleCount; m++) {
      const lines: string[] = [
        `import { sharedUtilityHelperFunction } from "./shared-utility-module.js";`,
      ];
      for (let i = 0; i < symbolCount; i++) {
        lines.push(
          `export function serviceHandlerNumber${m}_${i}() { return sharedUtilityHelperFunction(${i}); }`,
        );
      }
      await writeFile(join(cwd, "src", `service-module-number-${m}.ts`), `${lines.join("\n")}\n`);
    }
    await writeFile(
      join(cwd, "src", "shared-utility-module.ts"),
      `export function sharedUtilityHelperFunction(n: number) { return n * 2; }\n`,
    );
    for (let c = 0; c < 4; c++) {
      await writeFile(
        join(cwd, "src", `caller-module-number-${c}.ts`),
        `import { serviceHandlerNumber0_0 } from "./service-module-number-0.js";\n` +
          `export function callerEntry${c}() { return serviceHandlerNumber0_0(); }\n`,
      );
    }

    setLogQuietMode(true);
    const index = await buildSourceIndex(cwd, CONFIG, true);
    setLogQuietMode(false);
    expect(index).not.toBeNull();
    if (!index) return;

    const corpus: GoldenRow[] = Array.from({ length: moduleCount }, (_, m) => ({
      file: `src/service-module-number-${m}.ts`,
      // Anchors deliberately point past the 30-symbol legacy cap.
      focus: [`serviceHandlerNumber${m}_${symbolCount - 2}`, "sharedUtilityHelperFunction"],
      required: [
        `serviceHandlerNumber${m}_${symbolCount - 2}`,
        "sharedUtilityHelperFunction",
        "./shared-utility-module.js",
      ],
    }));

    let requiredTotal = 0;
    let keptTotal = 0;
    let legacyTokens = 0;
    let compactTokens = 0;

    for (const row of corpus) {
      const legacy = queryAgentContext(index, row.file, cwd);
      const compact = await buildCompactAgentContext(
        index,
        row.file,
        { tokenBudget: DEFAULT_AGENT_CONTEXT_TOKEN_BUDGET, focus: row.focus },
        cwd,
      );

      expect(compact.file?.path).toBe(legacy.file?.path);
      expect(compact.file?.language).toBe(legacy.file?.language);
      expect(parserHealth(compact)).toBe(parserHealth(legacy));

      const emitted = JSON.stringify(compact);
      const tokens = await estimateTokens(emitted);
      expect(tokens).toBeLessThanOrEqual(DEFAULT_AGENT_CONTEXT_TOKEN_BUDGET);
      expect(compact.usedTokens).toBe(tokens);

      const found = evidenceStrings(compact);
      // A row's own anchors are non-negotiable, and an aggregate can hide a
      // row that lost everything -- so both are checked per row.
      expect(row.focus.filter((anchor) => !found.has(anchor))).toEqual([]);
      const kept = row.required.filter((item) => found.has(item)).length;
      expect(kept / row.required.length).toBeGreaterThanOrEqual(ROW_RETENTION_MIN);
      requiredTotal += row.required.length;
      keptTotal += kept;
      legacyTokens += await estimateTokens(JSON.stringify(legacy));
      compactTokens += tokens;
    }

    expect(legacyTokens).toBeGreaterThan(corpus.length * DEFAULT_AGENT_CONTEXT_TOKEN_BUDGET * 0.5);
    expect(keptTotal / requiredTotal).toBeGreaterThanOrEqual(RETENTION_MIN);
    expect((legacyTokens - compactTokens) / legacyTokens).toBeGreaterThanOrEqual(REDUCTION_MIN);
  });
});
