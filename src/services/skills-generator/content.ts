/**
 * Shared content generation for the create-skills command.
 * Produces deterministic, structured markdown from a SourceIndex.
 * Optionally includes AI-enriched best-practice sections.
 */

import type {
  DepMapEntry,
  SourceIndex,
  SourceIndexFile,
  AIEnrichmentOutput,
  SkillKnowledgeBase,
  LanguageProfile,
  CodeStyleProfile,
  CreateSkillsPolicies,
} from "../../types/index.js";
import { DEFAULT_CREATE_SKILLS_POLICIES } from "../../types/index.js";
import { detectLanguageProfile } from "./language-profile.js";
import { detectProfile, type SkillProfile } from "./profile.js";
import { selectActiveRulePacks, resolveSafeMajor } from "./rule-packs/index.js";
import { buildSkillKnowledgeBase } from "./knowledge-base.js";
import { PROJECT_RULES_END_MARKER, PROJECT_RULES_START_MARKER } from "./constants.js";
import {
  buildDetectedConventionsSection,
  detectProjectConventions,
} from "./convention-detectors.js";
import { moduleKeyForPath } from "./module-grouping.js";
import { safeModuleName, selectModuleReferenceTargets } from "./module-references.js";
import { buildCommonChangePathsSection, buildFirstFilesSection } from "./usability-sections.js";
import {
  renderRegenerateCommand,
  renderRunScript,
  renderScriptAwareToolCommand,
  renderToolCommand,
} from "./package-manager.js";
import {
  enabledStrictFlags,
  recommendsImportType,
  requiresJsImportExtensions,
} from "./ts-project-flags.js";

const MAX_HUB_FILES = 10;
const MAX_SYMBOLS_INLINE = 12;
const MAX_SYMBOLS_SHORT = 8;
const MAX_MODULE_DIRS = 10;
const MAX_FILES_PER_DIR = 4;
const MAX_KB_MODULES = 10;
const MAX_KB_KEY_FILES = 4;
const MAX_KB_KEY_SYMBOLS = 6;
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

export interface ReferenceFileContent {
  codeStyle: string;
  languagePatterns: string;
  cleanCodeChecklist: string;
  customRules: string;
}

export interface SkillSections {
  agentWorkflow: string;
  /**
   * Project-authored rules from `.mp-sentinelrc.json` (`rules` / `ruleFiles`).
   * Rendered ABOVE generated references — these override generated guidance.
   * Empty string when the project defines no local rules.
   */
  projectRules: string;
  /**
   * Compact agent workflow for single-file rule adapters: same contract
   * (read rules first, index diagnostics) but without the reference-file
   * list, since rule outputs ship no references/ directory.
   */
  agentWorkflowCompact: string;
  referenceRouting: string;
  overview: string;
  /**
   * Conventions observed deterministically from config and the import graph
   * (path aliases, feature-folder layout, central HTTP client, query keys,
   * UI system roots). Empty string when none detected.
   */
  detectedConventions: string;
  /** Orientation list grounded by entrypoints + hub files ("" when no data) */
  firstFilesToRead: string;
  /** Task -> directories table for feature/API/UI/test work ("" when no data) */
  commonChangePaths: string;
  architecture: string;
  hubFiles: string;
  modules: string;
  commands: string;
  conventions: string;
  profileRules: string;
  /** Deterministic language & framework rules from rule packs */
  languageRules: string;
  /** Clean code policy section */
  cleanCodePolicy: string;
  /** File size policy section */
  fileSizePolicy: string;
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
  languageProfile: LanguageProfile;
  sections: SkillSections;
  references: ReferenceFileContent;
}

export function generateContent(
  index: SourceIndex | null,
  projectName: string,
  enrichment?: AIEnrichmentOutput | null,
  knowledgeBase?: SkillKnowledgeBase | null,
  codeStyleProfile?: CodeStyleProfile | null,
  policies?: CreateSkillsPolicies | null,
  /**
   * Rule ids (Phase 4.3) to drop from the generated rule list. Passed
   * straight through to `selectActiveRulePacks`. Undefined means no rules
   * are disabled.
   */
  disableRules?: readonly string[],
): GeneratedContent {
  const name = index?.project.packageName ?? projectName;
  const version = index?.project.packageVersion ?? "unknown";
  const frameworks = index?.project.detectedFrameworks ?? [];
  const profile = detectProfile(index);
  const languageProfile = index
    ? detectLanguageProfile(index)
    : {
        dominant: "unknown",
        secondary: [],
        distribution: {},
        indexableShare: 0,
        nonIndexableHotspots: [],
      };

  // Build knowledge base internally if not provided
  const kb = knowledgeBase ?? (index ? buildSkillKnowledgeBase(index) : null);

  // Compute rule packs (Phase 4.3: honor createSkills.disableRules)
  const allDeps = index ? { ...index.project.dependencies, ...index.project.devDependencies } : {};
  const rulePackSelection = selectActiveRulePacks(
    {
      langProfile: languageProfile,
      frameworks,
      deps: allDeps,
      tsConfig: index?.project.tsConfig,
    },
    disableRules,
  );

  const projectScripts = index?.project.scripts;
  const projectConventions = detectProjectConventions(index);
  const sections: SkillSections = {
    agentWorkflow: buildAgentWorkflow(name, kb, { scripts: projectScripts }),
    projectRules: buildProjectRulesSection(kb),
    agentWorkflowCompact: buildAgentWorkflow(name, kb, {
      includeReferences: false,
      scripts: projectScripts,
    }),
    referenceRouting: buildReferenceRouting(index, kb),
    overview: buildOverview(name, version, frameworks, index, profile, languageProfile),
    detectedConventions: buildDetectedConventionsSection(projectConventions),
    firstFilesToRead: buildFirstFilesSection(kb, index),
    commonChangePaths: buildCommonChangePathsSection(kb, index, projectConventions),
    architecture: buildArchitecture(index),
    hubFiles: buildHubFiles(index),
    modules: buildModules(index),
    commands: buildCommands(index),
    conventions: buildConventions(index),
    profileRules: buildProfileRules(index, profile),
    languageRules: buildLanguageRules(rulePackSelection),
    cleanCodePolicy: buildCleanCodePolicy(codeStyleProfile, policies),
    fileSizePolicy: buildFileSizePolicy(codeStyleProfile, policies),
    aiEnrichment: enrichment ? buildAIEnrichment(enrichment) : null,
    codebaseMap: buildCodebaseMap(kb),
    testingMap: buildTestingMapSection(kb),
    dependencies: buildDependenciesSection(kb, enrichment),
    publicApi: buildPublicApiSection(kb),
  };

  // Build reference file content
  const references: ReferenceFileContent = {
    codeStyle: buildCodeStyleReference(codeStyleProfile, policies),
    languagePatterns: buildLanguagePatternsReference(rulePackSelection, languageProfile),
    cleanCodeChecklist: buildCleanCodeChecklist(codeStyleProfile, policies),
    customRules: "", // Populated externally by loadUserRulePacks
  };

  return {
    projectName: name,
    projectVersion: version,
    frameworks,
    profile,
    languageProfile,
    sections,
    references,
  };
}

