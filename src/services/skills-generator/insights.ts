/**
 * Index Insights — derives IndexInsights from a built SourceIndex.
 *
 * Used to enrich generated skill files with higher-level metadata such as
 * file roles, test mappings, script classifications, and dependency usage.
 * This is computed purely from the SourceIndex (no AI calls).
 */

import type {
  SourceIndex,
  SourceIndexFile,
  IndexInsights,
  FileRole,
  ScriptCategory,
} from "../../types/index.js";
import { detectProfile } from "./profile.js";

// ── Directory-based role heuristics ────────────────────────────────────────

const ROLE_DIR_MAP: Array<[RegExp, FileRole]> = [
  [/^src\/index\.ts$/, "cli-entry"],
  [/^src\/cli\.ts$/, "cli-entry"],
  [/^index\.ts$/, "cli-entry"],
  [/^cli\.ts$/, "cli-entry"],
  [/^src\/cli\//, "command"],
  [/^src\/commands\//, "command"],
  [/^src\/services\/skills-generator\/adapters\//, "adapter"],
  [/^src\/services\/ai\//, "provider"],
  [/^src\/services\/(.+\/)*provider/, "provider"],
  [/^src\/services\//, "service"],
  [/^__tests__\//, "test"],
  [/\.test\.(ts|tsx|js|jsx)$/, "test"],
  [/\.spec\.(ts|tsx|js|jsx)$/, "test"],
  [/^src\/config\//, "config"],
  [/\.config\.(ts|js|mjs)$/, "config"],
  [/^src\/types\//, "type"],
  [/\.d\.ts$/, "type"],
  [/^examples\//, "example"],
  [/^src\/utils\//, "utils"],
  [/^src\/formatters\//, "utils"],
];

/**
 * Detect file role based on path conventions and content heuristics.
 */
function detectFileRole(file: SourceIndexFile, binEntry: string | undefined): FileRole {
  const { path } = file;

  // Check if this file is the binary entry point
  if (binEntry && (path === binEntry || path.endsWith(`/${binEntry}`))) {
    return "cli-entry";
  }

  // Directory-based heuristics
  for (const [pattern, role] of ROLE_DIR_MAP) {
    if (pattern.test(path)) return role;
  }

  // Heuristic: if file only exports types/interfaces, classify as "type"
  if (file.exports.length > 0 && file.symbols.length > 0) {
    const allTypes = file.symbols.every((s) => s.type === "interface" || s.type === "type");
    if (allTypes && file.exports.length >= file.symbols.length) {
      return "type";
    }
  }

  return "unknown";
}

// ── Script classification ──────────────────────────────────────────────────

const SCRIPT_CATEGORY_PATTERNS: Array<[RegExp, ScriptCategory]> = [
  [/build|tsup|tsc\b(?!.*--noEmit)/, "build"],
  [/\btest\b|jest|vitest|mocha|ava|tape|cypress|playwright/, "test"],
  [/\btypecheck|tsc --noEmit|tsc --no-emit/, "typecheck"],
  [/\bformat|prettier|lint-staged|eslint/, "format"],
  [/\brelease|publish|version|semantic-release|changeset/, "release"],
  [/\bindex|indexing/, "indexing"],
  [/\bdev|watch|start\b/, "dev"],
];

function classifyScript(name: string, command: string): ScriptCategory {
  // Shortcut: check well-known script names first
  const nameCategory = classifyScriptName(name);
  if (nameCategory !== "other") return nameCategory;

  // Fall back to command content matching
  for (const [pattern, category] of SCRIPT_CATEGORY_PATTERNS) {
    if (pattern.test(command)) return category;
  }
  return "other";
}

function classifyScriptName(name: string): ScriptCategory {
  switch (name) {
    case "build":
    case "compile":
      return "build";
    case "test":
    case "test:coverage":
    case "test:watch":
    case "test:integration":
    case "test:e2e":
      return "test";
    case "typecheck":
    case "type-check":
    case "typescript":
      return "typecheck";
    case "format":
    case "format:check":
    case "lint":
    case "lint:check":
      return "format";
    case "release":
    case "publish":
    case "version":
    case "prerelease":
      return "release";
    case "indexing":
    case "index":
      return "indexing";
    case "dev":
    case "develop":
    case "watch":
    case "start":
      return "dev";
    default:
      return "other";
  }
}

// ── External package helpers ───────────────────────────────────────────────

/**
 * Extract the npm package name from an import specifier.
 * Handles scoped packages (@scope/name), path-based imports (lodash/memoize),
 * and bare specifiers (react).
 */
function extractPackageName(specifier: string): string | null {
  // Node builtins / URLs
  if (
    specifier.startsWith("node:") ||
    specifier.startsWith("data:") ||
    specifier.startsWith("http:") ||
    specifier.startsWith("https:")
  ) {
    return null;
  }

  // Scoped package: @scope/name or @scope/name/path
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    if (parts.length >= 2) {
      return `${parts[0]}/${parts[1]}`;
    }
    return null;
  }

  // Bare specifier: react, lodash/memoize, etc.
  const parts = specifier.split("/");
  const pkg = parts[0];
  if (pkg && !pkg.startsWith(".") && !pkg.startsWith("/")) {
    return pkg;
  }

  return null;
}

/**
 * Measure how far each dependency reaches into the codebase.
 *
 * Returns package name -> number of files that import it directly, plus the
 * files that import one of those files. Presence in package.json says nothing
 * about influence; a client created in one provider module and consumed
 * everywhere should outrank a library imported once and never used again.
 * One hop is deliberate: it separates "wired into the app" from "installed",
 * without letting a shared util drag every package to the top.
 *
 * Deterministic — derived only from the index import graph.
 */
export function computeDependencyReach(index: SourceIndex): Record<string, number> {
  const aliasPrefixes = collectAliasPrefixes(index);

  // Reverse edge: file -> internal files importing it.
  const importers = new Map<string, Set<string>>();
  for (const file of index.files) {
    for (const target of file.importsFrom ?? []) {
      const bucket = importers.get(target) ?? new Set<string>();
      bucket.add(file.path);
      importers.set(target, bucket);
    }
  }

  const reach: Record<string, number> = {};
  const directByPkg = new Map<string, Set<string>>();
  for (const file of index.files) {
    for (const imp of file.imports) {
      if (!isExternalImport(imp.source, aliasPrefixes)) continue;
      const pkg = extractPackageName(imp.source);
      if (!pkg) continue;
      const bucket = directByPkg.get(pkg) ?? new Set<string>();
      bucket.add(file.path);
      directByPkg.set(pkg, bucket);
    }
  }

  for (const [pkg, direct] of directByPkg) {
    const reachable = new Set(direct);
    for (const path of direct) {
      for (const dependent of importers.get(path) ?? []) {
        reachable.add(dependent);
      }
    }
    reach[pkg] = reachable.size;
  }
  return reach;
}

/**
 * Collect tsconfig `paths` alias prefixes (e.g. `@/`, `~/`, `@app/`).
 *
 * Alias specifiers look bare (`@/lib/utils`) but resolve to files inside the
 * repository, so they must never be reported as npm dependencies.
 */
export function collectAliasPrefixes(index: SourceIndex): string[] {
  const paths = index.project.tsConfig?.compilerOptions?.paths as
    | Record<string, unknown>
    | undefined;
  if (!paths) return [];
  return [...new Set(Object.keys(paths).map((key) => key.replace(/\*$/, "")))]
    .filter((prefix) => prefix.length > 0)
    .sort();
}

/**
 * Check if an import specifier refers to an external (npm) package.
 *
 * Specifiers matching a tsconfig path alias are internal, not dependencies.
 */
function isExternalImport(specifier: string, aliasPrefixes: readonly string[] = []): boolean {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("\\")) {
    return false;
  }
  return !aliasPrefixes.some(
    (prefix) => specifier.startsWith(prefix) || specifier === prefix.replace(/\/$/, ""),
  );
}

// ── Test association heuristics ────────────────────────────────────────────

/**
 * Try to associate a test file with a source file by path convention.
 * Examples:
 *   src/foo.ts          ← src/__tests__/foo.test.ts
 *   src/foo.ts          ← src/foo.test.ts
 *   src/foo/bar.ts      ← src/foo/__tests__/bar.test.ts
 *   src/sub/foo.ts      ← src/sub/__tests__/foo.test.ts
 */
function associateTestToSource(testPath: string): string | null {
  // Remove __tests__/ prefix and test file suffix
  let normalized = testPath
    .replace(/\/__tests__\//, "/")
    .replace(/\.(test|spec)\.(ts|tsx|js|jsx)$/, "$4")
    .replace(/\.(test|spec)\.(ts|tsx|js|jsx)$/, "");

  // If after normalization the path doesn't have a file extension, add .ts
  if (!normalized.includes(".")) {
    normalized += ".ts";
  }

  return normalized;
}

// ── Public API detection ───────────────────────────────────────────────────

/**
 * Find files that are part of the public API surface.
 * Looks at files re-exported from src/lib.ts or other entry points.
 */
function findPublicApiFiles(index: SourceIndex): string[] {
  const publicApiFiles = new Set<string>();

  // Look for common public API entry files
  const entryCandidates = [
    "src/lib.ts",
    "src/index.ts",
    "src/main.ts",
    "src/server.ts",
    "src/app.ts",
    "index.ts",
    "lib.ts",
  ];

  for (const entryPath of entryCandidates) {
    const entryFile = index.files.find((f) => f.path === entryPath);
    if (!entryFile) continue;

    // Collect files re-exported from this entry
    for (const exp of entryFile.exports) {
      if (exp.source) {
        // This is a re-export from another file
        const exportFile = resolveExportSource(exp.source, entryPath);
        if (exportFile) {
          publicApiFiles.add(exportFile);
        }
      }
    }
  }

  return Array.from(publicApiFiles);
}

/**
 * Roughly resolve an export source path relative to the importing file.
 */
function resolveExportSource(source: string, importerPath: string): string | null {
  if (source.startsWith(".")) {
    // Relative path
    const dir = importerPath.split("/").slice(0, -1).join("/");
    const resolved = (dir ? dir + "/" : "") + source;
    // Normalize ./ and ../
    const parts = resolved.split("/");
    const result: string[] = [];
    for (const part of parts) {
      if (part === "." || part === "") continue;
      if (part === "..") {
        result.pop();
      } else {
        result.push(part);
      }
    }
    if (result.length > 0) {
      const candidate = result.join("/");
      const hasExt = /\.(ts|tsx|js|jsx|mjs|mts|cjs|cts)$/.test(candidate);
      return hasExt ? candidate : candidate + ".ts";
    }
  }
  return null;
}

// ── Main builder ───────────────────────────────────────────────────────────

/**
 * Build IndexInsights from a SourceIndex.
 */
export function buildIndexInsights(index: SourceIndex): IndexInsights {
  // 1. File role detection
  const binEntry: string | undefined =
    typeof index.project.bin === "string" ? index.project.bin : undefined;
  const fileRoles: Record<string, FileRole> = {};
  for (const file of index.files) {
    fileRoles[file.path] = detectFileRole(file, binEntry);
  }

  // 2. Public API files
  const publicApiFiles = findPublicApiFiles(index);

  // 3. Test map
  const testMap: Record<string, string[]> = {};

  // Collect test files
  const testFiles = index.files.filter((f) => fileRoles[f.path] === "test");

  for (const testFile of testFiles) {
    const sourcePath = associateTestToSource(testFile.path);
    if (sourcePath) {
      // Check if the source file exists in the index
      const sourceExists = index.files.some((f) => f.path === sourcePath);
      if (sourceExists) {
        if (!testMap[sourcePath]) testMap[sourcePath] = [];
        testMap[sourcePath]!.push(testFile.path);
      }

      // Also check by import graph: what does the test import?
      if (testFile.importsFrom) {
        for (const importedFile of testFile.importsFrom) {
          if (!testMap[importedFile]) testMap[importedFile] = [];
          if (!testMap[importedFile]!.includes(testFile.path)) {
            testMap[importedFile]!.push(testFile.path);
          }
        }
      }
    }
  }

  // 4. Command map
  const commandMap: Record<string, ScriptCategory> = {};
  if (index.project.scripts) {
    for (const [name, command] of Object.entries(index.project.scripts)) {
      commandMap[name] = classifyScript(name, command);
    }
  }

  // 5. Dependency usage
  const aliasPrefixes = collectAliasPrefixes(index);
  const dependencyUsage: Record<string, string[]> = {};
  for (const file of index.files) {
    // Track files that import external packages (tsconfig aliases are internal)
    const externalImports = file.imports.filter((imp) =>
      isExternalImport(imp.source, aliasPrefixes),
    );
    for (const imp of externalImports) {
      const pkgName = extractPackageName(imp.source);
      if (pkgName) {
        if (!dependencyUsage[pkgName]) dependencyUsage[pkgName] = [];
        if (!dependencyUsage[pkgName]!.includes(file.path)) {
          dependencyUsage[pkgName]!.push(file.path);
        }
      }
    }
  }

  // 6-9. Special export/import tracking
  const defaultExportFiles: string[] = [];
  const reExportFiles: string[] = [];
  const typeOnlyImportFiles: string[] = [];
  const dynamicImportFiles: string[] = [];

  for (const file of index.files) {
    // Default exports
    if (file.exports.some((exp) => exp.isDefault || exp.kind === "default")) {
      defaultExportFiles.push(file.path);
    }

    // Re-exports
    if (file.exports.some((exp) => exp.source !== undefined)) {
      reExportFiles.push(file.path);
    }

    // Type-only imports
    if (file.imports.some((imp) => imp.typeOnly)) {
      typeOnlyImportFiles.push(file.path);
    }

    // Dynamic imports
    if (file.imports.some((imp) => imp.kind === "dynamic")) {
      dynamicImportFiles.push(file.path);
    }
  }

  return {
    fileRoles,
    publicApiFiles,
    testMap,
    commandMap,
    dependencyUsage,
    defaultExportFiles,
    reExportFiles,
    typeOnlyImportFiles,
    dynamicImportFiles,
  };
}
