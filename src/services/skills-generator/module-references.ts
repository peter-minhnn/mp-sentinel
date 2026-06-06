/**
 * Per-module reference generation (`references/modules/<safe-name>.md`).
 *
 * `references/modules.md` stays compact; the top bounded contexts that
 * exceed a size threshold additionally get their own deep-dive reference
 * with key files, entrypoints, local dependencies, dependents, tests, and
 * relevant detected conventions. Deterministic — derived only from the
 * knowledge base and index.
 */

import type { ModuleInfo, SkillKnowledgeBase, SourceIndex } from "../../types/index.js";
import type { DetectedConvention } from "./convention-detectors.js";
import { renderWorkspaceScript } from "./package-manager.js";

/** Modules need at least this many source files to earn a deep-dive file. */
export const MODULE_REFERENCE_MIN_SOURCE_FILES = 5;
/** At most this many module reference files are generated. */
export const MAX_MODULE_REFERENCE_FILES = 6;

const MAX_KEY_FILES = 6;
const MAX_KEY_SYMBOLS = 8;
const MAX_TEST_LINKS = 6;
const MAX_DIR_LINKS = 8;
const MAX_PACKAGE_SCRIPTS = 3;
const PREFERRED_PACKAGE_SCRIPTS = ["build", "test", "dev", "lint", "typecheck"];

/** "src/features/approval-inbox" -> "src-features-approval-inbox" */
export function safeModuleName(directory: string): string {
  return (
    directory
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "module"
  );
}

/**
 * Select the bounded contexts that get their own reference file:
 * non-root modules with enough source files, largest first, capped.
 */
export function selectModuleReferenceTargets(kb: SkillKnowledgeBase | null): ModuleInfo[] {
  if (!kb) return [];
  return kb.modules
    .filter(
      (m) => m.directory !== "(root)" && m.sourceFileCount >= MODULE_REFERENCE_MIN_SOURCE_FILES,
    )
    .slice(0, MAX_MODULE_REFERENCE_FILES);
}

export interface ModuleReferenceFile {
  /** Module directory key, e.g. "src/features/approval-inbox" */
  directory: string;
  /** Path relative to the skill dir, e.g. "references/modules/src-features-approval-inbox.md" */
  relPath: string;
  content: string;
}

