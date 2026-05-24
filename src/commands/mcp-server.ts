/**
 * mp-sentinel MCP Server — stdio JSON-RPC entry point.
 *
 * Exports a factory for testability and a command wrapper for the CLI.
 * All tools are read-only: index health, agent context, explain context,
 * symbol/import search, explain-file, stats, and parser drilldowns.
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
  getAgentsExplain,
  getSkillsDoctorHandler,
  getSkillsCheckHandler,
  getReviewScopeHandler,
  getReviewDeterministicHandler,
  getReviewFilterFilesHandler,
} from "../services/mcp-server/service.js";

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
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
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
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
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
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
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
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
            isError: true,
          };
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
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
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
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
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
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
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
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

  // ── Tool 10: Agents Explain ─────────────────────────────────────────

  server.tool(
    "mp_sentinel_agents_explain",
    "Show which agent/IDE adapters are detected and why (matching create-skills --explain-agents).",
    {},
    async () => {
      try {
        const result = await getAgentsExplain(projectRoot);
        if (result.error) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
            isError: true,
          };
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── Tool 11: Skills Doctor ──────────────────────────────────────────

  server.tool(
    "mp_sentinel_skills_doctor",
    "Comprehensive agent/skill health check (matching create-skills --doctor). Read-only, no file writes.",
    {
      agents: z
        .array(z.enum(["claude", "cursor", "codex", "windsurf", "antigravity", "cline", "generic"]))
        .optional()
        .describe("Agent adapter ids"),
      allAgents: z.boolean().optional().describe("Check all non-generic agents"),
    },
    async ({ agents, allAgents }) => {
      if (agents && allAgents) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "error",
                message: "'agents' and 'allAgents' cannot be used together",
              }),
            },
          ],
          isError: true,
        };
      }
      try {
        const result = await getSkillsDoctorHandler(projectRoot, {
          ...(agents ? { agents } : {}),
          ...(allAgents !== undefined ? { allAgents } : {}),
        });
        if (result.status === "error") {
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
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

  // ── Tool 12: Skills Check ───────────────────────────────────────────

  server.tool(
    "mp_sentinel_skills_check",
    "Verify generated skill freshness and quality (matching create-skills --check). Missing index is an error.",
    {
      agents: z
        .array(z.enum(["claude", "cursor", "codex", "windsurf", "antigravity", "cline", "generic"]))
        .optional()
        .describe("Agent adapter ids"),
      allAgents: z.boolean().optional().describe("Check all non-generic agents"),
    },
    async ({ agents, allAgents }) => {
      if (agents && allAgents) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "'agents' and 'allAgents' cannot be used together" }),
            },
          ],
          isError: true,
        };
      }
      try {
        const result = await getSkillsCheckHandler(projectRoot, {
          ...(agents ? { agents } : {}),
          ...(allAgents !== undefined ? { allAgents } : {}),
        });
        if (result.error) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
            isError: true,
          };
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── Tool 13: Review Scope ──────────────────────────────────────────

  server.tool(
    "mp_sentinel_review_scope",
    "Resolve review target, filter files, and return diff metadata without raw patch content.",
    {
      target: z
        .object({
          mode: z.enum(["staged", "range", "commit", "files"]),
          value: z.string().optional(),
          files: z.array(z.string()).optional(),
        })
        .optional(),
      guardrails: z
        .object({
          maxFiles: z.number().int().min(1).optional(),
          maxDiffLines: z.number().int().min(100).optional(),
          maxCharsPerFile: z.number().int().min(1000).optional(),
          contextLines: z.number().int().min(0).optional(),
          tokenLimit: z.number().int().min(1).optional(),
        })
        .optional(),
    },
    async ({ target, guardrails }) => {
      try {
        const result = await getReviewScopeHandler(
          projectRoot,
          target as Record<string, unknown> | undefined,
          guardrails as Record<string, unknown> | undefined,
        );
        if (result.error) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
            isError: true,
          };
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── Tool 14: Review Deterministic ──────────────────────────────────

  server.tool(
    "mp_sentinel_review_deterministic",
    "Run non-AI review: risk analysis, secret redaction, token estimation. No AI calls.",
    {
      target: z
        .object({
          mode: z.enum(["staged", "range", "commit", "files"]),
          value: z.string().optional(),
          files: z.array(z.string()).optional(),
        })
        .optional(),
      guardrails: z
        .object({
          maxFiles: z.number().int().min(1).optional(),
          maxDiffLines: z.number().int().min(100).optional(),
          maxCharsPerFile: z.number().int().min(1000).optional(),
          contextLines: z.number().int().min(0).optional(),
          tokenLimit: z.number().int().min(1).optional(),
        })
        .optional(),
    },
    async ({ target, guardrails }) => {
      try {
        const result = await getReviewDeterministicHandler(
          projectRoot,
          target as Record<string, unknown> | undefined,
          guardrails as Record<string, unknown> | undefined,
        );
        if (result.error) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
            isError: true,
          };
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── Tool 15: Filter Files ──────────────────────────────────────────

  server.tool(
    "mp_sentinel_review_filter_files",
    "Run explicit file paths through review file filtering. Returns accepted/rejected paths with reasons.",
    {
      files: z.array(z.string().min(1)).describe("File paths to filter"),
    },
    async ({ files }) => {
      try {
        const result = await getReviewFilterFilesHandler(projectRoot, files);
        if (result.error) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
            isError: true,
          };
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
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
