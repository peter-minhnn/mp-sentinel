/**
 * GitHub Copilot (Workspace + custom instructions) adapter (Phase 4.2).
 *
 * GitHub's "Adding repository custom instructions for GitHub Copilot"
 * documents `.github/copilot-instructions.md` as the canonical path that
 * Copilot reads for project-wide rules. Copilot recommends short,
 * single-purpose instructions, so this adapter ships the concise rule
 * body (no bulky maps).
 *
 * Detection signals:
 *   - `.github/copilot-instructions.md` already exists
 *   - `.github/` directory exists (best-effort signal that the project
 *     uses GitHub tooling)
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  AgentAdapter,
  AgentAdapterId,
  GeneratedSkillFile,
  SkillsGenerationContext,
  SourceIndex,
} from "../../../types/index.js";
import { renderConciseRules } from "./rule-renderer.js";

export const copilotAdapter: AgentAdapter = {
  id: "copilot" as AgentAdapterId,
  label: "GitHub Copilot (.github/copilot-instructions.md)",

  spec: {
    officialDocsUrl: "https://docs.github.com/en/copilot/concepts/prompting/response-customization",
    outputKind: "rule",
    workspacePath: ".github/copilot-instructions.md",
    requiredFiles: [],
    frontmatterRules: { required: [] },
    sizeLimit: 20000,
  },

  detect(projectRoot: string): boolean {
    return (
      existsSync(join(projectRoot, ".github", "copilot-instructions.md")) ||
      existsSync(join(projectRoot, ".github"))
    );
  },

  getDefaultOutput(projectRoot: string, _projectName: string): string {
    return join(projectRoot, ".github", "copilot-instructions.md");
  },

  async generate(
    index: SourceIndex | null,
    context: SkillsGenerationContext,
  ): Promise<GeneratedSkillFile[]> {
    const outputPath = this.getDefaultOutput(context.projectRoot, context.projectName);
    return renderConciseRules(index, context, outputPath, {
      titleTemplate: "{projectName} Copilot Instructions",
      blockquoteNote: false,
    });
  },
};
