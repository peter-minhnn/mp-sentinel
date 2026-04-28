/**
 * SkillKnowledgeBase — builds structured codebase knowledge from SourceIndex.
 *
 * Pure deterministic derivation from SourceIndex fields. No AI calls.
 * When index.insights is absent, returns a minimal KB with empty arrays.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  SourceIndex,
  SourceIndexFile,
  SkillKnowledgeBase,
  ModuleInfo,
  EntrypointInfo,
  TestingMap,
  TestGapEntry,
  DepMapEntry,
  RiskEntry,
  FileRole,
} from "../../types/index.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function topDir(path: string): string {
  const slash = path.indexOf("/");
  return slash === -1 ? "(root)" : path.slice(0, slash);
}

function dominantRole(roles: FileRole[]): FileRole {
  const counts = new Map<FileRole, number>();
  for (const r of roles) {
    if (r === "unknown") continue;
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  if (counts.size === 0) return "unknown";
  let best: FileRole = "unknown";
  let bestCount = 0;
  for (const [r, c] of counts) {
    if (c > bestCount || (c === bestCount && r < best)) {
      best = r;
      bestCount = c;
    }
  }
  return best;
}

function isTestFile(path: string): boolean {
  return path.includes(".test.") || path.includes(".spec.") || path.includes("__tests__");
}

function sortedUniq<T>(items: T[]): T[] {
  return [...new Set(items)].sort();
}

// ── Module Ownership ───────────────────────────────────────────────────────

function buildModuleOwnership(
  index: SourceIndex,
  fileRoles: Record<string, FileRole>,
): ModuleInfo[] {
  const dirMap = new Map<string, SourceIndexFile[]>();
  for (const file of index.files) {
    const dir = topDir(file.path);
    const bucket = dirMap.get(dir) ?? [];
    bucket.push(file);
    dirMap.set(dir, bucket);
  }

  const modules: ModuleInfo[] = [];

  for (const [directory, files] of dirMap) {
    const sourceFiles = files.filter((f) => !isTestFile(f.path));
    const testFiles = files.filter((f) => isTestFile(f.path));
    const roles = sourceFiles.map((f) => fileRoles[f.path] ?? "unknown");

    // Key files: non-test, sorted by symbol count desc, max 5
    const keyFiles = sourceFiles
      .filter((f) => f.symbols.length > 0)
      .sort((a, b) => b.symbols.length - a.symbols.length || a.path.localeCompare(b.path))
      .slice(0, 5)
      .map((f) => f.path);

    // Key symbols: from key files, deduplicated by name, max 10
    const symbolSeen = new Set<string>();
    const keySymbols: Array<{ name: string; type: string; file: string }> = [];
    for (const file of keyFiles.map((p) => index.files.find((f) => f.path === p))) {
      if (!file) continue;
      for (const sym of file.symbols) {
        if (symbolSeen.has(sym.name)) continue;
        symbolSeen.add(sym.name);
        keySymbols.push({ name: sym.name, type: sym.type, file: file.path });
        if (keySymbols.length >= 10) break;
      }
      if (keySymbols.length >= 10) break;
    }

    // Import/export dirs
    const importDirs = new Set<string>();
    const exportedDirs = new Set<string>();
    for (const file of sourceFiles) {
      for (const imp of file.importsFrom ?? []) {
        const dir = topDir(imp);
        if (dir !== directory) importDirs.add(dir);
      }
      for (const dep of file.importedBy ?? []) {
        const dir = topDir(dep);
        if (dir !== directory) exportedDirs.add(dir);
      }
    }

    modules.push({
      directory,
      dominantRole: dominantRole(roles),
      sourceFileCount: sourceFiles.length,
      testFileCount: testFiles.length,
      keyFiles,
      keySymbols,
      importsFromDirs: [...importDirs].sort(),
      importedByDirs: [...exportedDirs].sort(),
    });
  }

  return modules.sort(
    (a, b) => b.sourceFileCount - a.sourceFileCount || a.directory.localeCompare(b.directory),
  );
}

// ── Entrypoints ────────────────────────────────────────────────────────────

function buildEntrypoints(
  index: SourceIndex,
  publicApiFiles: string[],
  fileRoles: Record<string, FileRole>,
): EntrypointInfo[] {
  const result: EntrypointInfo[] = [];

  // CLI entry
  for (const [path, role] of Object.entries(fileRoles)) {
    if (role === "cli-entry") {
      const binVal = typeof index.project.bin === "string" ? index.project.bin : undefined;
      result.push({
        type: "cli",
        path,
        label: binVal ? `bin: ${binVal}` : "entry",
      });
    }
  }

  // Commands
  for (const [path, role] of Object.entries(fileRoles)) {
    if (role === "command") {
      result.push({ type: "command", path, label: "command handler" });
    }
  }

  // Public API
  for (const path of publicApiFiles) {
    result.push({ type: "public-api", path, label: "re-exported entry" });
  }

  // Config
  for (const [path, role] of Object.entries(fileRoles)) {
    if (role === "config") {
      result.push({ type: "config", path, label: "configuration" });
    }
  }

  return result.sort((a, b) => a.type.localeCompare(b.type) || a.path.localeCompare(b.path));
}

// ── Testing Map ────────────────────────────────────────────────────────────

function buildTestingMap(
  index: SourceIndex,
  testMap: Record<string, string[]>,
  fileRoles: Record<string, FileRole>,
  modules: ModuleInfo[],
): TestingMap {
  // Test associations
  const testAssociations: Record<string, string[]> = {};
  for (const [source, tests] of Object.entries(testMap)) {
    testAssociations[source] = [...tests].sort();
  }

  // Test gaps: source files (non-test, non-type, has symbols) without testMap entry
  const testGaps: TestGapEntry[] = [];
  for (const file of index.files) {
    if (isTestFile(file.path)) continue;
    const role = fileRoles[file.path] ?? "unknown";
    if (role === "type" || role === "config") continue;
    if (file.symbols.length === 0) continue;
    if (testAssociations[file.path]) continue;

    // Check import-graph match
    const hasImportMatch = (file.importedBy ?? []).some((imp) => isTestFile(imp));
    if (hasImportMatch) continue;

    testGaps.push({
      sourceFile: file.path,
      reason: "no-test-file",
    });
  }
  testGaps.sort((a, b) => a.sourceFile.localeCompare(b.sourceFile));

  // Most tested modules
  const mostTestedModules = modules
    .filter((m) => m.testFileCount > 0)
    .sort((a, b) => b.testFileCount - a.testFileCount || a.directory.localeCompare(b.directory))
    .slice(0, 10);

  return { testAssociations, testGaps, mostTestedModules };
}

// ── Dependency Map ─────────────────────────────────────────────────────────

function buildDepMap(index: SourceIndex, dependencyUsage: Record<string, string[]>): DepMapEntry[] {
  const allDeps = { ...index.project.dependencies, ...index.project.devDependencies };
  const result: DepMapEntry[] = [];

  for (const [pkgName, files] of Object.entries(dependencyUsage)) {
    const version = allDeps[pkgName] ?? "unknown";
    result.push({
      packageName: pkgName,
      version,
      files: [...files].sort(),
      fileCount: files.length,
    });
  }

  return result
    .sort((a, b) => b.fileCount - a.fileCount || a.packageName.localeCompare(b.packageName))
    .slice(0, 20);
}

// ── Risk Map ───────────────────────────────────────────────────────────────

function buildRiskMap(
  index: SourceIndex,
  defaultExportFiles: string[],
  reExportFiles: string[],
  typeOnlyImportFiles: string[],
  dynamicImportFiles: string[],
): RiskEntry[] {
  const result: RiskEntry[] = [];

  for (const file of defaultExportFiles) {
    result.push({ file, type: "default-export", detail: "Default export — harder to tree-shake" });
  }
  for (const file of reExportFiles) {
    const reExportCount =
      index.files.find((f) => f.path === file)?.exports.filter((e) => e.source).length ?? 1;
    result.push({
      file,
      type: "re-export",
      detail: `Re-exports ${reExportCount} module(s) — indirect coupling`,
    });
  }
  for (const file of dynamicImportFiles) {
    result.push({
      file,
      type: "dynamic-import",
      detail: "Dynamic import — lazy-loaded dependency",
    });
  }
  for (const file of typeOnlyImportFiles) {
    result.push({
      file,
      type: "type-only-import",
      detail: "Type-only imports — safe to remove without runtime impact",
    });
  }

  // Hub files: imported by >1 other file
  const hubFiles = index.files
    .filter((f) => (f.importedBy?.length ?? 0) > 1)
    .sort(
      (a, b) =>
        (b.importedBy?.length ?? 0) - (a.importedBy?.length ?? 0) || a.path.localeCompare(b.path),
    )
    .slice(0, 10);

  for (const file of hubFiles) {
    const count = file.importedBy?.length ?? 0;
    if (result.some((r) => r.file === file.path && r.type === "hub-file")) continue;
    result.push({
      file: file.path,
      type: "hub-file",
      detail: `Imported by ${count} file(s) — high blast radius`,
      importCount: count,
    });
  }

  return result.sort((a, b) => a.type.localeCompare(b.type) || a.file.localeCompare(b.file));
}

// ── Main builder ───────────────────────────────────────────────────────────

const KNOWN_INSTRUCTION_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  ".cursor/rules",
  ".clinerules",
  ".agents/rules",
  ".agents/skills",
  ".windsurf/rules",
  ".codex/rules",
  ".antigravity/rules",
];

function detectInstructionFiles(projectRoot: string): string[] {
  const found: string[] = [];
  for (const relPath of KNOWN_INSTRUCTION_FILES) {
    const absPath = join(projectRoot, relPath);
    if (existsSync(absPath)) {
      found.push(relPath);
    }
  }
  return found;
}

export function buildSkillKnowledgeBase(
  index: SourceIndex,
  projectRoot?: string,
): SkillKnowledgeBase {
  const insights = index.insights;
  const project = index.project;

  const fileRoles: Record<string, FileRole> = insights?.fileRoles ?? {};
  const publicApiFiles: string[] = insights?.publicApiFiles ?? [];
  const testMap: Record<string, string[]> = insights?.testMap ?? {};
  const dependencyUsage: Record<string, string[]> = insights?.dependencyUsage ?? {};
  const defaultExportFiles: string[] = insights?.defaultExportFiles ?? [];
  const reExportFiles: string[] = insights?.reExportFiles ?? [];
  const typeOnlyImportFiles: string[] = insights?.typeOnlyImportFiles ?? [];
  const dynamicImportFiles: string[] = insights?.dynamicImportFiles ?? [];

  const instructionFiles = projectRoot ? detectInstructionFiles(projectRoot) : [];

  if (!insights) {
    return {
      projectName: project.packageName ?? "unknown",
      projectVersion: project.packageVersion ?? "0.0.0",
      packageManager: project.packageManager ?? "npm",
      modules: [],
      entrypoints: [],
      testing: { testAssociations: {}, testGaps: [], mostTestedModules: [] },
      dependencies: [],
      risks: [],
      instructionFiles,
    };
  }

  const modules = buildModuleOwnership(index, fileRoles);
  const entrypoints = buildEntrypoints(index, publicApiFiles, fileRoles);
  const testing = buildTestingMap(index, testMap, fileRoles, modules);
  const dependencies = buildDepMap(index, dependencyUsage);
  const risks = buildRiskMap(
    index,
    defaultExportFiles,
    reExportFiles,
    typeOnlyImportFiles,
    dynamicImportFiles,
  );

  return {
    projectName: project.packageName ?? "unknown",
    projectVersion: project.packageVersion ?? "0.0.0",
    packageManager: project.packageManager ?? "npm",
    modules,
    entrypoints,
    testing,
    dependencies,
    risks,
    instructionFiles,
  };
}
