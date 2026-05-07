/**
 * MCP preset expansion — converts shorthand preset configs into full MCPServer
 * definitions before cache lookup and tool execution.
 */

import type { MCPPreset, MCPServer, MCPCall } from "../../types/index.js";

export interface PresetExpansion {
  servers: MCPServer[];
  errors: string[];
}

const GITHUB_DEFAULT_ENV: Record<string, string> = { GITHUB_TOKEN: "GITHUB_TOKEN" };

const expandGitHubPreset = (preset: Extract<MCPPreset, { preset: "github" }>): MCPServer => ({
  id: "github",
  transport: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-github"],
  env: preset.env ?? GITHUB_DEFAULT_ENV,
  calls: preset.calls,
});

const expandFetchPreset = (preset: Extract<MCPPreset, { preset: "fetch" }>): MCPServer | null => {
  const calls: MCPCall[] = [];

  if (preset.calls) {
    calls.push(...preset.calls);
  }
  if (preset.urls) {
    for (const url of preset.urls) {
      if (preset.calls && preset.calls.length > 0) {
        calls.push({ tool: "fetch", input: { url } });
      } else {
        calls.push({ tool: "fetch", input: { url }, maxChars: 6000 });
      }
    }
  }

  if (calls.length === 0) {
    return null;
  }

  const server: MCPServer = {
    id: "fetch",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-fetch"],
    calls,
  };

  if (preset.env) {
    server.env = preset.env;
  }

  return server;
};

/**
 * Expand a list of MCP presets into full MCPServer definitions.
 * Returns expanded servers and errors. Duplicate preset names are errors.
 */
export const expandPresets = (presets: MCPPreset[]): PresetExpansion => {
  const servers: MCPServer[] = [];
  const errors: string[] = [];
  const seenIds = new Set<string>();

  for (const preset of presets) {
    if (seenIds.has(preset.preset)) {
      errors.push(`Duplicate preset "${preset.preset}". Each preset can only be used once.`);
      continue;
    }
    seenIds.add(preset.preset);

    if (preset.preset === "github") {
      servers.push(expandGitHubPreset(preset));
    } else if (preset.preset === "fetch") {
      const server = expandFetchPreset(preset);
      if (server) {
        servers.push(server);
      } else {
        errors.push(`Fetch preset requires at least one of "calls" or "urls" to be non-empty.`);
      }
    }
  }

  return { servers, errors };
};

/**
 * Validate that expanded presets and explicit servers have no duplicate IDs.
 * Returns the list of duplicate IDs found.
 */
export const findDuplicateServerIds = (
  expandedPresets: MCPServer[],
  servers: MCPServer[],
): string[] => {
  const allIds = [...expandedPresets, ...servers].map((s) => s.id);
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const id of allIds) {
    if (seen.has(id)) {
      duplicates.add(id);
    } else {
      seen.add(id);
    }
  }

  return [...duplicates];
};
