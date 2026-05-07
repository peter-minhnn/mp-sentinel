/**
 * MCP diagnostics — read-only checks for MCP configuration health.
 * Never spawns MCP servers. Only checks command availability and env vars.
 * Uses node:fs + node:path instead of shell exec to stay shell-free.
 */

import { accessSync, constants } from "node:fs";
import { join, delimiter } from "node:path";
import type { MCPConfig, MCPDiagnostics, MCPDiagnosticServer } from "../../types/index.js";
import { expandPresets } from "./presets.js";

/**
 * Check whether a command exists on PATH without spawning a shell.
 * Uses PATH/PATHEXT resolution via node:fs and node:path only.
 */
const commandExistsOnPath = (command: string): boolean => {
  const pathEnv = process.env.PATH ?? "";
  const pathDirs = pathEnv.split(delimiter).filter(Boolean);

  if (process.platform === "win32") {
    // Windows: check PATH + PATHEXT for each executable extension
    const pathext = (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").toUpperCase();
    const extList = pathext.split(";").filter(Boolean);
    for (const dir of pathDirs) {
      for (const ext of extList) {
        try {
          accessSync(join(dir, command + ext), constants.X_OK);
          return true;
        } catch {
          // continue
        }
      }
      // Also try bare command name
      try {
        accessSync(join(dir, command), constants.X_OK);
        return true;
      } catch {
        // continue
      }
    }
  } else {
    // Unix: check each PATH directory for an executable file
    for (const dir of pathDirs) {
      try {
        accessSync(join(dir, command), constants.X_OK);
        return true;
      } catch {
        // continue
      }
    }
  }

  return false;
};

const checkEnvVars = (envMapping: Record<string, string> | undefined): string[] | undefined => {
  if (!envMapping) return undefined;
  const missing: string[] = [];
  for (const parentVar of Object.values(envMapping)) {
    if (!process.env[parentVar]) {
      missing.push(parentVar);
    }
  }
  return missing.length > 0 ? missing : undefined;
};

export const generateMCPDiagnostics = (config: MCPConfig): MCPDiagnostics => {
  if (!config.enabled) {
    return {
      enabled: false,
      serverCount: 0,
      servers: [],
    };
  }

  // Expand presets and combine with explicit servers, tracking source
  const presets = config.presets ?? [];
  const presetExpansion = presets.length > 0 ? expandPresets(presets) : { servers: [] };
  type AnnotatedServer = (typeof presetExpansion.servers)[number] & {
    source: "preset" | "explicit";
  };
  const annotated: AnnotatedServer[] = [
    ...presetExpansion.servers.map((s) => ({ ...s, source: "preset" as const })),
    ...(config.servers ?? []).map((s) => ({ ...s, source: "explicit" as const })),
  ];

  const servers: MCPDiagnosticServer[] = annotated.map((server) => {
    const exists = commandExistsOnPath(server.command);
    const missingVars = checkEnvVars(server.env);

    let status: MCPDiagnosticServer["status"];
    if (!exists) {
      status = "missing_command";
    } else if (missingVars && missingVars.length > 0) {
      status = "missing_env";
    } else {
      status = "ready";
    }

    const base: MCPDiagnosticServer = {
      id: server.id,
      command: `${server.command} ${server.args.join(" ")}`.trim(),
      status,
      toolCount: server.calls.length,
      source: server.source,
    };

    if (missingVars) {
      base.missingVars = missingVars;
    }

    // Build recommended actions
    const actions: string[] = [];
    if (!exists) {
      actions.push(`Install "${server.command}" or adjust PATH so the command is available.`);
    }
    if (missingVars) {
      for (const v of missingVars) {
        actions.push(`Set the "${v}" environment variable.`);
      }
    }
    if (actions.length > 0) {
      base.recommendedActions = actions;
    }

    return base;
  });

  return {
    enabled: true,
    serverCount: servers.length,
    servers,
    cacheSettings: {
      enabled: config.cacheEnabled !== false,
      ttlMs: config.cacheTtlMs ?? 3_600_000,
    },
  };
};