function buildAgentWorkflow(
  projectName: string,
  kb: SkillKnowledgeBase | null,
  options: { includeReferences?: boolean; scripts?: Record<string, string> | undefined } = {},
): string {
  const includeReferences = options.includeReferences !== false;
  const tool = (args: string): string =>
    renderScriptAwareToolCommand(kb?.packageManager, options.scripts, args);
  // Build instruction-files list from detected files or fallback to generic pattern
  let instructionFilesLine: string;
  const instructionFiles = kb?.instructionFiles;
  if (instructionFiles && instructionFiles.length > 0) {
    const fileList = instructionFiles.map((f) => `\`${f}\``).join(", ");
    instructionFilesLine = `2. **Read local agent instructions**: ${fileList}. Project-authored instructions and rules OVERRIDE generated references when they conflict.`;
  } else {
    instructionFilesLine = `2. **Read local agent instructions**: \`AGENTS.md\`, \`CLAUDE.md\`, \`.claude/skills/\`, \`.agents/skills/\`, \`.cursor/rules/\`, \`.windsurf/skills/\`, \`.roo/skills/\`, \`.cline/skills/\`.`;
  }

  // Reference file list from KB entrypoints or static
  const refFiles = kb
    ? [
        `   - \`references/codebase-map.md\` - ${kb.modules.length} mods, ${kb.entrypoints.length} entrypoints`,
        `   - \`references/testing-map.md\` - ${Object.keys(kb.testing.testAssociations).length} test associations`,
        `   - \`references/dependencies.md\` - ${kb.dependencies.length} dependencies`,
        `   - \`references/public-api.md\` - ${kb.risks.length} risk items`,
        `   - \`references/code-style.md\` - detected indent, quotes, semicolons, formatter configs`,
        `   - \`references/language-patterns.md\` - per-language rules and language distribution`,
        `   - \`references/clean-code-checklist.md\` - code quality checklist with limits`,
      ]
    : [
        `   - \`references/codebase-map.md\` - modules, entrypoints, key symbols`,
        `   - \`references/testing-map.md\` - test associations and gaps`,
        `   - \`references/dependencies.md\` - dependency versions and usage`,
        `   - \`references/public-api.md\` - API surface and risks`,
        `   - \`references/code-style.md\` - detected indent, quotes, semicolons, formatter configs`,
        `   - \`references/language-patterns.md\` - per-language rules and language distribution`,
        `   - \`references/clean-code-checklist.md\` - code quality checklist with limits`,
      ];

  // Build quick-start examples from real index data
  const examples = buildSearchExamples(kb, options.scripts);

  const lines = [
    `## Required Agent Workflow`,
    ``,
    `Before writing any code for **${projectName}**, follow these steps in order:`,
    ``,
    includeReferences
      ? `1. **Read SKILL.md** - project profile, conventions, pitfalls.`
      : `1. **Read these rules first** - project profile, conventions, pitfalls.`,
    instructionFilesLine,
    `3. **Check parser health first**:`,
    `   - \`${tool("indexing --health --index-format json")}\` - health overview, parser breakdown`,
    `4. **Drilldown when health suggests issues**:`,
    `   - \`${tool("indexing --recovered --index-format json")}\` - list files parsed via fallback recoveries`,
    `   - \`${tool("indexing --parse-errors --index-format json")}\` - list files with hard parse errors`,
    `5. **Before editing**, use source index diagnostics:`,
    `   - \`${tool("indexing --agent-context <file> --index-format json")}\` - symbols, imports, dependents, next commands`,
    `   - \`${tool("indexing --explain-index <file> --index-format json")}\` - imports, dependents, symbols`,
    `   - \`${tool("indexing --find-symbol <name> --index-format json")}\` - search index for symbols`,
    `   - \`${tool("indexing --find-import <package-or-path> --index-format json")}\` - search index for import usage`,
    `   - \`${tool("indexing --find-code <query> --index-format json")}\` - search indexed code snippets`,
    `   - \`${tool("indexing --stats --index-format json")}\` - index statistics`,
    `   - \`${tool("--explain-context --format json --files <file>")}\` - context enrichment preview`,
    ...(includeReferences ? [`6. **Load only the relevant references**:`, ...refFiles] : []),
    `${includeReferences ? "7" : "6"}. **Respect the profile rules** - each profile has specific review pitfalls listed below.`,
  ];

  if (examples.length > 0) {
    lines.push(``, examples);
  }

  // Generated artifact note — development guardrails
  lines.push(
    ``,
    `> **Auto-generated.** Regenerate via \`${renderRegenerateCommand(kb?.packageManager, options.scripts)}\`. Do not edit.`,
  );

  return lines.join("\n");
}

// ── Project Rules (authoritative, project-authored) ───────────────────────

const MAX_PROJECT_RULES = 30;

/**
 * Render project-authored rules (`rules` / `ruleFiles` from
 * `.mp-sentinelrc.json`) as a deterministic section. These are placed ABOVE
 * generated references and explicitly override generated guidance on
 * conflict. Returns an empty string when the project defines none.
 */
/**
 * Replace risky Unicode (smart quotes, dashes, arrows, ellipsis) with ASCII
 * in project-authored text. Project rules come from `.mp-sentinelrc.json`
 * and may carry typographic characters the quality gate flags; normalizing
 * them keeps authored guidance verbatim in meaning but terminal-safe.
 */
function sanitizeProjectText(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/—/g, "--")
    .replace(/–/g, "-")
    .replace(/→/g, "->")
    .replace(/←/g, "<-")
    .replace(/…/g, "...")
    .replace(/✓/g, "[x]")
    .replace(/✗/g, "[ ]");
}

