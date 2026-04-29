/**
 * Shared content generation for the create-skills command.
 * Produces deterministic, structured markdown from a SourceIndex.
 * Optionally includes AI-enriched best-practice sections.
 */

import type {
  SourceIndex,
  SourceIndexFile,
  AIEnrichmentOutput,
  SkillKnowledgeBase,
} from "../../types/index.js";
import { detectProfile, type SkillProfile } from "./profile.js";
import { buildSkillKnowledgeBase } from "./knowledge-base.js";

const MAX_HUB_FILES = 10;
const MAX_SYMBOLS_INLINE = 12;
const MAX_SYMBOLS_SHORT = 8;
const MAX_MODULE_DIRS = 15;
const MAX_FILES_PER_DIR = 5;
const MAX_HUB_FILE_DETAIL_LINES = 15;
const MAX_RISK_DETAIL_LINES = 3;
const MAX_TEST_ASSOC_ENTRIES = 20;
const MAX_TEST_GAP_ENTRIES = 30;
const MAX_DEP_TABLE_ENTRIES = 15;
const MAX_DEP_DETAIL_ENTRIES = 15;
const MAX_DEP_FILE_LIST = 5;
const MAX_RISK_ENTRIES = 20;
const MAX_SCRIPT_ENTRIES = 12;
const MAX_IMPORT_FROM_LIST = 5;

/** Clean a semver range for display: "^2.4.2" -> "2.4.2 (range ^2.4.2)" */
function cleanDisplayVersion(version: string): string {
  if (!version) return version;
  // Already a bare version
  if (/^\d/.test(version)) return version;
  // Has a range prefix - show both
  const bare = version.replace(/^[\^~>=<]+/, "");
  if (bare === version) return version;
  return `${bare} (range ${version})`;
}

export interface SkillSections {
  agentWorkflow: string;
  overview: string;
  architecture: string;
  hubFiles: string;
  modules: string;
  commands: string;
  conventions: string;
  profileRules: string;
  /** AI-enriched best-practice notes (null when AI enrichment is disabled) */
  aiEnrichment: string | null;
  codebaseMap: string;
  testingMap: string;
  dependencies: string;
  publicApi: string;
}

export interface GeneratedContent {
  projectName: string;
  projectVersion: string;
  frameworks: string[];
  profile: SkillProfile;
  sections: SkillSections;
}

export function generateContent(
  index: SourceIndex | null,
  projectName: string,
  enrichment?: AIEnrichmentOutput | null,
  knowledgeBase?: SkillKnowledgeBase | null,
): GeneratedContent {
  const name = index?.project.packageName ?? projectName;
  const version = index?.project.packageVersion ?? "unknown";
  const frameworks = index?.project.detectedFrameworks ?? [];
  const profile = detectProfile(index);

  // Build knowledge base internally if not provided
  const kb = knowledgeBase ?? (index ? buildSkillKnowledgeBase(index) : null);

  const sections: SkillSections = {
    agentWorkflow: buildAgentWorkflow(name, kb),
    overview: buildOverview(name, version, frameworks, index, profile),
    architecture: buildArchitecture(index),
    hubFiles: buildHubFiles(index),
    modules: buildModules(index),
    commands: buildCommands(index),
    conventions: buildConventions(index),
    profileRules: buildProfileRules(index, profile),
    aiEnrichment: enrichment ? buildAIEnrichment(enrichment) : null,
    codebaseMap: buildCodebaseMap(kb),
    testingMap: buildTestingMapSection(kb),
    dependencies: buildDependenciesSection(kb, enrichment),
    publicApi: buildPublicApiSection(kb),
  };

  return { projectName: name, projectVersion: version, frameworks, profile, sections };
}

