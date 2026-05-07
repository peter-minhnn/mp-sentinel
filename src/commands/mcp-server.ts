/**
 * mp-sentinel MCP Server — stdio JSON-RPC entry point.
 *
 * Exports a factory for testability and a command wrapper for the CLI.
 * All three tools are read-only: index health, agent context, explain context.
 * No AI calls, no mutations, no outbound MCP spawning.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getToolVersion } from "../utils/version.js";
import {
  getIndexHealth,
  getAgentContext,
  getExplainContext,
} from "../services/mcp-server/service.js";

/**
 * Create a configured McpServer with all three tools registered.
 * The server is NOT connected to any transport — caller must call
 * server.connect(transport) to start serving.
 */
export const createMPSentinelMCPServer = (projectRoot: string): McpServer => {
  const toolVersion = getToolVersion();
  const server = new McpServer(
    { name: "mp-sentinel", version: toolVersion },
    { capabilities: { tools: {} } },
  );

  // ── Tool 1: Index Health ─────────────────────────────────────────────

  server.tool(
    "mp_sentinel_index_health",
    "Read-only source index health check. Reports cache status, schema version, and file count. Never builds or refreshes the index.",
    {},
    async () => {
      try {
        const health = await getIndexHealth(projectRoot);
        return { content: [{ type: "text" as const, text: JSON.stringify(health, null, 2) }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "error",
                message: err instanceof Error ? err.message : String(err),
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── Tool 2: Agent Context ────────────────────────────────────────────

  server.tool(
    "mp_sentinel_agent_context",
    "Get structured agent context for a specific file: symbols, imports, exports, dependents, hub files, and suggested commands.",
    {
      file: z.string().describe("Path to the file relative to project root"),
    },
    async ({ file }) => {
      try {
        const result = await getAgentContext(projectRoot, file);
        if (result.error) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(result, null, 2),
              },
            ],
            isError: true,
          };
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: err instanceof Error ? err.message : String(err),
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── Tool 3: Explain Context ──────────────────────────────────────────

  server.tool(
    "mp_sentinel_explain_context",
    "Structured context preview for a set of files: index health, related files, suggested commands, and MCP diagnostics. No AI calls.",
    {
      files: z.array(z.string()).describe("Array of file paths relative to project root"),
    },
    async ({ files }) => {
      try {
        const result = await getExplainContext(projectRoot, files);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "error",
                message: err instanceof Error ? err.message : String(err),
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  return server;
};

/**
 * Run mp-sentinel as a stdio MCP server.
 * This is the CLI entry point for the `mcp-server` command.
 * Returns 0 on clean close, 2 on crash.
 * Logs go to stderr; stdout is reserved for MCP JSON-RPC.
 */
export const runMCPServerCommand = async (projectRoot: string = process.cwd()): Promise<number> => {
  try {
    const server = createMPSentinelMCPServer(projectRoot);
    const transport = new StdioServerTransport();
    process.stderr.write("mp-sentinel MCP server starting (stdio)\n");
    await server.connect(transport);
    return 0;
  } catch (err) {
    process.stderr.write(
      `mp-sentinel MCP server error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
  }
};
