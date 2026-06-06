/**
 * Shared progressive-disclosure skill renderer.
 *
 * Every skill-capable agent (Claude, Codex, Antigravity, Zed, Windsurf,
 * Roo, Cline) gets the same layout: a lean SKILL.md that carries the
 * agent workflow, reference routing, overview, and policies — plus the
 * full reference set as separate files the agent loads on demand:
 *
 *   architecture, modules, commands, codebase-map, testing-map,
 *   dependencies, public-api, code-style, language-patterns,
 *   clean-code-checklist
 *
 * Adapters differ only in output directory and skill name. The
 * frontmatter `name` always matches the skill folder name (enforced by
 * the quality gate).
 */

import { join } from "node:path";
import type {
  GeneratedSkillFile,
  SkillsGenerationContext,
  SourceIndex,
} from "../../../types/index.js";
import { generateContent } from "../content.js";
import { renderRegenerateCommand } from "../package-manager.js";
import { buildSkillKnowledgeBase } from "../knowledge-base.js";
import { detectProjectConventions } from "../convention-detectors.js";
import { buildModuleReferences } from "../module-references.js";

/**
 * Hard char budget for reference files. Matches the quality gate's
 * `REF_MD_MAX`; reference docs that exceed it fail the gate, so the two large
 * map files (modules, codebase-map) are trimmed to fit while keeping their
 * top entries.
 */
const REFERENCE_CHAR_BUDGET = 6000;

/**
 * Trim a generated reference to the char budget by dropping trailing
 * `blockMarker` blocks, preserving the leading preamble and as many whole
 * blocks as fit, then appending a compact "and N more" summary. Whole blocks
 * are kept intact so output stays valid markdown. Returns the input unchanged
 * when already within budget.
 */
function trimReferenceToBudget(content: string, blockMarker: string): string {
  if (content.length <= REFERENCE_CHAR_BUDGET) return content;

  const lines = content.split("\n");
  // Split into a preamble (everything before the first block) and blocks,
  // where each block runs from one blockMarker line up to the next.
  const preamble: string[] = [];
  const blocks: string[][] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    if (line.startsWith(blockMarker)) {
      current = [line];
      blocks.push(current);
    } else if (current) {
      current.push(line);
    } else {
      preamble.push(line);
    }
  }

  const blockLen = (b: string[]): number => b.join("\n").length + 1;
  // Reserve room for the truncation note.
  const budget = REFERENCE_CHAR_BUDGET - 120;

  let used = preamble.join("\n").length;
  const keptBlocks: string[][] = [];
  let dropped = 0;
  for (const block of blocks) {
    const len = blockLen(block);
    if (dropped === 0 && used + len <= budget) {
      keptBlocks.push(block);
      used += len;
    } else {
      dropped++;
    }
  }

  const out = [...preamble, ...keptBlocks.flat()];
  if (dropped > 0) {
    out.push("", `_... and ${dropped} more (truncated to fit the reference size budget)._`);
  }
  return out.join("\n");
}

/** Reference files every progressive skill ships (relative to skill dir). */
export const SKILL_REFERENCE_FILES: readonly string[] = [
  "references/architecture.md",
  "references/modules.md",
  "references/commands.md",
  "references/codebase-map.md",
  "references/testing-map.md",
  "references/dependencies.md",
  "references/public-api.md",
  "references/code-style.md",
  "references/language-patterns.md",
  "references/clean-code-checklist.md",
];

const REFERENCE_LINKS: readonly string[] = [
  `- [Architecture & Hub Files](./references/architecture.md)`,
  `- [Module Map](./references/modules.md)`,
  `- [Profile Rules & Commands](./references/commands.md)`,
  `- [Codebase Map](./references/codebase-map.md)`,
  `- [Testing Map](./references/testing-map.md)`,
  `- [Dependencies](./references/dependencies.md)`,
  `- [Public API](./references/public-api.md)`,
  `- [Code Style](./references/code-style.md)`,
  `- [Language Patterns](./references/language-patterns.md)`,
  `- [Clean Code Checklist](./references/clean-code-checklist.md)`,
];

/**
 * Render the lean SKILL.md + full reference set for a skill directory.
 *
 * @param skillDir   Absolute output directory for the skill.
 * @param skillName  Skill folder name (also the frontmatter `name`).
 */