function buildAgentWorkflow(projectName: string, kb: SkillKnowledgeBase | null): string {
  // Build instruction-files list from detected files or fallback to generic pattern
  let instructionFilesLine: string;
  const instructionFiles = kb?.instructionFiles;
  if (instructionFiles && instructionFiles.length > 0) {
    const fileList = instructionFiles.map((f) => `\`${f}\``).join(", ");
    instructionFilesLine = `2. **Read local agent instructions**: ${fileList}.`;
  } else {
    instructionFilesLine = `2. **Read local agent instructions**: \`AGENTS.md\`, \`CLAUDE.md\`, \`.agents/rules/\`, \`.agents/skills/\`, \`.cursor/rules/\`, \`.clinerules/\`.`;
  }

  // Reference file list from KB entrypoints or static
  const refFiles = kb
    ? [
        `   - \`references/codebase-map.md\` - ${kb.modules.length} module(s), ${kb.entrypoints.length} entrypoint(s)`,
        `   - \`references/testing-map.md\` - ${Object.keys(kb.testing.testAssociations).length} test association(s)`,
        `   - \`references/dependencies.md\` - ${kb.dependencies.length} dependency(s) tracked`,
        `   - \`references/public-api.md\` - ${kb.risks.length} risk item(s)`,
      ]
    : [
        `   - \`references/codebase-map.md\` - module ownership, key files, symbols`,
        `   - \`references/testing-map.md\` - test associations and gaps`,
        `   - \`references/dependencies.md\` - dependency versions and usage`,
        `   - \`references/public-api.md\` - public API surface and risks`,
      ];

  // Build quick-start examples from real index data
  const examples = buildSearchExamples(kb);

  const lines = [
    `## Required Agent Workflow`,
    ``,
    `Before writing any code for **${projectName}**, follow these steps in order:`,
    ``,
    `1. **Read this skill file** (SKILL.md) - understand the project profile, conventions, and pitfalls.`,
    instructionFilesLine,
    `3. **Before touching any file**, use source index diagnostics:`,
    `   - \`mp-sentinel indexing --agent-context <file> --index-format json\` - symbols, imports, dependents, suggested next commands`,
    `   - \`mp-sentinel indexing --explain-index <file> --index-format json\` - imports, dependents, symbols for the file`,
    `   - \`mp-sentinel indexing --find-symbol <name> --index-format json\` - search index for symbols (functions, classes, interfaces)`,
    `   - \`mp-sentinel indexing --find-import <package-or-path> --index-format json\` - search index for files importing a package or path`,
    `   - \`mp-sentinel indexing --stats --index-format json\` - index summary with insight counts`,
    `   - \`mp-sentinel --explain-context --format json --files <file>\` - review context enrichment`,
    `4. **Load only the relevant references** for the paths you touch:`,
    ...refFiles,
    `5. **Respect the profile rules** - each profile has specific review pitfalls listed below.`,
  ];

  if (examples.length > 0) {
    lines.push(``, examples);
  }

  return lines.join("\n");
}

/**
 * Build codebase-specific search examples from real index data.
 * Returns an empty string if KB is unavailable or no examples can be derived.
 */
function buildSearchExamples(kb: SkillKnowledgeBase | null): string {
  if (!kb) return "";

  const exampleLines: string[] = [];
  exampleLines.push(`**Quick-start search examples (from this codebase):**`);

  // Top hub file — use --agent-context to explore it
  const topHub = kb.risks
    .filter((r) => r.type === "hub-file")
    .sort((a, b) => (b.importCount ?? 0) - (a.importCount ?? 0))[0];
  if (topHub) {
    exampleLines.push(
      `   - \`mp-sentinel indexing --agent-context ${topHub.file} --index-format json\` - top hub file (imported by ${topHub.importCount} files)`,
    );
  }

  // Top dependency — use --find-import to see usage
  const topDep = kb.dependencies[0];
  if (topDep) {
    exampleLines.push(
      `   - \`mp-sentinel indexing --find-import ${topDep.packageName} --index-format json\` - top dependency (used by ${topDep.fileCount} files)`,
    );
  }

  // Representative command/source module — use --find-symbol for a key symbol
  // Try CLI entries first, then command entries, then any entrypoint
  const candidateEntries = [
    ...kb.entrypoints.filter((e) => e.type === "cli"),
    ...kb.entrypoints.filter((e) => e.type === "command"),
    ...kb.entrypoints,
  ];
  for (const entry of candidateEntries) {
    const mod = kb.modules.find(
      (m) =>
        entry.path.startsWith(m.directory + "/") ||
        entry.path === m.directory ||
        m.directory === "(root)",
    );
    const keySym = mod?.keySymbols[0];
    if (keySym) {
      exampleLines.push(
        `   - \`mp-sentinel indexing --find-symbol ${keySym.name} --index-format json\` - locate \`${keySym.name}\` (${keySym.type}) across the codebase`,
      );
      break;
    }
  }

  // Fallback: if no entrypoint-based symbol example, use largest module's first symbol
  if (exampleLines.length <= 2 && kb.modules.length > 0) {
    const largestModule = kb.modules[0]!;
    const keySym = largestModule.keySymbols[0];
    if (keySym) {
      exampleLines.push(
        `   - \`mp-sentinel indexing --find-symbol ${keySym.name} --index-format json\` - locate \`${keySym.name}\` (${keySym.type}) across the codebase`,
      );
    }
  }

  return exampleLines.length > 1 ? exampleLines.join("\n") : "";
}

