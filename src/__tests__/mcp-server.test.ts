/**
 * MCP server tests — service handlers and InMemoryTransport integration.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setLogQuietMode } from "../utils/logger.js";
import { clearConfigCache } from "../utils/config.js";

/**
 * Create a minimal valid source index at cachePath.
 */
const writeMinimalIndex = async (
  cachePath: string,
  files: Array<{ path: string }> = [],
): Promise<void> => {
  const content = JSON.stringify({
    schemaVersion: "1.2",
    generatedAt: new Date().toISOString(),
    toolVersion: "test",
    project: {
      packageName: "test-project",
      packageVersion: "1.0.0",
      detectedFrameworks: [],
      dependencies: {},
      devDependencies: {},
    },
    files: files.map((f) => ({
      path: f.path,
      language: "typescript",
      sha256: "abc",
      sizeBytes: 100,
      mtimeMs: 0,
      imports: [],
      exports: [],
      symbols: [],
    })),
    stats: {
      totalFiles: files.length,
      indexedFiles: files.length,
      skippedFiles: 0,
      parseErrors: 0,
    },
  });
  await mkdir(cachePath.substring(0, cachePath.lastIndexOf("/")), { recursive: true });
  await writeFile(cachePath, content, "utf-8");
};

/**
 * Write a minimal .mp-sentinelrc.json to isolate config resolution.
 */
const writeMinimalConfig = async (
  projectRoot: string,
  overrides: Record<string, unknown> = {},
): Promise<void> => {
  const config = {
    indexing: {
      cachePath: ".mp-sentinel-cache/source-index.json",
    },
    ...overrides,
  };
  await writeFile(join(projectRoot, ".mp-sentinelrc.json"), JSON.stringify(config), "utf-8");
};

const DEFAULT_CACHE_REL = ".mp-sentinel-cache/source-index.json";

// ── Service handler tests ─────────────────────────────────────────────

describe("mcp-server service handlers", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "mp-sentinel-mcp-srv-"));
    clearConfigCache();
    setLogQuietMode(true);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("getIndexHealth returns missing when no cache exists", async () => {
    await writeMinimalConfig(tempDir);
    const { getIndexHealth } = await import("../services/mcp-server/service.js");
    const result = await getIndexHealth(tempDir);
    expect(result.status).toBe("missing");
  });

  it("getIndexHealth returns ok when cache exists", async () => {
    await writeMinimalConfig(tempDir);
    await writeMinimalIndex(join(tempDir, DEFAULT_CACHE_REL), [
      { path: "src/a.ts" },
      { path: "src/b.ts" },
    ]);
    const { getIndexHealth } = await import("../services/mcp-server/service.js");
    const result = await getIndexHealth(tempDir);
    expect(result.status).toBe("ok");
    expect(result.schemaVersion).toBe("1.2");
    expect(result.totalFiles).toBe(2);
    expect(result.generatedAt).toBeTruthy();
  });

  it("getAgentContext returns error when no index", async () => {
    await writeMinimalConfig(tempDir);
    const { getAgentContext } = await import("../services/mcp-server/service.js");
    const result = await getAgentContext(tempDir, "src/file.ts");
    expect(result.error).toBe("No source index found");
  });

  it("getAgentContext returns context for known file", async () => {
    await writeMinimalConfig(tempDir);
    await writeMinimalIndex(join(tempDir, DEFAULT_CACHE_REL), [{ path: "src/known.ts" }]);
    const { getAgentContext } = await import("../services/mcp-server/service.js");
    const result = await getAgentContext(tempDir, "src/known.ts");
    expect(result.file).toBeTruthy();
    expect((result.file as Record<string, unknown>).path).toBe("src/known.ts");
  });

  it("getAgentContext handles unknown file gracefully", async () => {
    await writeMinimalConfig(tempDir);
    await writeMinimalIndex(join(tempDir, DEFAULT_CACHE_REL), [{ path: "src/known.ts" }]);
    const { getAgentContext } = await import("../services/mcp-server/service.js");
    const result = await getAgentContext(tempDir, "nonexistent.ts");
    expect(result.file).toBeNull();
    expect(result.directImports).toEqual([]);
  });

  it("getExplainContext returns unavailable when no index", async () => {
    await writeMinimalConfig(tempDir);
    const { getExplainContext } = await import("../services/mcp-server/service.js");
    const result = await getExplainContext(tempDir, ["src/file.ts"]);
    expect(result.status).toBe("unavailable");
    expect(result.indexUsed).toBe(false);
    expect(result.reason).toContain("source index");
  });

  it("getExplainContext returns available when index exists", async () => {
    await writeMinimalConfig(tempDir);
    await writeMinimalIndex(join(tempDir, DEFAULT_CACHE_REL), [{ path: "src/file.ts" }]);
    const { getExplainContext } = await import("../services/mcp-server/service.js");
    const result = await getExplainContext(tempDir, ["src/file.ts"]);
    expect(result.status).toBe("available");
    expect(result.indexUsed).toBe(true);
    expect(result.contextPreview).toBeTruthy();
  });

  it("custom indexing.cachePath is respected", async () => {
    const customCacheRel = "custom/cache/index.json";
    await writeMinimalConfig(tempDir, { indexing: { cachePath: customCacheRel } });
    await writeMinimalIndex(join(tempDir, customCacheRel), [{ path: "src/test.ts" }]);
    const { getIndexHealth } = await import("../services/mcp-server/service.js");
    const result = await getIndexHealth(tempDir);
    expect(result.status).toBe("ok");
    expect(result.totalFiles).toBe(1);
  });
});

