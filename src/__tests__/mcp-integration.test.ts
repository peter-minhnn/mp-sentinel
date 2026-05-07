/**
 * MCP integration tests — gatherMCPContext, buildSystemPrompt injection,
 * context formatting, cache behavior, and mocked stdio server smoke test.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { gatherMCPContext } from "../services/mcp/index.js";
import { buildSystemPrompt } from "../config/prompts.js";
import { buildMCPContextString } from "../services/mcp/context-builder.js";
import { clearConfigCache } from "../utils/config.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setLogQuietMode } from "../utils/logger.js";
import type { ProjectConfig } from "../types/index.js";

beforeEach(() => {
  clearConfigCache();
  setLogQuietMode(true);
});

afterEach(() => {
  setLogQuietMode(false);
});

// ── buildMCPContextString ─────────────────────────────────────────────────

describe("buildMCPContextString", () => {
  it("formats results with server/tool labels", () => {
    const context = buildMCPContextString(
      [
        { serverId: "gh", tool: "get_pr", result: "PR #42 details", truncated: false },
        { serverId: "docs", tool: "fetch", result: "API docs", truncated: false },
      ],
      10000,
    );
    expect(context).toContain("[gh/get_pr]");
    expect(context).toContain("PR #42 details");
    expect(context).toContain("[docs/fetch]");
    expect(context).toContain("API docs");
  });

  it("truncates to maxChars budget strictly", () => {
    const context = buildMCPContextString(
      [{ serverId: "gh", tool: "get", result: "A".repeat(200), truncated: false }],
      50,
    );
    expect(context).toContain("... (truncated)");
    // Strict budget: final string must never exceed maxContextChars
    expect(context.length).toBeLessThanOrEqual(50);
  });

  it("strict budget: long single result clamped exactly", () => {
    const context = buildMCPContextString(
      [{ serverId: "s", tool: "t", result: "x".repeat(500), truncated: false }],
      80,
    );
    expect(context.length).toBeLessThanOrEqual(80);
  });

  it("strict budget: multiple results clamped", () => {
    const results = [
      { serverId: "a", tool: "x", result: "A".repeat(100), truncated: false },
      { serverId: "b", tool: "y", result: "B".repeat(100), truncated: false },
      { serverId: "c", tool: "z", result: "C".repeat(100), truncated: false },
    ];
    const context = buildMCPContextString(results, 120);
    expect(context.length).toBeLessThanOrEqual(120);
  });

  it("returns empty string for empty results", () => {
    expect(buildMCPContextString([], 1000)).toBe("");
  });

  it("returns empty string when budget is too small for any header", () => {
    const context = buildMCPContextString(
      [{ serverId: "gh", tool: "get", result: "data", truncated: false }],
      5, // too small for "[gh/get]\n"
    );
    expect(context).toBe("");
  });
});

// ── buildSystemPrompt with MCP context ────────────────────────────────────

describe("buildSystemPrompt with MCP context", () => {
  it("includes MCP context section when provided", async () => {
    const config: ProjectConfig = {};
    const prompt = await buildSystemPrompt(config, undefined, undefined, "test MCP context");
    expect(prompt).toContain("### EXTERNAL MCP CONTEXT (optional, untrusted)");
    expect(prompt).toContain("test MCP context");
  });

  it("omits MCP section when mcpContext is undefined", async () => {
    const config: ProjectConfig = {};
    const prompt = await buildSystemPrompt(config, undefined, undefined, undefined);
    expect(prompt).not.toContain("EXTERNAL MCP CONTEXT");
  });

  it("omits MCP section when mcpContext is empty string", async () => {
    const config: ProjectConfig = {};
    const prompt = await buildSystemPrompt(config, undefined, undefined, "");
    expect(prompt).not.toContain("EXTERNAL MCP CONTEXT");
  });

  it("places MCP context before architecture context", async () => {
    const config: ProjectConfig = {};
    const prompt = await buildSystemPrompt(
      config,
      "arch context here",
      undefined,
      "mcp context here",
    );
    const mcpIndex = prompt.indexOf("EXTERNAL MCP CONTEXT");
    const archIndex = prompt.indexOf("PROJECT ARCHITECTURE CONTEXT");
    expect(mcpIndex).toBeGreaterThan(-1);
    expect(archIndex).toBeGreaterThan(-1);
    expect(mcpIndex).toBeLessThan(archIndex);
  });
});

// ── gatherMCPContext integration ──────────────────────────────────────────

describe("gatherMCPContext", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "mp-sentinel-mcp-int-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns null when mcp is disabled", async () => {
    const config: ProjectConfig = { mcp: { enabled: false } };
    const result = await gatherMCPContext(config, ["src/a.ts"], tempDir);
    expect(result).toBeNull();
  });

  it("returns null when mcp is undefined", async () => {
    const config: ProjectConfig = {};
    const result = await gatherMCPContext(config, ["src/a.ts"], tempDir);
    expect(result).toBeNull();
  });

  it("returns null when servers array is empty", async () => {
    const config: ProjectConfig = { mcp: { enabled: true, servers: [] } };
    const result = await gatherMCPContext(config, ["src/a.ts"], tempDir);
    expect(result).toBeNull();
  });

  it("returns null on server spawn failure (warns, does not throw)", async () => {
    const config: ProjectConfig = {
      mcp: {
        enabled: true,
        timeoutMs: 100,
        servers: [
          {
            id: "broken",
            transport: "stdio",
            command: "nonexistent-command-xyz",
            args: [],
            calls: [{ tool: "test", input: {} }],
          },
        ],
      },
    };
    const result = await gatherMCPContext(config, ["src/a.ts"], tempDir);
    expect(result).toBeNull();
  }, 15000);
});

// ── gatherMCPContextDetails integration ────────────────────────────────────

describe("gatherMCPContextDetails", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "mp-sentinel-mcp-details-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns disabled summary when mcp is disabled", async () => {
    const { gatherMCPContextDetails: details } = await import("../services/mcp/index.js");
    const config: ProjectConfig = { mcp: { enabled: false } };
    const result = await details(config, ["src/a.ts"], tempDir);
    expect(result.context).toBeNull();
    expect(result.summary.enabled).toBe(false);
    expect(result.summary.attemptedCallCount).toBe(0);
    expect(result.summary.calls).toEqual([]);
  });

  it("returns enabled summary when mcp is undefined", async () => {
    const { gatherMCPContextDetails: details } = await import("../services/mcp/index.js");
    const config: ProjectConfig = {};
    const result = await details(config, ["src/a.ts"], tempDir);
    expect(result.context).toBeNull();
    expect(result.summary.enabled).toBe(false);
  });

  it("returns empty summary when servers array is empty", async () => {
    const { gatherMCPContextDetails: details } = await import("../services/mcp/index.js");
    const config: ProjectConfig = { mcp: { enabled: true, servers: [] } };
    const result = await details(config, ["src/a.ts"], tempDir);
    expect(result.context).toBeNull();
    expect(result.summary.enabled).toBe(true);
    expect(result.summary.serverCount).toBe(0);
  });

  it("tracks failed calls for nonexistent server command", async () => {
    const { gatherMCPContextDetails: details } = await import("../services/mcp/index.js");
    const config: ProjectConfig = {
      mcp: {
        enabled: true,
        timeoutMs: 100,
        cacheEnabled: false,
        servers: [
          {
            id: "broken",
            transport: "stdio",
            command: "nonexistent-command-xyz",
            args: [],
            calls: [{ tool: "test", input: {} }],
          },
        ],
      },
    };
    const result = await details(config, ["src/a.ts"], tempDir);
    expect(result.context).toBeNull();
    expect(result.summary.serverCount).toBe(1);
    expect(result.summary.attemptedCallCount).toBe(1);
    expect(result.summary.failedCallCount).toBe(1);
    expect(result.summary.freshCallCount).toBe(0);
    expect(result.summary.calls[0]!.status).toBe("failed");
    expect(result.summary.calls[0]!.cacheStatus).toBe("disabled");
  }, 15000);

  it("call details never contain env values", async () => {
    const { gatherMCPContextDetails: details } = await import("../services/mcp/index.js");
    const config: ProjectConfig = {
      mcp: {
        enabled: true,
        timeoutMs: 100,
        servers: [
          {
            id: "no-leak",
            transport: "stdio",
            command: "nonexistent-command-xyz",
            args: [],
            env: { SECRET_TOKEN: "MY_SECRET_TOKEN_VAR" },
            calls: [{ tool: "test", input: {} }],
          },
        ],
      },
    };
    const result = await details(config, ["src/a.ts"], tempDir);
    // Verify no env parent variable names appear as values in any field
    const summaryStr = JSON.stringify(result.summary);
    expect(summaryStr).not.toContain("MY_SECRET_TOKEN_VAR");
    // cacheStatus values must only be "hit", "miss", or "disabled"
    for (const call of result.summary.calls) {
      expect(["hit", "miss", "disabled"]).toContain(call.cacheStatus);
    }
  }, 15000);

  it("summary contextChars and truncated reflect empty context", async () => {
    const { gatherMCPContextDetails: details } = await import("../services/mcp/index.js");
    const config: ProjectConfig = {
      mcp: {
        enabled: true,
        timeoutMs: 100,
        servers: [
          {
            id: "broken",
            transport: "stdio",
            command: "nonexistent-command-xyz",
            args: [],
            calls: [{ tool: "test", input: {} }],
          },
        ],
      },
    };
    const result = await details(config, ["src/a.ts"], tempDir);
    expect(result.summary.contextChars).toBe(0);
    expect(result.summary.truncated).toBe(false);
  }, 15000);

  it("warnings array is empty for disabled config", async () => {
    const { gatherMCPContextDetails: details } = await import("../services/mcp/index.js");
    const config: ProjectConfig = { mcp: { enabled: false } };
    const result = await details(config, ["src/a.ts"], tempDir);
    expect(result.summary.warnings).toEqual([]);
  });

  it("backward-compatible gatherMCPContext returns same context string", async () => {
    const { gatherMCPContextDetails: details } = await import("../services/mcp/index.js");
    const config: ProjectConfig = { mcp: { enabled: false } };
    const detailed = await details(config, ["src/a.ts"], tempDir);
    const wrapped = await gatherMCPContext(config, ["src/a.ts"], tempDir);
    expect(wrapped).toBe(detailed.context);
  });
});

// ── MCP cache integration ─────────────────────────────────────────────────

describe("MCP cache integration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "mp-sentinel-mcp-cache-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("cache key is deterministic for same inputs", async () => {
    const { buildMCPCacheKey } = await import("../services/mcp/cache.js");
    const params = {
      serverId: "test",
      command: "npx",
      args: ["-y", "test"],
      toolName: "get",
      resolvedInput: { path: "README.md" },
      headSha: "abc123",
      changedFiles: ["src/a.ts", "src/b.ts"],
      toolVersion: "2.2.0",
      envMapping: {},
    };
    const key1 = buildMCPCacheKey(params);
    const key2 = buildMCPCacheKey(params);
    expect(key1).toBe(key2);
  });

  it("cache key changes when changed files differ", async () => {
    const { buildMCPCacheKey } = await import("../services/mcp/cache.js");
    const base = {
      serverId: "test",
      command: "npx",
      args: ["-y", "test"],
      toolName: "get",
      resolvedInput: { path: "README.md" },
      headSha: "abc123",
      toolVersion: "2.2.0",
      envMapping: {},
    };
    const key1 = buildMCPCacheKey({ ...base, changedFiles: ["src/a.ts"] });
    const key2 = buildMCPCacheKey({ ...base, changedFiles: ["src/b.ts"] });
    expect(key1).not.toBe(key2);
  });

  it("cache key changes when resolved input differs", async () => {
    const { buildMCPCacheKey } = await import("../services/mcp/cache.js");
    const base = {
      serverId: "test",
      command: "npx",
      args: ["-y", "test"],
      toolName: "get",
      headSha: "abc123",
      changedFiles: ["src/a.ts"],
      toolVersion: "2.2.0",
      envMapping: {},
    };
    const key1 = buildMCPCacheKey({ ...base, resolvedInput: { path: "a.md" } });
    const key2 = buildMCPCacheKey({ ...base, resolvedInput: { path: "b.md" } });
    expect(key1).not.toBe(key2);
  });

  it("cache key is stable for nested objects regardless of key order", async () => {
    const { buildMCPCacheKey } = await import("../services/mcp/cache.js");
    const base = {
      serverId: "test",
      command: "npx",
      args: [],
      toolName: "get",
      headSha: "abc123",
      changedFiles: ["src/a.ts"],
      toolVersion: "2.2.0",
      envMapping: {},
    };
    const key1 = buildMCPCacheKey({
      ...base,
      resolvedInput: { filter: { level: "high", labels: ["bug", "urgent"] } },
    });
    const key2 = buildMCPCacheKey({
      ...base,
      resolvedInput: { filter: { labels: ["bug", "urgent"], level: "high" } },
    });
    expect(key1).toBe(key2);
  });

  it("cache key changes for nested objects with different values", async () => {
    const { buildMCPCacheKey } = await import("../services/mcp/cache.js");
    const base = {
      serverId: "test",
      command: "npx",
      args: [],
      toolName: "get",
      headSha: "abc123",
      changedFiles: ["src/a.ts"],
      toolVersion: "2.2.0",
      envMapping: {},
    };
    const key1 = buildMCPCacheKey({
      ...base,
      resolvedInput: { filter: { level: "high" } },
    });
    const key2 = buildMCPCacheKey({
      ...base,
      resolvedInput: { filter: { level: "low" } },
    });
    expect(key1).not.toBe(key2);
  });

  it("cache key changes when env mapping differs", async () => {
    const { buildMCPCacheKey } = await import("../services/mcp/cache.js");
    const base = {
      serverId: "test",
      command: "npx",
      args: [],
      toolName: "get",
      resolvedInput: { path: "test.md" },
      headSha: "abc",
      changedFiles: ["test.md"],
      toolVersion: "1.0.0",
    };
    const key1 = buildMCPCacheKey({ ...base, envMapping: { GITHUB_TOKEN: "GH_TOKEN" } });
    const key2 = buildMCPCacheKey({
      ...base,
      envMapping: { GITHUB_TOKEN: "GH_TOKEN", NPM_TOKEN: "NPM_REGISTRY_TOKEN" },
    });
    expect(key1).not.toBe(key2);
  });

  it("cache key changes when parent env source changes (same child key)", async () => {
    const { buildMCPCacheKey } = await import("../services/mcp/cache.js");
    const base = {
      serverId: "test",
      command: "npx",
      args: [],
      toolName: "get",
      resolvedInput: { path: "test.md" },
      headSha: "abc",
      changedFiles: ["test.md"],
      toolVersion: "1.0.0",
    };
    // Same child key (GITHUB_TOKEN), different parent source
    const key1 = buildMCPCacheKey({ ...base, envMapping: { GITHUB_TOKEN: "GH_TOKEN" } });
    const key2 = buildMCPCacheKey({ ...base, envMapping: { GITHUB_TOKEN: "GITHUB_TOKEN" } });
    expect(key1).not.toBe(key2);
  });

  it("cache key is stable regardless of env mapping key order", async () => {
    const { buildMCPCacheKey } = await import("../services/mcp/cache.js");
    const base = {
      serverId: "test",
      command: "npx",
      args: [],
      toolName: "get",
      resolvedInput: { path: "test.md" },
      headSha: "abc",
      changedFiles: ["test.md"],
      toolVersion: "1.0.0",
    };
    const key1 = buildMCPCacheKey({ ...base, envMapping: { A: "A_SRC", B: "B_SRC", C: "C_SRC" } });
    const key2 = buildMCPCacheKey({ ...base, envMapping: { C: "C_SRC", A: "A_SRC", B: "B_SRC" } });
    expect(key1).toBe(key2);
  });

  it("cache write and read round-trips", async () => {
    const { buildMCPCacheKey, writeMCPCacheEntry, readMCPCacheEntry } =
      await import("../services/mcp/cache.js");
    const key = buildMCPCacheKey({
      serverId: "test",
      command: "npx",
      args: [],
      toolName: "get",
      resolvedInput: { path: "test.md" },
      headSha: "abc",
      changedFiles: ["test.md"],
      toolVersion: "1.0.0",
      envMapping: {},
    });
    const result = "cached test result";
    await writeMCPCacheEntry(key, result, 60000, tempDir);
    const cached = await readMCPCacheEntry(key, 60000, tempDir);
    expect(cached).toBe(result);
  });

  it("cache read returns null for expired entry", async () => {
    const { buildMCPCacheKey, writeMCPCacheEntry, readMCPCacheEntry } =
      await import("../services/mcp/cache.js");
    const key = buildMCPCacheKey({
      serverId: "test",
      command: "npx",
      args: [],
      toolName: "get",
      resolvedInput: { path: "test.md" },
      headSha: "abc",
      changedFiles: ["test.md"],
      toolVersion: "1.0.0",
      envMapping: {},
    });
    await writeMCPCacheEntry(key, "result", 1, tempDir);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const cached = await readMCPCacheEntry(key, 1, tempDir);
    expect(cached).toBeNull();
  });

  it("cache read returns null for missing key", async () => {
    const { readMCPCacheEntry } = await import("../services/mcp/cache.js");
    const result = await readMCPCacheEntry("nonexistentkey", 60000, tempDir);
    expect(result).toBeNull();
  });
});

// ── Mocked stdio MCP server smoke test ────────────────────────────────────

describe("MCP stdio client with mock server", () => {
  let tempDir: string;
  let mockServerPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "mp-sentinel-mcp-smoke-"));
    mockServerPath = join(tempDir, "mock-mcp-server.cjs");

    // A minimal MCP stdio server that handles:
    //   initialize → protocolVersion + capabilities
    //   tools/call → returns mock text content
    //   notifications/initialized → no-op
    await writeFile(
      mockServerPath,
      `const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });

function send(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: id, result: result }) + "\\n");
}

rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') {
      send(msg.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "mock-server", version: "1.0.0" },
      });
    } else if (msg.method === 'notifications/initialized') {
      // No response for notifications
    } else if (msg.method === 'tools/list') {
      send(msg.id, {
        tools: [{ name: "echo", description: "Echo test tool", inputSchema: { type: "object", properties: { message: { type: "string" } } } }],
      });
    } else if (msg.method === 'tools/call') {
      const inputMsg = (msg.params && msg.params.arguments && msg.params.arguments.message) || "default";
      send(msg.id, {
        content: [{ type: "text", text: "mock-echo: " + inputMsg }],
      });
    }
  } catch (e) {
    // Ignore parse errors — MCP transport may send non-JSON
  }
});

// Keep process alive until stdin closes
process.stdin.on('end', () => { process.exit(0); });
`,
      "utf-8",
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("connects to mock server and returns tool result", async () => {
    // Dynamically import to avoid module caching with env vars
    const { executeMCPServer } = await import("../services/mcp/client.js");

    const server = {
      id: "mock",
      transport: "stdio" as const,
      command: "node",
      args: [mockServerPath],
      calls: [{ tool: "echo", input: { message: "hello world" } }],
    };

    const config = { timeoutMs: 5000, maxContextChars: 6000 };

    const results = await executeMCPServer(server, server.calls, config, tempDir);
    expect(results.length).toBe(1);
    expect(results[0]!.tool).toBe("echo");
    expect(results[0]!.result).toContain("mock-echo: hello world");
    expect(results[0]!.truncated).toBe(false);
  }, 15000);

  it("handles multiple tool calls to mock server", async () => {
    const { executeMCPServer } = await import("../services/mcp/client.js");

    const calls = [
      { tool: "echo", input: { message: "first" } },
      { tool: "echo", input: { message: "second" } },
    ];

    const server = {
      id: "mock",
      transport: "stdio" as const,
      command: "node",
      args: [mockServerPath],
      calls,
    };

    const config = { timeoutMs: 5000, maxContextChars: 6000 };

    const results = await executeMCPServer(server, calls, config, tempDir);
    expect(results.length).toBe(2);
    expect(results[0]!.result).toContain("mock-echo: first");
    expect(results[1]!.result).toContain("mock-echo: second");
  }, 15000);

  it("returns empty array on server timeout", async () => {
    // A mock server that never responds (hangs forever)
    const hangPath = join(tempDir, "hang-server.cjs");
    await writeFile(
      hangPath,
      `// Hangs forever — never responds to MCP requests
setTimeout(() => {}, 30000);
`,
      "utf-8",
    );

    const { executeMCPServer } = await import("../services/mcp/client.js");

    const server = {
      id: "hang",
      transport: "stdio" as const,
      command: "node",
      args: [hangPath],
      calls: [{ tool: "echo", input: {} }],
    };

    const config = { timeoutMs: 500, maxContextChars: 6000 };

    const results = await executeMCPServer(server, server.calls, config, tempDir);
    expect(results).toEqual([]);
  }, 15000);
});

// ── stableJson export ─────────────────────────────────────────────────────

describe("stableJson", () => {
  it("recursively sorts nested object keys", async () => {
    const { stableJson } = await import("../services/mcp/cache.js");
    const a = stableJson({ z: { b: 2, a: 1 }, y: 3 });
    const b = stableJson({ y: 3, z: { a: 1, b: 2 } });
    expect(a).toBe(b);
  });

  it("handles empty objects", async () => {
    const { stableJson } = await import("../services/mcp/cache.js");
    expect(stableJson({})).toBe("{}");
  });

  it("handles arrays of objects", async () => {
    const { stableJson } = await import("../services/mcp/cache.js");
    const a = stableJson({
      items: [
        { b: 2, a: 1 },
        { d: 4, c: 3 },
      ],
    });
    const b = stableJson({
      items: [
        { a: 1, b: 2 },
        { c: 3, d: 4 },
      ],
    });
    expect(a).toBe(b);
  });

  it("handles arrays with different ordering as different", async () => {
    const { stableJson } = await import("../services/mcp/cache.js");
    const a = stableJson({ items: [{ a: 1 }, { b: 2 }] });
    const b = stableJson({ items: [{ b: 2 }, { a: 1 }] });
    expect(a).not.toBe(b);
  });

  it("handles null and primitives", async () => {
    const { stableJson } = await import("../services/mcp/cache.js");
    expect(stableJson(null)).toBe("null");
    expect(stableJson(42)).toBe("42");
    expect(stableJson("hello")).toBe('"hello"');
    expect(stableJson(true)).toBe("true");
  });
});
