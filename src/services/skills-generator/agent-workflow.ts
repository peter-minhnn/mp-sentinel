import type { SkillKnowledgeBase } from "../../types/index.js";
import { renderRegenerateCommand, renderScriptAwareToolCommand } from "./package-manager.js";

export function renderAdaptiveWorkflow(
  projectName: string,
  kb: SkillKnowledgeBase | null,
  options: { includeReferences?: boolean; scripts?: Record<string, string> | undefined },
  examples: string,
): string {
  const tool = (args: string): string =>
    renderScriptAwareToolCommand(kb?.packageManager, options.scripts, args);
  const instructions =
    kb?.instructionFiles?.map((f) => `\`${f}\``).join(", ") ||
    "`AGENTS.md`, `CLAUDE.md`, `.claude/skills/`, `.agents/skills/`, `.windsurf/skills/`, `.roo/skills/`, `.cline/skills/`";
  return [
    "## Required Agent Workflow",
    "",
    options.includeReferences !== false
      ? "Read this skill for the project's constraints; load additional references only when relevant."
      : "Read these rules for the project's constraints.",
    `Read local agent instructions for **${projectName}**: ${instructions}. Project-authored rules override generated guidance.`,
    "- Choose the smallest useful retrieval step; known file/region tasks may read source directly. Do not call every tool before each read.",
    `- Check index health once when relying on the index: \`${tool("indexing --health --index-format json")}\`. Recheck after source changes or evidence of staleness.`,
    `- Known identifier: \`${tool("indexing --search <query> --limit 5 --index-format json")}\`. Known path: \`${tool("indexing --find-file <path> --index-format json")}\`.`,
    `- Unclear task: \`${tool('indexing --task-context "<original task>" --token-budget 800 --index-format json')}\`. Top files are suggestions, not an exhaustive set.`,
    `- For symbols, dependencies or callers: \`${tool("indexing --agent-context <file> --token-budget 1200 --focus <anchor> --index-format json")}\`. Omit focus when unnecessary; reuse still-current evidence in this task.`,
    "- Read the relevant source before editing. Keep the original user request and constraints; capsules reduce retrieval output, not conversation memory.",
    "- Budgets/usedTokens use cl100k_base estimates, not the model provider's billed usage. Count additional source, skills and tool calls when measuring savings.",
    "",
    "### Diagnostics (only when needed)",
    `- Parser recovery: \`${tool("indexing --recovered --index-format json")}\`; errors: \`${tool("indexing --parse-errors --index-format json")}\`.`,
    `- File inclusion: \`${tool("indexing --explain-index <file> --index-format json")}\`; statistics: \`${tool("indexing --stats --index-format json")}\`.`,
    `- Review context: \`${tool("--explain-context --format json --files <file>")}\`.`,
    ...(options.includeReferences !== false
      ? [
          `- Load references only for the changed surface: references/testing-map.md for tests; references/language-patterns.md for framework rules; references/clean-code-checklist.md for policies; references/codebase-map.md for modules; references/public-api.md for API changes; references/dependencies.md (${kb?.dependencies.length ?? 0} dependencies) for package usage.`,
        ]
      : []),
    ...(examples ? ["", examples] : []),
    "",
    `> Auto-generated. Regenerate via \`${renderRegenerateCommand(kb?.packageManager, options.scripts)}\`. Do not edit generated files.`,
  ].join("\n");
}
