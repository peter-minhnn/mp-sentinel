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

  it("lists exactly three tools", async () => {
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
    expect(names).toEqual([
      "mp_sentinel_agent_context",
      "mp_sentinel_explain_context",
      "mp_sentinel_index_health",
    ]);

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