function buildProjectRulesSection(kb: SkillKnowledgeBase | null): string {
  const rules = (kb?.projectRules ?? []).map(sanitizeProjectText);
  const ruleFiles = kb?.projectRuleFiles ?? [];
  if (rules.length === 0 && ruleFiles.length === 0) return "";

  // Stable boundary markers wrap the section so quality checks can strip
  // project-authored content reliably even when a rule (or ruleFile content)
  // embeds its own Markdown H2 headings.
  const lines = [
    PROJECT_RULES_START_MARKER,
    `## Project Rules (authoritative)`,
    ``,
    `These rules are authored by the project (\`.mp-sentinelrc.json\`). When they conflict with any generated guidance in this skill, the project rules win.`,
    ``,
  ];

  for (const rule of rules.slice(0, MAX_PROJECT_RULES)) {
    lines.push(`- ${rule}`);
  }
  if (rules.length > MAX_PROJECT_RULES) {
    lines.push(`- ... and ${rules.length - MAX_PROJECT_RULES} more rules in config`);
  }

  if (ruleFiles.length > 0) {
    lines.push(
      ``,
      `Additional project rule files (read before coding):`,
      ``,
      ...ruleFiles.map((f) => `- \`${f}\``),
    );
  }

  lines.push(PROJECT_RULES_END_MARKER);

  return lines.join("\n");
}

// ── Reference Routing ──────────────────────────────────────────────────────

const MAX_ROUTING_ROWS = 15;

/**
 * Build a compact Reference Routing table that maps directories to recommended
 * reference files. Agents use this to load only the references relevant to the
 * files they are touching, instead of reading all generated docs.
 *
 * Routing is data-driven from actual indexed file paths — no hardcoded paths.
 * Same index produces byte-identical output (deterministic sort, no timestamps).
 */
function buildReferenceRouting(index: SourceIndex | null, kb: SkillKnowledgeBase | null): string {
  if (!index || !kb) {
    return "## Reference Routing\n\nNo source index available. Run `npx mp-sentinel indexing` first.";
  }

  // ── Extract directory candidates from indexed file paths ────────────────
  const srcLevels = new Set<string>();
  const srcDeepCounts = new Map<string, number>();
  const topLevels = new Set<string>();

  const isFileName = (segment: string): boolean =>
    /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|json|yaml|yml|md|css|scss|html|vue|svelte)$/i.test(segment);

  for (const file of index.files) {
    const parts = file.path.split("/");
    if (parts.length < 2) continue;

    if (parts[0] === "src") {
      // src/<top>/
      if (!isFileName(parts[1]!)) {
        srcLevels.add(`${parts[0]}/${parts[1]}/`);
      }
      // src/<top>/<sub>/ — deeper service domains
      if (parts.length >= 3) {
        const deep = `${parts[0]}/${parts[1]}/${parts[2]}/`;
        srcDeepCounts.set(deep, (srcDeepCounts.get(deep) ?? 0) + 1);
      }
    } else if (!parts[0]!.startsWith(".")) {
      topLevels.add(`${parts[0]}/`);
    }
  }

  // Promote deeper patterns with sufficient file count
  for (const [deep, count] of srcDeepCounts) {
    if (count >= 3) {
      const parent = deep.split("/").slice(0, 2).join("/") + "/";
      // Remove parent if a child is promoted (child is more specific)
      srcLevels.delete(parent);
      srcLevels.add(deep);
    }
  }

  const allCandidates = [...srcLevels, ...topLevels].sort();

  // ── Classify each candidate ─────────────────────────────────────────────

  interface RoutingRow {
    dirs: string[];
    refs: string;
  }

  const rows: RoutingRow[] = [];
  const fileRoles = index.insights?.fileRoles ?? {};
  const publicApiFiles = index.insights?.publicApiFiles ?? [];
  const depUsage = index.insights?.dependencyUsage ?? {};

  // Module deep-dive references: map a routing dir to its module reference
  // name (e.g. "modules/src-features-approval-inbox") when one is generated.
  const moduleTargets = selectModuleReferenceTargets(kb);
  const moduleRefFor = (dir: string): string | undefined => {
    const stripped = dir.endsWith("/") ? dir.slice(0, -1) : dir;
    const target = moduleTargets.find(
      (m) => m.directory === stripped || stripped.startsWith(m.directory + "/"),
    );
    return target ? `modules/${safeModuleName(target.directory)}` : undefined;
  };

  const pushRow = (dir: string, baseRefs: string): void => {
    const modRef = moduleRefFor(dir);
    rows.push({ dirs: [dir], refs: modRef ? `${modRef}, ${baseRefs}` : baseRefs });
  };

  for (const dir of allCandidates) {
    const prefix = dir.endsWith("/") ? dir.slice(0, -1) : dir;
    const filesInDir = index.files.filter(
      (f) => f.path.startsWith(prefix + "/") || f.path === prefix,
    );

    if (filesInDir.length === 0) continue;

    // Priority 1: CLI / command entrypoints
    const hasCliOrCmd = kb.entrypoints.some(
      (ep) =>
        (ep.type === "cli" || ep.type === "command") &&
        (ep.path.startsWith(prefix + "/") || ep.path === prefix),
    );
    if (hasCliOrCmd) {
      pushRow(dir, "commands, testing-map");
      continue;
    }

    // Priority 2: public API entrypoints or type/public API surface
    const hasPublicApi = kb.entrypoints.some(
      (ep) => ep.type === "public-api" && (ep.path.startsWith(prefix + "/") || ep.path === prefix),
    );
    const dirHasPublicApiFile = publicApiFiles.some(
      (p) => p.startsWith(prefix + "/") || p === prefix,
    );
    if (hasPublicApi || dirHasPublicApiFile) {
      pushRow(dir, "public-api, codebase-map");
      continue;
    }

    // Priority 3: hub / risk files imported by >= 3 files
    const hasHub = kb.risks.some(
      (r) =>
        r.type === "hub-file" &&
        (r.importCount ?? 0) >= 3 &&
        (r.file.startsWith(prefix + "/") || r.file === prefix),
    );
    if (hasHub) {
      pushRow(dir, "architecture, codebase-map");
      continue;
    }

    // Priority 4: dependency-heavy and cross-module
    const depPkgs = new Set<string>();
    const crossDirs = new Set<string>();
    for (const file of filesInDir) {
      for (const [pkg, pkgFiles] of Object.entries(depUsage)) {
        if (pkgFiles.includes(file.path)) depPkgs.add(pkg);
      }
      for (const imp of file.importsFrom ?? []) {
        const impTop = imp.includes("/") ? imp.slice(0, imp.indexOf("/")) : "(root)";
        if (impTop !== prefix.split("/")[0]) crossDirs.add(impTop);
      }
    }
    if (depPkgs.size >= 2 && crossDirs.size >= 2) {
      pushRow(dir, "architecture, dependencies");
      continue;
    }

    // Priority 5: scripts/ directory
    if (dir === "scripts/") {
      pushRow(dir, "commands, testing-map");
      continue;
    }

    // Fallback
    pushRow(dir, "architecture, codebase-map");
  }

  // ── Merge rows with the same reference set ──────────────────────────────
  const merged: RoutingRow[] = [];
  const refIndex = new Map<string, number>();
  for (const row of rows) {
    const existing = refIndex.get(row.refs);
    if (existing !== undefined) {
      merged[existing]!.dirs.push(...row.dirs);
    } else {
      refIndex.set(row.refs, merged.length);
      merged.push(row);
    }
  }

  // Sort: non-fallback rows first (by first dir name), fallback last
  const fallback = merged.find((r) => r.dirs.length === 1 && r.dirs[0] === "#fallback");
  const sorted = merged
    .filter((r) => r !== fallback)
    .sort((a, b) => a.dirs[0]!.localeCompare(b.dirs[0]!));

  // Always add an "Other files" fallback row with the default ref set
  const fallbackRefs = "architecture, codebase-map";

  // ── Build markdown table ────────────────────────────────────────────────
  const lines = [
    `## Reference Routing`,
    ``,
    `When touching files, load only the relevant references:`,
    ``,
    `| Directory Pattern | Recommended References |`,
    `|---|---|`,
  ];

  for (const row of sorted.slice(0, MAX_ROUTING_ROWS)) {
    const dirCell = row.dirs.map((d) => `\`${d}\``).join(", ");
    lines.push(`| ${dirCell} | ${row.refs} |`);
  }

  lines.push(`| Other files | ${fallbackRefs} |`);

  return lines.join("\n");
}