function buildModuleReferenceContent(
  mod: ModuleInfo,
  kb: SkillKnowledgeBase,
  index: SourceIndex,
  conventions: DetectedConvention[],
): string {
  const lines = [
    `## Module: \`${mod.directory}/\``,
    ``,
    `Role: ${mod.dominantRole}. ${mod.sourceFileCount} source file(s), ${mod.testFileCount} test file(s).`,
  ];

  // Key files with their top symbols
  if (mod.keyFiles.length > 0) {
    lines.push(``, `### Key Files`, ``);
    for (const path of mod.keyFiles.slice(0, MAX_KEY_FILES)) {
      const file = index.files.find((f) => f.path === path);
      const syms = (file?.symbols ?? [])
        .slice(0, 3)
        .map((s) => `\`${s.name}\``)
        .join(", ");
      lines.push(`- \`${path}\`${syms ? ` - ${syms}` : ""}`);
    }
  }

  if (mod.keySymbols.length > 0) {
    const symList = mod.keySymbols
      .slice(0, MAX_KEY_SYMBOLS)
      .map((s) => `\`${s.name}\` (${s.type})`)
      .join(", ");
    lines.push(``, `### Key Symbols`, ``, symList);
  }

  // Entrypoints living inside this module
  const moduleEntrypoints = kb.entrypoints.filter(
    (ep) => ep.path.startsWith(mod.directory + "/") || ep.path === mod.directory,
  );
  if (moduleEntrypoints.length > 0) {
    lines.push(``, `### Entrypoints`, ``);
    for (const ep of moduleEntrypoints.slice(0, MAX_DIR_LINKS)) {
      lines.push(`- [${ep.type}] \`${ep.path}\` - ${ep.label}`);
    }
  }

  // Local dependency edges
  if (mod.importsFromDirs.length > 0) {
    lines.push(
      ``,
      `### Depends On`,
      ``,
      mod.importsFromDirs
        .slice(0, MAX_DIR_LINKS)
        .map((d) => `\`${d}/\``)
        .join(", "),
    );
  }
  if (mod.importedByDirs.length > 0) {
    lines.push(
      ``,
      `### Used By`,
      ``,
      mod.importedByDirs
        .slice(0, MAX_DIR_LINKS)
        .map((d) => `\`${d}/\``)
        .join(", "),
    );
  }

  // Tests touching this module
  const assocEntries = Object.entries(kb.testing.testAssociations)
    .filter(([source]) => source.startsWith(mod.directory + "/"))
    .sort(([a], [b]) => a.localeCompare(b));
  const gaps = kb.testing.testGaps.filter((g) => g.sourceFile.startsWith(mod.directory + "/"));
  if (assocEntries.length > 0 || gaps.length > 0) {
    lines.push(``, `### Tests`, ``);
    for (const [source, tests] of assocEntries.slice(0, MAX_TEST_LINKS)) {
      lines.push(`- \`${source}\` -> ${tests.map((t) => `\`${t}\``).join(", ")}`);
    }
    if (assocEntries.length > MAX_TEST_LINKS) {
      lines.push(`- ... and ${assocEntries.length - MAX_TEST_LINKS} more associations`);
    }
    if (gaps.length > 0) {
      lines.push(`- ${gaps.length} file(s) without test coverage in this module`);
    }
  }

  // Workspace package scripts: when this module lives inside a workspace
  // package with its own manifest, the NEAREST package scripts win over
  // root-level commands for module-local work.
  const ownerPackage = (index.project.workspacePackages ?? []).find(
    (p) => mod.directory === p.directory || mod.directory.startsWith(p.directory + "/"),
  );
  if (ownerPackage && ownerPackage.scriptNames.length > 0) {
    const preferred = [
      ...PREFERRED_PACKAGE_SCRIPTS.filter((s) => ownerPackage.scriptNames.includes(s)),
      ...ownerPackage.scriptNames.filter((s) => !PREFERRED_PACKAGE_SCRIPTS.includes(s)),
    ].slice(0, MAX_PACKAGE_SCRIPTS);
    lines.push(
      ``,
      `### Package Scripts (\`${ownerPackage.name}\`)`,
      ``,
      `This module belongs to the \`${ownerPackage.name}\` workspace package - run its own scripts for module-local work:`,
      ``,
    );
    for (const script of preferred) {
      lines.push(
        `- \`${renderWorkspaceScript(index.project.packageManager, ownerPackage.name, script)}\``,
      );
    }
  }

  // Conventions relevant to this module (mention the module path or apply
  // to feature folders when this is a feature module)
  const isFeatureModule = /(^|\/)features\//.test(mod.directory + "/");
  const relevant = conventions.filter(
    (c) =>
      c.text.includes(`\`${mod.directory}`) || (isFeatureModule && c.id === "feature-structure"),
  );
  if (relevant.length > 0) {
    lines.push(``, `### Conventions`, ``);
    for (const conv of relevant) {
      lines.push(`- ${conv.text}`);
    }
  }

  lines.push(``);
  return lines.join("\n");
}

/**
 * Build the per-module deep-dive reference files for the selected bounded
 * contexts. Returns an empty array when the index/kb lack module data.
 */
export function buildModuleReferences(
  kb: SkillKnowledgeBase | null,
  index: SourceIndex | null,
  conventions: DetectedConvention[],
): ModuleReferenceFile[] {
  if (!kb || !index) return [];
  return selectModuleReferenceTargets(kb).map((mod) => ({
    directory: mod.directory,
    relPath: `references/modules/${safeModuleName(mod.directory)}.md`,
    content: buildModuleReferenceContent(mod, kb, index, conventions),
  }));
}
