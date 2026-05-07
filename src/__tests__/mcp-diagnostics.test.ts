/**
 * MCP diagnostics tests.
 * Tests generateMCPDiagnostics for all statuses: disabled, ready, missing_env, missing_command.
 * No server spawns — diagnostics are read-only and use shell-free PATH resolution.
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { generateMCPDiagnostics } from "../services/mcp/diagnostics.js";
import { clearConfigCache } from "../utils/config.js";
import type { MCPConfig } from "../types/index.js";

beforeEach(() => {
  clearConfigCache();
});

describe("generateMCPDiagnostics — disabled", () => {
  it("returns disabled when MCP is not enabled", () => {
    const config: MCPConfig = { enabled: false };
    const result = generateMCPDiagnostics(config);
    expect(result.enabled).toBe(false);
    expect(result.serverCount).toBe(0);
    expect(result.servers).toEqual([]);
  });

  it("returns disabled when MCP is undefined-like (enabled false default)", () => {
    const config: MCPConfig = {};
    const result = generateMCPDiagnostics(config);
    expect(result.enabled).toBe(false);
    expect(result.serverCount).toBe(0);
  });
});

describe("generateMCPDiagnostics — missing_command", () => {
  it("flags nonexistent command as missing_command", () => {
    const config: MCPConfig = {
      enabled: true,
      servers: [
        {
          id: "nonexistent",
          transport: "stdio",
          command: "nonexistent-command-xyz-12345",
          args: [],
          calls: [{ tool: "test", input: {} }],
        },
      ],
    };
    const result = generateMCPDiagnostics(config);
    expect(result.enabled).toBe(true);
    expect(result.serverCount).toBe(1);
    expect(result.servers[0]!.status).toBe("missing_command");
    expect(result.servers[0]!.id).toBe("nonexistent");
  });

  it("has recommendedActions for missing command", () => {
    const config: MCPConfig = {
      enabled: true,
      servers: [
        {
          id: "no-cmd",
          transport: "stdio",
          command: "nonexistent-command-xyz-12345",
          args: [],
          calls: [{ tool: "test", input: {} }],
        },
      ],
    };
    const result = generateMCPDiagnostics(config);
    expect(result.servers[0]!.recommendedActions).toBeDefined();
    expect(result.servers[0]!.recommendedActions![0]).toContain("Install");
  });
});

describe("generateMCPDiagnostics — ready", () => {
  it("flags existing command as ready when no env mapping", () => {
    const config: MCPConfig = {
      enabled: true,
      servers: [
        {
          id: "node-check",
          transport: "stdio",
          command: "node",
          args: ["--version"],
          calls: [{ tool: "test", input: {} }],
        },
      ],
    };
    const result = generateMCPDiagnostics(config);
    expect(result.servers[0]!.status).toBe("ready");
    expect(result.servers[0]!.toolCount).toBe(1);
  });

  it("uses npx as ready command", () => {
    const config: MCPConfig = {
      enabled: true,
      servers: [
        {
          id: "npx-check",
          transport: "stdio",
          command: "npx",
          args: ["--version"],
          calls: [{ tool: "test", input: {} }],
        },
      ],
    };
    const result = generateMCPDiagnostics(config);
    expect(result.servers[0]!.status).toBe("ready");
  });

  it("no recommendedActions when ready", () => {
    const config: MCPConfig = {
      enabled: true,
      servers: [
        {
          id: "ready-svr",
          transport: "stdio",
          command: "node",
          args: ["--version"],
          calls: [{ tool: "test", input: {} }],
        },
      ],
    };
    const result = generateMCPDiagnostics(config);
    expect(result.servers[0]!.recommendedActions).toBeUndefined();
  });
});

describe("generateMCPDiagnostics — missing_env", () => {
  it("flags missing parent env vars", () => {
    const config: MCPConfig = {
      enabled: true,
      servers: [
        {
          id: "needs-env",
          transport: "stdio",
          command: "node",
          args: ["--version"],
          env: { GITHUB_TOKEN: "NONEXISTENT_ENV_VAR_XYZ_12345" },
          calls: [{ tool: "test", input: {} }],
        },
      ],
    };
    const result = generateMCPDiagnostics(config);
    expect(result.servers[0]!.status).toBe("missing_env");
    expect(result.servers[0]!.missingVars).toContain("NONEXISTENT_ENV_VAR_XYZ_12345");
  });

  it("has recommendedActions for missing env vars", () => {
    const config: MCPConfig = {
      enabled: true,
      servers: [
        {
          id: "needs-env",
          transport: "stdio",
          command: "node",
          args: ["--version"],
          env: { TOKEN: "MISSING_TOKEN_VAR" },
          calls: [{ tool: "test", input: {} }],
        },
      ],
    };
    const result = generateMCPDiagnostics(config);
    expect(result.servers[0]!.recommendedActions).toBeDefined();
    expect(result.servers[0]!.recommendedActions![0]).toContain("MISSING_TOKEN_VAR");
  });

  it("ready when env vars exist", () => {
    const config: MCPConfig = {
      enabled: true,
      servers: [
        {
          id: "has-env",
          transport: "stdio",
          command: "node",
          args: ["--version"],
          env: { PATH: "PATH" },
          calls: [{ tool: "test", input: {} }],
        },
      ],
    };
    const result = generateMCPDiagnostics(config);
    expect(result.servers[0]!.status).toBe("ready");
  });
});

describe("generateMCPDiagnostics — GitHub preset default env", () => {
  it("reports missing_env when GITHUB_TOKEN is missing", () => {
    const config: MCPConfig = {
      enabled: true,
      presets: [
        { preset: "github", calls: [{ tool: "get_file_contents", input: { path: "README.md" } }] },
      ],
    };
    // GITHUB_TOKEN is likely not set in test env, so status should be missing_env
    const result = generateMCPDiagnostics(config);
    expect(result.serverCount).toBe(1);
    if (process.env.GITHUB_TOKEN) {
      expect(result.servers[0]!.status).toBe("ready");
    } else {
      expect(result.servers[0]!.status).toBe("missing_env");
      expect(result.servers[0]!.missingVars).toContain("GITHUB_TOKEN");
    }
  });

  it("reports ready when GITHUB_TOKEN overridden with PATH", () => {
    const config: MCPConfig = {
      enabled: true,
      presets: [
        {
          preset: "github",
          calls: [{ tool: "get_file_contents", input: { path: "README.md" } }],
          env: { PATH: "PATH" },
        },
      ],
    };
    const result = generateMCPDiagnostics(config);
    // Overriding env replaces default GITHUB_TOKEN with PATH, which always exists
    expect(result.servers[0]!.status).toBe("ready");
  });
});

describe("generateMCPDiagnostics — presets", () => {
  it("expands presets and includes in diagnostics", () => {
    const config: MCPConfig = {
      enabled: true,
      presets: [
        { preset: "fetch", urls: ["https://example.com"] },
        {
          preset: "github",
          calls: [{ tool: "get_file_contents", input: { path: "README.md" } }],
          env: { PATH: "PATH" },
        },
      ],
    };
    const result = generateMCPDiagnostics(config);
    expect(result.serverCount).toBe(2);
    expect(result.servers.map((s) => s.id).sort()).toEqual(["fetch", "github"]);
  });

  it("combines expanded presets with explicit servers", () => {
    const config: MCPConfig = {
      enabled: true,
      presets: [{ preset: "fetch", urls: ["https://example.com"] }],
      servers: [
        {
          id: "custom",
          transport: "stdio",
          command: "node",
          args: ["--version"],
          calls: [{ tool: "test", input: {} }],
        },
      ],
    };
    const result = generateMCPDiagnostics(config);
    expect(result.serverCount).toBe(2);
  });
});

describe("generateMCPDiagnostics — no spawn", () => {
  it("completes instantly for a command that would hang if spawned", () => {
    const config: MCPConfig = {
      enabled: true,
      timeoutMs: 100,
      servers: [
        {
          id: "no-spawn",
          transport: "stdio",
          command: "node",
          args: ["-e", "setTimeout(() => {}, 30000)"],
          calls: [{ tool: "test", input: {} }],
        },
      ],
    };

    const start = Date.now();
    const result = generateMCPDiagnostics(config);
    const elapsed = Date.now() - start;

    // Should complete quickly using shell-free PATH resolution
    expect(result.enabled).toBe(true);
    expect(result.servers[0]!.id).toBe("no-spawn");
    expect(elapsed).toBeLessThan(5000);
  });
});
