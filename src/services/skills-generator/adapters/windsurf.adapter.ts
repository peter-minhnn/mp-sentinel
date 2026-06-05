/**
 * Windsurf adapter.
 *
 * Windsurf (Cascade) now supports Skills as the recommended progressive-
 * disclosure mechanism for project guidance, stored under
 * `.windsurf/skills/<skill-name>/SKILL.md`. The legacy `.windsurf/rules/`
 * layout still works but loads everything eagerly; we generate a skill
 * folder instead (legacy rule files are flagged as advisories, never
 * deleted).
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

export const windsurfAdapter: AgentAdapter = {
  id: "windsurf" as AgentAdapterId,
  label: "Windsurf (.windsurf/skills/)",

  spec: {
    officialDocsUrl: "https://docs.windsurf.com/windsurf/cascade/skills",
    outputKind: "skill",
    workspacePath: ".windsurf/skills/{projectName}-windsurf-best-practices/",
    requiredFiles: ["SKILL.md"],
    frontmatterRules: {
      required: ["description"],
      optional: ["name"],
    },
    sizeLimit: 20000,
  },

  detect(projectRoot: string): boolean {
    return existsSync(join(projectRoot, ".windsurf"));
  },

  getDefaultOutput(projectRoot: string, projectName: string): string {
    return join(projectRoot, ".windsurf", "skills", `${projectName}-windsurf-best-practices`);
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
      `${context.projectName}-windsurf-best-practices`,
    );
  },
};
