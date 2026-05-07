/**
 * MCP context gathering orchestrator.
 * Coordinates: PR metadata extraction → template resolution → cache lookup →
 * server execution → context string formatting.
 *
 * Called once per review run before AI audit. Returns null if MCP is disabled
 * or no results were obtained. All failures are logged as warnings.
 */

import type { ProjectConfig } from "../../types/index.js";
import { extractPRMetadata } from "../../utils/pr-metadata.js";
import { resolveTemplateVariables } from "./template-resolver.js";
import { buildMCPCacheKey, readMCPCacheEntry, writeMCPCacheEntry } from "./cache.js";
import { executeMCPServer } from "./client.js";
import { buildMCPContextString } from "./context-builder.js";
import { expandPresets } from "./presets.js";
import { getToolVersion } from "../../utils/version.js";
import type { MCPCallResult } from "./client.js";

export const gatherMCPContext = async (
  config: ProjectConfig,
  changedFiles: string[],
  workingDir: string,
): Promise<string | null> => {
  const mcp = config.mcp;
  if (!mcp?.enabled) {
    return null;
  }

  // Expand presets and combine with explicit servers
  const presetExpansion =
    mcp.presets && mcp.presets.length > 0 ? expandPresets(mcp.presets) : { servers: [] };
  const allServers = [...presetExpansion.servers, ...(mcp.servers ?? [])];

  if (allServers.length === 0) {
    return null;
  }

  const metadata = await extractPRMetadata(changedFiles);
  const toolVersion = getToolVersion();
  const cacheEnabled = mcp.cacheEnabled !== false;
  const cacheTtlMs = mcp.cacheTtlMs ?? 3_600_000;
  const maxContextChars = mcp.maxContextChars ?? 6000;

  const allResults: MCPCallResult[] = [];

  for (const server of allServers) {
    const resolvedCalls = server.calls.map((call) => ({
      ...call,
      input: resolveTemplateVariables(call.input, metadata, workingDir),
    }));

    // Separate cached from uncached calls (parallel arrays for cache keys)
    const uncachedCalls: typeof resolvedCalls = [];
    const uncachedCacheKeys: (string | null)[] = [];
    for (const call of resolvedCalls) {
      if (cacheEnabled) {
        const cacheKey = buildMCPCacheKey({
          serverId: server.id,
          command: server.command,
          args: server.args,
          toolName: call.tool,
          resolvedInput: call.input,
          headSha: metadata.headSha,
          changedFiles,
          toolVersion,
          envMapping: server.env ?? {},
        });
        const cached = await readMCPCacheEntry(cacheKey, cacheTtlMs);
        if (cached !== null) {
          allResults.push({
            serverId: server.id,
            tool: call.tool,
            result: cached,
            truncated: false,
          });
          continue;
        }

        uncachedCalls.push(call);
        uncachedCacheKeys.push(cacheKey);
      } else {
        uncachedCalls.push(call);
        uncachedCacheKeys.push(null);
      }
    }

    if (uncachedCalls.length > 0) {
      const freshResults = await executeMCPServer(server, uncachedCalls, mcp, workingDir);
      for (let i = 0; i < freshResults.length; i++) {
        const result = freshResults[i]!;
        allResults.push(result);

        if (cacheEnabled) {
          const key = uncachedCacheKeys[i];
          if (key) {
            await writeMCPCacheEntry(key, result.result, cacheTtlMs);
          }
        }
      }
    }
  }

  if (allResults.length === 0) return null;

  const context = buildMCPContextString(allResults, maxContextChars);
  return context || null;
};