// ── InMemoryTransport integration ─────────────────────────────────────

describe("mcp-server InMemoryTransport integration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "mp-sentinel-mcp-int-"));
    clearConfigCache();
    setLogQuietMode(true);
    await writeMinimalConfig(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("lists exactly nine tools", async () => {
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { createMPSentinelMCPServer } = await import("../commands/mcp-server.js");

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMPSentinelMCPServer(tempDir);
    await server.connect(serverTransport);

    const client = new Client({ name: "test-client", version: "1.0" }, { capabilities: {} });
    await client.connect(clientTransport);

    const { tools } = await client.listTools();
    const names = tools.map((t: { name: string }) => t.name).sort();
    expect(names).toHaveLength(15);
    expect(names).toContain("mp_sentinel_review_scope");
    expect(names).toContain("mp_sentinel_review_deterministic");
    expect(names).toContain("mp_sentinel_review_filter_files");

    await client.close();
  });

  it("callTool: mp_sentinel_index_health returns valid JSON", async () => {
    await writeMinimalIndex(join(tempDir, DEFAULT_CACHE_REL), [{ path: "src/file.ts" }]);

    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { createMPSentinelMCPServer } = await import("../commands/mcp-server.js");

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMPSentinelMCPServer(tempDir);
    await server.connect(serverTransport);

    const client = new Client({ name: "test-client", version: "1.0" }, { capabilities: {} });
    await client.connect(clientTransport);

    const result = (await client.callTool({
      name: "mp_sentinel_index_health",
      arguments: {},
    })) as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.content).toHaveLength(1);
    const text = result.content[0]!.text;
    const parsed = JSON.parse(text);
    expect(parsed.status).toBe("ok");
    expect(parsed.totalFiles).toBe(1);

    await client.close();
  });

  it("callTool: mp_sentinel_agent_context missing index returns isError", async () => {
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { createMPSentinelMCPServer } = await import("../commands/mcp-server.js");

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMPSentinelMCPServer(tempDir);
    await server.connect(serverTransport);

    const client = new Client({ name: "test-client", version: "1.0" }, { capabilities: {} });
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "mp_sentinel_agent_context",
      arguments: { file: "src/test.ts" },
    });
    expect(result.isError).toBe(true);

    await client.close();
  });
});

// ── Index Query Tests ────────────────────────────────────────────────

/**
 * Write a richer fixture index with symbols, imports, and parser variations.
 */
