/**
 * Shared content generation for the create-skills command.
 * Produces deterministic, structured markdown from a SourceIndex.
 */

import type { SourceIndex, SourceIndexFile } from "../../types/index.js";
import { detectProfile, type SkillProfile } from "./profile.js";

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
  profileRules: string;
}

export interface GeneratedContent {
  projectName: string;
  projectVersion: string;
  frameworks: string[];
  profile: SkillProfile;
  sections: SkillSections;
}

export function generateContent(index: SourceIndex | null, projectName: string): GeneratedContent {
  const name = index?.project.packageName ?? projectName;
  const version = index?.project.packageVersion ?? "unknown";
  const frameworks = index?.project.detectedFrameworks ?? [];
  const profile = detectProfile(index);

  const sections: SkillSections = {
    overview: buildOverview(name, version, frameworks, index, profile),
    architecture: buildArchitecture(index),
    hubFiles: buildHubFiles(index),
    modules: buildModules(index),
    commands: buildCommands(index),
    conventions: buildConventions(index),
    profileRules: buildProfileRules(index, profile),
  };

  return { projectName: name, projectVersion: version, frameworks, profile, sections };
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

function buildProfileRules(index: SourceIndex | null, profile: SkillProfile): string {
  const lines = [`## Project Profile: ${profile}`];

  // ── Commands ──
  const pm = index?.project.packageManager ?? "npm";
  const scripts = index?.project.scripts ?? {};
  const scriptKeys = Object.keys(scripts).sort();

  lines.push(``, `### Commands`, ``, `Package manager: \`${pm}\``, ``);

  if (scriptKeys.length > 0) {
    lines.push("```sh");
    for (const key of scriptKeys.slice(0, 12)) {
      lines.push(`${pm} run ${key}  # ${scripts[key]}`);
    }
    if (scriptKeys.length > 12) {
      lines.push(`# … and ${scriptKeys.length - 12} more scripts`);
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

    const sorted = [...moduleMap.entries()].sort((a, b) => b[1].length - a[1].length);
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
        lines.push(`- \`${dir}/\` — ${files.length} source file(s)${testNote}`);
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
        `- Respect \`tsconfig.json\` path aliases — do not bypass with relative traversals.`,
      );
    }
  } else {
    lines.push(`_No source index available — conventions cannot be inferred._`);
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
        `- **Exit codes are a contract** — never change 0/1/2 semantics without a breaking-change note.`,
        `- **Diff-first review** — do not send full file content to the AI when \`diff\` + context is sufficient.`,
        `- **Keep CLI parsing separate** — argument parsing belongs in a dedicated \`src/cli/\` layer, not inside command implementations.`,
        `- **No business logic in \`src/index.ts\`** — entry files should only route, never contain core logic.`,
        `- **Watch for breaking changes in scripts** — renaming a script or changing its side-effects is a breaking change for consumers.`,
      );
      break;
    case "node-service":
      lines.push(
        `- **Handler purity** — route handlers should be thin; delegate to services / repositories.`,
        `- **Error middleware** — unhandled errors must be caught by centralized error middleware, never leak stack traces in production.`,
        `- **Env config validation** — validate all \`process.env\` reads at startup; fail fast on missing required variables.`,
        `- **Async boundaries** — always await or explicitly catch promises in request handlers to prevent unhandled rejections.`,
        `- **Health checks** — any new dependency (DB, cache, queue) needs a corresponding health-check probe.`,
      );
      break;
    case "react-next":
      lines.push(
        `- **Server/Client boundary** — avoid importing server-only modules into client components; use the \`'use server'\` / \`'use client'\` split explicitly.`,
        `- **Data fetching colocation** — keep data fetching close to the component that consumes it; do not prop-drill fetched data across >2 layers.`,
        `- **No direct DOM mutations in React** — use refs and effects, never direct \`document.querySelector\` manipulation outside of isolated helpers.`,
        `- **Image optimization** — prefer \`next/image\` over raw \`<img>\` tags.`,
        `- **Bundle size vigilance** — adding a new dependency to a page-level component can bloat the route chunk; audit with \`next bundle-analyzer\` if available.`,
      );
      break;
    case "library":
    default:
      lines.push(
        `- **Public API surface** — every exported symbol is a commitment; prefer keeping internals un-exported.`,
        `- **SemVer awareness** — removing or renaming an exported symbol requires a major version bump.`,
        `- **Type definitions** — if TypeScript is used, ensure \`d.ts\` files or inline types ship with the build artifact.`,
        `- **Peer dependencies** — be explicit about peer deps; avoid accidental bundling of framework code.`,
        `- **Tree-shakeability** — use named exports and avoid side-effectful top-level code to help bundlers eliminate dead code.`,
      );
      break;
  }

  return lines.join("\n");
}
