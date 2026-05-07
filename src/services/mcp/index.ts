/**
 * MCP context gathering orchestrator.
 * Coordinates: PR metadata extraction → template resolution → cache lookup →
 * server execution → context string formatting.
 *
 * Called once per review run before AI audit. Returns null if MCP is disabled
 * or no results were obtained. All failures are logged as warnings.
 */

import type {
  ProjectConfig,
  MCPCallDetail,
  MCPGatherResult,
  MCPContextSummary,
} from "../../types/index.js";
import { extractPRMetadata } from "../../utils/pr-metadata.js";
import { resolveTemplateVariables } from "./template-resolver.js";
import { buildMCPCacheKey, readMCPCacheEntry, writeMCPCacheEntry } from "./cache.js";
import { executeMCPServer } from "./client.js";
import { buildMCPContextString } from "./context-builder.js";
import { expandPresets } from "./presets.js";
import { getToolVersion } from "../../utils/version.js";
import type { MCPCallResult } from "./client.js";

/**
 * Gather MCP context with full runtime observability detail.
 * Returns the context string plus a summary with per-call metadata,
 * cache hit/miss counts, and warnings.
 */
export const gatherMCPContextDetails = async (
  config: ProjectConfig,
  changedFiles: string[],
  workingDir: string,
): Promise<MCPGatherResult> => {
  const mcp = config.mcp;
  const emptySummary: MCPContextSummary = {
    enabled: false,
    serverCount: 0,
    attemptedCallCount: 0,
    cachedCallCount: 0,
    freshCallCount: 0,
    failedCallCount: 0,
    contextChars: 0,
    truncated: false,
    warnings: [],
    calls: [],
  };

  if (!mcp?.enabled) {
    return { context: null, summary: emptySummary };
  }

  // Expand presets and combine with explicit servers
  const presetExpansion =
    mcp.presets && mcp.presets.length > 0 ? expandPresets(mcp.presets) : { servers: [] };
  const allServers = [...presetExpansion.servers, ...(mcp.servers ?? [])];

  if (allServers.length === 0) {
    emptySummary.enabled = true;
    return { context: null, summary: emptySummary };
  }

  const metadata = await extractPRMetadata(changedFiles);
  const toolVersion = getToolVersion();
  const cacheEnabled = mcp.cacheEnabled !== false;
  const cacheTtlMs = mcp.cacheTtlMs ?? 3_600_000;
  const maxContextChars = mcp.maxContextChars ?? 6000;

  const allResults: MCPCallResult[] = [];
  const callDetails: MCPCallDetail[] = [];
  const warnings: string[] = [];
  let cachedCount = 0;
  let freshCount = 0;
  let failedCount = 0;

  for (const server of allServers) {
    const resolvedCalls = server.calls.map((call) => ({
      ...call,
      input: resolveTemplateVariables(call.input, metadata, workingDir),
    }));

    // Separate cached from uncached calls
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
          callDetails.push({
            serverId: server.id,
            tool: call.tool,
            cacheStatus: "hit",
            status: "ok",
          });
          cachedCount++;
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

      // Track successful results and detect failed calls
      const successTools = new Set(freshResults.map((r) => r.tool));
      for (const call of uncachedCalls) {
        if (successTools.has(call.tool)) {
          callDetails.push({
            serverId: server.id,
            tool: call.tool,
            cacheStatus: cacheEnabled ? "miss" : "disabled",
            status: "ok",
          });
          freshCount++;
        } else {
          callDetails.push({
            serverId: server.id,
            tool: call.tool,
            cacheStatus: cacheEnabled ? "miss" : "disabled",
            status: "failed",
          });
          failedCount++;
        }
      }

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

  if (allResults.length === 0) {
    return {
      context: null,
      summary: {
        enabled: true,
        serverCount: allServers.length,
        attemptedCallCount: callDetails.length,
        cachedCallCount: cachedCount,
        freshCallCount: freshCount,
        failedCallCount: failedCount,
        contextChars: 0,
        truncated: false,
        warnings,
        calls: callDetails,
      },
    };
  }

  const context = buildMCPContextString(allResults, maxContextChars);

  // Detect truncation: compute rough expected length without budget
  let expectedRawChars = 0;
  for (const r of allResults) {
    // Header: "[serverId/tool]\n" + separator "\n\n"
    expectedRawChars += r.serverId.length + r.tool.length + 3 + r.result.length + 2;
  }
  const truncated = expectedRawChars > maxContextChars;

  return {
    context: context || null,
    summary: {
      enabled: true,
      serverCount: allServers.length,
      attemptedCallCount: callDetails.length,
      cachedCallCount: cachedCount,
      freshCallCount: freshCount,
      failedCallCount: failedCount,
      contextChars: context ? context.length : 0,
      truncated,
      warnings,
      calls: callDetails,
    },
  };
};

/** Backward-compatible wrapper: returns only the context string. */
export const gatherMCPContext = async (
  config: ProjectConfig,
  changedFiles: string[],
  workingDir: string,
): Promise<string | null> => {
  const result = await gatherMCPContextDetails(config, changedFiles, workingDir);
  return result.context;
};