const writeRichIndex = async (cachePath: string): Promise<void> => {
  const content = JSON.stringify({
    schemaVersion: "1.2",
    generatedAt: new Date().toISOString(),
    toolVersion: "test",
    project: {
      packageName: "test-project",
      packageVersion: "1.0.0",
      detectedFrameworks: [],
      dependencies: {},
      devDependencies: {},
    },
    files: [
      {
        path: "src/main.ts",
        language: "typescript",
        sha256: "a",
        sizeBytes: 200,
        mtimeMs: 0,
        imports: [
          { source: "./helper", kind: "named", names: ["doStuff"], line: 1 },
          { source: "./helper.js", kind: "named", names: ["doStuffAgain"], line: 2 },
          { source: "lodash", kind: "named", names: ["merge"], line: 3 },
          { source: "node:fs", kind: "named", names: ["readFile"], line: 4 },
        ],
        exports: [{ kind: "default", names: ["run"], line: 10 }],
        symbols: [
          { name: "run", type: "function", line: 10, column: 0 },
          { name: "mainConfig", type: "variable", line: 5, column: 0 },
        ],
        importsFrom: ["src/helper.ts"],
        importedBy: ["src/other.ts"],
        parserMode: "tree-sitter",
      },
      {
        path: "src/helper.ts",
        language: "typescript",
        sha256: "b",
        sizeBytes: 100,
        mtimeMs: 0,
        imports: [
          { source: "../unresolved", kind: "default", names: ["foo"], line: 1 },
          { source: "react", kind: "named", names: ["useState"], line: 2 },
        ],
        exports: [{ kind: "named", names: ["doStuff"], line: 3 }],
        symbols: [
          { name: "doStuff", type: "function", line: 3, column: 0 },
          { name: "helperUtil", type: "function", line: 7, column: 0 },
        ],
        parserMode: "chunked-tree-sitter",
        chunkCount: 2,
        chunkSize: 5000,
        chunkWarningCount: 1,
        parseWarnings: ["chunk boundary exceeded"],
      },
      {
        path: "src/broken.ts",
        language: "typescript",
        sha256: "c",
        sizeBytes: 50,
        mtimeMs: 0,
        imports: [],
        exports: [],
        symbols: [],
        parseErrors: ["Unexpected token '?' at line 42"],
        parserMode: "tree-sitter",
      },
    ],
    stats: {
      totalFiles: 3,
      indexedFiles: 3,
      skippedFiles: 0,
      parseErrors: 1,
      importEdges: 2,
    },
  });
  await mkdir(cachePath.substring(0, cachePath.lastIndexOf("/")), { recursive: true });
  await writeFile(cachePath, content, "utf-8");
};

