/**
 * Tests for Phase 3.2 — provider streaming + assembly helpers.
 */

import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { AnthropicProvider } from "../services/ai/providers/anthropic.provider.js";
import { assembleStream, callGenerateStream } from "../services/ai/usage.js";
import { parseSseStream } from "../services/ai/sse.js";
import type { AIStreamChunk, IAIProvider } from "../services/ai/types.js";

const mockFetch = jest.fn<typeof fetch>();
globalThis.fetch = mockFetch;

beforeEach(() => {
  jest.clearAllMocks();
});

/** Build a ReadableStream<Uint8Array> from a string for SSE tests. */
const sseBody = (text: string): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
};

const collectChunks = async (
  iter: AsyncIterable<AIStreamChunk>,
): Promise<AIStreamChunk[]> => {
  const out: AIStreamChunk[] = [];
  for await (const c of iter) out.push(c);
  return out;
};

// ── SSE parser ─────────────────────────────────────────────────────────────

describe("parseSseStream", () => {
  it("yields one event per blank-line-terminated block", async () => {
    const body = sseBody("event: foo\ndata: bar\n\nevent: baz\ndata: qux\n\n");
    const events = [];
    for await (const ev of parseSseStream(body)) events.push(ev);
    expect(events).toEqual([
      { event: "foo", data: "bar" },
      { event: "baz", data: "qux" },
    ]);
  });

  it("concatenates multiple data: lines with \\n", async () => {
    const body = sseBody("event: x\ndata: line1\ndata: line2\n\n");
    const events = [];
    for await (const ev of parseSseStream(body)) events.push(ev);
    expect(events).toEqual([{ event: "x", data: "line1\nline2" }]);
  });

  it("skips comments and unknown fields", async () => {
    const body = sseBody(": ping\nid: 1\nretry: 5\nevent: x\ndata: y\n\n");
    const events = [];
    for await (const ev of parseSseStream(body)) events.push(ev);
    expect(events).toEqual([{ event: "x", data: "y" }]);
  });

  it("handles a null body gracefully", async () => {
    const out = [];
    for await (const ev of parseSseStream(null)) out.push(ev);
    expect(out).toEqual([]);
  });
});

// ── Anthropic streaming ────────────────────────────────────────────────────

describe("AnthropicProvider.generateStream", () => {
  it("yields text deltas and a terminal chunk with usage", async () => {
    const sse =
      `event: message_start\ndata: ${JSON.stringify({
        type: "message_start",
        message: { usage: { input_tokens: 100 } },
      })}\n\n` +
      `event: content_block_delta\ndata: ${JSON.stringify({
        type: "content_block_delta",
        delta: { type: "text_delta", text: "Hello " },
      })}\n\n` +
      `event: content_block_delta\ndata: ${JSON.stringify({
        type: "content_block_delta",
        delta: { type: "text_delta", text: "world." },
      })}\n\n` +
      `event: message_delta\ndata: ${JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 5 },
      })}\n\n` +
      `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`;

    mockFetch.mockResolvedValueOnce(
      new Response(sseBody(sse), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );

    const provider = new AnthropicProvider({
      provider: "anthropic",
      apiKey: "k",
      model: "claude-sonnet-4-6",
    });
    const chunks = await collectChunks(provider.generateStream("s", "u"));
    // Two text deltas + one terminal chunk
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual({ deltaText: "Hello ", done: false });
    expect(chunks[1]).toEqual({ deltaText: "world.", done: false });
    expect(chunks[2]?.done).toBe(true);
    expect(chunks[2]?.usage).toEqual({ inputTokens: 100, outputTokens: 5 });
    expect(chunks[2]?.finishReason).toBe("stop");
  });

  it("collects tool_use input_json_delta into the terminal chunk", async () => {
    const sse =
      `event: content_block_delta\ndata: ${JSON.stringify({
        type: "content_block_delta",
        delta: { type: "input_json_delta", partial_json: '{"status":' },
      })}\n\n` +
      `event: content_block_delta\ndata: ${JSON.stringify({
        type: "content_block_delta",
        delta: { type: "input_json_delta", partial_json: '"PASS"}' },
      })}\n\n` +
      `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`;

    mockFetch.mockResolvedValueOnce(
      new Response(sseBody(sse), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );

    const provider = new AnthropicProvider({
      provider: "anthropic",
      apiKey: "k",
      model: "claude-sonnet-4-6",
    });
    const chunks = await collectChunks(
      provider.generateStream("s", "u", {
        name: "mp_sentinel_audit",
        schema: { type: "object" },
      }),
    );
    // No text_delta events fired, so only the terminal chunk carries data.
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.deltaText).toBe('{"status":"PASS"}');
    expect(chunks[0]?.done).toBe(true);
  });

  it("throws on non-OK HTTP status", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("nope", { status: 401, statusText: "Unauthorized" }),
    );
    const provider = new AnthropicProvider({
      provider: "anthropic",
      apiKey: "k",
      model: "claude-sonnet-4-6",
    });
    await expect(
      (async () => {
        for await (const _ of provider.generateStream("s", "u")) {
          /* drain */
        }
      })(),
    ).rejects.toThrow(/Anthropic streaming error: 401/);
  });
});

