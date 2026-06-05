/**
 * Roo Code adapter.
 *
 * Roo Code supports Skills under `.roo/skills/<skill-name>/SKILL.md` as
 * the progressive-disclosure mechanism for project guidance. The legacy
 * `.roo/rules/` layout still works but loads everything eagerly; we
 * generate a skill folder instead (legacy rule files are flagged as
 * advisories, never deleted).
 *
 * Detection signals:
 *   - `.roo/` directory
 *   - `.roorules` legacy file
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

export const rooAdapter: AgentAdapter = {
  id: "roo" as AgentAdapterId,
  label: "Roo Code (.roo/skills/)",

  spec: {
    officialDocsUrl: "https://roocodeinc.github.io/Roo-Code/features/skills/",
    outputKind: "skill",
    workspacePath: ".roo/skills/{projectName}-roo-best-practices/",
    requiredFiles: ["SKILL.md"],
    frontmatterRules: {
      required: ["description"],
      optional: ["name"],
    },
    sizeLimit: 20000,
  },

  detect(projectRoot: string): boolean {
    return existsSync(join(projectRoot, ".roo")) || existsSync(join(projectRoot, ".roorules"));
  },

  getDefaultOutput(projectRoot: string, projectName: string): string {
    return join(projectRoot, ".roo", "skills", `${projectName}-roo-best-practices`);
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
      `${context.projectName}-roo-best-practices`,
    );
  },
};
