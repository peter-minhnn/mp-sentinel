/**
 * Rust ecosystem manifest reader.
 *
 * Parses Cargo.toml (TOML format) to extract package name, version,
 * edition, and dependencies.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import { log } from "../../../utils/logger.js";
import type { ManifestReader } from "./types.js";
import type { ProjectManifest } from "../../../types/index.js";

// ── Detection ─────────────────────────────────────────────────────────────

function detectRustProject(cwd: string): boolean {
  return existsSync(resolve(cwd, "Cargo.toml"));
}

// ── Cargo.toml parser ─────────────────────────────────────────────────────

interface CargoData {
  name: string | undefined;
  version: string | undefined;
  edition: string | undefined;
  deps: Record<string, string>;
  devDeps: Record<string, string>;
  scripts: Record<string, string>;
}

function extractFromCargo(raw: Record<string, unknown>): CargoData {
  const result: CargoData = {
    name: undefined,
    version: undefined,
    edition: undefined,
    deps: {},
    devDeps: {},
    scripts: {},
  };

  // [package] table
  const pkg = raw.package as Record<string, unknown> | undefined;
  if (pkg) {
    result.name = pkg.name as string | undefined;
    result.version = pkg.version as string | undefined;
    result.edition = pkg.edition as string | undefined;
  }

  // [dependencies]
  const deps = raw.dependencies as Record<string, unknown> | undefined;
  if (deps) {
    for (const [name, spec] of Object.entries(deps)) {
      if (typeof spec === "string") {
        result.deps[name] = spec;
      } else if (typeof spec === "object" && spec !== null) {
        const depObj = spec as Record<string, unknown>;
        result.deps[name] = (depObj.version as string) || "*";
        if (depObj.features) {
          const features = depObj.features as string[];
          if (features.length > 0) result.deps[name] += ` (features: ${features.join(", ")})`;
        }
      }
    }
  }

  // [dev-dependencies]
  const devDeps = raw["dev-dependencies"] as Record<string, unknown> | undefined;
  if (devDeps) {
    for (const [name, spec] of Object.entries(devDeps)) {
      if (typeof spec === "string") {
        result.devDeps[name] = spec;
      } else if (typeof spec === "object" && spec !== null) {
        result.devDeps[name] = ((spec as Record<string, unknown>).version as string) || "*";
      }
    }
  }

  // [build-dependencies] — treat as deps
  const buildDeps = raw["build-dependencies"] as Record<string, unknown> | undefined;
  if (buildDeps) {
    for (const [name, spec] of Object.entries(buildDeps)) {
      if (typeof spec === "string") {
        result.deps[name] = spec;
      } else if (typeof spec === "object" && spec !== null) {
        result.deps[name] = ((spec as Record<string, unknown>).version as string) || "*";
      }
    }
  }

  // [package.metadata.bin] or [[bin]] — we can't fully parse [[bin]] tables simply
  // with smol-toml's regular API, but we can check for [package.metadata.scripts]
  const pkgMeta = pkg?.metadata as Record<string, unknown> | undefined;
  if (pkgMeta) {
    const scripts = pkgMeta.scripts as Record<string, string> | undefined;
    if (scripts) {
      for (const [name, cmd] of Object.entries(scripts)) {
        result.scripts[name] = cmd;
      }
    }
  }

  return result;
}

// ── Framework detection ────────────────────────────────────────────────────

function detectRustFrameworks(deps: Record<string, string>): string[] {
  const frameworks: string[] = [];
  if (deps["axum"]) frameworks.push("axum");
  if (deps["actix-web"] || deps["actix-rt"]) frameworks.push("actix");
  if (deps["rocket"]) frameworks.push("rocket");
  if (deps["tokio"]) frameworks.push("tokio");
  if (deps["tower"] || deps["tower-http"]) frameworks.push("tower");
  if (deps["serde"]) frameworks.push("serde");
  if (deps["clap"]) frameworks.push("clap");
  return frameworks;
}

// ── Reader implementation ─────────────────────────────────────────────────

export const rustReader: ManifestReader = {
  id: "rust",

  detect(cwd: string): boolean {
    return detectRustProject(cwd);
  },

  async read(cwd: string): Promise<ProjectManifest> {
    let cargo: CargoData = {
      name: undefined,
      version: undefined,
      edition: undefined,
      deps: {},
      devDeps: {},
      scripts: {},
    };

    const cargoPath = resolve(cwd, "Cargo.toml");
    try {
      const content = await readFile(cargoPath, "utf-8");
      const parsed = parseToml(content) as Record<string, unknown>;
      cargo = extractFromCargo(parsed);
    } catch (error) {
      log.warning(
        `Failed to parse Cargo.toml: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const frameworks = detectRustFrameworks(cargo.deps);

    return {
      packageName: cargo.name,
      packageVersion: cargo.version,
      ecosystem: "rust",
      packageManager: "cargo",
      dependencies: cargo.deps,
      devDependencies: cargo.devDeps,
      scripts: cargo.scripts,
      detectedFrameworks: frameworks,
    };
  },
};
