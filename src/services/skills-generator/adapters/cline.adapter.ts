/**
 * Cline adapter.
 *
 * Cline supports Skills under `.cline/skills/<skill-name>/SKILL.md`
 * (experimental in Cline docs, but the official direction for
 * progressive-disclosure project guidance). The legacy `.clinerules/`
 * rule files still work but load everything eagerly; we generate a skill
 * folder instead (legacy rule files are flagged as advisories, never
 * deleted).
 *
 * Detection signals:
 *   - `.cline/` directory
 *   - `.clinerules/` legacy directory
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
import { renderProgressiveSkill } from "./skill-renderer.js";

export const clineAdapter: AgentAdapter = {
  id: "cline" as AgentAdapterId,
  label: "Cline (.cline/skills/)",

  spec: {
    officialDocsUrl: "https://docs.cline.bot/customization/skills",
    outputKind: "skill",
    workspacePath: ".cline/skills/{projectName}-cline-best-practices/",
    requiredFiles: ["SKILL.md"],
    frontmatterRules: {
      required: ["description"],
      optional: ["name"],
    },
    sizeLimit: 20000,
  },

  detect(projectRoot: string): boolean {
    return existsSync(join(projectRoot, ".cline")) || existsSync(join(projectRoot, ".clinerules"));
  },

  getDefaultOutput(projectRoot: string, projectName: string): string {
    return join(projectRoot, ".cline", "skills", `${projectName}-cline-best-practices`);
  },

  async generate(
    index: SourceIndex | null,
    context: SkillsGenerationContext,
  ): Promise<GeneratedSkillFile[]> {
    const skillDir = this.getDefaultOutput(context.projectRoot, context.projectName);
    return renderProgressiveSkill(
      index,
      context,
      skillDir,
      `${context.projectName}-cline-best-practices`,
    );
  },
};
