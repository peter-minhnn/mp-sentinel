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
  // NOTE (OpenAI strict mode): the Responses API with `strict: true` requires
  // that EVERY key in `properties` is also listed in `required`. Fields that
  // are conceptually optional cannot simply be left out of `required`; instead
  // they must be made nullable via a `["<type>", "null"]` union (and `null`
  // added to any `enum`) so the model may emit `null` to mean "absent".
  // See: https://platform.openai.com/docs/guides/structured-outputs
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["status", "issues"],
    properties: {
      status: { type: "string", enum: ["PASS", "FAIL"] },
      issues: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "line",
            "severity",
            "message",
            "suggestion",
            "codeSuggestion",
            "category",
            "confidence",
            "evidence",
          ],
          properties: {
            line: { type: "integer", minimum: 1 },
            severity: { type: "string", enum: ["CRITICAL", "WARNING", "INFO"] },
            message: { type: "string" },
            // Optional fields — nullable so `strict` accepts their absence.
            suggestion: { type: ["string", "null"] },
            codeSuggestion: { type: ["string", "null"] },
            category: {
              type: ["string", "null"],
              enum: [
                "security",
                "runtime-crash",
                "architecture",
                "dependency-version",
                "test-gap",
                "performance",
                "maintainability",
                "refactor",
                null,
              ],
            },
            confidence: { type: ["string", "null"], enum: ["low", "medium", "high", null] },
            evidence: { type: ["string", "null"] },
          },
        },
      },
    },
  },
};
