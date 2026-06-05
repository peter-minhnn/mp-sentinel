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

export const antigravityAdapter: AgentAdapter = {
  id: "antigravity" as AgentAdapterId,
  label: "Google Antigravity (.agents/skills/)",

  spec: {
    officialDocsUrl: "https://antigravity.google/docs/skills",
    outputKind: "skill",
    workspacePath: ".agents/skills/{projectName}-antigravity-best-practices/",
    requiredFiles: ["SKILL.md"],
    frontmatterRules: {
      required: ["description"],
      optional: ["name"],
    },
    sizeLimit: 20000,
  },

  detect(projectRoot: string): boolean {
    return existsSync(join(projectRoot, ".antigravity")) || existsSync(join(projectRoot, ".agent"));
  },

  getDefaultOutput(projectRoot: string, projectName: string): string {
    return join(projectRoot, ".agents", "skills", `${projectName}-antigravity-best-practices`);
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
      `${context.projectName}-antigravity-best-practices`,
    );
  },
};
