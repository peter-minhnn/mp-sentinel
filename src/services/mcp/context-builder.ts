/**
 * Format MCP tool call results into a prompt section.
 * Results are labeled with server/tool attribution and truncated to fit the budget.
 * Total output will never exceed maxContextChars.
 */

import type { MCPCallResult } from "./client.js";

const TRUNCATION_MARKER = "\n... (truncated)";

export const buildMCPContextString = (
  results: MCPCallResult[],
  maxContextChars: number,
): string => {
  if (results.length === 0) return "";

  const sections: string[] = [];
  let chars = 0;

  for (const r of results) {
    const header = `[${r.serverId}/${r.tool}]\n`;
    const available = maxContextChars - chars;

    // Can't fit even the header — stop here
    if (available <= header.length) break;

    const bodyAvailable = available - header.length;
    let body: string;
    if (r.result.length > bodyAvailable) {
      const markerLen = TRUNCATION_MARKER.length;
      if (bodyAvailable > markerLen) {
        body = r.result.slice(0, bodyAvailable - markerLen) + TRUNCATION_MARKER;
      } else {
        body = r.result.slice(0, bodyAvailable);
      }
    } else {
      body = r.result;
    }

    sections.push(header + body);
    chars += header.length + body.length;

    // If we're at or over budget, stop adding sections
    if (chars >= maxContextChars) break;
  }

  if (sections.length === 0) return "";

  const joined = sections.join("\n\n");
  if (joined.length <= maxContextChars) return joined;

  // Strict budget enforcement: truncate to leave room for the marker
  return joined.slice(0, maxContextChars - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
};
