/**
 * Node.js ecosystem manifest reader.
 *
 * Reads package.json, tsconfig.json, and detects frameworks/lockfiles
 * from a Node.js project. This is the default reader and handles all
 * JS/TS ecosystems (React, Next, Vue, Svelte, Astro, Solid, Angular, etc.).
 */

import { readFile } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { log } from "../../../utils/logger.js";
import { parseJsoncObject } from "../jsonc.js";

// ── JSON helpers ──────────────────────────────────────────────────────────
import type { ManifestReader } from "./types.js";
import type { ProjectManifest, WorkspacePackageInfo } from "../../../types/index.js";

// ── JSON helpers ──────────────────────────────────────────────────────────

function parseJsonSafe(content: string): Record<string, unknown> | null {
  try {
    return parseJsoncObject(content);
  } catch (error) {
    log.warning(`Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function parseStrictJson(content: string, fileName: string): Record<string, unknown> | null {
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch (error) {
    log.warning(
      `Failed to parse ${fileName}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

// ── Detection ─────────────────────────────────────────────────────────────

/**
 * Detect if a project root has a Node.js manifest (package.json).
 */
function detectPackageJson(cwd: string): boolean {
  return existsSync(resolve(cwd, "package.json"));
}

// ── Package manager ────────────────────────────────────────────────────────

const KNOWN_PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);

/**
 * Detect the package manager. The `packageManager` field in package.json
 * (e.g. `"bun@1.1.30"`) is the authoritative signal and wins over lockfiles;
 * lockfile presence is the fallback.
 */
function detectPackageManager(cwd: string, manifestField?: string): string {
  if (manifestField) {
    const name = manifestField.split("@")[0]!.trim().toLowerCase();
    if (KNOWN_PACKAGE_MANAGERS.has(name)) return name;
  }
  const lockFiles = [
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lock",
    "bun.lockb",
    "npm-shrinkwrap.json",
  ];
  for (const lockFile of lockFiles) {
    if (existsSync(resolve(cwd, lockFile))) {
      const base = lockFile.split(".")[0]!;
      if (base === "package-lock") return "npm";
      if (base === "pnpm-lock") return "pnpm";
      if (base === "npm-shrinkwrap") return "npm";
      return base;
    }
  }
  return "npm";
}

// ── Workspaces (monorepo) detection ────────────────────────────────────────

interface WorkspaceDetection {
  globs: string[];
  /** "package-json" is an explicit signal; "pnpm" needs a discovered package */
  source: "package-json" | "pnpm";
}

/** Drop empty, `.`, and placeholder tokens from workspace globs. */
function cleanWorkspaceGlobs(globs: string[]): string[] {
  return globs.map((g) => g.trim()).filter((g) => g.length > 0 && g !== "." && g !== "./");
}

/**
 * Parse the `packages:` list from pnpm-workspace.yaml WITHOUT pulling in
 * unrelated top-level YAML lists (e.g. `onlyBuiltDependencies:`, `catalog:`).
 * Only list items under the `packages:` key (until the next top-level key)
 * are returned.
 */
function parsePnpmWorkspacePackages(content: string): string[] {
  const lines = content.split(/\r?\n/);
  const globs: string[] = [];
  let inPackages = false;
  for (const line of lines) {
    if (/^packages\s*:/.test(line)) {
      inPackages = true;
      continue;
    }
    // A new top-level key (no indentation, not a list item) ends the block.
    if (inPackages && /^\S/.test(line) && !/^\s*-/.test(line)) {
      if (!/^packages\s*:/.test(line)) inPackages = false;
    }
    if (!inPackages) continue;
    const item = line.match(/^\s*-\s*["']?([^"'\n#]+?)["']?\s*$/);
    if (item) globs.push(item[1]!.trim());
  }
  return globs;
}

/**
 * Read workspace globs from package.json `workspaces` (array or
 * `{ packages: [] }`) or the `packages:` list of pnpm-workspace.yaml.
 * Returns the source so the caller can require a discovered package for
 * pnpm-only signals while trusting explicit package.json `workspaces`.
 */
function detectWorkspaces(cwd: string, pkgWorkspaces: unknown): WorkspaceDetection | undefined {
  if (Array.isArray(pkgWorkspaces)) {
    const globs = cleanWorkspaceGlobs(
      pkgWorkspaces.filter((w): w is string => typeof w === "string"),
    );
    if (globs.length > 0) return { globs, source: "package-json" };
  } else if (pkgWorkspaces && typeof pkgWorkspaces === "object") {
    const packages = (pkgWorkspaces as { packages?: unknown }).packages;
    if (Array.isArray(packages)) {
      const globs = cleanWorkspaceGlobs(packages.filter((w): w is string => typeof w === "string"));
      if (globs.length > 0) return { globs, source: "package-json" };
    }
  }

  const pnpmWorkspacePath = resolve(cwd, "pnpm-workspace.yaml");
  if (existsSync(pnpmWorkspacePath)) {
    try {
      const content = readFileSync(pnpmWorkspacePath, "utf-8");
      const globs = cleanWorkspaceGlobs(parsePnpmWorkspacePackages(content));
      if (globs.length > 0) return { globs, source: "pnpm" };
    } catch {
      // Unreadable pnpm-workspace.yaml — no workspace signal
    }
  }

  return undefined;
}

// ── Workspace package discovery ────────────────────────────────────────────

const MAX_WORKSPACE_PACKAGES = 24;

/**
 * Discover package-level manifests under the workspace globs. Supports the
 * common `<dir>/*` glob and literal directories; deeper glob syntax is
 * skipped (deterministic, no glob library).
 */
function readWorkspacePackages(
  cwd: string,
  globs: string[] | undefined,
): WorkspacePackageInfo[] | undefined {
  if (!globs || globs.length === 0) return undefined;

  const packageDirs: string[] = [];
  for (const glob of globs) {
    if (glob.startsWith("(") || glob.startsWith("!")) continue;
    if (glob.endsWith("/*")) {
      const parent = resolve(cwd, glob.slice(0, -2));
      if (!existsSync(parent)) continue;
      try {
        for (const entry of readdirSync(parent, { withFileTypes: true })) {
          if (entry.isDirectory()) packageDirs.push(join(glob.slice(0, -2), entry.name));
        }
      } catch {
        // Unreadable workspace parent — skip
      }
    } else if (!glob.includes("*")) {
      packageDirs.push(glob);
    }
  }

  const packages: WorkspacePackageInfo[] = [];
  for (const dir of packageDirs.sort()) {
    if (packages.length >= MAX_WORKSPACE_PACKAGES) break;
    const pkgPath = resolve(cwd, dir, "package.json");
    if (!existsSync(pkgPath)) continue;
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
        name?: unknown;
        scripts?: Record<string, string>;
      };
      if (typeof pkg.name !== "string") continue;
      packages.push({
        directory: dir.replace(/\\/g, "/"),
        name: pkg.name,
        scriptNames: Object.keys(pkg.scripts ?? {}).sort(),
      });
    } catch {
      // Malformed package manifest — skip
    }
  }

  return packages.length > 0 ? packages : undefined;
}

