/**
 * Tests for provider-native structured output (Phase 2.5).
 *
 * Each provider's `generate()` is exercised with a `responseSchema` and
 * we inspect the outgoing request body (via `mockFetch`) to confirm the
 * schema is forwarded in the right provider-specific shape.
 */

import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { AnthropicProvider } from "../services/ai/providers/anthropic.provider.js";
import { OpenAIProvider } from "../services/ai/providers/openai.provider.js";
import { GrokProvider } from "../services/ai/providers/grok.provider.js";
import { OpenRouterProvider } from "../services/ai/providers/openrouter.provider.js";
import { AUDIT_RESPONSE_SCHEMA } from "../services/ai/audit-schema.js";

const mockFetch = jest.fn<typeof fetch>();
globalThis.fetch = mockFetch;

const jsonResponse = (body: unknown): Response => new Response(JSON.stringify(body));

const lastBody = (): Record<string, unknown> => {
  const call = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
  expect(call).toBeDefined();
  const init = call![1] as RequestInit;
  expect(typeof init.body).toBe("string");
  return JSON.parse(init.body as string) as Record<string, unknown>;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("OpenAI structured output (text.format.json_schema)", () => {
  it("attaches json_schema when responseSchema is passed", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ output_text: '{"status":"PASS"}', status: "completed" }),
    );
    const provider = new OpenAIProvider({
      provider: "openai",
      apiKey: "k",
      model: "gpt-5.2",
    });
    await provider.generate("s", "u", AUDIT_RESPONSE_SCHEMA);
    const body = lastBody();
    const text = body["text"] as { format?: Record<string, unknown> } | undefined;
    expect(text?.format).toBeDefined();
    expect(text?.format?.["type"]).toBe("json_schema");
    expect(text?.format?.["name"]).toBe(AUDIT_RESPONSE_SCHEMA.name);
  });

  it("omits the format block when no schema is passed", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ output_text: "{}", status: "completed" }));
    const provider = new OpenAIProvider({
      provider: "openai",
      apiKey: "k",
      model: "gpt-5.2",
    });
    await provider.generate("s", "u");
    const body = lastBody();
    expect(body["text"]).toBeUndefined();
  });
});

describe("Anthropic structured output (tool_use)", () => {
  it("attaches tools[] + tool_choice when responseSchema is passed", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        content: [
          {
            type: "tool_use",
            name: AUDIT_RESPONSE_SCHEMA.name,
            input: { status: "PASS", issues: [] },
          },
        ],
        stop_reason: "tool_use",
      }),
    );
    const provider = new AnthropicProvider({
      provider: "anthropic",
      apiKey: "k",
      model: "claude-sonnet-4-6",
    });
    const result = await provider.generate("s", "u", AUDIT_RESPONSE_SCHEMA);
    const body = lastBody();
    const tools = body["tools"] as Array<{ name: string; input_schema: unknown }> | undefined;
    expect(tools).toHaveLength(1);
    expect(tools?.[0]?.name).toBe(AUDIT_RESPONSE_SCHEMA.name);
    expect(body["tool_choice"]).toEqual({
      type: "tool",
      name: AUDIT_RESPONSE_SCHEMA.name,
    });
    // The tool_use block's input is serialized back to text so the
    // downstream parser keeps working.
    expect(JSON.parse(result.text)).toEqual({ status: "PASS", issues: [] });
  });

  it("does NOT attach tools when no schema is passed", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ content: [{ type: "text", text: "hello" }] }));
    const provider = new AnthropicProvider({
      provider: "anthropic",
      apiKey: "k",
      model: "claude-sonnet-4-6",
    });
    await provider.generate("s", "u");
    const body = lastBody();
    expect(body["tools"]).toBeUndefined();
    expect(body["tool_choice"]).toBeUndefined();
  });
});

describe("Grok structured output (response_format.json_schema)", () => {
  it("attaches response_format when responseSchema is passed", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
      }),
    );
    const provider = new GrokProvider({ provider: "grok", apiKey: "k", model: "grok-4" });
    await provider.generate("s", "u", AUDIT_RESPONSE_SCHEMA);
    const body = lastBody();
    const rf = body["response_format"] as
      | {
          type?: string;
          json_schema?: { name?: string };
        }
      | undefined;
    expect(rf?.type).toBe("json_schema");
    expect(rf?.json_schema?.name).toBe(AUDIT_RESPONSE_SCHEMA.name);
  });
});

describe("OpenRouter structured output (json_schema for OpenAI models only)", () => {
  it("attaches json_schema for openai/* models", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
      }),
    );
    const provider = new OpenRouterProvider({
      provider: "openrouter",
      apiKey: "k",
      model: "openai/gpt-5.2",
    });
    await provider.generate("s", "u", AUDIT_RESPONSE_SCHEMA);
    const body = lastBody();
    const rf = body["response_format"] as { type?: string } | undefined;
    expect(rf?.type).toBe("json_schema");
  });

  it("omits response_format for non-openai models even with schema", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
      }),
    );
    const provider = new OpenRouterProvider({
      provider: "openrouter",
      apiKey: "k",
      model: "anthropic/claude-sonnet-4-6",
    });
    await provider.generate("s", "u", AUDIT_RESPONSE_SCHEMA);
    const body = lastBody();
    expect(body["response_format"]).toBeUndefined();
  });
});

describe("AUDIT_RESPONSE_SCHEMA shape", () => {
  it("declares the audit rubric fields the parser expects", () => {
    expect(AUDIT_RESPONSE_SCHEMA.name).toBe("mp_sentinel_audit");
    const schema = AUDIT_RESPONSE_SCHEMA.schema as {
      properties: { status: { enum: string[] }; issues: { items: { properties: unknown } } };
    };
    expect(schema.properties.status.enum).toEqual(["PASS", "FAIL"]);
    expect(schema.properties.issues).toBeDefined();
  });
});
