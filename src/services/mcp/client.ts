/**
 * MCP stdio client — spawns MCP servers, calls tools, normalizes results.
 * Lazy-loads @modelcontextprotocol/sdk to avoid import cost when MCP is disabled.
 * Never throws — all failures return empty results.
 */

import type { MCPServer, MCPCall, MCPConfig } from "../../types/index.js";
import { sanitizeEnv } from "./sanitizer.js";
import { log } from "../../utils/logger.js";
import { getToolVersion } from "../../utils/version.js";

/** Single result from an MCP tool call */
export interface MCPCallResult {
  serverId: string;
  tool: string;
  result: string;
  truncated: boolean;
}

// ── Typed interfaces for the MCP SDK (lazy-loaded) ─────────────────────────

interface MCPTransportLike {
  close(): Promise<void>;
}

interface MCPClientLike {
  connect(transport: MCPTransportLike): Promise<void>;
  close(): Promise<void>;
  callTool(params: {
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<{ content: unknown[] }>;
}

type MCPClientConstructor = new (
  info: { name: string; version: string },
  options: { capabilities: Record<string, never> },
) => MCPClientLike;

type MCPTransportConstructor = new (options: {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
}) => MCPTransportLike;

let ClientCtor: MCPClientConstructor | null = null;
let TransportCtor: MCPTransportConstructor | null = null;

const loadSDK = async (): Promise<void> => {
  if (ClientCtor && TransportCtor) return;
  const [clientMod, stdioMod] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/stdio.js"),
  ]);
  ClientCtor = (clientMod as { Client: MCPClientConstructor }).Client;
  TransportCtor = (stdioMod as { StdioClientTransport: MCPTransportConstructor })
    .StdioClientTransport;
};

// ── Content type guard ──────────────────────────────────────────────────────

interface TextContent {
  type: "text";
  text: string;
}

const isTextContent = (item: unknown): item is TextContent =>
  typeof item === "object" && item !== null && (item as TextContent).type === "text";

// ── Execute ─────────────────────────────────────────────────────────────────

/**
 * Connect to an MCP server via stdio transport and execute configured tool calls.
 * Returns an array of results (one per call) or an empty array on any failure.
 * Never throws — all failures are caught and logged as warnings.
 */
export const executeMCPServer = async (
  server: MCPServer,
  resolvedCalls: MCPCall[],
  config: MCPConfig,
  workingDir: string,
): Promise<MCPCallResult[]> => {
  try {
    await loadSDK();
  } catch (err) {
    log.warning(`MCP: Failed to load MCP SDK for server "${server.id}": ${(err as Error).message}`);
    return [];
  }

  const timeoutMs = config.timeoutMs ?? 3000;
  const maxChars = config.maxContextChars ?? 6000;
  const toolVersion = getToolVersion();

  let transport: MCPTransportLike | null = null;
  let client: MCPClientLike | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const safeEnv = sanitizeEnv(server.env ?? {});

    transport = new TransportCtor!({
      command: server.command,
      args: server.args,
      env: safeEnv,
      cwd: workingDir,
    });

    client = new ClientCtor!({ name: "mp-sentinel", version: toolVersion }, { capabilities: {} });

    const connectAndCall = async (): Promise<MCPCallResult[]> => {
      // client.connect() calls transport.start() internally — do NOT call transport.start() manually
      await client!.connect(transport!);

      const results: MCPCallResult[] = [];
      for (const call of resolvedCalls) {
        try {
          const result = await client!.callTool({
            name: call.tool,
            arguments: call.input,
          });

          const text = (result.content as unknown[])
            .filter(isTextContent)
            .map((c) => c.text)
            .join("\n");

          const perCallMax = call.maxChars ?? maxChars;
          const truncated = text.length > perCallMax;
          results.push({
            serverId: server.id,
            tool: call.tool,
            result: truncated ? text.slice(0, perCallMax) + "\n... (truncated)" : text,
            truncated,
          });
        } catch (err) {
          log.warning(
            `MCP: Tool "${call.tool}" on server "${server.id}" failed: ${(err as Error).message}`,
          );
        }
      }

      return results;
    };

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`MCP server "${server.id}" timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });

    const results = await Promise.race([connectAndCall(), timeoutPromise]);
    return results;
  } catch (err) {
    log.warning(`MCP: Server "${server.id}" failed: ${(err as Error).message}`);
    return [];
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    try {
      if (client) await client.close();
    } catch {
      // Best-effort cleanup
    }
    try {
      if (transport) await transport.close();
    } catch {
      // Best-effort cleanup
    }
  }
};