function buildOverview(
  name: string,
  version: string,
  frameworks: string[],
  index: SourceIndex | null,
  profile: SkillProfile,
): string {
  const lines = [
    `## Overview`,
    ``,
    `**Project:** ${name} v${version}`,
    `**Profile:** ${profile}`,
    `**Frameworks:** ${frameworks.length > 0 ? frameworks.join(", ") : "none detected"}`,
  ];

  if (index) {
    if (index.project.nodeEngine) lines.push(`**Node Engine:** ${index.project.nodeEngine}`);
    if (index.project.packageManager)
      lines.push(`**Package Manager:** ${index.project.packageManager}`);
    lines.push(`**Indexed Files:** ${index.stats.indexedFiles}`);
    if (index.stats.importEdges !== undefined)
      lines.push(`**Import Edges (graph):** ${index.stats.importEdges}`);

    // Mention real entrypoints and key scripts when available (v1.0.16+)
    if (index.insights) {
      const cliEntries = Object.entries(index.insights.fileRoles)
        .filter(([, role]) => role === "cli-entry")
        .map(([path]) => path);
      const commandFiles = Object.entries(index.insights.fileRoles)
        .filter(([, role]) => role === "command")
        .map(([path]) => path);

      if (cliEntries.length > 0) {
        lines.push(
          `**CLI Entrypoints:** ${cliEntries
            .slice(0, 3)
            .map((p) => `\`${p}\``)
            .join(", ")}`,
        );
      }
      if (commandFiles.length > 0) {
        lines.push(
          `**Command Files:** ${commandFiles
            .slice(0, 3)
            .map((p) => `\`${p}\``)
            .join(", ")}${commandFiles.length > 3 ? ` (+${commandFiles.length - 3} more)` : ""}`,
        );
      }
    }

    // Mention key scripts from package.json
    const scripts = index.project.scripts;
    if (scripts && Object.keys(scripts).length > 0) {
      const pm = index.project.packageManager ?? "npm";
      const keyScripts = ["test", "build", "dev", "start", "typecheck", "lint", "format"].filter(
        (s) => scripts[s] !== undefined,
      );
      if (keyScripts.length > 0) {
        lines.push(
          `**Key Scripts:** ${keyScripts.map((s) => `\`${pm} ${s === "test" ? s : `run ${s}`}\``).join(", ")}`,
        );
      }
    }
  }

  return lines.join("\n");
}

function buildArchitecture(index: SourceIndex | null): string {
  if (!index || index.files.length === 0) {
    return "## Architecture\n\nNo source index available. Run `mp-sentinel indexing` first.";
  }

  const hasGraph = index.files.some((f) => (f.importsFrom ?? f.importedBy) !== undefined);

  const lines = [`## Architecture`];

  if (hasGraph) {
    lines.push(
      ``,
      `Graph-aware index (schema ${index.schemaVersion}). Import edges: ${index.stats.importEdges ?? 0}.`,
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
      lines.push(`- \`${dir}/\` - ${count} file(s)`);
    }
    if (topDirs.length > MAX_MODULE_DIRS) {
      lines.push(`- ... and ${topDirs.length - MAX_MODULE_DIRS} more`);
    }
  }

  return lines.join("\n");
}

function buildHubFiles(index: SourceIndex | null): string {
  if (!index || !index.files.some((f) => f.importedBy !== undefined)) return "";

  const hubFiles = index.files
    .filter((f) => (f.importedBy?.length ?? 0) > 1)
    .sort(
      (a, b) =>
        (b.importedBy?.length ?? 0) - (a.importedBy?.length ?? 0) || a.path.localeCompare(b.path),
    )
    .slice(0, MAX_HUB_FILES);

  if (hubFiles.length === 0) return "";

  const lines = [`## Hub Files (most imported)`];

  for (const file of hubFiles) {
    const entryLines: string[] = [];
    const importedByCount = file.importedBy?.length ?? 0;
    const topSymbols = file.symbols
      .slice(0, MAX_SYMBOLS_INLINE)
      .map((s) => `\`${s.name}\``)
      .join(", ");
    const overflow =
      file.symbols.length > MAX_SYMBOLS_INLINE
        ? ` (+${file.symbols.length - MAX_SYMBOLS_INLINE} more)`
        : "";

    entryLines.push(``, `### \`${file.path}\` - imported by ${importedByCount} file(s)`);
    if (topSymbols) entryLines.push(`Exports: ${topSymbols}${overflow}`);
    if ((file.importsFrom?.length ?? 0) > 0) {
      const deps = file
        .importsFrom!.slice(0, MAX_IMPORT_FROM_LIST)
        .map((p) => `\`${p}\``)
        .join(", ");
      entryLines.push(`Depends on: ${deps}`);
    }

    if (entryLines.length > MAX_HUB_FILE_DETAIL_LINES) {
      entryLines.splice(MAX_HUB_FILE_DETAIL_LINES);
      entryLines.push("... (truncated)");
    }
    lines.push(...entryLines);
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
  const sorted = [...moduleMap.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  );

  for (const [dir, files] of sorted.slice(0, MAX_MODULE_DIRS)) {
    lines.push(``, `### \`${dir}/\` (${files.length} file(s))`);

    const keyFiles = files
      .filter((f) => f.symbols.length > 0)
      .sort((a, b) => b.symbols.length - a.symbols.length || a.path.localeCompare(b.path))
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
      lines.push(`- ... and ${files.length - MAX_FILES_PER_DIR} more files`);
    }
  }

  return lines.join("\n");
}

function buildCommands(index: SourceIndex | null): string {
  const pm = index?.project.packageManager ?? "npm";

  const lines = [`## Development Commands`, ``, `Package manager: \`${pm}\``, ``];

  // Use real scripts from index when available
  const scripts = index?.project.scripts;
  if (scripts && Object.keys(scripts).length > 0) {
    lines.push("```sh");
    const scriptKeys = Object.keys(scripts).slice(0, MAX_SCRIPT_ENTRIES);
    for (const key of scriptKeys) {
      const cmd = scripts[key] ?? key;
      lines.push(`${pm}${key === "test" ? " " : " run "}${key}  # ${cmd}`);
    }
    if (Object.keys(scripts).length > MAX_SCRIPT_ENTRIES) {
      lines.push(`# ... and ${Object.keys(scripts).length - MAX_SCRIPT_ENTRIES} more scripts`);
    }
    lines.push("```");
  } else {
    lines.push(
      "```sh",
      `${pm} test           # Run tests`,
      `${pm} run build      # Build project`,
      "```",
    );
  }

  return lines.join("\n");
}

function buildConventions(index: SourceIndex | null): string {
  if (!index || index.files.length === 0) return "";

  const lines = [`## Code Conventions`];

  const hasEsm = index.files.some((f) => f.imports.some((i) => i.source.endsWith(".js")));
  if (hasEsm) {
    lines.push(``, `- **Module System:** ESM - internal imports include \`.js\` extension`);
  }

  const hasTs = index.files.some((f) => f.language === "typescript" || f.language === "tsx");
  if (hasTs) {
    lines.push(`- **Language:** TypeScript - use \`import type\` for type-only imports`);
  }

  const testFileCount = index.files.filter(
    (f) => f.path.includes(".test.") || f.path.includes(".spec.") || f.path.includes("__tests__"),
  ).length;
  if (testFileCount > 0) {
    lines.push(`- **Tests:** ${testFileCount} test file(s) found`);
  }

  return lines.join("\n");
}

function buildProfileRules(index: SourceIndex | null, profile: SkillProfile): string {
  const lines = [`## Project Profile: ${profile}`];

  // ── Commands ──
  const pm = index?.project.packageManager ?? "npm";
  const scripts = index?.project.scripts ?? {};
  const scriptKeys = Object.keys(scripts).sort();

  lines.push(``, `### Commands`, ``, `Package manager: \`${pm}\``, ``);

  if (scriptKeys.length > 0) {
    lines.push("```sh");
    for (const key of scriptKeys.slice(0, MAX_SCRIPT_ENTRIES)) {
      lines.push(`${pm} run ${key}  # ${scripts[key]}`);
    }
    if (scriptKeys.length > MAX_SCRIPT_ENTRIES) {
      lines.push(`# ... and ${scriptKeys.length - MAX_SCRIPT_ENTRIES} more scripts`);
    }
    lines.push("```");
  } else {
    lines.push("_No scripts found in package.json._");
  }

  // ── Module Ownership ──
  if (index && index.files.length > 0) {
    const moduleMap = new Map<string, SourceIndexFile[]>();
    for (const file of index.files) {
      const slash = file.path.indexOf("/");
      const topDir = slash === -1 ? "(root)" : file.path.slice(0, slash);
      const bucket = moduleMap.get(topDir) ?? [];
      bucket.push(file);
      moduleMap.set(topDir, bucket);
    }

    const sorted = [...moduleMap.entries()].sort(
      (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
    );
    if (sorted.length > 0) {
      lines.push(
        ``,
        `### Module Ownership`,
        ``,
        `Top-level directories and their responsibilities:`,
        ``,
      );
      for (const [dir, files] of sorted.slice(0, MAX_MODULE_DIRS)) {
        const testCount = files.filter(
          (f) =>
            f.path.includes(".test.") || f.path.includes(".spec.") || f.path.includes("__tests__"),
        ).length;
        const testNote = testCount > 0 ? ` (${testCount} test files)` : "";
        lines.push(`- \`${dir}/\` - ${files.length} source file(s)${testNote}`);
      }
    }
  }

  // ── Import Conventions ──
  lines.push(``, `### Import Conventions`, ``);
  if (index) {
    const hasEsm = index.files.some((f) => f.imports.some((i) => i.source.endsWith(".js")));
    if (hasEsm) {
      lines.push(`- Internal imports **must** include the \`.js\` extension (ESM).`);
    }
    const hasTs = index.files.some((f) => f.language === "typescript" || f.language === "tsx");
    if (hasTs) {
      lines.push(`- Use \`import type\` for type-only imports.`);
    }
    const hasNodePrefix = index.files.some((f) =>
      f.imports.some((i) => i.source.startsWith("node:")),
    );
    if (hasNodePrefix) {
      lines.push(`- Built-in modules must use the \`node:\` prefix.`);
    }
    const tsConfigPaths = index.project.tsConfig?.compilerOptions?.paths;
    if (tsConfigPaths && Object.keys(tsConfigPaths as Record<string, unknown>).length > 0) {
      lines.push(
        `- Respect \`tsconfig.json\` path aliases - do not bypass with relative traversals.`,
      );
    }
  } else {
    lines.push(`_No source index available - conventions cannot be inferred._`);
  }

  // ── Test Expectations ──
  if (index) {
    const testFiles = index.files.filter(
      (f) => f.path.includes(".test.") || f.path.includes(".spec.") || f.path.includes("__tests__"),
    );
    if (testFiles.length > 0) {
      lines.push(
        ``,
        `### Test Expectations`,
        ``,
        `- ${testFiles.length} test file(s) indexed.`,
        `- Run \`${pm} test\` before committing changes that touch logic.`,
        `- Do not skip failing tests without a \`TODO\` comment linking to an issue.`,
      );
    }
  }

  // ── Review Pitfalls (profile-specific) ──
  lines.push(``, `### Review Pitfalls`, ``);
  switch (profile) {
    case "cli-tooling":
      lines.push(
        `- **Exit codes are a contract** - never change 0/1/2 semantics without a breaking-change note.`,
        `- **Diff-first review** - do not send full file content to the AI when \`diff\` + context is sufficient.`,
        `- **Keep CLI parsing separate** - argument parsing belongs in a dedicated \`src/cli/\` layer, not inside command implementations.`,
        `- **No business logic in \`src/index.ts\`** - entry files should only route, never contain core logic.`,
        `- **Watch for breaking changes in scripts** - renaming a script or changing its side-effects is a breaking change for consumers.`,
      );
      break;
    case "node-service":
      lines.push(
        `- **Handler purity** - route handlers should be thin; delegate to services / repositories.`,
        `- **Error middleware** - unhandled errors must be caught by centralized error middleware, never leak stack traces in production.`,
        `- **Env config validation** - validate all \`process.env\` reads at startup; fail fast on missing required variables.`,
        `- **Async boundaries** - always await or explicitly catch promises in request handlers to prevent unhandled rejections.`,
        `- **Health checks** - any new dependency (DB, cache, queue) needs a corresponding health-check probe.`,
      );
      break;
    case "react-next":
      lines.push(
        `- **Server/Client boundary** - avoid importing server-only modules into client components; use the \`'use server'\` / \`'use client'\` split explicitly.`,
        `- **Data fetching colocation** - keep data fetching close to the component that consumes it; do not prop-drill fetched data across >2 layers.`,
        `- **No direct DOM mutations in React** - use refs and effects, never direct \`document.querySelector\` manipulation outside of isolated helpers.`,
        `- **Image optimization** - prefer \`next/image\` over raw \`<img>\` tags.`,
        `- **Bundle size vigilance** - adding a new dependency to a page-level component can bloat the route chunk; audit with \`next bundle-analyzer\` if available.`,
      );
      break;
    case "library":
    default:
      lines.push(
        `- **Public API surface** - every exported symbol is a commitment; prefer keeping internals un-exported.`,
        `- **SemVer awareness** - removing or renaming an exported symbol requires a major version bump.`,
        `- **Type definitions** - if TypeScript is used, ensure d.ts files or inline types ship with the build artifact.`,
        `- **Peer dependencies** - be explicit about peer deps; avoid accidental bundling of framework code.`,
        `- **Tree-shakeability** - use named exports and avoid side-effectful top-level code to help bundlers eliminate dead code.`,
      );
      break;
  }

  return lines.join("\n");
}

// ── Codebase Map ──────────────────────────────────────────────────────────

function buildCodebaseMap(kb: SkillKnowledgeBase | null): string {
  if (!kb) return "## Codebase Map\n\nNo source index available. Run `mp-sentinel indexing` first.";

  const lines = [`## Codebase Map`];

  // Module Ownership
  if (kb.modules.length > 0) {
    lines.push(``, `### Module Ownership`, ``);
    for (const mod of kb.modules) {
      lines.push(`#### \`${mod.directory}/\` - ${mod.dominantRole}`);
      lines.push(`- ${mod.sourceFileCount} source file(s), ${mod.testFileCount} test file(s)`);
      if (mod.keyFiles.length > 0) {
        lines.push(`- Key files: ${mod.keyFiles.map((f) => `\`${f}\``).join(", ")}`);
      }
      if (mod.keySymbols.length > 0) {
        lines.push(
          `- Key symbols: ${mod.keySymbols.map((s) => `\`${s.name}\` (${s.type})`).join(", ")}`,
        );
      }
      if (mod.importsFromDirs.length > 0) {
        lines.push(`- Imports from: ${mod.importsFromDirs.map((d) => `\`${d}/\``).join(", ")}`);
      }
      if (mod.importedByDirs.length > 0) {
        lines.push(`- Imported by: ${mod.importedByDirs.map((d) => `\`${d}/\``).join(", ")}`);
      }
      lines.push(``);
    }
  }

  // Entrypoints
  if (kb.entrypoints.length > 0) {
    lines.push(`### Entrypoints`, ``);
    for (const ep of kb.entrypoints) {
      const icon =
        ep.type === "cli"
          ? "CLI"
          : ep.type === "public-api"
            ? "API"
            : ep.type === "command"
              ? "CMD"
              : "CFG";
      lines.push(`- **[${icon}]** \`${ep.path}\` - ${ep.label}`);
    }
  }

  return lines.join("\n");
}

// ── Testing Map ────────────────────────────────────────────────────────────

function buildTestingMapSection(kb: SkillKnowledgeBase | null): string {
  if (!kb) return "## Testing Map\n\nNo source index available. Run `mp-sentinel indexing` first.";

  const lines = [`## Testing Map`];

  // Test Associations
  const assocEntries = Object.entries(kb.testing.testAssociations).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  if (assocEntries.length > 0) {
    lines.push(``, `### Test Associations`, ``);
    lines.push(`| Source File | Test File(s) |`);
    lines.push(`|---|---|`);
    for (const [source, tests] of assocEntries.slice(0, MAX_TEST_ASSOC_ENTRIES)) {
      lines.push(`| \`${source}\` | ${tests.map((t) => `\`${t}\``).join(", ")} |`);
    }
    if (assocEntries.length > MAX_TEST_ASSOC_ENTRIES) {
      lines.push(`| ... | ${assocEntries.length - MAX_TEST_ASSOC_ENTRIES} more ... |`);
    }
    lines.push(``);
  }

  // Test Gaps
  if (kb.testing.testGaps.length > 0) {
    lines.push(`### Test Gaps`, ``);
    lines.push(`Files with no associated test coverage:`);
    for (const gap of kb.testing.testGaps.slice(0, MAX_TEST_GAP_ENTRIES)) {
      lines.push(
        `- \`${gap.sourceFile}\` - ${gap.reason === "no-test-file" ? "no test file found" : "no import-graph match"}`,
      );
    }
    if (kb.testing.testGaps.length > MAX_TEST_GAP_ENTRIES) {
      lines.push(`- ... and ${kb.testing.testGaps.length - MAX_TEST_GAP_ENTRIES} more`);
    }
    lines.push(``);
  }

  // Most Tested Modules
  if (kb.testing.mostTestedModules.length > 0) {
    lines.push(`### Most Tested Modules`, ``);
    for (const mod of kb.testing.mostTestedModules) {
      lines.push(`- \`${mod.directory}/\` - ${mod.testFileCount} test file(s)`);
    }
  }

  return lines.join("\n");
}

// ── Dependencies ───────────────────────────────────────────────────────────

function buildDependenciesSection(
  kb: SkillKnowledgeBase | null,
  enrichment?: AIEnrichmentOutput | null,
): string {
  if (!kb) return "## Dependencies\n\nNo source index available. Run `mp-sentinel indexing` first.";

  const lines = [`## Dependencies`];

  if (kb.dependencies.length > 0) {
    lines.push(``, `### Top Dependencies (by usage)`, ``);
    lines.push(`| Package | Version | Used By |`);
    lines.push(`|---|---|---|`);
    for (const dep of kb.dependencies.slice(0, MAX_DEP_TABLE_ENTRIES)) {
      const displayVersion = cleanDisplayVersion(dep.version);
      lines.push(`| \`${dep.packageName}\` | ${displayVersion} | ${dep.fileCount} file(s) |`);
    }
    lines.push(``);

    lines.push(`### Dependency Details`, ``);
    for (const dep of kb.dependencies.slice(0, MAX_DEP_DETAIL_ENTRIES)) {
      const fileList = dep.files
        .slice(0, MAX_DEP_FILE_LIST)
        .map((f) => `\`${f}\``)
        .join(", ");
      const overflow =
        dep.files.length > MAX_DEP_FILE_LIST
          ? ` (+${dep.files.length - MAX_DEP_FILE_LIST} more)`
          : "";
      const displayVersion = cleanDisplayVersion(dep.version);
      lines.push(`- **${dep.packageName}** v${displayVersion} - used by: ${fileList}${overflow}`);
    }
  }

  // Append AI enrichment if available
  if (enrichment) {
    const aiContent = buildAIEnrichment(enrichment);
    if (aiContent) {
      lines.push(``, aiContent);
    }
  }

  return lines.join("\n");
}

// ── Public API ─────────────────────────────────────────────────────────────

function buildPublicApiSection(kb: SkillKnowledgeBase | null): string {
  if (!kb) return "## Public API\n\nNo source index available. Run `mp-sentinel indexing` first.";

  const lines = [`## Public API Surface`];

  // Entry points
  const apiEntries = kb.entrypoints.filter((ep) => ep.type === "public-api" || ep.type === "cli");
  if (apiEntries.length > 0) {
    lines.push(``, `### Entry Points`, ``);
    for (const ep of apiEntries) {
      lines.push(`- \`${ep.path}\` - ${ep.label}`);
    }
  }

  // Risk Surface
  if (kb.risks.length > 0) {
    lines.push(``, `### Risk Surface`, ``);
    const riskCounts = new Map<string, number>();
    for (const r of kb.risks) {
      riskCounts.set(r.type, (riskCounts.get(r.type) ?? 0) + 1);
    }
    lines.push(`| Risk Type | Count |`);
    lines.push(`|---|---|`);
    for (const [type, count] of [...riskCounts.entries()].sort()) {
      lines.push(`| ${type} | ${count} |`);
    }
    lines.push(``);

    lines.push(`### Risk Details`, ``);
    const riskEntries = kb.risks.slice(0, MAX_RISK_ENTRIES);
    for (let i = 0; i < riskEntries.length; i++) {
      const risk = riskEntries[i]!;
      const extra = risk.importCount !== undefined ? ` (${risk.importCount} importers)` : "";
      let detail = risk.detail;
      // Cap detail lines
      const detailLines = detail.split("\n");
      if (detailLines.length > MAX_RISK_DETAIL_LINES) {
        detail = detailLines.slice(0, MAX_RISK_DETAIL_LINES).join("\n") + "\n... (truncated)";
      }
      lines.push(`- **${risk.type}**: \`${risk.file}\`${extra} - ${detail}`);
    }
    if (kb.risks.length > MAX_RISK_ENTRIES) {
      lines.push(`- ... and ${kb.risks.length - MAX_RISK_ENTRIES} more risks`);
    }
  }

  return lines.join("\n");
}

// ── AI Enrichment sections ──────────────────────────────────────────────────

/**
 * Build AI-enriched best-practice sections from AIEnrichmentOutput.
 * Returns an empty string if there are no rules to display.
 */
function buildAIEnrichment(enrichment: AIEnrichmentOutput): string {
  const parts: string[] = [];

  if (enrichment.languageRules.length > 0) {
    parts.push(`## AI-Enriched Language & Framework Rules`, ``);
    for (const rule of enrichment.languageRules) {
      parts.push(`- ${rule}`);
    }
    parts.push(``);
  }

  if (enrichment.libraryRules.length > 0) {
    parts.push(`## AI-Enriched Library Best Practices`, ``);
    for (const rule of enrichment.libraryRules) {
      parts.push(`- ${rule}`);
    }
    parts.push(``);
  }

  if (enrichment.versionNotes.length > 0) {
    parts.push(`## AI-Enriched Version Notes`, ``);
    for (const note of enrichment.versionNotes) {
      parts.push(`- ${note}`);
    }
    parts.push(``);
  }

  if (enrichment.riskWarnings.length > 0) {
    parts.push(`## AI-Enriched Risk Warnings`, ``);
    for (const warning of enrichment.riskWarnings) {
      parts.push(`- ${warning}`);
    }
    parts.push(``);
  }

  if (enrichment.recommendedChecks.length > 0) {
    parts.push(`## AI-Enriched Recommended Checks`, ``);
    for (const check of enrichment.recommendedChecks) {
      parts.push(`- ${check}`);
    }
    parts.push(``);
  }

  return parts.join("\n").trim();
}
