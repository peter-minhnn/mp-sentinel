/**
 * Server-Sent Events (SSE) parser shared by streaming providers (Phase 3.2).
 *
 * Anthropic, OpenAI Responses API, Gemini, and Grok all stream their
 * responses as `text/event-stream` with the standard SSE framing:
 *
 *     event: <name>
 *     data: <json or text>
 *     data: <continuation>
 *
 *     event: <name>
 *     data: <json>
 *
 * Each blank line terminates an event. Each provider then layers its own
 * semantics on top — what event names matter, where the text deltas live
 * in the JSON, etc. This helper handles the wire-level framing only; the
 * provider's `generateStream` interprets the parsed events.
 */

export interface SseEvent {
  /** `event:` field, default empty string when absent. */
  event: string;
  /** Concatenation of `data:` lines for this event. */
  data: string;
}

/**
 * Parse a Response body whose `Content-Type` is `text/event-stream` into
 * a stream of `SseEvent` objects. The function performs no JSON parsing
 * — callers handle the JSON specific to their provider.
 *
 * Behavior:
 *   - Multiple `data:` lines in a single event are concatenated with `\n`
 *     between them (RFC 6202 / WHATWG EventSource).
 *   - Lines beginning with `:` are SSE comments and are skipped.
 *   - Unknown field names are ignored — `id:`, `retry:`, etc.
 *
 * The function is async-iterable; consumers `for await` on its result.
 */
export async function* parseSseStream(
  body: ReadableStream<Uint8Array> | null,
): AsyncIterable<SseEvent> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let pendingEvent = "";
  let pendingData: string[] = [];

  const flush = (): SseEvent | null => {
    if (pendingData.length === 0) {
      pendingEvent = "";
      return null;
    }
    const ev: SseEvent = { event: pendingEvent, data: pendingData.join("\n") };
    pendingEvent = "";
    pendingData = [];
    return ev;
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE separates events by a blank line (`\n\n` after CR normalization).
      // We split on `\n` and process each line; a blank line flushes.
      let newlineIdx = buffer.indexOf("\n");
      while (newlineIdx >= 0) {
        // Use slice + trimEnd to handle CRLF.
        const line = buffer.slice(0, newlineIdx).replace(/\r$/, "");
        buffer = buffer.slice(newlineIdx + 1);
        newlineIdx = buffer.indexOf("\n");

        if (line === "") {
          const ev = flush();
          if (ev) yield ev;
          continue;
        }
        if (line.startsWith(":")) continue; // comment

        const colonIdx = line.indexOf(":");
        const field = colonIdx === -1 ? line : line.slice(0, colonIdx);
        // Per spec, a single leading space after the colon is stripped.
        const rawValue = colonIdx === -1 ? "" : line.slice(colonIdx + 1);
        const value =
          rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;

        if (field === "event") {
          pendingEvent = value;
        } else if (field === "data") {
          pendingData.push(value);
        }
        // `id:` and `retry:` are accepted but unused here.
      }
    }
    // Decoder flush + tail event (some servers omit the trailing blank line).
    buffer += decoder.decode();
    if (buffer.length > 0) {
      // Best-effort: treat remaining buffer as the data of one final event.
      const tailLines = buffer.split("\n").map((l) => l.replace(/\r$/, ""));
      for (const line of tailLines) {
        if (line === "") {
          const ev = flush();
          if (ev) yield ev;
          continue;
        }
        if (line.startsWith(":")) continue;
        const colonIdx = line.indexOf(":");
        const field = colonIdx === -1 ? line : line.slice(0, colonIdx);
        const rawValue = colonIdx === -1 ? "" : line.slice(colonIdx + 1);
        const value =
          rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
        if (field === "event") pendingEvent = value;
        else if (field === "data") pendingData.push(value);
      }
    }
    const tail = flush();
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}
