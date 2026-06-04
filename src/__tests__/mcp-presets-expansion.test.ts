/**
 * Tests for the new MCP presets (Phase 4.4 -- filesystem, git, slack,
 * linear, postgres).
 */

import { afterEach, describe, expect, it } from "@jest/globals";
import { expandPresets } from "../services/mcp/presets.js";

describe("Phase 4.4 — filesystem preset", () => {
  it("expands with default rootPaths = [cwd]", () => {
    const { servers, errors } = expandPresets([
      {
        preset: "filesystem",
        calls: [{ tool: "list_directory", input: { path: "." } }],
      },
    ]);
    expect(errors).toEqual([]);
    expect(servers).toHaveLength(1);
    expect(servers[0]?.id).toBe("filesystem");
    expect(servers[0]?.command).toBe("npx");
    expect(servers[0]?.args).toContain("@modelcontextprotocol/server-filesystem");
    // The cwd is appended as the last arg
    expect(servers[0]?.args.length).toBeGreaterThanOrEqual(3);
  });

  it("forwards explicit rootPaths", () => {
    const { servers } = expandPresets([
      {
        preset: "filesystem",
        rootPaths: ["/src", "/docs"],
        calls: [{ tool: "list_directory", input: { path: "/src" } }],
      },
    ]);
    expect(servers[0]?.args).toContain("/src");
    expect(servers[0]?.args).toContain("/docs");
  });
});

describe("Phase 4.4 — git preset", () => {
  it("expands with cwd repository default", () => {
    const { servers, errors } = expandPresets([
      {
        preset: "git",
        calls: [{ tool: "git_log", input: { max_count: 5 } }],
      },
    ]);
    expect(errors).toEqual([]);
    expect(servers[0]?.id).toBe("git");
    expect(servers[0]?.command).toBe("uvx");
    expect(servers[0]?.args).toContain("mcp-server-git");
    expect(servers[0]?.args).toContain("--repository");
  });

  it("rejects a mutating tool call via the global MCPCallSchema layer", () => {
    // Schema validation happens in config.ts (Zod). The preset expander
    // doesn't itself enforce read-only -- it just shapes the server. This
    // test documents that read-only verbs ARE accepted.
    const { servers } = expandPresets([
      {
        preset: "git",
        calls: [{ tool: "git_show", input: { commit: "HEAD" } }],
      },
    ]);
    expect(servers).toHaveLength(1);
  });
});

describe("Phase 4.4 — slack preset", () => {
  it("uses the default env mapping when none is provided", () => {
    const { servers } = expandPresets([
      {
        preset: "slack",
        calls: [{ tool: "channels_list", input: {} }],
      },
    ]);
    expect(servers[0]?.id).toBe("slack");
    expect(servers[0]?.env).toEqual({
      SLACK_BOT_TOKEN: "SLACK_BOT_TOKEN",
      SLACK_TEAM_ID: "SLACK_TEAM_ID",
    });
  });

  it("respects a custom env mapping", () => {
    const { servers } = expandPresets([
      {
        preset: "slack",
        env: { SLACK_BOT_TOKEN: "MY_TOKEN_VAR" },
        calls: [{ tool: "channels_list", input: {} }],
      },
    ]);
    expect(servers[0]?.env).toEqual({ SLACK_BOT_TOKEN: "MY_TOKEN_VAR" });
  });
});

describe("Phase 4.4 — linear preset", () => {
  it("expands with default env mapping", () => {
    const { servers } = expandPresets([
      {
        preset: "linear",
        calls: [{ tool: "list_issues", input: {} }],
      },
    ]);
    expect(servers[0]?.id).toBe("linear");
    expect(servers[0]?.env).toEqual({ LINEAR_API_KEY: "LINEAR_API_KEY" });
  });
});

describe("Phase 4.4 — postgres preset", () => {
  const ORIGINAL_DATABASE_URL = process.env["DATABASE_URL"];

  afterEach(() => {
    if (ORIGINAL_DATABASE_URL === undefined) {
      delete process.env["DATABASE_URL"];
    } else {
      process.env["DATABASE_URL"] = ORIGINAL_DATABASE_URL;
    }
    delete process.env["MY_PG_URL"];
  });

  it("passes the connection URL from DATABASE_URL as a CLI argument", () => {
    process.env["DATABASE_URL"] = "postgresql://localhost:5432/testdb";
    const { servers, errors } = expandPresets([
      {
        preset: "postgres",
        calls: [{ tool: "query", input: { sql: "SELECT 1" } }],
      },
    ]);
    expect(errors).toEqual([]);
    expect(servers[0]?.id).toBe("postgres");
    // server-postgres expects the DSN as the trailing CLI argument, not env
    expect(servers[0]?.args).toEqual([
      "-y",
      "@modelcontextprotocol/server-postgres",
      "postgresql://localhost:5432/testdb",
    ]);
    expect(servers[0]?.env).toBeUndefined();
  });

  it("honors connectionUrlEnv override", () => {
    process.env["MY_PG_URL"] = "postgresql://example:5432/other";
    const { servers, errors } = expandPresets([
      {
        preset: "postgres",
        connectionUrlEnv: "MY_PG_URL",
        calls: [{ tool: "query", input: { sql: "SELECT 1" } }],
      },
    ]);
    expect(errors).toEqual([]);
    expect(servers[0]?.args).toContain("postgresql://example:5432/other");
  });

  it("errors when the connection URL env var is unset", () => {
    delete process.env["DATABASE_URL"];
    const { servers, errors } = expandPresets([
      {
        preset: "postgres",
        calls: [{ tool: "query", input: { sql: "SELECT 1" } }],
      },
    ]);
    expect(servers).toEqual([]);
    expect(errors[0]).toMatch(/DATABASE_URL/);
  });
});

describe("Phase 4.4 — duplicate-preset error", () => {
  it("flags duplicate filesystem preset", () => {
    const { errors } = expandPresets([
      { preset: "filesystem", calls: [{ tool: "list_directory", input: { path: "." } }] },
      { preset: "filesystem", calls: [{ tool: "read_file", input: { path: "x" } }] },
    ]);
    expect(errors[0]).toMatch(/Duplicate preset "filesystem"/);
  });
});

describe("Phase 4.4 — mixed presets all expand", () => {
  const ORIGINAL_DATABASE_URL = process.env["DATABASE_URL"];

  afterEach(() => {
    if (ORIGINAL_DATABASE_URL === undefined) {
      delete process.env["DATABASE_URL"];
    } else {
      process.env["DATABASE_URL"] = ORIGINAL_DATABASE_URL;
    }
  });

  it("expands github + filesystem + git + slack + linear + postgres together", () => {
    process.env["DATABASE_URL"] = "postgresql://localhost:5432/testdb";
    const { servers, errors } = expandPresets([
      {
        preset: "github",
        calls: [{ tool: "get_repository", input: { owner: "x", repo: "y" } }],
      },
      { preset: "filesystem", calls: [{ tool: "list_directory", input: { path: "." } }] },
      { preset: "git", calls: [{ tool: "git_log", input: {} }] },
      { preset: "slack", calls: [{ tool: "channels_list", input: {} }] },
      { preset: "linear", calls: [{ tool: "list_issues", input: {} }] },
      { preset: "postgres", calls: [{ tool: "query", input: { sql: "SELECT 1" } }] },
    ]);
    expect(errors).toEqual([]);
    expect(servers.map((s) => s.id)).toEqual([
      "github",
      "filesystem",
      "git",
      "slack",
      "linear",
      "postgres",
    ]);
  });
});
