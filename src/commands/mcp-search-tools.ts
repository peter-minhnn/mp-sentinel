/**
 * Compact agent-search MCP tools. Kept separate so mcp-server.ts does not grow.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { stringifyCompactJson } from "../services/source-index/json-output.js";
import { isSearchHitKind } from "../services/source-index/agent-search.js";
import { getIndexSearch, getFindFile } from "../services/mcp-server/search.js";
import { getTaskContext } from "../services/mcp-server/task-context.js";

function ok(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text" as const, text: stringifyCompactJson(value) }] };
}

function err(value: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  return { content: [{ type: "text" as const, text: stringifyCompactJson(value) }], isError: true };
}

export function registerAgentSearchTools(server: McpServer, projectRoot: string): void {
  server.tool(
    "mp_sentinel_index_search",
    "Compact unified index search for AI agents. Default kinds: symbol, file, import (no code snippets). Returns flat hits without pretty-print whitespace. Use kinds=['code'] for snippet hits.",
    {
      query: z.string().min(1).describe("Symbol, file path, or import to look up"),
      limit: z.number().int().min(1).max(50).optional().describe("Max hits (default 10, max 50)"),
      kinds: z
        .array(z.enum(["symbol", "file", "import", "code"]))
        .optional()
        .describe("Hit kinds to include. Default: symbol, file, import"),
    },
    async ({ query, limit, kinds }) => {
      try {
        const parsedKinds = kinds?.filter(isSearchHitKind);
        const result = await getIndexSearch(projectRoot, query, {
          ...(limit !== undefined ? { limit } : {}),
          ...(parsedKinds && parsedKinds.length > 0 ? { kinds: parsedKinds } : {}),
        });
        if (result.status === "error") return err(result);
        return ok(result);
      } catch (error) {
        return err({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  server.tool(
    "mp_sentinel_index_find_file",
    "Search the source index for file paths by relative path or basename. Compact JSON.",
    {
      query: z.string().min(1).describe("Path fragment or file basename"),
      limit: z.number().int().min(1).max(50).optional().describe("Max hits (default 10, max 50)"),
    },
    async ({ query, limit }) => {
      try {
        const result = await getFindFile(projectRoot, query, limit);
        if (result.status === "error") return err(result);
        return ok(result);
      } catch (error) {
        return err({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  server.tool(
    "mp_sentinel_task_context",
    "Build a short ranked file capsule from a natural-language prompt. Does not echo the prompt or include code snippets. Follow with mp_sentinel_agent_context on a chosen file. Does not compress the original conversation.",
    {
      prompt: z.string().min(1).describe("Task prompt (any language)"),
      maxFiles: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("Max files in the capsule (default 5, max 10)"),
      tokenBudget: z
        .number()
        .int()
        .min(100)
        .max(4000)
        .optional()
        .describe("Hard token budget for the JSON capsule (default 800)"),
    },
    async ({ prompt, maxFiles, tokenBudget }) => {
      try {
        const result = await getTaskContext(projectRoot, prompt, {
          ...(maxFiles !== undefined ? { maxFiles } : {}),
          ...(tokenBudget !== undefined ? { tokenBudget } : {}),
        });
        if (result.status === "error") return err(result);
        return ok(result);
      } catch (error) {
        return err({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );
}
