/**
 * Node.js ecosystem manifest reader.
 *
 * Reads package.json, tsconfig.json, and detects frameworks/lockfiles
 * from a Node.js project. This is the default reader and handles all
 * JS/TS ecosystems (React, Next, Vue, Svelte, Astro, Solid, Angular, etc.).
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { log } from "../../../utils/logger.js";
import { parseJsoncObject } from "../jsonc.js";

// ── JSON helpers ──────────────────────────────────────────────────────────
import type { ManifestReader } from "./types.js";
import type { ProjectManifest } from "../../../types/index.js";

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

function detectPackageManager(cwd: string): string {
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
      if (base === "package-lock") return "npm";
      if (base === "pnpm-lock") return "pnpm";
      if (base === "npm-shrinkwrap") return "npm";
      return base;
    }
  }
  return "npm";
}

// ── package.json reader ────────────────────────────────────────────────────

async function readPackageManifest(cwd: string): Promise<{
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
  if (allDeps.nestjs) frameworks.push("nestjs");
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
      packageManager: detectPackageManager(cwd),
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