describe("mcp-server index query handlers", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "mp-sentinel-mcp-query-"));
    clearConfigCache();
    setLogQuietMode(true);
    await writeMinimalConfig(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ── Find Symbol ──

  it("getFindSymbol returns error for missing index", async () => {
    const { getFindSymbol } = await import("../services/mcp-server/service.js");
    const result = await getFindSymbol(tempDir, "anything");
    expect(result.status).toBe("error");
  });

  it("getFindSymbol returns empty results for non-matching query", async () => {
    await writeRichIndex(join(tempDir, DEFAULT_CACHE_REL));
    const { getFindSymbol } = await import("../services/mcp-server/service.js");
    const result = await getFindSymbol(tempDir, "zzzzzNoMatch");
    expect(result.status).toBe("ok");
    expect(result.resultCount).toBe(0);
    expect(result.results).toEqual([]);
  });

  it("getFindSymbol returns ranked results for matching query", async () => {
    await writeRichIndex(join(tempDir, DEFAULT_CACHE_REL));
    const { getFindSymbol } = await import("../services/mcp-server/service.js");
    const result = await getFindSymbol(tempDir, "run");
    expect(result.status).toBe("ok");
    expect(result.resultCount).toBeGreaterThanOrEqual(1);
    expect(result.results).toEqual(
      expect.arrayContaining([expect.objectContaining({ score: expect.any(Number) })]),
    );
  });

  // ── Find Import ──

  it("getFindImport returns empty results for non-matching query", async () => {
    await writeRichIndex(join(tempDir, DEFAULT_CACHE_REL));
    const { getFindImport } = await import("../services/mcp-server/service.js");
    const result = await getFindImport(tempDir, "zzzzzNoMatch");
    expect(result.status).toBe("ok");
    expect(result.resultCount).toBe(0);
  });

  it("getFindImport returns ranked results for matching query", async () => {
    await writeRichIndex(join(tempDir, DEFAULT_CACHE_REL));
    const { getFindImport } = await import("../services/mcp-server/service.js");
    const result = await getFindImport(tempDir, "lodash");
    expect(result.status).toBe("ok");
    expect(result.resultCount).toBeGreaterThanOrEqual(1);
  });

  // ── Explain File ──

  it("getExplainFile returns error for missing index", async () => {
    const { getExplainFile } = await import("../services/mcp-server/service.js");
    const result = await getExplainFile(tempDir, "src/main.ts");
    expect(result.error).toBe("No source index found");
  });

  it("getExplainFile returns error for unknown file", async () => {
    await writeRichIndex(join(tempDir, DEFAULT_CACHE_REL));
    const { getExplainFile } = await import("../services/mcp-server/service.js");
    const result = await getExplainFile(tempDir, "nonexistent.ts");
    expect(result.error).toBe("File not found in index");
  });

  it("getExplainFile returns full info with import classification", async () => {
    await writeRichIndex(join(tempDir, DEFAULT_CACHE_REL));
    const { getExplainFile } = await import("../services/mcp-server/service.js");
    const result = await getExplainFile(tempDir, "src/main.ts");
    expect(result.path).toBe("src/main.ts");
    expect(result.language).toBe("typescript");
    expect(result.symbols).toHaveLength(2);
    // ./helper normalizes to src/helper matching importsFrom src/helper.ts
    // ./helper.js also normalizes to src/helper (extension-stripped)
    expect(result.resolvedImports).toEqual(["./helper", "./helper.js"]);
    expect(result.externalImports).toEqual(expect.arrayContaining(["lodash", "node:fs"]));
    expect(result.importedBy).toEqual(["src/other.ts"]);
    expect(result.role).toBeUndefined();
  });

  it("getExplainFile classifies unresolved local imports", async () => {
    await writeRichIndex(join(tempDir, DEFAULT_CACHE_REL));
    const { getExplainFile } = await import("../services/mcp-server/service.js");
    const result = await getExplainFile(tempDir, "src/helper.ts");
    // ../unresolved starts with "." but is NOT in importsFrom → unresolved
    expect(result.unresolvedImports).toContain("../unresolved");
    // react is external
    expect(result.externalImports).toContain("react");
  });

  // ── Index Stats ──

  it("getIndexStats returns error for missing index", async () => {
    const { getIndexStats } = await import("../services/mcp-server/service.js");
    const result = await getIndexStats(tempDir);
    expect(result.status).toBe("error");
  });

  it("getIndexStats returns complete stats block", async () => {
    await writeRichIndex(join(tempDir, DEFAULT_CACHE_REL));
    const { getIndexStats } = await import("../services/mcp-server/service.js");
    const result = (await getIndexStats(tempDir)) as Record<string, unknown>;
    expect(result.schemaVersion).toBe("1.2");
    expect(result.totalFiles).toBe(3);
    expect(result.recoveredFiles).toBe(1);
    expect(result.parserModeBreakdown).toEqual(
      expect.objectContaining({ "tree-sitter": 2, "chunked-tree-sitter": 1 }),
    );
    expect(result.importEdges).toBe(2);
    expect(result.chunkedFiles).toBe(1);
  });

  // ── Recovered Files ──

  it("getRecoveredFiles returns only recovered files", async () => {
    await writeRichIndex(join(tempDir, DEFAULT_CACHE_REL));
    const { getRecoveredFiles } = await import("../services/mcp-server/service.js");
    const result = (await getRecoveredFiles(tempDir)) as Record<string, unknown>;
    expect(result.status).toBe("ok");
    expect(result.recoveredFiles).toBe(1);
    const files = result.files as Array<Record<string, unknown>>;
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("src/helper.ts");
    expect(files[0]!.parserMode).toBe("chunked-tree-sitter");
  });

  // ── Parse Errors ──

  it("getParseErrors returns only files with parse errors", async () => {
    await writeRichIndex(join(tempDir, DEFAULT_CACHE_REL));
    const { getParseErrors } = await import("../services/mcp-server/service.js");
    const result = (await getParseErrors(tempDir)) as Record<string, unknown>;
    expect(result.status).toBe("ok");
    expect(result.parseErrorCount).toBe(1);
    const files = result.files as Array<Record<string, unknown>>;
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("src/broken.ts");
    expect(files[0]!.parseErrors as string[]).toContain("Unexpected token '?' at line 42");
  });

  // ── Limit tests ──

  const writeLargeIndex = async (cachePath: string): Promise<void> => {
    const recoveredFiles = Array.from({ length: 120 }, (_, i) => ({
      path: `src/recovered${i}.ts`,
      language: "typescript" as const,
      sha256: `r${i}`,
      sizeBytes: 50,
      mtimeMs: 0,
      imports: [],
      exports: [],
      symbols: [],
      parserMode: "ascii-fallback" as const,
    }));
    const errorFiles = Array.from({ length: 120 }, (_, i) => ({
      path: `src/error${i}.ts`,
      language: "typescript" as const,
      sha256: `e${i}`,
      sizeBytes: 50,
      mtimeMs: 0,
      imports: [],
      exports: [],
      symbols: [],
      parseErrors: ["Syntax error"],
      parserMode: "tree-sitter" as const,
    }));
    const content = JSON.stringify({
      schemaVersion: "1.2",
      generatedAt: new Date().toISOString(),
      toolVersion: "test",
      project: {
        packageName: "test",
        packageVersion: "1.0",
        detectedFrameworks: [] as string[],
        dependencies: {},
        devDependencies: {},
      },
      files: [...recoveredFiles, ...errorFiles],
      stats: { totalFiles: 240, indexedFiles: 240, skippedFiles: 0, parseErrors: 120 },
    });
    await mkdir(cachePath.substring(0, cachePath.lastIndexOf("/")), { recursive: true });
    await writeFile(cachePath, content, "utf-8");
  };

  it("getRecoveredFiles default limit returns 50 and truncated", async () => {
    await writeMinimalConfig(tempDir);
    await writeLargeIndex(join(tempDir, DEFAULT_CACHE_REL));
    const { getRecoveredFiles } = await import("../services/mcp-server/service.js");
    const result = (await getRecoveredFiles(tempDir)) as Record<string, unknown>;
    expect(result.status).toBe("ok");
    expect((result.files as unknown[]).length).toBe(50);
    expect(result.truncated).toBe(true);
  });

  it("getRecoveredFiles limit 100 returns 100 and truncated", async () => {
    await writeMinimalConfig(tempDir);
    await writeLargeIndex(join(tempDir, DEFAULT_CACHE_REL));
    const { getRecoveredFiles } = await import("../services/mcp-server/service.js");
    const result = (await getRecoveredFiles(tempDir, 100)) as Record<string, unknown>;
    expect(result.status).toBe("ok");
    expect((result.files as unknown[]).length).toBe(100);
    expect(result.truncated).toBe(true);
  });

  it("getParseErrors default limit returns 50 and truncated", async () => {
    await writeMinimalConfig(tempDir);
    await writeLargeIndex(join(tempDir, DEFAULT_CACHE_REL));
    const { getParseErrors } = await import("../services/mcp-server/service.js");
    const result = (await getParseErrors(tempDir)) as Record<string, unknown>;
    expect(result.status).toBe("ok");
    expect((result.files as unknown[]).length).toBe(50);
    expect(result.truncated).toBe(true);
  });

  it("getParseErrors limit 100 returns 100 and truncated", async () => {
    await writeMinimalConfig(tempDir);
    await writeLargeIndex(join(tempDir, DEFAULT_CACHE_REL));
    const { getParseErrors } = await import("../services/mcp-server/service.js");
    const result = (await getParseErrors(tempDir, 100)) as Record<string, unknown>;
    expect(result.status).toBe("ok");
    expect((result.files as unknown[]).length).toBe(100);
    expect(result.truncated).toBe(true);
  });
});