// ── OpenAI streaming ───────────────────────────────────────────────────────

describe("OpenAIProvider.generateStream", () => {
  it("yields text deltas and a terminal chunk with usage", async () => {
    const sse =
      `event: response.output_text.delta\ndata: ${JSON.stringify({
        type: "response.output_text.delta",
        delta: "Hello ",
      })}\n\n` +
      `event: response.output_text.delta\ndata: ${JSON.stringify({
        type: "response.output_text.delta",
        delta: "world.",
      })}\n\n` +
      `event: response.completed\ndata: ${JSON.stringify({
        type: "response.completed",
        response: { status: "completed", usage: { input_tokens: 12, output_tokens: 4 } },
      })}\n\n`;

    // Lazy import so the dynamic require doesn't poison earlier tests.
    const { OpenAIProvider } = await import("../services/ai/providers/openai.provider.js");
    mockFetch.mockResolvedValueOnce(
      new Response(sseBody(sse), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
    const provider = new OpenAIProvider({
      provider: "openai",
      apiKey: "k",
      model: "gpt-5.2",
    });
    const chunks = await collectChunks(provider.generateStream("s", "u"));
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual({ deltaText: "Hello ", done: false });
    expect(chunks[1]).toEqual({ deltaText: "world.", done: false });
    expect(chunks[2]?.done).toBe(true);
    expect(chunks[2]?.usage).toEqual({ inputTokens: 12, outputTokens: 4 });
    expect(chunks[2]?.finishReason).toBe("stop");
  });
});

// ── callGenerateStream fallback ────────────────────────────────────────────

describe("callGenerateStream", () => {
  it("uses generateStream when available", async () => {
    const fakeChunks: AIStreamChunk[] = [
      { deltaText: "a", done: false },
      { deltaText: "b", done: true, usage: { inputTokens: 1, outputTokens: 2 } },
    ];
    const provider: IAIProvider = {
      generateContent: jest.fn(async () => "ab"),
      generateStream: async function* () {
        for (const c of fakeChunks) yield c;
      },
      isAvailable: () => true,
    };
    const out = await collectChunks(callGenerateStream(provider, "s", "u"));
    expect(out).toEqual(fakeChunks);
  });

  it("falls back to generate() and emits one terminal chunk", async () => {
    const provider: IAIProvider = {
      generateContent: jest.fn(async () => "fallback text"),
      generate: jest.fn(async () => ({
        text: "fallback text",
        usage: { inputTokens: 10, outputTokens: 5 },
      })),
      isAvailable: () => true,
    };
    const out = await collectChunks(callGenerateStream(provider, "s", "u"));
    expect(out).toHaveLength(1);
    expect(out[0]?.done).toBe(true);
    expect(out[0]?.deltaText).toBe("fallback text");
    expect(out[0]?.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });
});

// ── assembleStream ─────────────────────────────────────────────────────────

describe("assembleStream", () => {
  it("concatenates all deltaText and returns the terminal usage/finishReason", async () => {
    const chunks: AIStreamChunk[] = [
      { deltaText: "hello ", done: false },
      { deltaText: "world", done: false },
      {
        deltaText: "",
        done: true,
        usage: { inputTokens: 7, outputTokens: 3 },
        finishReason: "stop",
      },
    ];
    const iter = (async function* () {
      for (const c of chunks) yield c;
    })();
    const onDelta = jest.fn();
    const result = await assembleStream(iter, onDelta);
    expect(result.text).toBe("hello world");
    expect(result.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
    expect(result.finishReason).toBe("stop");
    expect(onDelta).toHaveBeenCalledTimes(2);
  });
});
