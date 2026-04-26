/**
 * Shared content generation for the create-skills command.
 * Produces deterministic, structured markdown from a SourceIndex.
 */

import type { SourceIndex, SourceIndexFile } from "../../types/index.js";

const MAX_HUB_FILES = 10;
const MAX_SYMBOLS_INLINE = 12;
const MAX_SYMBOLS_SHORT = 8;
const MAX_MODULE_DIRS = 15;
const MAX_FILES_PER_DIR = 5;

export interface SkillSections {
  overview: string;
  architecture: string;
  hubFiles: string;
  modules: string;
  commands: string;
  conventions: string;
}

export interface GeneratedContent {
  projectName: string;
  projectVersion: string;
  frameworks: string[];
  sections: SkillSections;
}

export function generateContent(index: SourceIndex | null, projectName: string): GeneratedContent {
  const name = index?.project.packageName ?? projectName;
  const version = index?.project.packageVersion ?? "unknown";
  const frameworks = index?.project.detectedFrameworks ?? [];

  const sections: SkillSections = {
    overview: buildOverview(name, version, frameworks, index),
    architecture: buildArchitecture(index),
    hubFiles: buildHubFiles(index),
    modules: buildModules(index),
    commands: buildCommands(index),
    conventions: buildConventions(index),
  };

  return { projectName: name, projectVersion: version, frameworks, sections };
}

function buildOverview(
  name: string,
  version: string,
  frameworks: string[],
  index: SourceIndex | null,
): string {
  const lines = [
    `## Overview`,
    ``,
    `**Project:** ${name} v${version}`,
    `**Frameworks:** ${frameworks.length > 0 ? frameworks.join(", ") : "none detected"}`,
  ];

  if (index) {
    if (index.project.nodeEngine) lines.push(`**Node Engine:** ${index.project.nodeEngine}`);
    if (index.project.packageManager)
      lines.push(`**Package Manager:** ${index.project.packageManager}`);
    lines.push(`**Indexed Files:** ${index.stats.indexedFiles}`);
    if (index.stats.importEdges !== undefined)
      lines.push(`**Import Edges (graph):** ${index.stats.importEdges}`);
  }

  return lines.join("\n");
}

function buildArchitecture(index: SourceIndex | null): string {
  if (!index || index.files.length === 0) {
    return "## Architecture\n\nNo source index available. Run `mp-sentinel indexing` first.";
  }

  const hasGraph =
    index.schemaVersion === "1.1" &&
    index.files.some((f) => (f.importsFrom ?? f.importedBy) !== undefined);

  const lines = [`## Architecture`];

  if (hasGraph) {
    lines.push(
      ``,
      `Graph-aware index (schema 1.1). Import edges: ${index.stats.importEdges ?? 0}.`,
    );
  }

  const topDirs = [
    ...new Set(
      index.files.map((f) => {
        const slash = f.path.indexOf("/");
        return slash === -1 ? "(root)" : f.path.slice(0, slash);
      }),
    ),
  ].sort();

  if (topDirs.length > 0) {
    lines.push(``, `### Top-level directories`, ``);
    for (const dir of topDirs.slice(0, MAX_MODULE_DIRS)) {
      const count = index.files.filter((f) =>
        dir === "(root)" ? !f.path.includes("/") : f.path.startsWith(`${dir}/`),
      ).length;
      lines.push(`- \`${dir}/\` — ${count} file(s)`);
    }
    if (topDirs.length > MAX_MODULE_DIRS) {
      lines.push(`- … and ${topDirs.length - MAX_MODULE_DIRS} more`);
    }
  }

  return lines.join("\n");
}