describe("mcp-server index query integration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "mp-sentinel-mcp-qint-"));
    clearConfigCache();
    setLogQuietMode(true);
    await writeMinimalConfig(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("listTools returns all 12 tools", async () => {
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { createMPSentinelMCPServer } = await import("../commands/mcp-server.js");

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMPSentinelMCPServer(tempDir);
    await server.connect(serverTransport);

    const client = new Client({ name: "test-client", version: "1.0" }, { capabilities: {} });
    await client.connect(clientTransport);

    const { tools } = await client.listTools();
    const names = tools.map((t: { name: string }) => t.name).sort();
    expect(names).toHaveLength(15);
    expect(names).toContain("mp_sentinel_index_find_symbol");
    expect(names).toContain("mp_sentinel_index_find_import");
    expect(names).toContain("mp_sentinel_index_explain_file");
    expect(names).toContain("mp_sentinel_index_stats");
    expect(names).toContain("mp_sentinel_index_recovered_files");
    expect(names).toContain("mp_sentinel_index_parse_errors");
    expect(names).toContain("mp_sentinel_agents_explain");
    expect(names).toContain("mp_sentinel_skills_doctor");
    expect(names).toContain("mp_sentinel_skills_check");
    expect(names).toContain("mp_sentinel_review_scope");
    expect(names).toContain("mp_sentinel_review_deterministic");
    expect(names).toContain("mp_sentinel_review_filter_files");

    await client.close();
  });

  it("callTool: mp_sentinel_index_find_symbol returns valid JSON", async () => {
    await writeRichIndex(join(tempDir, DEFAULT_CACHE_REL));

    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { createMPSentinelMCPServer } = await import("../commands/mcp-server.js");

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMPSentinelMCPServer(tempDir);
    await server.connect(serverTransport);

    const client = new Client({ name: "test-client", version: "1.0" }, { capabilities: {} });
    await client.connect(clientTransport);

    const result = (await client.callTool({
      name: "mp_sentinel_index_find_symbol",
      arguments: { query: "run" },
    })) as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).toBeFalsy();
    const text = result.content[0]!.text;
    const parsed = JSON.parse(text);
    expect(parsed.status).toBe("ok");
    expect(parsed.resultCount).toBeGreaterThanOrEqual(1);

    await client.close();
  });

  it("callTool: mp_sentinel_index_stats returns valid JSON with stats", async () => {
    await writeRichIndex(join(tempDir, DEFAULT_CACHE_REL));

    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { createMPSentinelMCPServer } = await import("../commands/mcp-server.js");

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMPSentinelMCPServer(tempDir);
    await server.connect(serverTransport);

    const client = new Client({ name: "test-client", version: "1.0" }, { capabilities: {} });
    await client.connect(clientTransport);

    const result = (await client.callTool({
      name: "mp_sentinel_index_stats",
      arguments: {},
    })) as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).toBeFalsy();
    const text = result.content[0]!.text;
    const parsed = JSON.parse(text);
    expect(parsed.schemaVersion).toBe("1.2");
    expect(parsed.totalFiles).toBe(3);

    await client.close();
  });
});

