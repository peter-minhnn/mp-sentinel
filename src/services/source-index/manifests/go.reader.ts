/**
 * Go ecosystem manifest reader.
 *
 * Parses go.mod to extract module name, Go version, and dependencies.
 * go.mod uses a simple line-based format (not TOML/YAML/JSON).
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { log } from "../../../utils/logger.js";
import type { ManifestReader } from "./types.js";
import type { ProjectManifest } from "../../../types/index.js";

// ── Detection ─────────────────────────────────────────────────────────────

function detectGoProject(cwd: string): boolean {
  return existsSync(resolve(cwd, "go.mod"));
}

// ── go.mod parser ─────────────────────────────────────────────────────────

interface GoMod {
  moduleName: string | undefined;
  goVersion: string | undefined;
  dependencies: Record<string, string>;
}

function parseGoMod(content: string): GoMod {
  const result: GoMod = {
    moduleName: undefined,
    goVersion: undefined,
    dependencies: {},
  };

  let inRequireBlock = false;

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();

    // Skip comments and empty lines
    if (line === "" || line.startsWith("//")) continue;

    // Module declaration: module <path>
    const moduleMatch = line.match(/^module\s+(\S+)/);
    if (moduleMatch && moduleMatch[1]) {
      result.moduleName = moduleMatch[1];
      continue;
    }

    // Go version: go <version>
    const goMatch = line.match(/^go\s+(\S+)/);
    if (goMatch && goMatch[1]) {
      result.goVersion = goMatch[1];
      continue;
    }

    // require block: require ( ... )
    if (line.startsWith("require (")) {
      inRequireBlock = true;
      continue;
    }
    if (line.startsWith(")")) {
      inRequireBlock = false;
      continue;
    }

    // Inline require: require <path> <version>
    const inlineReq = line.match(/^require\s+(\S+)\s+(\S+)/);
    if (inlineReq && inlineReq[1] && inlineReq[2]) {
      result.dependencies[inlineReq[1]] = inlineReq[2];
      continue;
    }

    // Inside require block: <path> <version>
    if (inRequireBlock) {
      const blockReq = line.match(/^(\S+)\s+(\S+)/);
      if (blockReq && blockReq[1] && blockReq[2]) {
        // Filter out indirect deps
        if (!line.includes("// indirect")) {
          result.dependencies[blockReq[1]] = blockReq[2];
        }
      }
    }
  }

  return result;
}

// ── Reader implementation ─────────────────────────────────────────────────

export const goReader: ManifestReader = {
  id: "go",

  detect(cwd: string): boolean {
    return detectGoProject(cwd);
  },

  async read(cwd: string): Promise<ProjectManifest> {
    let goModData: GoMod = {
      moduleName: undefined,
      goVersion: undefined,
      dependencies: {},
    };

    const goModPath = resolve(cwd, "go.mod");
    try {
      const content = await readFile(goModPath, "utf-8");
      goModData = parseGoMod(content);
    } catch (error) {
      log.warning(
        `Failed to read go.mod: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const frameworks: string[] = [];
    // Detect popular Go frameworks from deps
    const allDeps = goModData.dependencies;
    if (allDeps["github.com/gin-gonic/gin"]) frameworks.push("gin");
    if (allDeps["github.com/labstack/echo"]) frameworks.push("echo");
    if (allDeps["github.com/gofiber/fiber"]) frameworks.push("fiber");
    if (allDeps["github.com/gorilla/mux"]) frameworks.push("gorilla-mux");
    if (allDeps["github.com/urfave/cli"]) frameworks.push("cli");
    if (allDeps["github.com/spf13/cobra"]) frameworks.push("cobra");

    return {
      packageName: goModData.moduleName,
      packageVersion: goModData.goVersion,
      ecosystem: "go",
      packageManager: "go-mod",
      dependencies: goModData.dependencies,
      devDependencies: {},
      scripts: {},
      detectedFrameworks: frameworks,
    };
  },
};
