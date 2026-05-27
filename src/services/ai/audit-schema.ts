/**
 * Shared JSON Schema for the audit response (Phase 2.5).
 *
 * Mirrors the rubric documented in `src/config/prompts.ts` so providers
 * that support structured output (OpenAI's json_schema, Gemini's
 * responseSchema, Anthropic's tool_use) can constrain the model to emit
 * a directly-parseable object.
 *
 * Providers that don't support structured output ignore this schema and
 * the model's text output is parsed via the existing defensive parser
 * (`utils/parser.ts#parseAuditResponse`).
 */

import type { AIResponseSchema } from "./types.js";

export const AUDIT_RESPONSE_SCHEMA: AIResponseSchema = {
  name: "mp_sentinel_audit",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["status"],
    properties: {
      status: { type: "string", enum: ["PASS", "FAIL"] },
      issues: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["line", "severity", "message"],
          properties: {
            line: { type: "integer", minimum: 1 },
            severity: { type: "string", enum: ["CRITICAL", "WARNING", "INFO"] },
            message: { type: "string" },
            suggestion: { type: "string" },
            category: {
              type: "string",
              enum: [
                "security",
                "runtime-crash",
                "architecture",
                "dependency-version",
                "test-gap",
                "performance",
                "maintainability",
              ],
            },
            confidence: { type: "string", enum: ["low", "medium", "high"] },
            evidence: { type: "string" },
          },
        },
      },
    },
  },
};