// ── package.json reader ────────────────────────────────────────────────────

interface NodePackageManifest {
  packageName: string | undefined;
  packageVersion: string | undefined;
  nodeEngine: string | undefined;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
  bin: string | Record<string, string> | undefined;
  /** Raw `packageManager` field from package.json (e.g. "bun@1.1.30") */
  packageManagerField: string | undefined;
  /** Raw `workspaces` field from package.json (array or { packages }) */
  workspacesField: unknown;
}

const EMPTY_NODE_MANIFEST: NodePackageManifest = {
  packageName: undefined,
  packageVersion: undefined,
  nodeEngine: undefined,
  dependencies: {},
  devDependencies: {},
  scripts: {},
  bin: undefined,
  packageManagerField: undefined,
  workspacesField: undefined,
};

async function readPackageManifest(cwd: string): Promise<NodePackageManifest> {
  const pkgPath = resolve(cwd, "package.json");
  if (!existsSync(pkgPath)) {
    return { ...EMPTY_NODE_MANIFEST };
  }
  try {
    const content = await readFile(pkgPath, "utf-8");
    const pkg = parseStrictJson(content, "package.json");
    if (!pkg) {
      return { ...EMPTY_NODE_MANIFEST };
    }
    const engines = pkg.engines as Record<string, string> | undefined;
    return {
      packageName: pkg.name as string | undefined,
      packageVersion: pkg.version as string | undefined,
      nodeEngine: engines?.node as string | undefined,
      dependencies: (pkg.dependencies ?? {}) as Record<string, string>,
      devDependencies: (pkg.devDependencies ?? {}) as Record<string, string>,
      scripts: (pkg.scripts ?? {}) as Record<string, string>,
      bin: pkg.bin as string | Record<string, string> | undefined,
      packageManagerField: typeof pkg.packageManager === "string" ? pkg.packageManager : undefined,
      workspacesField: pkg.workspaces,
    };
  } catch (error) {
    log.warning(
      `Failed to parse package.json: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { ...EMPTY_NODE_MANIFEST };
  }
}

// ── tsconfig reader ────────────────────────────────────────────────────────

async function readTsConfig(
  cwd: string,
): Promise<{ compilerOptions: Record<string, unknown>; extends?: string } | undefined> {
  const tsconfigPaths = ["tsconfig.json", "tsconfig.app.json", "tsconfig.node.json"];
  for (const filename of tsconfigPaths) {
    const path = resolve(cwd, filename);
    if (existsSync(path)) {
      try {
        const content = await readFile(path, "utf-8");
        const tsconfig = parseJsonSafe(content);
        if (!tsconfig) continue;
        const result: { compilerOptions: Record<string, unknown>; extends?: string } = {
          compilerOptions: (tsconfig.compilerOptions ?? {}) as Record<string, unknown>,
        };
        if (tsconfig.extends) {
          result.extends = tsconfig.extends as string;
        }
        return result;
      } catch (error) {
        log.warning(
          `Failed to parse ${filename}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  return undefined;
}

// ── Framework detection ────────────────────────────────────────────────────

function detectFrameworks(
  dependencies: Record<string, string>,
  devDependencies: Record<string, string>,
): string[] {
  const frameworks: string[] = [];
  const allDeps = { ...dependencies, ...devDependencies };

  if (allDeps.react || allDeps["react-dom"]) {
    frameworks.push("react");
    if (allDeps["next"]) frameworks.push("next.js");
    if (allDeps.gatsby) frameworks.push("gatsby");
  }
  if (allDeps.vue || allDeps["@vue/core"]) {
    frameworks.push("vue");
    if (allDeps.nuxt) frameworks.push("nuxt");
  }
  if (allDeps["@angular/core"]) frameworks.push("angular");
  if (allDeps.express) frameworks.push("express");
  if (allDeps.fastify) frameworks.push("fastify");
  // NestJS ships as scoped packages (@nestjs/core, @nestjs/common) -- there is
  // no bare `nestjs` package, so detect via the scoped core/common deps.
  if (allDeps["@nestjs/core"] || allDeps["@nestjs/common"] || allDeps.nestjs) {
    frameworks.push("nestjs");
  }
  if (allDeps.jest || allDeps["@jest/globals"]) frameworks.push("jest");
  if (allDeps.vitest) frameworks.push("vitest");
  if (allDeps.mocha) frameworks.push("mocha");
  if (allDeps.playwright) frameworks.push("playwright");
  if (allDeps.cypress) frameworks.push("cypress");
  if (allDeps.vite) frameworks.push("vite");
  if (allDeps.webpack) frameworks.push("webpack");
  if (allDeps.esbuild) frameworks.push("esbuild");
  if (allDeps.rollup) frameworks.push("rollup");
  if (allDeps.typescript) frameworks.push("typescript");
  if (allDeps.svelte || allDeps["@sveltejs/kit"]) frameworks.push("svelte");
  if (allDeps.astro) frameworks.push("astro");
  if (allDeps["solid-js"]) frameworks.push("solid");

  return frameworks;
}

// ── Reader implementation ─────────────────────────────────────────────────

export const nodeReader: ManifestReader = {
  id: "node",

  detect(cwd: string): boolean {
    return detectPackageJson(cwd);
  },

  async read(cwd: string): Promise<ProjectManifest> {
    const pkgInfo = await readPackageManifest(cwd);
    const tsConfig = await readTsConfig(cwd);
    const frameworkList = detectFrameworks(pkgInfo.dependencies, pkgInfo.devDependencies);
    const detection = detectWorkspaces(cwd, pkgInfo.workspacesField);
    const workspacePackages = detection ? readWorkspacePackages(cwd, detection.globs) : undefined;
    // package.json `workspaces` is an explicit monorepo signal even when no
    // package manifests are discovered yet. A pnpm-workspace-only signal must
    // be backed by at least one real package manifest before we claim it.
    const workspaces =
      detection && (detection.source === "package-json" || (workspacePackages?.length ?? 0) > 0)
        ? detection.globs
        : undefined;

    // Get tool version from package.json if available
    let toolVersion: string | undefined;
    try {
      if (existsSync(resolve(cwd, "package.json"))) {
        const pkgContent = await readFile(resolve(cwd, "package.json"), "utf-8");
        const pkg = parseStrictJson(pkgContent, "package.json");
        if (pkg?.version) {
          toolVersion = pkg.version as string;
        }
      }
    } catch {
      // Ignore
    }

    return {
      packageName: pkgInfo.packageName,
      packageVersion: pkgInfo.packageVersion,
      nodeEngine: pkgInfo.nodeEngine,
      ecosystem: "node",
      packageManager: detectPackageManager(cwd, pkgInfo.packageManagerField),
      workspaces,
      workspacePackages: workspaces ? workspacePackages : undefined,
      dependencies: pkgInfo.dependencies,
      devDependencies: pkgInfo.devDependencies,
      scripts: pkgInfo.scripts,
      bin: pkgInfo.bin,
      detectedFrameworks: frameworkList,
      tsConfig,
      toolVersion,
    };
  },
};
