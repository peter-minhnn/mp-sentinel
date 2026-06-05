/**
 * Zed editor adapter (Phase 4.2).
 *
 * Zed's docs now recommend Skills for project-level agent guidance and
 * list project-local skills under `<worktree>/.agents/skills/`. We write
 * a SKILL.md skill directory there (the legacy root `.rules` file still
 * works in Zed but is no longer the recommended layout). The directory
 * name is suffixed (`-zed-best-practices`) to avoid collisions with the
 * codex/antigravity skills that share `.agents/skills/`.
 *
 * Detection signals:
 *   - `.zed/` directory (Zed workspace settings)
 *   - existing `.rules` file (legacy Zed rules marker)
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

export const zedAdapter: AgentAdapter = {
  id: "zed" as AgentAdapterId,
  label: "Zed (.agents/skills/)",

  spec: {
    officialDocsUrl: "https://zed.dev/docs/ai/skills",
    outputKind: "skill",
    workspacePath: ".agents/skills/{projectName}-zed-best-practices/",
    requiredFiles: ["SKILL.md"],
    frontmatterRules: {
      required: ["description"],
      optional: ["name"],
    },
    sizeLimit: 20000,
  },

  detect(projectRoot: string): boolean {
    return existsSync(join(projectRoot, ".zed")) || existsSync(join(projectRoot, ".rules"));
  },

  getDefaultOutput(projectRoot: string, projectName: string): string {
    return join(projectRoot, ".agents", "skills", `${projectName}-zed-best-practices`);
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
      `${context.projectName}-zed-best-practices`,
    );
  },
};
