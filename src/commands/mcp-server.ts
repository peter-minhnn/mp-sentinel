/**
 * mp-sentinel MCP Server — stdio JSON-RPC entry point.
 *
 * Exports a factory for testability and a command wrapper for the CLI.
 * All tools are read-only: index health, agent context, explain context,
 * compact search / find-file / task-context, symbol/import search, explain-file, stats, and parser drilldowns.
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
  getFindSymbol,
  getFindImport,
  getFindCode,
  getExplainFile,
  getIndexStats,
  getRecoveredFiles,
  getParseErrors,
} from "../services/mcp-server/service.js";
import { stringifyCompactJson } from "../services/source-index/json-output.js";
import { registerAgentSearchTools } from "./mcp-search-tools.js";
import { registerReviewAndSkillsTools } from "./mcp-review-tools.js";

/**
 * Create a configured McpServer with all read-only tools registered.
 * The server is NOT connected to any transport — caller must call
 * server.connect(transport) to start serving.
 */
export const createMPSentinelMCPServer = (projectRoot: string): McpServer => {
  const toolVersion = getToolVersion();
  const server = new McpServer(
    { name: "mp-sentinel", version: toolVersion },
    { capabilities: { tools: {} } },
  );

  registerAgentSearchTools(server, projectRoot);

  // ── Tool 1: Index Health ─────────────────────────────────────────────

  server.tool(
    "mp_sentinel_index_health",
    "Read-only source index health check. Reports cache status, schema version, and file count. Never builds or refreshes the index.",
    {},
    async () => {
      try {
        const health = await getIndexHealth(projectRoot);
        return { content: [{ type: "text" as const, text: stringifyCompactJson(health) }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: stringifyCompactJson({
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
    "Get compact agent context for a specific file: symbols, imports, exports, dependents, hub files, and call edges, packed under a hard token budget (default 1200). Pass `focus` anchors from the task to rank the evidence that matters first. No suggested commands, no code snippets.",
    {
      file: z.string().describe("Path to the file relative to project root"),
      focus: z
        .array(z.string())
        .optional()
        .describe(
          "Up to 6 task anchors (symbol, import source, path) ranked into the capsule first",
        ),
      tokenBudget: z
        .number()
        .int()
        .optional()
        .describe("Hard token budget for the emitted JSON (default 1200, min 100, max 4000)"),
    },
    async ({ file, focus, tokenBudget }) => {
      try {
        const result = await getAgentContext(projectRoot, file, {
          ...(focus !== undefined ? { focus } : {}),
          ...(tokenBudget !== undefined ? { tokenBudget } : {}),
        });
        if (result.error) {
          return {
            content: [
              {
                type: "text" as const,
                text: stringifyCompactJson(result),
              },
            ],
            isError: true,
          };
        }
        return { content: [{ type: "text" as const, text: stringifyCompactJson(result) }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: stringifyCompactJson({
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
        return { content: [{ type: "text" as const, text: stringifyCompactJson(result) }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: stringifyCompactJson({
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

  // ── Tool 4: Find Symbol ────────────────────────────────────────────

  server.tool(
    "mp_sentinel_index_find_symbol",
    "Search source index for symbols (functions, classes, interfaces, etc.) matching a query.",
    {
      query: z.string().min(1).describe("Symbol name or partial name to search for"),
    },
    async ({ query }) => {
      try {
        const result = await getFindSymbol(projectRoot, query);
        if (result.status === "error") {
          return {
            content: [{ type: "text" as const, text: stringifyCompactJson(result) }],
            isError: true,
          };
        }
        return { content: [{ type: "text" as const, text: stringifyCompactJson(result) }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: stringifyCompactJson({
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

  // ── Tool 5: Find Import ────────────────────────────────────────────

  server.tool(
    "mp_sentinel_index_find_import",
    "Search source index for files importing a package or path.",
    {
      query: z.string().min(1).describe("Package name or import path to search for"),
    },
    async ({ query }) => {
      try {
        const result = await getFindImport(projectRoot, query);
        if (result.status === "error") {
          return {
            content: [{ type: "text" as const, text: stringifyCompactJson(result) }],
            isError: true,
          };
        }
        return { content: [{ type: "text" as const, text: stringifyCompactJson(result) }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: stringifyCompactJson({
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

  // ── Tool 6: Find Code ──────────────────────────────────────────────

  server.tool(
    "mp_sentinel_index_find_code",
    "Search source index for code snippets matching a text query.",
    {
      query: z.string().min(1).describe("Code text or partial text to search for"),
    },
    async ({ query }) => {
      try {
        const result = await getFindCode(projectRoot, query);
        if (result.status === "error") {
          return {
            content: [{ type: "text" as const, text: stringifyCompactJson(result) }],
            isError: true,
          };
        }
        return { content: [{ type: "text" as const, text: stringifyCompactJson(result) }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: stringifyCompactJson({
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

  // ── Tool 7: Explain File ───────────────────────────────────────────

  server.tool(
    "mp_sentinel_index_explain_file",
    "Get dependency info for a specific file: symbols, imports, exports, resolved/unresolved/external imports, parser telemetry.",
    {
      file: z.string().min(1).describe("Path to the file relative to project root"),
    },
    async ({ file }) => {
      try {
        const result = await getExplainFile(projectRoot, file);
        if (result.error) {
          return {
            content: [{ type: "text" as const, text: stringifyCompactJson(result) }],
            isError: true,
          };
        }
        return { content: [{ type: "text" as const, text: stringifyCompactJson(result) }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: stringifyCompactJson({
                error: err instanceof Error ? err.message : String(err),
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── Tool 7: Index Stats ────────────────────────────────────────────

  server.tool(
    "mp_sentinel_index_stats",
    "Source-index statistics: file counts, parser mode breakdown, chunk telemetry, insights, import edges. Never builds or refreshes the index.",
    {},
    async () => {
      try {
        const result = await getIndexStats(projectRoot);
        if (result.status === "error") {
          return {
            content: [{ type: "text" as const, text: stringifyCompactJson(result) }],
            isError: true,
          };
        }
        return { content: [{ type: "text" as const, text: stringifyCompactJson(result) }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: stringifyCompactJson({
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

  // ── Tool 8: Recovered Files ────────────────────────────────────────

  server.tool(
    "mp_sentinel_index_recovered_files",
    "List files parsed via fallback parser (chunked-tree-sitter, ascii-fallback, or lexical-fallback).",
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max files to return (default 50, max 100)"),
    },
    async ({ limit }) => {
      try {
        const result = await getRecoveredFiles(projectRoot, limit);
        if (result.status === "error") {
          return {
            content: [{ type: "text" as const, text: stringifyCompactJson(result) }],
            isError: true,
          };
        }
        return { content: [{ type: "text" as const, text: stringifyCompactJson(result) }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: stringifyCompactJson({
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

  // ── Tool 9: Parse Errors ───────────────────────────────────────────

  server.tool(
    "mp_sentinel_index_parse_errors",
    "List files with hard parse errors.",
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Max files to return (default 50, max 100)"),
    },
    async ({ limit }) => {
      try {
        const result = await getParseErrors(projectRoot, limit);
        if (result.status === "error") {
          return {
            content: [{ type: "text" as const, text: stringifyCompactJson(result) }],
            isError: true,
          };
        }
        return { content: [{ type: "text" as const, text: stringifyCompactJson(result) }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: stringifyCompactJson({
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

  registerReviewAndSkillsTools(server, projectRoot);

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
