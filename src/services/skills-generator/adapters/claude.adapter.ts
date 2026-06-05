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

export const claudeAdapter: AgentAdapter = {
  id: "claude" as AgentAdapterId,
  label: "Claude Code (.claude/skills/)",

  spec: {
    officialDocsUrl: "https://docs.anthropic.com/en/docs/claude-code/skills",
    outputKind: "skill",
    workspacePath: ".claude/skills/{projectName}-best-practices/",
    requiredFiles: ["SKILL.md"],
    frontmatterRules: {
      required: ["description"],
      optional: ["name"],
    },
    sizeLimit: 0,
  },

  detect(projectRoot: string): boolean {
    return existsSync(join(projectRoot, ".claude"));
  },

  getDefaultOutput(projectRoot: string, projectName: string): string {
    return join(projectRoot, ".claude", "skills", `${projectName}-best-practices`);
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
      `${context.projectName}-best-practices`,
    );
  },
};