function buildHubFiles(index: SourceIndex | null): string {
  if (!index || index.schemaVersion !== "1.1") return "";

  const hubFiles = index.files
    .filter((f) => (f.importedBy?.length ?? 0) > 1)
    .sort((a, b) => (b.importedBy?.length ?? 0) - (a.importedBy?.length ?? 0))
    .slice(0, MAX_HUB_FILES);

  if (hubFiles.length === 0) return "";

  const lines = [`## Hub Files (most imported)`];

  for (const file of hubFiles) {
    const importedByCount = file.importedBy?.length ?? 0;
    const topSymbols = file.symbols
      .slice(0, MAX_SYMBOLS_INLINE)
      .map((s) => `\`${s.name}\``)
      .join(", ");
    const overflow =
      file.symbols.length > MAX_SYMBOLS_INLINE
        ? ` (+${file.symbols.length - MAX_SYMBOLS_INLINE} more)`
        : "";

    lines.push(``, `### \`${file.path}\` — imported by ${importedByCount} file(s)`);
    if (topSymbols) lines.push(`Exports: ${topSymbols}${overflow}`);
    if ((file.importsFrom?.length ?? 0) > 0) {
      const deps = file
        .importsFrom!.slice(0, 5)
        .map((p) => `\`${p}\``)
        .join(", ");
      lines.push(`Depends on: ${deps}`);
    }
  }

  return lines.join("\n");
}

function buildModules(index: SourceIndex | null): string {
  if (!index || index.files.length === 0) {
    return "## Module Map\n\nNo source index available.";
  }

  const moduleMap = new Map<string, SourceIndexFile[]>();
  for (const file of index.files) {
    const slash = file.path.indexOf("/");
    const topDir = slash === -1 ? "(root)" : file.path.slice(0, slash);
    const bucket = moduleMap.get(topDir) ?? [];
    bucket.push(file);
    moduleMap.set(topDir, bucket);
  }

  const lines = [`## Module Map`];
  const sorted = [...moduleMap.entries()].sort((a, b) => b[1].length - a[1].length);

  for (const [dir, files] of sorted.slice(0, MAX_MODULE_DIRS)) {
    lines.push(``, `### \`${dir}/\` (${files.length} file(s))`);

    const keyFiles = files
      .filter((f) => f.symbols.length > 0)
      .sort((a, b) => b.symbols.length - a.symbols.length)
      .slice(0, MAX_FILES_PER_DIR);

    for (const file of keyFiles) {
      const syms = file.symbols
        .slice(0, MAX_SYMBOLS_SHORT)
        .map((s) => `${s.type} \`${s.name}\``)
        .join(", ");
      const overflow =
        file.symbols.length > MAX_SYMBOLS_SHORT
          ? ` (+${file.symbols.length - MAX_SYMBOLS_SHORT} more)`
          : "";
      lines.push(`- **\`${file.path}\`**: ${syms}${overflow}`);
    }

    if (files.length > MAX_FILES_PER_DIR) {
      lines.push(`- … and ${files.length - MAX_FILES_PER_DIR} more files`);
    }
  }

  return lines.join("\n");
}

function buildCommands(index: SourceIndex | null): string {
  const pm = index?.project.packageManager ?? "npm";
  const hasTs =
    index?.project.dependencies?.["typescript"] !== undefined ||
    index?.project.devDependencies?.["typescript"] !== undefined;

  const lines = [
    `## Development Commands`,
    ``,
    `Package manager: \`${pm}\``,
    ``,
    "```sh",
    `${pm} test           # Run tests`,
    `${pm} run build      # Build project`,
    "```",
  ];

  if (hasTs) {
    lines.push(``, "```sh", `${pm} run typecheck  # TypeScript type-check`, "```");
  }

  return lines.join("\n");
}

function buildConventions(index: SourceIndex | null): string {
  if (!index || index.files.length === 0) return "";

  const lines = [`## Code Conventions`];

  const hasEsm = index.files.some((f) => f.imports.some((i) => i.source.endsWith(".js")));
  if (hasEsm) {
    lines.push(``, `- **Module System:** ESM — internal imports include \`.js\` extension`);
  }

  const hasTs = index.files.some((f) => f.language === "typescript" || f.language === "tsx");
  if (hasTs) {
    lines.push(`- **Language:** TypeScript — use \`import type\` for type-only imports`);
  }

  const testFileCount = index.files.filter(
    (f) => f.path.includes(".test.") || f.path.includes(".spec.") || f.path.includes("__tests__"),
  ).length;
  if (testFileCount > 0) {
    lines.push(`- **Tests:** ${testFileCount} test file(s) found`);
  }

  return lines.join("\n");
}
