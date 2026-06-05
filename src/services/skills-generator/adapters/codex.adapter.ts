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

export const codexAdapter: AgentAdapter = {
  id: "codex" as AgentAdapterId,
  label: "Codex / OpenAI (.agents/skills/)",

  spec: {
    officialDocsUrl: "https://developers.openai.com/codex/skills",
    outputKind: "skill",
    workspacePath: ".agents/skills/{projectName}-codex-best-practices/",
    requiredFiles: ["SKILL.md"],
    frontmatterRules: {
      required: ["description"],
      optional: ["name"],
    },
    sizeLimit: 20000,
  },

  detect(projectRoot: string): boolean {
    return (
      existsSync(join(projectRoot, ".codex")) ||
      existsSync(join(projectRoot, ".agents")) ||
      // Only treat a root AGENTS.md as a codex signal if .agents/ also exists,
      // so we don't collide with mp-sentinel's own AGENTS.md in the user's repo.
      (existsSync(join(projectRoot, "AGENTS.md")) && existsSync(join(projectRoot, ".agents")))
    );
  },

  getDefaultOutput(projectRoot: string, projectName: string): string {
    return join(projectRoot, ".agents", "skills", `${projectName}-codex-best-practices`);
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
      `${context.projectName}-codex-best-practices`,
    );
  },
};
