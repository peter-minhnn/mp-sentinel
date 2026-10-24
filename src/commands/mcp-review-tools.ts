/**
 * MCP tool registrations for agent diagnostics, skills health, and review
 * previews. Split out of `mcp-server.ts` to keep that entry point small;
 * every handler stays read-only (no AI calls, no mutations).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getAgentsExplain,
  getSkillsDoctorHandler,
  getSkillsCheckHandler,
  getReviewScopeHandler,
  getReviewDeterministicHandler,
  getReviewFilterFilesHandler,
} from "../services/mcp-server/service.js";
import { stringifyCompactJson } from "../services/source-index/json-output.js";

/** Register agents-explain, skills doctor/check, and the review preview tools. */
export const registerReviewAndSkillsTools = (server: McpServer, projectRoot: string): void => {
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
              text: stringifyCompactJson({
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
              text: stringifyCompactJson({
                error: "'agents' and 'allAgents' cannot be used together",
              }),
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
};