// ── Agent/Skill Diagnostics Tests ────────────────────────────────────

describe("mcp-server agent/skill diagnostics", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "mp-sentinel-mcp-diag-"));
    clearConfigCache();
    setLogQuietMode(true);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("getAgentsExplain returns explain output without index", async () => {
    const { getAgentsExplain } = await import("../services/mcp-server/service.js");
    const result = await getAgentsExplain(tempDir);
    expect(result.projectName).toBe("project");
    expect(result.agents).toBeInstanceOf(Array);
    expect(result.defaultSelection).toBeInstanceOf(Array);
  });

  it("getSkillsDoctorHandler returns missing index info (not an error)", async () => {
    const { getSkillsDoctorHandler } = await import("../services/mcp-server/service.js");
    const result = (await getSkillsDoctorHandler(tempDir)) as Record<string, unknown>;
    const index = result.index as Record<string, unknown>;
    expect(index.status).toBe("missing");
    expect(result.status).not.toBe("error");
  });

  it("getSkillsCheckHandler returns error for missing index", async () => {
    const { getSkillsCheckHandler } = await import("../services/mcp-server/service.js");
    const result = await getSkillsCheckHandler(tempDir);
    expect(result.error).toBeTruthy();
  });

  it("getSkillsDoctorHandler rejects agents+allAgents together", async () => {
    const { getSkillsDoctorHandler } = await import("../services/mcp-server/service.js");
    const result = await getSkillsDoctorHandler(tempDir, {
      agents: ["claude"],
      allAgents: true,
    });
    expect(result.status).toBe("error");
  });

  it("getSkillsDoctorHandler returns error for unknown agent IDs", async () => {
    const { getSkillsDoctorHandler } = await import("../services/mcp-server/service.js");
    const result = await getSkillsDoctorHandler(tempDir, {
      agents: ["nonexistent_adapter" as "claude"],
    });
    expect(result.status).toBe("error");
  });

  it("getAgentsExplain sanitizes scoped package names", async () => {
    // Write a package.json with scoped name to test sanitization
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "@scope/my.project" }),
      "utf-8",
    );
    const { getAgentsExplain } = await import("../services/mcp-server/service.js");
    const result = await getAgentsExplain(tempDir);
    expect(result.projectName).toBe("scope-my.project");
  });
});

