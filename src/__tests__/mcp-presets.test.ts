/**
 * MCP preset expansion tests.
 * Covers expandPresets, findDuplicateServerIds, preset-to-server expansion,
 * env propagation, and GitHub default env mapping.
 */

import { describe, it, expect } from "@jest/globals";
import { expandPresets, findDuplicateServerIds } from "../services/mcp/presets.js";
import type { MCPPreset } from "../types/index.js";

describe("expandPresets — github", () => {
  it("expands github preset with explicit calls", () => {
    const presets: MCPPreset[] = [
      { preset: "github", calls: [{ tool: "get_file_contents", input: { path: "README.md" } }] },
    ];
    const result = expandPresets(presets);
    expect(result.errors).toHaveLength(0);
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]!.id).toBe("github");
    expect(result.servers[0]!.transport).toBe("stdio");
    expect(result.servers[0]!.command).toBe("npx");
    expect(result.servers[0]!.args).toEqual(["-y", "@modelcontextprotocol/server-github"]);
    expect(result.servers[0]!.calls).toHaveLength(1);
    expect(result.servers[0]!.calls[0]!.tool).toBe("get_file_contents");
  });

  it("has default GITHUB_TOKEN env mapping", () => {
    const presets: MCPPreset[] = [
      { preset: "github", calls: [{ tool: "get_file_contents", input: { path: "a.md" } }] },
    ];
    const result = expandPresets(presets);
    expect(result.servers[0]!.env).toEqual({ GITHUB_TOKEN: "GITHUB_TOKEN" });
  });

  it("allows overriding default env", () => {
    const presets: MCPPreset[] = [
      {
        preset: "github",
        calls: [{ tool: "get_file_contents", input: { path: "a.md" } }],
        env: { GITHUB_TOKEN: "MY_CUSTOM_TOKEN" },
      },
    ];
    const result = expandPresets(presets);
    expect(result.servers[0]!.env).toEqual({ GITHUB_TOKEN: "MY_CUSTOM_TOKEN" });
  });

  it("duplicate github preset produces error (not warning)", () => {
    const presets: MCPPreset[] = [
      { preset: "github", calls: [{ tool: "get_file_contents", input: { path: "a.md" } }] },
      { preset: "github", calls: [{ tool: "get_file_contents", input: { path: "b.md" } }] },
    ];
    const result = expandPresets(presets);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Duplicate preset "github"');
    expect(result.servers).toHaveLength(1);
  });
});

describe("expandPresets — fetch", () => {
  it("expands fetch preset with explicit calls", () => {
    const presets: MCPPreset[] = [
      { preset: "fetch", calls: [{ tool: "fetch", input: { url: "https://example.com" } }] },
    ];
    const result = expandPresets(presets);
    expect(result.errors).toHaveLength(0);
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]!.id).toBe("fetch");
    expect(result.servers[0]!.command).toBe("uvx");
    expect(result.servers[0]!.args).toEqual(["mcp-server-fetch"]);
    expect(result.servers[0]!.calls).toHaveLength(1);
  });

  it("expands fetch preset with urls array", () => {
    const presets: MCPPreset[] = [
      {
        preset: "fetch",
        urls: ["https://docs.example.com", "https://api.example.com"],
      },
    ];
    const result = expandPresets(presets);
    expect(result.errors).toHaveLength(0);
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]!.calls).toHaveLength(2);
    expect(result.servers[0]!.calls[0]!.tool).toBe("fetch");
    expect(result.servers[0]!.calls[0]!.input).toEqual({ url: "https://docs.example.com" });
    expect(result.servers[0]!.calls[1]!.input).toEqual({ url: "https://api.example.com" });
  });

  it("combines explicit calls and urls in fetch preset", () => {
    const presets: MCPPreset[] = [
      {
        preset: "fetch",
        calls: [{ tool: "fetch", input: { url: "https://custom.example.com" } }],
        urls: ["https://docs.example.com"],
      },
    ];
    const result = expandPresets(presets);
    expect(result.errors).toHaveLength(0);
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]!.calls).toHaveLength(2);
  });

  it("returns error for fetch preset with no calls and no urls", () => {
    const presets: MCPPreset[] = [{ preset: "fetch" }];
    const result = expandPresets(presets);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("calls");
    expect(result.servers).toHaveLength(0);
  });

  it("returns error for fetch preset with empty arrays", () => {
    const presets: MCPPreset[] = [{ preset: "fetch", calls: [], urls: [] }];
    const result = expandPresets(presets);
    expect(result.errors).toHaveLength(1);
    expect(result.servers).toHaveLength(0);
  });

  it("propagates env to expanded fetch server", () => {
    const presets: MCPPreset[] = [
      {
        preset: "fetch",
        urls: ["https://example.com"],
        env: { NPM_TOKEN: "NPM_REGISTRY_TOKEN" },
      },
    ];
    const result = expandPresets(presets);
    expect(result.errors).toHaveLength(0);
    expect(result.servers[0]!.env).toEqual({ NPM_TOKEN: "NPM_REGISTRY_TOKEN" });
  });
});

describe("expandPresets — multiple presets", () => {
  it("expands github and fetch together", () => {
    const presets: MCPPreset[] = [
      { preset: "github", calls: [{ tool: "get_file_contents", input: { path: "README.md" } }] },
      { preset: "fetch", urls: ["https://docs.example.com"] },
    ];
    const result = expandPresets(presets);
    expect(result.errors).toHaveLength(0);
    expect(result.servers).toHaveLength(2);
    expect(result.servers.map((s) => s.id).sort()).toEqual(["fetch", "github"]);
  });
});

describe("expandPresets — empty presets", () => {
  it("returns empty servers for empty preset list", () => {
    const result = expandPresets([]);
    expect(result.servers).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });
});

describe("findDuplicateServerIds", () => {
  it("returns empty when no duplicates", () => {
    const expanded = [
      { id: "github", transport: "stdio" as const, command: "npx", args: [], calls: [] },
    ];
    const servers = [
      { id: "fetch", transport: "stdio" as const, command: "uvx", args: [], calls: [] },
    ];
    expect(findDuplicateServerIds(expanded, servers)).toEqual([]);
  });

  it("detects duplicates between expanded presets and servers", () => {
    const expanded = [
      { id: "github", transport: "stdio" as const, command: "npx", args: [], calls: [] },
    ];
    const servers = [
      { id: "github", transport: "stdio" as const, command: "node", args: [], calls: [] },
    ];
    expect(findDuplicateServerIds(expanded, servers)).toEqual(["github"]);
  });

  it("detects duplicates within servers", () => {
    const expanded: typeof servers = [];
    const servers = [
      { id: "dup", transport: "stdio" as const, command: "npx", args: [], calls: [] },
      { id: "dup", transport: "stdio" as const, command: "node", args: [], calls: [] },
    ];
    expect(findDuplicateServerIds(expanded, servers)).toEqual(["dup"]);
  });

  it("returns empty for both empty", () => {
    expect(findDuplicateServerIds([], [])).toEqual([]);
  });
});