export function renderProgressiveSkill(
  index: SourceIndex | null,
  context: SkillsGenerationContext,
  skillDir: string,
  skillName: string,
): GeneratedSkillFile[] {
  const { projectName, enrichment, knowledgeBase } = context;
  const content = generateContent(
    index,
    projectName,
    enrichment,
    knowledgeBase,
    context.codeStyleProfile,
    context.policies,
    context.disableRules,
  );

  // Per-module deep-dive references for the top bounded contexts
  const kb = knowledgeBase ?? (index ? buildSkillKnowledgeBase(index) : null);
  const moduleRefs = buildModuleReferences(kb, index, detectProjectConventions(index));
  const moduleLinks = moduleRefs.map(
    (m) => `- [Module: ${m.directory}](./${m.relPath.replace(/\\/g, "/")})`,
  );

  const skillMdParts: string[] = [
    `---`,
    `name: ${skillName}`,
    `description: Best practices and architecture guide for ${content.projectName} (auto-generated by mp-sentinel)`,
    `---`,
    ``,
    `# ${content.projectName} Best Practices`,
    ``,
    `> Auto-generated by mp-sentinel - re-run \`${renderRegenerateCommand(knowledgeBase?.packageManager, index?.project.scripts)}\` to update.`,
    ``,
    content.sections.agentWorkflow,
    ...(content.sections.projectRules ? [``, content.sections.projectRules] : []),
    ``,
    content.sections.referenceRouting,
    ``,
    content.sections.overview,
    ...(content.sections.firstFilesToRead ? [``, content.sections.firstFilesToRead] : []),
    ...(content.sections.detectedConventions ? [``, content.sections.detectedConventions] : []),
    ...(content.sections.commonChangePaths ? [``, content.sections.commonChangePaths] : []),
    ``,
    content.sections.languageRules,
    ``,
    content.sections.cleanCodePolicy,
    ``,
    content.sections.fileSizePolicy,
  ];
  if (content.sections.aiEnrichment) {
    skillMdParts.push(``, content.sections.aiEnrichment);
  }
  skillMdParts.push(``, `## References`, ``, ...REFERENCE_LINKS, ...moduleLinks);
  const skillMd = skillMdParts.join("\n");

  const architectureMd = [content.sections.architecture, content.sections.hubFiles]
    .filter(Boolean)
    .join("\n\n");

  const commandsMd = [content.sections.profileRules].filter(Boolean).join("\n\n");

  const moduleRefFiles = moduleRefs.map((m) => ({
    outputPath: join(skillDir, ...m.relPath.split("/")),
    content: m.content,
  }));

  return [
    { outputPath: join(skillDir, "SKILL.md"), content: skillMd },
    ...moduleRefFiles,
    {
      outputPath: join(skillDir, "references", "architecture.md"),
      content: architectureMd || "# Architecture\n\nNo graph data available.",
    },
    {
      outputPath: join(skillDir, "references", "modules.md"),
      content: trimReferenceToBudget(
        content.sections.modules || "# Module Map\n\nNo index available.",
        "### ",
      ),
    },
    {
      outputPath: join(skillDir, "references", "commands.md"),
      content: commandsMd || "# Commands\n\nNo index available.",
    },
    {
      outputPath: join(skillDir, "references", "codebase-map.md"),
      content: trimReferenceToBudget(
        content.sections.codebaseMap || "# Codebase Map\n\nNo index available.",
        "#### ",
      ),
    },
    {
      outputPath: join(skillDir, "references", "testing-map.md"),
      content: content.sections.testingMap || "# Testing Map\n\nNo index available.",
    },
    {
      outputPath: join(skillDir, "references", "dependencies.md"),
      content: content.sections.dependencies || "# Dependencies\n\nNo index available.",
    },
    {
      outputPath: join(skillDir, "references", "public-api.md"),
      content: content.sections.publicApi || "# Public API\n\nNo index available.",
    },
    {
      outputPath: join(skillDir, "references", "code-style.md"),
      content: content.references.codeStyle || "# Code Style\n\nNo style data available.",
    },
    {
      outputPath: join(skillDir, "references", "language-patterns.md"),
      content:
        content.references.languagePatterns || "# Language Patterns\n\nNo language data available.",
    },
    {
      outputPath: join(skillDir, "references", "clean-code-checklist.md"),
      content:
        content.references.cleanCodeChecklist ||
        "# Clean Code Checklist\n\nNo policy data available.",
    },
  ];
}