describe("mcp-server agent/skill integration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "mp-sentinel-mcp-adiag-"));
    clearConfigCache();
    setLogQuietMode(true);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("callTool: mp_sentinel_agents_explain returns parseable JSON", async () => {
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { createMPSentinelMCPServer } = await import("../commands/mcp-server.js");

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMPSentinelMCPServer(tempDir);
    await server.connect(serverTransport);

    const client = new Client({ name: "test-client", version: "1.0" }, { capabilities: {} });
    await client.connect(clientTransport);

    const result = (await client.callTool({
      name: "mp_sentinel_agents_explain",
      arguments: {},
    })) as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).toBeFalsy();
    const text = result.content[0]!.text;
    const parsed = JSON.parse(text);
    expect(parsed.projectName).toBe("project");
    expect(parsed.agents).toBeInstanceOf(Array);

    await client.close();
  });

  it("callTool: mp_sentinel_skills_check with missing index returns isError", async () => {
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { createMPSentinelMCPServer } = await import("../commands/mcp-server.js");

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMPSentinelMCPServer(tempDir);
    await server.connect(serverTransport);

    const client = new Client({ name: "test-client", version: "1.0" }, { capabilities: {} });
    await client.connect(clientTransport);

    const result = (await client.callTool({
      name: "mp_sentinel_skills_check",
      arguments: {},
    })) as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).toBe(true);

    await client.close();
  });
});

// ── Review Preview Tests ────────────────────────────────────────────

