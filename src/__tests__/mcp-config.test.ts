/**
 * MCP config validation tests.
 * Tests Zod schema validation for MCP config in ProjectConfigSchema.
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { validateConfig, clearConfigCache } from "../utils/config.js";

beforeEach(() => {
  clearConfigCache();
});

describe("validateConfig with mcp", () => {
  it("accepts empty mcp (all fields optional)", () => {
    expect(validateConfig({ mcp: {} })).toBe(true);
  });

  it("accepts full valid MCP config", () => {
    expect(
      validateConfig({
        mcp: {
          enabled: true,
          timeoutMs: 5000,
          maxContextChars: 8000,
          cacheEnabled: true,
          cacheTtlMs: 7200000,
          servers: [
            {
              id: "github",
              transport: "stdio",
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-github"],
              calls: [{ tool: "get_file_contents", input: { path: "README.md" } }],
            },
          ],
        },
      }),
    ).toBe(true);
  });

  it("rejects mcp.enabled with wrong type", () => {
    expect(validateConfig({ mcp: { enabled: "true" } })).toBe(false);
    expect(validateConfig({ mcp: { enabled: 123 } })).toBe(false);
  });

  it("rejects mcp.timeoutMs with non-integer", () => {
    expect(validateConfig({ mcp: { timeoutMs: 1.5 } })).toBe(false);
    expect(validateConfig({ mcp: { timeoutMs: -100 } })).toBe(false);
  });

  it("rejects mcp.maxContextChars with non-positive", () => {
    expect(validateConfig({ mcp: { maxContextChars: 0 } })).toBe(false);
    expect(validateConfig({ mcp: { maxContextChars: -1 } })).toBe(false);
  });

  it("rejects mcp.cacheTtlMs with non-positive", () => {
    expect(validateConfig({ mcp: { cacheTtlMs: 0 } })).toBe(false);
  });

  it("rejects transport other than stdio", () => {
    expect(
      validateConfig({
        mcp: {
          servers: [
            {
              id: "test",
              transport: "sse",
              command: "npx",
              args: [],
              calls: [{ tool: "get", input: {} }],
            },
          ],
        },
      }),
    ).toBe(false);
  });

  it("rejects empty calls array", () => {
    expect(
      validateConfig({
        mcp: {
          servers: [
            {
              id: "test",
              transport: "stdio",
              command: "npx",
              args: [],
              calls: [],
            },
          ],
        },
      }),
    ).toBe(false);
  });

  it("rejects missing server id", () => {
    expect(
      validateConfig({
        mcp: {
          servers: [
            {
              id: "",
              transport: "stdio",
              command: "npx",
              args: [],
              calls: [{ tool: "get", input: {} }],
            },
          ],
        },
      }),
    ).toBe(false);
  });

  it("rejects missing command", () => {
    expect(
      validateConfig({
        mcp: {
          servers: [
            {
              id: "test",
              transport: "stdio",
              command: "",
              args: [],
              calls: [{ tool: "get", input: {} }],
            },
          ],
        },
      }),
    ).toBe(false);
  });

  it("defaults args to empty array when omitted", () => {
    // validateConfig returns true when Schema parse succeeds
    // args has .default([]) so omitting it should pass
    expect(
      validateConfig({
        mcp: {
          servers: [
            {
              id: "test",
              transport: "stdio",
              command: "npx",
              calls: [{ tool: "get", input: {} }],
            },
          ],
        },
      }),
    ).toBe(true);
  });
});

describe("MCP mutating tool rejection", () => {
  const mutatingTools = [
    "create_issue",
    "updateSchema",
    "DeleteRecord",
    "MERGE_PR",
    "close_ticket",
    "addFile",
    "CommitMessage",
    "checkout_branch",
    "RESET_HARD",
    "rerun_pipeline",
    "trigger_deploy",
    "create",
    "update",
    "delete",
    "merge",
    "close",
    "add",
    "commit",
    "checkout",
    "reset",
    "rerun",
    "trigger",
  ];

  for (const tool of mutatingTools) {
    it(`rejects mutating tool "${tool}"`, () => {
      expect(
        validateConfig({
          mcp: {
            servers: [
              {
                id: "test",
                transport: "stdio",
                command: "npx",
                args: [],
                calls: [{ tool, input: {} }],
              },
            ],
          },
        }),
      ).toBe(false);
    });
  }

  const nonMutatingTools = [
    "get_context",
    "fetch_docs",
    "read_file",
    "search_code",
    "list_branches",
    "get_pr_details",
  ];

  for (const tool of nonMutatingTools) {
    it(`accepts non-mutating tool "${tool}"`, () => {
      expect(
        validateConfig({
          mcp: {
            servers: [
              {
                id: "test",
                transport: "stdio",
                command: "npx",
                args: [],
                calls: [{ tool, input: {} }],
              },
            ],
          },
        }),
      ).toBe(true);
    });
  }
});

describe("MCP duplicate call rejection", () => {
  it("rejects duplicate tool+input pairs", () => {
    expect(
      validateConfig({
        mcp: {
          servers: [
            {
              id: "test",
              transport: "stdio",
              command: "npx",
              args: [],
              calls: [
                { tool: "get_file", input: { path: "README.md" } },
                { tool: "get_file", input: { path: "README.md" } },
              ],
            },
          ],
        },
      }),
    ).toBe(false);
  });

  it("accepts same tool with different inputs", () => {
    expect(
      validateConfig({
        mcp: {
          servers: [
            {
              id: "test",
              transport: "stdio",
              command: "npx",
              args: [],
              calls: [
                { tool: "get_file", input: { path: "README.md" } },
                { tool: "get_file", input: { path: "CHANGELOG.md" } },
              ],
            },
          ],
        },
      }),
    ).toBe(true);
  });

  it("detects duplicates with stable sorted JSON keys", () => {
    // Same input but different key ordering should still be detected as duplicate
    expect(
      validateConfig({
        mcp: {
          servers: [
            {
              id: "test",
              transport: "stdio",
              command: "npx",
              args: [],
              calls: [
                { tool: "get_file", input: { b: 2, a: 1 } },
                { tool: "get_file", input: { a: 1, b: 2 } },
              ],
            },
          ],
        },
      }),
    ).toBe(false);
  });
});

// ─── MCP preset validation ──────────────────────────────────────────────

describe("MCP preset validation", () => {
  it("accepts github preset with calls", () => {
    expect(
      validateConfig({
        mcp: {
          presets: [
            {
              preset: "github",
              calls: [{ tool: "get_file_contents", input: { path: "README.md" } }],
            },
          ],
        },
      }),
    ).toBe(true);
  });

  it("rejects github preset with no calls", () => {
    expect(
      validateConfig({
        mcp: {
          presets: [{ preset: "github", calls: [] }],
        },
      }),
    ).toBe(false);
  });

  it("accepts fetch preset with urls", () => {
    expect(
      validateConfig({
        mcp: {
          presets: [{ preset: "fetch", urls: ["https://example.com"] }],
        },
      }),
    ).toBe(true);
  });

  it("accepts fetch preset with calls", () => {
    expect(
      validateConfig({
        mcp: {
          presets: [
            {
              preset: "fetch",
              calls: [{ tool: "fetch", input: { url: "https://example.com" } }],
            },
          ],
        },
      }),
    ).toBe(true);
  });

  it("rejects fetch preset with no calls and no urls", () => {
    expect(
      validateConfig({
        mcp: { presets: [{ preset: "fetch" }] },
      }),
    ).toBe(false);
  });

  it("rejects fetch preset with empty calls and empty urls", () => {
    expect(
      validateConfig({
        mcp: { presets: [{ preset: "fetch", calls: [], urls: [] }] },
      }),
    ).toBe(false);
  });

  it("rejects unknown preset type", () => {
    expect(
      validateConfig({
        mcp: { presets: [{ preset: "unknown", calls: [] }] },
      }),
    ).toBe(false);
  });

  it("accepts mixed presets and servers", () => {
    expect(
      validateConfig({
        mcp: {
          presets: [
            { preset: "fetch", urls: ["https://example.com"] },
            { preset: "github", calls: [{ tool: "get_file_contents", input: { path: "x.md" } }] },
          ],
          servers: [
            {
              id: "custom",
              transport: "stdio",
              command: "npx",
              args: [],
              calls: [{ tool: "get", input: {} }],
            },
          ],
        },
      }),
    ).toBe(true);
  });

  it("rejects duplicate IDs between preset and server", () => {
    expect(
      validateConfig({
        mcp: {
          presets: [
            { preset: "github", calls: [{ tool: "get_file_contents", input: { path: "x.md" } }] },
          ],
          servers: [
            {
              id: "github",
              transport: "stdio",
              command: "npx",
              args: [],
              calls: [{ tool: "get", input: {} }],
            },
          ],
        },
      }),
    ).toBe(false);
  });

  it("rejects duplicate IDs between fetch preset and server", () => {
    expect(
      validateConfig({
        mcp: {
          presets: [{ preset: "fetch", urls: ["https://example.com"] }],
          servers: [
            {
              id: "fetch",
              transport: "stdio",
              command: "uvx",
              args: [],
              calls: [{ tool: "get", input: {} }],
            },
          ],
        },
      }),
    ).toBe(false);
  });

  it("rejects mutating tools inside presets", () => {
    expect(
      validateConfig({
        mcp: {
          presets: [
            {
              preset: "github",
              calls: [{ tool: "create_issue", input: { title: "test" } }],
            },
          ],
        },
      }),
    ).toBe(false);
  });

  it("accepts github preset with custom env", () => {
    expect(
      validateConfig({
        mcp: {
          presets: [
            {
              preset: "github",
              calls: [{ tool: "get_file_contents", input: { path: "a.md" } }],
              env: { GITHUB_TOKEN: "MY_TOKEN" },
            },
          ],
        },
      }),
    ).toBe(true);
  });

  it("accepts fetch preset with env", () => {
    expect(
      validateConfig({
        mcp: {
          presets: [
            {
              preset: "fetch",
              urls: ["https://example.com"],
              env: { NPM_TOKEN: "NPM_REGISTRY_TOKEN" },
            },
          ],
        },
      }),
    ).toBe(true);
  });

  it("rejects env with wrong type in preset", () => {
    expect(
      validateConfig({
        mcp: {
          presets: [
            {
              preset: "github",
              calls: [{ tool: "get_file_contents", input: { path: "a.md" } }],
              env: "not-an-object",
            },
          ],
        },
      }),
    ).toBe(false);
  });

  it("rejects duplicate preset names as config error", () => {
    expect(
      validateConfig({
        mcp: {
          presets: [
            { preset: "github", calls: [{ tool: "get_file_contents", input: { path: "a.md" } }] },
            { preset: "github", calls: [{ tool: "get_file_contents", input: { path: "b.md" } }] },
          ],
        },
      }),
    ).toBe(false);
  });
});

// ─── Duplicate explicit server ID validation ─────────────────────────────

describe("duplicate explicit server ID validation", () => {
  it("rejects duplicate IDs within explicit servers (no presets)", () => {
    expect(
      validateConfig({
        mcp: {
          servers: [
            {
              id: "dup-id",
              transport: "stdio",
              command: "npx",
              args: [],
              calls: [{ tool: "get", input: {} }],
            },
            {
              id: "dup-id",
              transport: "stdio",
              command: "node",
              args: [],
              calls: [{ tool: "get", input: {} }],
            },
          ],
        },
      }),
    ).toBe(false);
  });

  it("accepts unique explicit server IDs (no presets)", () => {
    expect(
      validateConfig({
        mcp: {
          servers: [
            {
              id: "server-a",
              transport: "stdio",
              command: "npx",
              args: [],
              calls: [{ tool: "get", input: {} }],
            },
            {
              id: "server-b",
              transport: "stdio",
              command: "node",
              args: [],
              calls: [{ tool: "get", input: {} }],
            },
          ],
        },
      }),
    ).toBe(true);
  });
});
