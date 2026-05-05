/**
 * Manifest Reader - Extract project metadata from package.json and tsconfig.json
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { createHash } from "node:crypto";
import { log } from "../../utils/logger.js";

/**
 * Parse JSON with support for JSONC (comments, trailing commas)
 */
function parseJsonSafe(content: string): Record<string, unknown> | null {
  try {
    // Remove single-line and multi-line comments
    let cleaned = content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

    // Remove trailing commas in objects and arrays
    cleaned = cleaned.replace(/,\s*([\]}])/g, "$1");

    return JSON.parse(cleaned) as Record<string, unknown>;
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

/**
 * Detects the package manager from lock files
 */
export function detectPackageManager(cwd: string): string {
  const lockFiles = [
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lockb",
    "npm-shrinkwrap.json",
  ];

  for (const lockFile of lockFiles) {
    if (existsSync(resolve(cwd, lockFile))) {
      const base = lockFile.split(".")[0]!;
      // Normalize to canonical names
      if (base === "package-lock") return "npm";
      if (base === "pnpm-lock") return "pnpm";
      if (base === "npm-shrinkwrap") return "npm";
      return base;
    }
  }

  return "npm";
}

/**
 * Reads package.json and extracts manifest information
 */
export async function readPackageManifest(cwd: string): Promise<{
  packageName: string | undefined;
  packageVersion: string | undefined;
  nodeEngine: string | undefined;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
  bin: string | Record<string, string> | undefined;
}> {
  const pkgPath = resolve(cwd, "package.json");

  if (!existsSync(pkgPath)) {
    return {
      packageName: undefined,
      packageVersion: undefined,
      nodeEngine: undefined,
      dependencies: {},
      devDependencies: {},
      scripts: {},
      bin: undefined,
    };
  }

  try {
    const content = await readFile(pkgPath, "utf-8");
    const pkg = parseStrictJson(content, "package.json");
    if (!pkg) {
      return {
        packageName: undefined,
        packageVersion: undefined,
        nodeEngine: undefined,
        dependencies: {},
        devDependencies: {},
        scripts: {},
        bin: undefined,
      };
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
    };
  } catch (error) {
    log.warning(
      `Failed to parse package.json: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {
      packageName: undefined,
      packageVersion: undefined,
      nodeEngine: undefined,
      dependencies: {},
      devDependencies: {},
      scripts: {},
      bin: undefined,
    };
  }
}

/**
 * Reads tsconfig.json and extracts compiler options
 */
export async function readTsConfig(cwd: string): Promise<
  | {
      compilerOptions: Record<string, unknown>;
      extends?: string;
    }
  | undefined
> {
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

/**
 * Detects frameworks based on dependencies and file patterns
 */
export function detectFrameworks(
  _cwd: string,
  dependencies: Record<string, string>,
  devDependencies: Record<string, string>,
): string[] {
  const frameworks: string[] = [];
  const allDeps = { ...dependencies, ...devDependencies };

  // React ecosystem
  if (allDeps.react || allDeps["react-dom"]) {
    frameworks.push("react");
    if (allDeps["next"]) frameworks.push("next.js");
    if (allDeps.gatsby) frameworks.push("gatsby");
  }

  // Vue ecosystem
  if (allDeps.vue || allDeps["@vue/core"]) {
    frameworks.push("vue");
    if (allDeps.nuxt) frameworks.push("nuxt");
  }

  // Angular
  if (allDeps["@angular/core"]) {
    frameworks.push("angular");
  }

  // Node.js frameworks
  if (allDeps.express) frameworks.push("express");
  if (allDeps.fastify) frameworks.push("fastify");
  if (allDeps.nestjs) frameworks.push("nestjs");

  // Testing frameworks
  if (allDeps.jest || allDeps["@jest/globals"]) frameworks.push("jest");
  if (allDeps.vitest) frameworks.push("vitest");
  if (allDeps.mocha) frameworks.push("mocha");
  if (allDeps.playwright) frameworks.push("playwright");
  if (allDeps.cypress) frameworks.push("cypress");

  // Build tools
  if (allDeps.vite) frameworks.push("vite");
  if (allDeps.webpack) frameworks.push("webpack");
  if (allDeps.esbuild) frameworks.push("esbuild");
  if (allDeps.rollup) frameworks.push("rollup");

  // Check for Node.js engine
  if (allDeps.typescript) frameworks.push("typescript");

  return frameworks;
}

/**
 * Main manifest reader - aggregates all manifest information
 */
export async function readManifest(cwd: string) {
  const pkgInfo = await readPackageManifest(cwd);
  const tsConfig = await readTsConfig(cwd);

  const frameworkList = detectFrameworks("", pkgInfo.dependencies, pkgInfo.devDependencies);

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
    // Ignore - toolVersion will remain undefined
  }

  return {
    packageName: pkgInfo.packageName,
    packageVersion: pkgInfo.packageVersion,
    nodeEngine: pkgInfo.nodeEngine,
    packageManager: detectPackageManager(cwd),
    dependencies: pkgInfo.dependencies,
    devDependencies: pkgInfo.devDependencies,
    scripts: pkgInfo.scripts,
    bin: pkgInfo.bin,
    detectedFrameworks: frameworkList,
    tsConfig,
    toolVersion,
  };
}

/**
 * Compute a deterministic hash of manifest inputs:
 * - package.json content
 * - tsconfig*.json content
 * - lockfile identity (which lockfile exists, not its content)
 */
export async function computeManifestHash(cwd: string): Promise<string> {
  const hash = createHash("sha256");

  const pkgPath = resolve(cwd, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const content = await readFile(pkgPath, "utf-8");
      hash.update(content);
    } catch {
      // ignore read errors
    }
  }

  const tsconfigPaths = ["tsconfig.json", "tsconfig.app.json", "tsconfig.node.json"];
  for (const filename of tsconfigPaths) {
    const path = resolve(cwd, filename);
    if (existsSync(path)) {
      try {
        const content = await readFile(path, "utf-8");
        hash.update(content);
      } catch {
        // ignore read errors
      }
    }
  }

  const lockFiles = [
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lockb",
    "npm-shrinkwrap.json",
  ];
  for (const lockFile of lockFiles) {
    if (existsSync(resolve(cwd, lockFile))) {
      hash.update(lockFile);
      break;
    }
  }

  return hash.digest("hex");
}

/**
 * Get file extension to language mapping
 */
export function extensionToLanguage(
  ext: string,
): "typescript" | "tsx" | "javascript" | "jsx" | null {
  const mapping: Record<string, "typescript" | "tsx" | "javascript" | "jsx"> = {
    ts: "typescript",
    tsx: "tsx",
    mts: "typescript",
    cts: "typescript",
    js: "javascript",
    jsx: "jsx",
    mjs: "javascript",
    cjs: "javascript",
  };
  return mapping[ext.toLowerCase()] ?? null;
}

/**
 * Check if a file path matches indexable languages
 */
export function isIndexableLanguage(
  path: string,
): "typescript" | "tsx" | "javascript" | "jsx" | null {
  const ext = basename(path).split(".").pop();
  if (!ext) return null;
  return extensionToLanguage(ext);
}

/**
 * Calculate which language to use for a file based on extension
 */
export function getLanguageForFile(
  path: string,
): "typescript" | "tsx" | "javascript" | "jsx" | null {
  return isIndexableLanguage(path);
}
