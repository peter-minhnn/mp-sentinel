/**
 * Import path resolver for TypeScript/JavaScript projects
 * Resolves module specifiers to file paths within the project
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { log } from "../../utils/logger.js";

export interface ResolveResult {
  /** Resolved file path relative to project root, or null if external */
  path: string | null;
  /** Whether the import is external (node_modules) */
  external: boolean;
}

/**
 * Strip JS-style comments and trailing commas so a JSONC file (tsconfig.json)
 * can be parsed with JSON.parse.
 */
function stripJsonComments(content: string): string {
  return content
    .replace(/\/\/[^\n\r]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/,(\s*[}\]])/g, "$1");
}

/**
 * Load a tsconfig file with optional extends chain resolution.
 * Returns merged compilerOptions where parent values serve as defaults
 * and child values override. baseUrl from a parent is resolved relative
 * to the parent config's directory.
 */
async function loadTsConfigWithExtends(
  configPath: string,
  visited: Set<string> = new Set(),
): Promise<{ compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } } | null> {
  const absPath = resolve(configPath);
  if (visited.has(absPath)) return null;
  visited.add(absPath);

  if (!existsSync(absPath)) return null;

  try {
    const content = await readFile(absPath, "utf-8");
    const config = JSON.parse(stripJsonComments(content)) as {
      extends?: string;
      compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
    };

    let merged: { baseUrl?: string; paths?: Record<string, string[]> } = {
      ...config.compilerOptions,
    };

    if (config.extends) {
      const parentDir = dirname(absPath);
      const parentPath = resolve(parentDir, config.extends);
      // Allow extends without .json extension
      const parentPaths = [parentPath, parentPath + ".json"];
      for (const pp of parentPaths) {
        const parent = await loadTsConfigWithExtends(pp, visited);
        if (parent?.compilerOptions) {
          const parentBaseUrl = parent.compilerOptions.baseUrl;
          const parentPathsOpt = parent.compilerOptions.paths;
          // If parent defines paths and child does not, use parent's paths.
          // If child defines paths, they replace parent's (TS behaviour).
          if (!merged.paths && parentPathsOpt) {
            merged.paths = parentPathsOpt;
          }
          // baseUrl from parent is relative to parent's directory
          if (!merged.baseUrl && parentBaseUrl) {
            merged.baseUrl =
              relative(
                resolve(projectRootFromPath(absPath)),
                resolve(parentDir, parentBaseUrl),
              ).replace(/\\/g, "/") || ".";
          }
          break;
        }
      }
    }

    return {
      compilerOptions: {
        ...(merged.baseUrl !== undefined && { baseUrl: merged.baseUrl }),
        ...(merged.paths !== undefined && { paths: merged.paths }),
      },
    };
  } catch (error) {
    log.debug(
      `Failed to read tsconfig at ${absPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/** Derive the project root from a tsconfig path (assumes config at project root). */
function projectRootFromPath(configPath: string): string {
  return dirname(resolve(configPath));
}

/**
 * Get TypeScript compiler options from tsconfig.json, with extends chain support.
 */
export async function readTsConfig(projectRoot: string): Promise<{
  baseUrl?: string;
  paths?: Record<string, string[]>;
} | null> {
  const tsConfigPaths = [
    resolve(projectRoot, "tsconfig.json"),
    resolve(projectRoot, "tsconfig.base.json"),
    resolve(projectRoot, "jsconfig.json"),
  ];

  for (const tsConfigPath of tsConfigPaths) {
    const loaded = await loadTsConfigWithExtends(tsConfigPath);
    if (loaded?.compilerOptions) {
      return {
        ...(loaded.compilerOptions.baseUrl !== undefined && {
          baseUrl: loaded.compilerOptions.baseUrl,
        }),
        ...(loaded.compilerOptions.paths !== undefined && { paths: loaded.compilerOptions.paths }),
      };
    }
  }

  return null;
}

/**
 * Normalize an import specifier by removing file extension if present
 */
function normalizeImport(specifier: string): string {
  // Remove .mts, .cts, .ts, .tsx, .mjs, .cjs, .js, .jsx extensions
  return specifier.replace(/\.(m?ts|tsx|m?js|jsx|cjs|cts)$/, "");
}

/**
 * Check if a specifier is a relative or absolute path
 */
function isLocalPath(specifier: string): boolean {
  return specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("\\");
}

/**
 * Check if a specifier is a bare import (likely external)
 */
function isBareImport(specifier: string): boolean {
  return (
    !isLocalPath(specifier) && !specifier.startsWith("data:") && specifier.indexOf("://") === -1
  );
}

/**
 * Try to resolve a local import specifier to a file
 */
function resolveLocalImport(
  specifier: string,
  sourceDir: string,
  projectRoot: string,
  fileExtensions: string[] = [
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".json",
  ],
): ResolveResult {
  let normalized = normalizeImport(specifier);

  // Handle index files
  const candidates: string[] = [];
  if (normalized.endsWith("/") || normalized.endsWith("\\")) {
    normalized = normalized.slice(0, -1);
  }

  // Generate candidate paths
  for (const ext of fileExtensions) {
    candidates.push(normalized + ext);
    candidates.push(join(normalized, "index" + ext));
  }

  for (const candidate of candidates) {
    const absolutePath = resolve(sourceDir, candidate);
    const relativePath = getRelativePath(projectRoot, absolutePath);

    if (relativePath && existsSync(absolutePath)) {
      return { path: relativePath, external: false };
    }
  }

  return { path: null, external: false };
}

/**
 * Resolve a bare import using tsconfig paths/baseUrl.
 * Tries extension candidates and index files, matching the same rules as resolveLocalImport.
 */
function resolvePathMapping(
  specifier: string,
  baseUrl: string,
  paths: Record<string, string[]>,
  projectRoot: string,
  fileExtensions: string[] = [
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".json",
  ],
): ResolveResult {
  const normalized = normalizeImport(specifier);

  for (const [pattern, targets] of Object.entries(paths)) {
    const patternRegex = pattern
      .replace(/\*/g, "(.*)")
      .replace(/\//g, "[/\\\\]")
      .replace(/\\/g, "\\\\");

    const match = normalized.match(new RegExp(`^${patternRegex}$`));
    if (match) {
      for (const target of targets) {
        const capture = match[1] ?? "";
        const base = resolve(projectRoot, baseUrl, normalizeImport(target.replace(/\*/g, capture)));

        for (const ext of fileExtensions) {
          const candidate = base + ext;
          const rel = getRelativePath(projectRoot, candidate);
          if (rel && existsSync(candidate)) return { path: rel, external: false };
        }
        for (const ext of fileExtensions) {
          const candidate = join(base, "index" + ext);
          const rel = getRelativePath(projectRoot, candidate);
          if (rel && existsSync(candidate)) return { path: rel, external: false };
        }
        const rel = getRelativePath(projectRoot, base);
        if (rel && existsSync(base)) return { path: rel, external: false };
      }
    }
  }

  return { path: null, external: true };
}

/**
 * Get relative path from project root
 */
export function getRelativePath(projectRoot: string, absolutePath: string): string | null {
  const normalizedRoot = resolve(projectRoot);
  const normalizedPath = resolve(absolutePath);

  if (!normalizedPath.startsWith(normalizedRoot)) {
    return null; // Path is outside project
  }

  return normalizedPath.slice(normalizedRoot.length + 1).replace(/\\/g, "/");
}

/**
 * Main resolver class
 */
export class ImportResolver {
  private projectRoot: string;
  private baseUrl: string;
  private paths: Record<string, string[]> | undefined;
  private fileExtensions: string[];

  constructor(
    projectRoot: string,
    options: { tsconfig?: { baseUrl?: string; paths?: Record<string, string[]> } } = {},
  ) {
    this.projectRoot = projectRoot;
    this.baseUrl = (options.tsconfig?.baseUrl as string | undefined) ?? ".";
    this.paths = options.tsconfig?.paths;
    this.fileExtensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json"];
  }

  async initialize(): Promise<void> {
    // Load tsconfig if not provided
    if (!this.paths) {
      const tsconfig = await readTsConfig(this.projectRoot);
      if (tsconfig) {
        if (tsconfig.baseUrl) {
          this.baseUrl = tsconfig.baseUrl;
        }
        if (tsconfig.paths) {
          this.paths = tsconfig.paths;
        }
      }
    }
  }

  /**
   * Resolve an import specifier relative to a source file
   */
  resolve(specifier: string, sourcePath: string): ResolveResult {
    // Always external: node builtins, @types stubs, data URIs, URLs
    if (
      specifier.startsWith("node:") ||
      specifier.startsWith("@types/") ||
      specifier.startsWith("data:") ||
      specifier.startsWith("http:") ||
      specifier.startsWith("https:")
    ) {
      return { path: null, external: true };
    }

    // Bare import (e.g. `react`, `@scope/pkg`, `@/lib/foo` alias).
    // Try tsconfig path mappings first — aliases live here.
    // Fall through to external only if no mapping resolves.
    if (isBareImport(specifier)) {
      if (this.paths && this.baseUrl) {
        const mapped = resolvePathMapping(
          specifier,
          this.baseUrl,
          this.paths,
          this.projectRoot,
          this.fileExtensions,
        );
        if (mapped.path) return mapped;
      }
      return { path: null, external: true };
    }

    // Relative / absolute local import
    const sourceDir = dirname(resolve(this.projectRoot, sourcePath));
    return resolveLocalImport(specifier, sourceDir, this.projectRoot, this.fileExtensions);
  }

  /**
   * Bulk resolve imports for multiple files
   */
  async resolveBatch(
    files: Array<{ path: string; imports: Array<{ source: string; line: number; kind: string }> }>,
  ): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();

    for (const file of files) {
      const resolvedImports: string[] = [];

      for (const imp of file.imports) {
        const resolved = this.resolve(imp.source, file.path);
        if (resolved.path) {
          resolvedImports.push(resolved.path);
        }
      }

      result.set(file.path, resolvedImports);
    }

    return result;
  }
}