/**
 * Build codebase-specific search examples from real index data.
 * Returns an empty string if KB is unavailable or no examples can be derived.
 */
function buildSearchExamples(
  kb: SkillKnowledgeBase | null,
  scripts?: Record<string, string> | undefined,
): string {
  if (!kb) return "";

  const tool = (args: string): string =>
    renderScriptAwareToolCommand(kb.packageManager, scripts, args);
  const exampleLines: string[] = [];
  exampleLines.push(`**Quick-start search examples (from this codebase):**`);

  // Top hub file — use --agent-context to explore it
  const topHub = kb.risks
    .filter((r) => r.type === "hub-file")
    .sort((a, b) => (b.importCount ?? 0) - (a.importCount ?? 0))[0];
  if (topHub) {
    exampleLines.push(
      `   - \`${tool(`indexing --agent-context ${topHub.file} --index-format json`)}\` - top hub file (imported by ${topHub.importCount} files)`,
    );
  }

  // Top dependency — use --find-import to see usage
  const topDep = kb.dependencies[0];
  if (topDep) {
    exampleLines.push(
      `   - \`${tool(`indexing --find-import ${topDep.packageName} --index-format json`)}\` - top dependency (used by ${topDep.fileCount} files)`,
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
        `   - \`${tool(`indexing --find-symbol ${keySym.name} --index-format json`)}\` - locate \`${keySym.name}\` (${keySym.type}) across the codebase`,
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
        `   - \`${tool(`indexing --find-symbol ${keySym.name} --index-format json`)}\` - locate \`${keySym.name}\` (${keySym.type}) across the codebase`,
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
  languageProfile: LanguageProfile,
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

    // Language breakdown
    if (Object.keys(languageProfile.distribution).length > 0) {
      const langEntries = Object.entries(languageProfile.distribution)
        .sort((a, b) => b[1] - a[1])
        .map(([lang, count]) => `${lang} (${count})`);
      lines.push(`**Languages:** ${langEntries.join(", ")}`);
    }

    if (languageProfile.nonIndexableHotspots.length > 0) {
      lines.push(
        `**Non-indexable Hotspots:** ${languageProfile.nonIndexableHotspots
          .slice(0, 5)
          .join(", ")}`,
      );
    }

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
          `**Key Scripts:** ${keyScripts.map((s) => `\`${renderRunScript(pm, s)}\``).join(", ")}`,
        );
      }
    }
  }

  return lines.join("\n");
}

function buildArchitecture(index: SourceIndex | null): string {
  if (!index || index.files.length === 0) {
    return "## Architecture\n\nNo source index available. Run `npx mp-sentinel indexing` first.";
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

  // Parser recovery note (only when there is something to report)
  const recoveredFiles = index.files.filter(
    (f) =>
      f.parserMode === "chunked-tree-sitter" ||
      f.parserMode === "ascii-fallback" ||
      f.parserMode === "lexical-fallback",
  ).length;
  const hardErrorFiles = index.files.filter((f) => f.parseErrors && f.parseErrors.length > 0);
  const hasParseIssues = recoveredFiles > 0 || hardErrorFiles.length > 0;

  if (hasParseIssues) {
    lines.push(``, `### Parser Recovery`, ``);

    if (recoveredFiles > 0) {
      const ts = index.files.filter(
        (f) => (f.parserMode ?? "tree-sitter") === "tree-sitter",
      ).length;
      const chunked = index.files.filter((f) => f.parserMode === "chunked-tree-sitter").length;
      const ascii = index.files.filter((f) => f.parserMode === "ascii-fallback").length;
      const lexical = index.files.filter((f) => f.parserMode === "lexical-fallback").length;
      lines.push(
        `${recoveredFiles} file(s) recovered via fallback parser. Breakdown: tree-sitter=${ts}, chunked-tree-sitter=${chunked}, ascii-fallback=${ascii}, lexical-fallback=${lexical}`,
      );
    }

    if (hardErrorFiles.length > 0) {
      lines.push(`${hardErrorFiles.length} file(s) with hard parse errors. Sample paths:`);
      for (const f of hardErrorFiles
        .map((x) => x.path)
        .sort()
        .slice(0, 3)) {
        lines.push(`- \`${f}\``);
      }
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
    const groupKey = moduleKeyForPath(file.path);
    const bucket = moduleMap.get(groupKey) ?? [];
    bucket.push(file);
    moduleMap.set(groupKey, bucket);
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
      lines.push(`${renderRunScript(pm, key)}  # ${cmd}`);
    }
    if (Object.keys(scripts).length > MAX_SCRIPT_ENTRIES) {
      lines.push(`# ... and ${Object.keys(scripts).length - MAX_SCRIPT_ENTRIES} more scripts`);
    }
    lines.push("```");
  } else {
    lines.push(
      "```sh",
      `${renderRunScript(pm, "test")}           # Run tests`,
      `${renderRunScript(pm, "build")}      # Build project`,
      "```",
    );
  }

  return lines.join("\n");
}

