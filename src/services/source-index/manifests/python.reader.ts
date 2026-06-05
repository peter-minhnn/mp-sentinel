/**
 * Python ecosystem manifest reader.
 *
 * Reads pyproject.toml (PEP 621) for project metadata and dependencies.
 * Falls back to setup.py (regex-based) + requirements.txt when pyproject.toml
 * is absent or doesn't contain the expected fields.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { log } from "../../../utils/logger.js";
import type { ManifestReader } from "./types.js";
import type { ProjectManifest } from "../../../types/index.js";

// ── Detection ─────────────────────────────────────────────────────────────

function detectPythonProject(cwd: string): boolean {
  return (
    existsSync(resolve(cwd, "pyproject.toml")) ||
    existsSync(resolve(cwd, "setup.py")) ||
    existsSync(resolve(cwd, "setup.cfg"))
  );
}

// ── pyproject.toml reader (PEP 621) ───────────────────────────────────────

function extractFromPyproject(raw: Record<string, unknown>): {
  name: string | undefined;
  version: string | undefined;
  deps: Record<string, string>;
  devDeps: Record<string, string>;
  scripts: Record<string, string>;
} {
  const result = {
    name: undefined as string | undefined,
    version: undefined as string | undefined,
    deps: {} as Record<string, string>,
    devDeps: {} as Record<string, string>,
    scripts: {} as Record<string, string>,
  };

  // PEP 621: [project] table with name, version, dependencies
  const project = raw.project as Record<string, unknown> | undefined;
  if (project) {
    result.name = project.name as string | undefined;
    result.version = project.version as string | undefined;

    // Dependencies: list of "package>=version" strings
    const deps = project.dependencies as string[] | undefined;
    if (deps) {
      for (const dep of deps) {
        // Extract package name from "package>=version" or "package==version" or "package"
        const match = dep.match(/^([a-zA-Z0-9_.-]+)/);
        if (match && match[1]) {
          result.deps[match[1].toLowerCase()] = dep;
        }
      }
    }

    // Optional dependencies (extras) — treat as devDeps
    const optionalDeps = project["optional-dependencies"] as Record<string, string[]> | undefined;
    if (optionalDeps) {
      for (const [, deps] of Object.entries(optionalDeps)) {
        for (const dep of deps) {
          const match = dep.match(/^([a-zA-Z0-9_.-]+)/);
          if (match && match[1]) {
            result.devDeps[match[1].toLowerCase()] = dep;
          }
        }
      }
    }

    // Scripts from [project.scripts] table (console_scripts)
    const scripts = project.scripts as Record<string, string> | undefined;
    if (scripts) {
      for (const [name, cmd] of Object.entries(scripts)) {
        result.scripts[name] = cmd as string;
      }
    }
  }

  // [tool.poetry] (Poetry format)
  const poetry = raw.tool as Record<string, unknown> | undefined;
  const poetryProj =
    (poetry?.poetry as Record<string, unknown> | undefined) ??
    (raw.poetry as Record<string, unknown> | undefined);
  if (poetryProj) {
    if (!result.name) result.name = poetryProj.name as string | undefined;
    if (!result.version) result.version = poetryProj.version as string | undefined;
    const poetryDeps = poetryProj.dependencies as Record<string, unknown> | undefined;
    if (poetryDeps) {
      for (const [name, spec] of Object.entries(poetryDeps)) {
        if (name === "python") continue;
        const version =
          typeof spec === "string"
            ? spec
            : (((spec as Record<string, unknown>)?.version as string) ?? "*");
        result.deps[name] = version;
      }
    }
    const poetryDevDeps = poetryProj["dev-dependencies"] as Record<string, unknown> | undefined;
    if (poetryDevDeps) {
      for (const [name, spec] of Object.entries(poetryDevDeps)) {
        const version = typeof spec === "string" ? spec : "*";
        result.devDeps[name] = version;
      }
    }
  }

  return result;
}

// ── setup.py (regex-based fallback) ───────────────────────────────────────

async function extractFromSetupPy(cwd: string): Promise<{
  name: string | undefined;
  version: string | undefined;
  deps: Record<string, string>;
}> {
  const result = {
    name: undefined as string | undefined,
    version: undefined as string | undefined,
    deps: {} as Record<string, string>,
  };

  const setupPyPath = resolve(cwd, "setup.py");
  if (!existsSync(setupPyPath)) return result;

  try {
    const content = await readFile(setupPyPath, "utf-8");
    const nameMatch = content.match(/name\s*=\s*["']([^"']+)["']/);
    if (nameMatch && nameMatch[1]) result.name = nameMatch[1];
    const verMatch = content.match(/version\s*=\s*["']([^"']+)["']/);
    if (verMatch && verMatch[1]) result.version = verMatch[1];
    // Extract install_requires
    const reqsMatch = content.match(/install_requires\s*=\s*\[([\s\S]*?)\]/);
    if (reqsMatch && reqsMatch[1]) {
      for (const line of reqsMatch[1].split(",")) {
        const trimmed = line.trim().replace(/^["']|["']$/g, "");
        if (trimmed) {
          const pkg = trimmed.match(/^([a-zA-Z0-9_.-]+)/);
          if (pkg && pkg[1]) result.deps[pkg[1].toLowerCase()] = trimmed;
        }
      }
    }
  } catch {
    // Ignore — pyproject.toml is preferred anyway
  }

  return result;
}

// ── requirements.txt fallback ─────────────────────────────────────────────

async function extractRequirementsTxt(cwd: string): Promise<Record<string, string>> {
  const deps: Record<string, string> = {};
  const reqPaths = ["requirements.txt", "requirements/production.txt"];
  for (const reqFile of reqPaths) {
    const reqPath = resolve(cwd, reqFile);
    if (!existsSync(reqPath)) continue;
    try {
      const content = await readFile(reqPath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) continue;
        const match = trimmed.match(/^([a-zA-Z0-9_.-]+)/);
        if (match && match[1]) {
          deps[match[1].toLowerCase()] = trimmed;
        }
      }
    } catch {
      // ignore
    }
  }
  return deps;
}

// ── Framework detection ────────────────────────────────────────────────────

function detectPythonFrameworks(deps: Record<string, string>): string[] {
  const frameworks: string[] = [];
  const allDeps = { ...deps };
  if (allDeps["django"]) frameworks.push("django");
  if (allDeps["flask"]) frameworks.push("flask");
  if (allDeps["fastapi"]) frameworks.push("fastapi");
  if (allDeps["starlette"]) frameworks.push("starlette");
  if (allDeps["aiohttp"]) frameworks.push("aiohttp");
  if (allDeps["tornado"]) frameworks.push("tornado");
  if (allDeps["pytest"] || allDeps["pytest-cov"]) frameworks.push("pytest");
  if (allDeps["celery"]) frameworks.push("celery");
  if (allDeps["sqlalchemy"]) frameworks.push("sqlalchemy");
  return frameworks;
}

// ── Reader implementation ─────────────────────────────────────────────────

export const pythonReader: ManifestReader = {
  id: "python",

  detect(cwd: string): boolean {
    return detectPythonProject(cwd);
  },

  async read(cwd: string): Promise<ProjectManifest> {
    let name: string | undefined;
    let version: string | undefined;
    let deps: Record<string, string> = {};
    let devDeps: Record<string, string> = {};
    let scripts: Record<string, string> = {};

    // Try pyproject.toml first
    const pyprojectPath = resolve(cwd, "pyproject.toml");
    if (existsSync(pyprojectPath)) {
      try {
        const content = await readFile(pyprojectPath, "utf-8");
        // Lazy import: keeps smol-toml out of dist/lib.js for consumers that
        // never read Python/Rust manifests.
        const { parse: parseToml } = await import("smol-toml");
        const parsed = parseToml(content) as Record<string, unknown>;
        const extracted = extractFromPyproject(parsed);
        name = extracted.name;
        version = extracted.version;
        deps = extracted.deps;
        devDeps = extracted.devDeps;
        scripts = extracted.scripts;
      } catch (error) {
        log.warning(
          `Failed to parse pyproject.toml: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Fallback to setup.py for name/version/deps not found in pyproject.toml
    if (!name || Object.keys(deps).length === 0) {
      const setupInfo = await extractFromSetupPy(cwd);
      if (!name) name = setupInfo.name;
      if (!version) version = setupInfo.version;
      if (Object.keys(deps).length === 0) deps = setupInfo.deps;
    }

    // Fill in deps from requirements.txt if still empty
    if (Object.keys(deps).length === 0) {
      deps = await extractRequirementsTxt(cwd);
    }

    const frameworkList = detectPythonFrameworks(deps);

    return {
      packageName: name,
      packageVersion: version,
      ecosystem: "python",
      packageManager: "pip",
      dependencies: deps,
      devDependencies: devDeps,
      scripts,
      detectedFrameworks: frameworkList,
    };
  },
};
