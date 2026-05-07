/**
 * Format MCP tool call results into a prompt section.
 * Results are labeled with server/tool attribution and truncated to fit the budget.
 * Total output will never exceed maxContextChars.
 */

import type { MCPCallResult } from "./client.js";

export const TRUNCATION_MARKER = "\n... (truncated)";

/**
 * Build the MCP context string and report whether budget-based truncation occurred.
 * Tracks three truncation signals internally:
 *   - Body clipped when an individual result exceeded available budget space
 *   - Results omitted when a later result's header could not fit
 *   - Final strict clamp when joined output exceeded the budget
 *
 * Per-call truncation (set by executeMCPServer via call.maxChars) is NOT tracked
 * here — the caller combines this with allResults.some(r => r.truncated).
 */
export const buildMCPContextResult = (
  results: MCPCallResult[],
  maxContextChars: number,
): { context: string; truncated: boolean } => {
  if (results.length === 0) return { context: "", truncated: false };

  const sections: string[] = [];
  let chars = 0;
  let formatterTruncated = false;

  for (const r of results) {
    const header = `[${r.serverId}/${r.tool}]\n`;
    const available = maxContextChars - chars;

    // Can't fit even the header — remaining results omitted
    if (available <= header.length) {
      formatterTruncated = true;
      break;
    }

    const bodyAvailable = available - header.length;
    let body: string;
    if (r.result.length > bodyAvailable) {
      // Body clipped by budget — formatter-level truncation
      const markerLen = TRUNCATION_MARKER.length;
      if (bodyAvailable > markerLen) {
        body = r.result.slice(0, bodyAvailable - markerLen) + TRUNCATION_MARKER;
      } else {
        body = r.result.slice(0, bodyAvailable);
      }
      formatterTruncated = true;
    } else {
      body = r.result;
    }

    sections.push(header + body);
    chars += header.length + body.length;

    // Budget exhausted — remaining results omitted
    if (chars >= maxContextChars) {
      if (sections.length < results.length) {
        formatterTruncated = true;
      }
      break;
    }
  }

  if (sections.length === 0) return { context: "", truncated: true };

  const joined = sections.join("\n\n");
  if (joined.length <= maxContextChars) {
    return { context: joined, truncated: formatterTruncated };
  }

  // Final strict clamp
  return {
    context: joined.slice(0, maxContextChars - TRUNCATION_MARKER.length) + TRUNCATION_MARKER,
    truncated: true,
  };
};

/** Backward-compatible wrapper: returns only the context string. */
export const buildMCPContextString = (results: MCPCallResult[], maxContextChars: number): string =>
  buildMCPContextResult(results, maxContextChars).context;