function buildConventions(index: SourceIndex | null): string {
  if (!index || index.files.length === 0) return "";

  const lines = [`## Code Conventions`];

  const hasTs = index.files.some((f) => f.language === "typescript" || f.language === "tsx");
  const tsConfig = index.project.tsConfig;
  const needsJsExtensions = requiresJsImportExtensions(tsConfig);
  const moduleResolution =
    typeof tsConfig?.compilerOptions?.moduleResolution === "string"
      ? tsConfig.compilerOptions.moduleResolution
      : undefined;

  // Node engine baseline — only show when actually read from package.json
  const nodeEngine = index.project.nodeEngine;
  if (nodeEngine) {
    lines.push(``, `- **Node Engine:** ${nodeEngine} - use \`node:\` prefix for built-in modules`);
  }

  // Module resolution: only require `.js` extensions under NodeNext/Node16.
  if (hasTs && needsJsExtensions) {
    lines.push(
      `- **Module System:** ESM - internal imports must include \`.js\` extension (NodeNext resolution)`,
    );
  } else if (hasTs && moduleResolution) {
    lines.push(
      `- **Module Resolution:** \`${moduleResolution}\` - do NOT add \`.js\` extensions to internal imports`,
    );
  }

  // TypeScript
  if (hasTs) {
    if (recommendsImportType(tsConfig)) {
      lines.push(
        `- **Language:** TypeScript - use \`import type\` for type-only imports (\`verbatimModuleSyntax\`)`,
      );
    } else {
      lines.push(`- **Language:** TypeScript`);
    }
    lines.push(
      `- **Avoid \`any\`** - if unavoidable (e.g., untyped third-party APIs), isolate in one place with a comment`,
    );
    const flagNames = enabledStrictFlags(tsConfig).filter((f) => f !== "strict");
    if (flagNames.length > 0) {
      lines.push(
        `- **Strict flags:** \`${flagNames.join("`, `")}\` are enforced - respect all strict tsconfig flags`,
      );
    } else if (tsConfig?.compilerOptions?.strict === true) {
      lines.push(`- **Strict mode:** \`strict: true\` is enforced in \`tsconfig.json\``);
    }
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
      lines.push(`${renderRunScript(pm, key)}  # ${scripts[key]}`);
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
      const groupKey = moduleKeyForPath(file.path);
      const bucket = moduleMap.get(groupKey) ?? [];
      bucket.push(file);
      moduleMap.set(groupKey, bucket);
    }

    const sorted = [...moduleMap.entries()].sort(
      (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
    );
    if (sorted.length > 0) {
      lines.push(``, `### Module Ownership`, ``, `Modules and their responsibilities:`, ``);
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
    const hasTs = index.files.some((f) => f.language === "typescript" || f.language === "tsx");
    const hasNodePrefix = index.files.some((f) =>
      f.imports.some((i) => i.source.startsWith("node:")),
    );
    const tsConfig = index.project.tsConfig;
    const needsJsExtensions = requiresJsImportExtensions(tsConfig);
    const moduleResolution =
      typeof tsConfig?.compilerOptions?.moduleResolution === "string"
        ? tsConfig.compilerOptions.moduleResolution
        : undefined;

    if (hasTs && index.project.nodeEngine) {
      lines.push(`- **Runtime:** Node ${index.project.nodeEngine}.`);
    }
    if (hasTs && needsJsExtensions) {
      lines.push(`- Internal imports **must** include the \`.js\` extension (NodeNext / ESM).`);
    } else if (hasTs && moduleResolution) {
      lines.push(
        `- Module resolution is \`${moduleResolution}\` - do **not** add \`.js\` extensions to internal imports.`,
      );
    }
    if (hasTs && recommendsImportType(tsConfig)) {
      lines.push(`- Use \`import type\` for type-only imports (\`verbatimModuleSyntax\`).`);
    }
    if (hasNodePrefix || (hasTs && needsJsExtensions)) {
      lines.push(
        `- Built-in modules must use the \`node:\` prefix (e.g., \`node:fs\`, \`node:path\`).`,
      );
    }
    if (hasTs) {
      lines.push(`- **Avoid \`any\`** - if unavoidable, isolate with a comment explaining why.`);
      const flagNames = enabledStrictFlags(tsConfig);
      if (flagNames.length > 0) {
        lines.push(
          `- Respect the strict \`tsconfig.json\` flags enabled here: \`${flagNames.join("`, `")}\`.`,
        );
      }
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
      const hasTestScript = "test" in scripts;
      lines.push(``, `### Test Expectations`, ``, `- ${testFiles.length} test file(s) indexed.`);
      if (hasTestScript) {
        lines.push(
          `- Run \`${renderRunScript(pm, "test")}\` before committing changes that touch logic.`,
        );
      } else {
        lines.push(
          `- No \`test\` script in \`package.json\` -- check the project README for the correct test command before committing logic changes.`,
        );
      }
      lines.push(`- Do not skip failing tests without a \`TODO\` comment linking to an issue.`);
    }
  }

  // ── Review Pitfalls (profile-specific) ──
  lines.push(``, `### Review Pitfalls`, ``);
  switch (profile) {
    case "cli-tooling":
      lines.push(
        `- **Exit codes are a contract** - never change 0/1/2 semantics without a breaking-change note.`,
        `- **Diff-first review** - send diff + context, not full file content.`,
        `- **Keep CLI parsing separate** - argument parsing belongs in \`src/cli/\`, not in command implementations.`,
        `- **No business logic in \`src/index.ts\`** - entry files route, never contain core logic.`,
        `- **Watch for breaking script changes** - renaming a script or changing side-effects is a breaking change.`,
      );
      break;
    case "node-service":
      lines.push(
        `- **Handler purity** - route handlers should delegate to services / repositories.`,
        `- **Error middleware** - catch unhandled errors centrally; never leak stack traces in production.`,
        `- **Env config validation** - validate \`process.env\` reads at startup; fail fast on missing required vars.`,
        `- **Async boundaries** - always catch promises in handlers to prevent unhandled rejections.`,
        `- **Health checks** - new dependencies (DB, cache, queue) need health-check probes.`,
      );
      break;
    case "react-next": {
      const allDeps = index
        ? { ...index.project.dependencies, ...index.project.devDependencies }
        : {};
      const nextMajor = resolveSafeMajor(allDeps["next"]);
      const isAppRouter = nextMajor !== null && nextMajor >= 13;
      if (isAppRouter) {
        lines.push(
          `- **Server/Client boundary** - avoid server-only imports in client components; use \`'use server'\` / \`'use client'\` split.`,
          `- **Data fetching colocation** - keep data fetching close to consuming component; avoid prop-drill across >2 layers.`,
          `- **No direct DOM mutations** - use refs and effects, never \`document.querySelector\` outside isolated helpers.`,
          `- **Image optimization** - prefer \`next/image\` over \`<img>\`.`,
          `- **Bundle size vigilance** - new deps in page components can bloat route chunks; audit with \`next bundle-analyzer\`.`,
        );
      } else {
        // Pages Router (Next.js <= 12) or unknown version — conservative
        lines.push(
          `- **Pages Router only** - do NOT add App Router patterns (\`'use client'\`/\`'use server'\`, \`app/\` directory, Server Components, route handlers); use \`pages/\`, \`_app\`, \`_document\`, \`getServerSideProps\`, \`getStaticProps\` only.`,
          `- **Data fetching at page level** - use \`getServerSideProps\`/\`getStaticProps\` for SSR/SSG; colocate client fetches in components via hooks (React Query/SWR).`,
          `- **No direct DOM mutations** - use refs and effects, never \`document.querySelector\` outside isolated helpers.`,
          `- **Image optimization** - prefer \`next/image\` (or \`next/legacy/image\`) over \`<img>\`.`,
          `- **Bundle size vigilance** - new deps in page components can bloat route chunks; audit with \`next bundle-analyzer\`.`,
        );
      }
      break;
    }
    case "react-spa":
      lines.push(
        `- **Route-level code splitting** - lazy-load route components (\`React.lazy\` / router lazy routes) to keep the initial bundle small.`,
        `- **Server state separation** - keep server data in a data library (React Query/SWR); do not mirror it into local component state.`,
        `- **Hooks discipline** - complete dependency arrays; stable keys (not array indices) in render loops.`,
        `- **No direct DOM mutations** - use refs and effects, never \`document.querySelector\` outside isolated helpers.`,
        `- **Bundle size vigilance** - audit new dependencies' impact on the client bundle; prefer dynamic imports for heavy libraries.`,
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
  if (!kb)
    return "## Codebase Map\n\nNo source index available. Run `npx mp-sentinel indexing` first.";

  const lines = [`## Codebase Map`];

  // Module Ownership
  if (kb.modules.length > 0) {
    lines.push(``, `### Module Ownership`, ``);
    for (const mod of kb.modules.slice(0, MAX_KB_MODULES)) {
      // Counts live on the heading line: identical "- N source file(s)"
      // bullets across same-sized modules would trip the repetitive-output
      // quality check and add no guidance value.
      lines.push(
        `#### \`${mod.directory}/\` - ${mod.dominantRole} (${mod.sourceFileCount} source / ${mod.testFileCount} test files)`,
      );
      if (mod.keyFiles.length > 0) {
        const keyFiles = mod.keyFiles.slice(0, MAX_KB_KEY_FILES);
        const overflow =
          mod.keyFiles.length > MAX_KB_KEY_FILES
            ? ` (+${mod.keyFiles.length - MAX_KB_KEY_FILES} more)`
            : "";
        lines.push(`- Key files: ${keyFiles.map((f) => `\`${f}\``).join(", ")}${overflow}`);
      }
      if (mod.keySymbols.length > 0) {
        const keySymbols = mod.keySymbols.slice(0, MAX_KB_KEY_SYMBOLS);
        lines.push(
          `- Key symbols: ${keySymbols.map((s) => `\`${s.name}\` (${s.type})`).join(", ")}`,
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
    if (kb.modules.length > MAX_KB_MODULES) {
      lines.push(`... and ${kb.modules.length - MAX_KB_MODULES} more module(s)`, ``);
    }
  }

  // Entrypoints
  if (kb.entrypoints.length > 0) {
    lines.push(`### Entrypoints`, ``);
    const entrypointIcon: Record<string, string> = {
      cli: "CLI",
      "public-api": "API",
      command: "CMD",
      app: "APP",
      route: "ROUTE",
      config: "CFG",
    };
    for (const ep of kb.entrypoints) {
      const icon = entrypointIcon[ep.type] ?? "CFG";
      lines.push(`- **[${icon}]** \`${ep.path}\` - ${ep.label}`);
    }
  }

  return lines.join("\n");
}

// ── Testing Map ────────────────────────────────────────────────────────────

function buildTestingMapSection(kb: SkillKnowledgeBase | null): string {
  if (!kb)
    return "## Testing Map\n\nNo source index available. Run `npx mp-sentinel indexing` first.";

  const lines = [`## Testing Map`];

  // Test Associations
  const assocEntries = Object.entries(kb.testing.testAssociations).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  if (
    assocEntries.length === 0 &&
    kb.testing.testGaps.length === 0 &&
    kb.testing.mostTestedModules.length === 0
  ) {
    lines.push(
      ``,
      `_No test files indexed for this project. New test files establish the project's test convention - place them consistently (dedicated \`__tests__/\`/\`tests/\` or colocated \`*.test.*\`)._`,
    );
  }
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
  if (!kb)
    return "## Dependencies\n\nNo source index available. Run `npx mp-sentinel indexing` first.";

  const lines = [`## Dependencies`];

  if (kb.dependencies.length === 0) {
    lines.push(``, `_No external dependency usage indexed for this project._`);
  }

  if (kb.dependencies.length > 0) {
    const runtimeDeps = kb.dependencies.filter(
      (d) => d.usageKind === "runtime" || d.usageKind === "mixed",
    );
    const testDeps = kb.dependencies.filter((d) => d.usageKind === "test");

    // Caps: runtime gets priority, test gets the remainder
    const runtimeTable = runtimeDeps.slice(0, MAX_DEP_TABLE_ENTRIES);
    const testTable = testDeps.slice(0, Math.max(0, MAX_DEP_TABLE_ENTRIES - runtimeTable.length));
    const runtimeDetail = runtimeDeps.slice(0, MAX_DEP_DETAIL_ENTRIES);
    const testDetail = testDeps.slice(
      0,
      Math.max(0, MAX_DEP_DETAIL_ENTRIES - runtimeDetail.length),
    );

    function renderDepTable(deps: DepMapEntry[]): void {
      lines.push(`| Package | Version | Used By |`);
      lines.push(`|---|---|---|`);
      for (const dep of deps) {
        const displayVersion = cleanDisplayVersion(dep.version);
        lines.push(`| \`${dep.packageName}\` | ${displayVersion} | ${dep.fileCount} file(s) |`);
      }
    }

    function renderDepDetails(deps: DepMapEntry[]): void {
      for (const dep of deps) {
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

    if (runtimeTable.length > 0) {
      lines.push(``, `### Runtime Dependencies`, ``);
      renderDepTable(runtimeTable);
      lines.push(``);
      renderDepDetails(runtimeDetail);
      lines.push(``);
    }

    if (testTable.length > 0) {
      lines.push(`### Test/Tooling Dependencies`, ``);
      renderDepTable(testTable);
      lines.push(``);
      renderDepDetails(testDetail);
      lines.push(``);
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
  if (!kb)
    return "## Public API\n\nNo source index available. Run `npx mp-sentinel indexing` first.";

  const lines = [`## Public API Surface`];

  // Entry points
  const apiEntries = kb.entrypoints.filter((ep) => ep.type === "public-api" || ep.type === "cli");

  if (apiEntries.length === 0 && kb.risks.length === 0) {
    lines.push(``, `_No public API entrypoints or risk signals indexed for this project._`);
  }
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

// ── Language & Framework Rules (deterministic rule packs) ─────────────────

/**
 * Build a deterministic `## Language & Framework Rules` section from
 * active rule packs. No AI calls — all rules are pre-written.
 */
function buildLanguageRules(selection: {
  packs: Array<{ id: string; label: string; rules: Array<{ kind: string; text: string }> }>;
  allRules: Array<{ kind: string; text: string }>;
}): string {
  if (selection.packs.length === 0) {
    return "";
  }

  // Only packs with at least one rendered rule drive this section. Version
  // gating / disableRules may empty a pack, and the builtin pack ships
  // evaluators only — those must not appear as active rendered packs or
  // inflate the pack count, and never produce empty "### ... Rules" headings.
  const renderedPacks = selection.packs.filter((p) => p.rules.length > 0);
  if (renderedPacks.length === 0) {
    return "";
  }

  const lines: string[] = [];

  // Per-pack sections
  for (const pack of renderedPacks) {
    lines.push(``, `### ${pack.label} Rules`, ``);
    for (const rule of pack.rules) {
      const prefix =
        rule.kind === "must" ? "**MUST**" : rule.kind === "should" ? "**SHOULD**" : "**AVOID**";
      lines.push(`- ${prefix}: ${rule.text}`);
    }
  }

  // Summary table at the top — counts based on rendered rules
  type RuleKind = "must" | "should" | "avoid";
  const ruleKinds: RuleKind[] = ["must", "should", "avoid"];
  const counts: Record<RuleKind, number> = { must: 0, should: 0, avoid: 0 };
  for (const pack of renderedPacks) {
    for (const rule of pack.rules) {
      const kind = rule.kind as RuleKind;
      counts[kind]++;
    }
  }
  const summaryParts = ruleKinds.filter((k) => counts[k] > 0).map((k) => `${counts[k]} ${k}`);
  const header = [
    ``,
    `## Language & Framework Rules`,
    ``,
    `Active packs: ${renderedPacks.map((p) => `\`${p.label}\``).join(", ")}`,
    ``,
    `Summary: ${summaryParts.join(", ")} rules across ${renderedPacks.length} pack(s).`,
    ``,
  ];

  lines.unshift(...header);
  lines.push(``);

  return lines.join("\n");
}

// ── Clean Code Policy sections ───────────────────────────────────────────

/**
 * Build the `## Clean Code Policy` section with configurable rules and
 * observed offenders from the code-style profile.
 */
function buildCleanCodePolicy(
  csp: CodeStyleProfile | null | undefined,
  policies: CreateSkillsPolicies | null | undefined,
): string {
  const pol = policies ?? DEFAULT_CREATE_SKILLS_POLICIES;

  const lines: string[] = [
    ``,
    `## Clean Code Policy`,
    ``,
    `These rules are enforced by the agent when writing or reviewing code:`,
    ``,
    `- **Maximum file length:** ${pol.maxFileLines} lines (hard limit). Refactor before adding more.`,
    `- **Warning at:** ${pol.warnFileLines} lines - consider splitting into smaller modules.`,
    `- **Maximum function body:** ${pol.maxFunctionLines} lines. Extract helpers for readability.`,
    `- **Maximum parameters:** ${pol.maxParams} per function. Use an options object for more.`,
    `- **Cyclomatic complexity hint:** ${pol.maxCyclomaticHint}. High-complexity functions should be refactored.`,
  ];

  if (pol.forbidDefaultExports) {
    lines.push(`- **Default exports are forbidden.** Use named exports only.`);
  }

  lines.push(``);

  return lines.join("\n");
}

/**
 * Build the `## File Size Policy` section showing the limit and any current
 * offenders from the code-style profile.
 */
function buildFileSizePolicy(
  csp: CodeStyleProfile | null | undefined,
  policies: CreateSkillsPolicies | null | undefined,
): string {
  const pol = policies ?? DEFAULT_CREATE_SKILLS_POLICIES;

  const lines: string[] = [
    ``,
    `## File Size Policy`,
    ``,
    `Hard limit: **${pol.maxFileLines} lines** per file.`,
    ``,
  ];

  if (csp) {
    lines.push(
      `- **Current codebase P50:** ${csp.p50FileLines} lines`,
      `- **Current codebase P95:** ${csp.p95FileLines} lines`,
      `- **Current max file:** ${csp.maxFileLines} lines`,
      ``,
    );

    if (csp.oversizedFiles.length > 0) {
      lines.push(`### Observed Offenders (files exceeding ${pol.maxFileLines} lines)`, ``);
      for (const file of csp.oversizedFiles.slice(0, 5)) {
        lines.push(`- \`${file.path}\` - ${file.lines} lines`);
      }
      lines.push(
        ``,
        `> **Note:** Existing oversized files are technical debt. Do NOT add more lines to them`,
        `> without refactoring first. Prefer creating new files when extending functionality.`,
      );
    } else {
      lines.push(`No files exceed the ${pol.maxFileLines}-line limit. Keep it this way.`);
    }
  }

  lines.push(``);

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

  // v2: Per-language rules
  if (enrichment.rulesByLanguage && Object.keys(enrichment.rulesByLanguage).length > 0) {
    parts.push(`## AI-Enriched Per-Language Rules`, ``);
    for (const [language, rules] of Object.entries(enrichment.rulesByLanguage)) {
      if (rules.length > 0) {
        parts.push(`### ${language.charAt(0).toUpperCase() + language.slice(1)}`, ``);
        for (const rule of rules) {
          parts.push(`- ${rule}`);
        }
        parts.push(``);
      }
    }
  }

  // v2: Clean code rules
  if (enrichment.cleanCodeRules && enrichment.cleanCodeRules.length > 0) {
    parts.push(`## AI-Enriched Clean Code Rules`, ``);
    for (const rule of enrichment.cleanCodeRules) {
      parts.push(`- ${rule}`);
    }
    parts.push(``);
  }

  // v2: Anti-patterns
  if (enrichment.antiPatterns && enrichment.antiPatterns.length > 0) {
    parts.push(`## AI-Enriched Anti-Patterns`, ``);
    for (const ap of enrichment.antiPatterns) {
      parts.push(`- **${ap.pattern}**`);
      if (ap.files.length > 0) {
        parts.push(`  - Files: ${ap.files.map((f) => `\`${f}\``).join(", ")}`);
      }
      parts.push(`  - Fix: ${ap.fix}`);
    }
    parts.push(``);
  }

  // v2: Style enforcement
  if (enrichment.styleEnforcement && enrichment.styleEnforcement.length > 0) {
    parts.push(`## AI-Enriched Style Enforcement`, ``);
    for (const rule of enrichment.styleEnforcement) {
      parts.push(`- ${rule}`);
    }
    parts.push(``);
  }

  return parts.join("\n").trim();
}

// ── Reference file builders ─────────────────────────────────────────────────

/**
 * Build a `references/code-style.md` file from the CodeStyleProfile.
 */
export function buildCodeStyleReference(
  csp: CodeStyleProfile | null | undefined,
  policies?: CreateSkillsPolicies | null,
): string {
  if (!csp) {
    return "## Code Style\n\nNo code style profile available. Run `npx mp-sentinel create-skills` with indexing first.";
  }

  const lines: string[] = [
    "## Code Style",
    ``,
    "Auto-detected code style from the codebase. These rules should be followed by the agent when writing new code.",
    ``,
    "## Indentation",
    ``,
    `**Style:** ${csp.indent === "tab" ? "Tabs" : csp.indent === "2-spaces" ? "2 spaces" : csp.indent === "4-spaces" ? "4 spaces" : csp.indent}`,
    ``,
    "## Quotes",
    ``,
    `**Preference:** ${csp.singleQuoteRatio > 0.6 ? "Single quotes" : csp.singleQuoteRatio < 0.4 ? "Double quotes" : "Mixed"}`,
    `(single quote ratio: ${(csp.singleQuoteRatio * 100).toFixed(0)}%)`,
    ``,
    "## Semicolons",
    ``,
    `**Usage:** ${csp.semicolonRatio > 0.6 ? "Semicolons required" : csp.semicolonRatio < 0.4 ? "No semicolons" : "Mixed usage"}`,
    `(semicolon ratio: ${(csp.semicolonRatio * 100).toFixed(0)}%)`,
    ``,
    "## Trailing Newlines",
    ``,
    `**Compliance:** ${csp.trailingNewlineRatio > 0.5 ? "Files end with newline" : "Inconsistent trailing newlines"}`,
    ``,
    "## File Size Distribution",
    ``,
    `- **P50 (median):** ${csp.p50FileLines} lines`,
    `- **P95:** ${csp.p95FileLines} lines`,
    `- **Max:** ${csp.maxFileLines} lines`,
    ``,
  ];

  if (csp.formatterConfigs.length > 0) {
    lines.push("## Detected Formatter / Linter Configs", ``);
    for (const cfg of csp.formatterConfigs) {
      lines.push(`- \`${cfg}\``);
    }
    lines.push(``);
  }

  if (csp.oversizedFiles.length > 0) {
    lines.push("## Oversized Files (technical debt)", ``);
    for (const file of csp.oversizedFiles.slice(0, 10)) {
      lines.push(`- \`${file.path}\` - ${file.lines} lines`);
    }
    lines.push(``);
  }

  return lines.join("\n");
}

/**
 * Build a `references/language-patterns.md` file from the active rule pack selection
 * and language profile.
 */
export function buildLanguagePatternsReference(
  rulePackSelection: {
    packs: Array<{
      id: string;
      label: string;
      rules: Array<{ kind: string; text: string }>;
      fileGlobs: string[];
    }>;
    allRules: Array<{ kind: string; text: string }>;
  },
  langProfile: LanguageProfile,
): string {
  const lines: string[] = [
    "## Language Patterns",
    ``,
    "Auto-detected language patterns and framework rules for this codebase. Agents should respect these when writing or reviewing code.",
    ``,
    "## Language Distribution",
    ``,
  ];

  // Language distribution table
  const sortedLangs = Object.entries(langProfile.distribution).sort((a, b) => b[1] - a[1]);

  lines.push("| Language | File Count | Share |");
  lines.push("|---|---|---|");
  const totalFiles = Object.values(langProfile.distribution).reduce((s, c) => s + c, 0);
  for (const [lang, count] of sortedLangs) {
    const share = totalFiles > 0 ? ((count / totalFiles) * 100).toFixed(1) : "0";
    lines.push(`| ${lang} | ${count} | ${share}% |`);
  }
  lines.push(``);

  if (langProfile.nonIndexableHotspots.length > 0) {
    lines.push("## Non-Indexable Hotspots", ``);
    lines.push(
      "These areas contain files the indexer cannot fully parse (Svelte, Vue, Python, etc.):",
    );
    lines.push(``);
    for (const hotspot of langProfile.nonIndexableHotspots) {
      lines.push(`- \`${hotspot}/`);
    }
    lines.push(``);
  }

  // Per-pack rules
  if (rulePackSelection.packs.length > 0) {
    lines.push("## Framework & Language Rules", ``);
    for (const pack of rulePackSelection.packs) {
      lines.push(`### ${pack.label}`, ``);
      if (pack.fileGlobs.length > 0) {
        lines.push(`Applies to: ${pack.fileGlobs.map((g) => `\`${g}\``).join(", ")}`);
        lines.push(``);
      }
      for (const rule of pack.rules) {
        const prefix =
          rule.kind === "must" ? "**MUST**" : rule.kind === "should" ? "**SHOULD**" : "**AVOID**";
        lines.push(`- ${prefix}: ${rule.text}`);
      }
      lines.push(``);
    }
  }
  return lines.join("\n");
}

/**
 * Build a `references/clean-code-checklist.md` file from the policies and profile.
 */
export function buildCleanCodeChecklist(
  csp: CodeStyleProfile | null | undefined,
  policies?: CreateSkillsPolicies | null,
): string {
  const pol = policies ?? DEFAULT_CREATE_SKILLS_POLICIES;

  const lines: string[] = [
    "## Clean Code Checklist",
    ``,
    "Before submitting code for review, verify:",
    ``,
    "## File Size",
    ``,
    `- [ ] No file exceeds ${pol.maxFileLines} lines (hard limit)`,
    `- [ ] Files over ${pol.warnFileLines} lines are split into smaller modules`,
    ``,
    "## Functions",
    ``,
    `- [ ] No function body exceeds ${pol.maxFunctionLines} lines`,
    `- [ ] No function has more than ${pol.maxParams} parameters (use an options object for more)`,
    ``,
    "## Complexity",
    ``,
    `- [ ] Cyclomatic complexity is below ${pol.maxCyclomaticHint} per function`,
    ``,
  ];

  if (pol.forbidDefaultExports) {
    lines.push("## Exports", "", "- [ ] No default exports - use named exports only", "");
  }

  if (csp && csp.oversizedFiles.length > 0) {
    lines.push(
      "## Existing Technical Debt",
      "",
      "The following files already exceed the size limit. Do not add to them without refactoring:",
      "",
    );
    for (const file of csp.oversizedFiles.slice(0, 5)) {
      lines.push(`- [ ] \`${file.path}\` (${file.lines} lines)`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