describe("mcp-server review preview", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "mp-sentinel-mcp-rpv-"));
    clearConfigCache();
    setLogQuietMode(true);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("getReviewFilterFiles returns accepted/rejected with reasons", async () => {
    await writeFile(join(tempDir, "test.ts"), "// test", "utf-8");
    await writeFile(join(tempDir, ".env"), "SECRET=value", "utf-8");
    const { getReviewFilterFiles } = await import("../services/mcp-server/review-preview.js");
    const result = await getReviewFilterFiles(tempDir, ["test.ts", ".env"]);
    const accepted = result.accepted as string[];
    const rejected = result.rejected as Array<{ path: string; reason: string }>;
    expect(accepted).toContain("test.ts");
    expect(rejected.some((r) => r.path === ".env")).toBe(true);
  });

  it("getReviewScope uses explicit files target and returns no raw patches", async () => {
    await mkdir(join(tempDir, "src"), { recursive: true });
    await writeFile(join(tempDir, "src/main.ts"), "const x = 1;\n", "utf-8");
    await writeFile(join(tempDir, "src/main_test.ts"), 'test("works", () => {});\n', "utf-8");
    const { getReviewScope } = await import("../services/mcp-server/review-preview.js");
    const result = await getReviewScope(tempDir, {
      mode: "files",
      files: ["src/main.ts", "src/main_test.ts"],
    });
    expect(result.error).toBeFalsy();
    expect(result.mode).toBe("files");
    const resultStr = JSON.stringify(result);
    expect(resultStr).not.toContain("patch");
  });

  it("getReviewScope filter files returns accepted paths", async () => {
    await writeFile(join(tempDir, "valid.ts"), "// ok", "utf-8");
    const { getReviewFilterFiles } = await import("../services/mcp-server/review-preview.js");
    const result = await getReviewFilterFiles(tempDir, ["valid.ts"]);
    expect(result.accepted).toContain("valid.ts");
  });

  it("getReviewFilterFiles works without git repo", async () => {
    await writeFile(join(tempDir, "test.ts"), "// test", "utf-8");
    const { getReviewFilterFiles } = await import("../services/mcp-server/review-preview.js");
    const result = await getReviewFilterFiles(tempDir, ["test.ts"]);
    expect(result.accepted).toContain("test.ts");
  });

  it("commit target without value returns error", async () => {
    const { getReviewScope } = await import("../services/mcp-server/review-preview.js");
    const result = await getReviewScope(tempDir, { mode: "commit" });
    expect(result.error).toBeTruthy();
  });

  it("files target without files array returns error", async () => {
    const { getReviewScope } = await import("../services/mcp-server/review-preview.js");
    const result = await getReviewScope(tempDir, { mode: "files" });
    expect(result.error).toBeTruthy();
  });

  it("getReviewScope files mode works when cwd differs from projectRoot", async () => {
    const subDir = join(tempDir, "sub");
    await mkdir(subDir, { recursive: true });
    await mkdir(join(tempDir, "src"), { recursive: true });
    await writeFile(join(tempDir, "src/main.ts"), "const x = 1;\n", "utf-8");
    const { getReviewScope } = await import("../services/mcp-server/review-preview.js");
    const prevCwd = process.cwd();
    process.chdir(subDir);
    try {
      const result = await getReviewScope(tempDir, {
        mode: "files",
        files: ["src/main.ts"],
      });
      expect(result.error).toBeFalsy();
      expect(result.mode).toBe("files");
      expect(result.acceptedFiles).toContain("src/main.ts");
      expect(result.totalFiles).toBe(1);
    } finally {
      process.chdir(prevCwd);
    }
  });

  it("getReviewDeterministic returns aiEnabled: false", async () => {
    await mkdir(join(tempDir, "src"), { recursive: true });
    await writeFile(join(tempDir, "src/safe.ts"), "const x = 1;\n", "utf-8");
    const { getReviewDeterministic } = await import("../services/mcp-server/review-preview.js");
    const result = await getReviewDeterministic(tempDir, {
      mode: "files",
      files: ["src/safe.ts"],
    });
    expect(result.aiEnabled).toBe(false);
  });

  it("invalid commit ref returns error", async () => {
    const { getReviewScope } = await import("../services/mcp-server/review-preview.js");
    const result = await getReviewScope(tempDir, {
      mode: "commit",
      value: "nonexistent-ref-xyz",
    });
    expect(result.error).toBeTruthy();
  });

  it("invalid range returns error", async () => {
    const { getReviewScope } = await import("../services/mcp-server/review-preview.js");
    const result = await getReviewScope(tempDir, {
      mode: "range",
      value: "nonexistent-branch...HEAD",
    });
    expect(result.error).toBeTruthy();
  });

  it("getReviewDeterministic flags eval in file content", async () => {
    await mkdir(join(tempDir, "src"), { recursive: true });
    await writeFile(join(tempDir, "src/risky.ts"), "const result = eval(userInput);\n", "utf-8");
    const { getReviewDeterministic } = await import("../services/mcp-server/review-preview.js");
    const result = await getReviewDeterministic(tempDir, {
      mode: "files",
      files: ["src/risky.ts"],
    });
    const findings = result.findings as Array<Record<string, unknown>>;
    expect(findings.length).toBeGreaterThan(0);
  });
});
