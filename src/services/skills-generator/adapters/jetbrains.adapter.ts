/**
 * JetBrains AI Assistant adapter (Phase 4.2).
 *
 * Junie (JetBrains' AI agent) reads project-scoped instructions from
 * `.junie/AGENTS.md` -- current Junie docs list `.junie/AGENTS.md` first
 * and call `.junie/guidelines.md` the legacy path, so we write the
 * current one. Guidelines load eagerly, so we ship the concise rule body.
 *
 * Detection signals:
 *   - `.junie/` directory
 *   - `.idea/` (IntelliJ-family IDE project marker)
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

export const jetbrainsAdapter: AgentAdapter = {
  id: "jetbrains" as AgentAdapterId,
  label: "JetBrains AI / Junie (.junie/AGENTS.md)",

  spec: {
    officialDocsUrl: "https://www.jetbrains.com/help/junie/customize-guidelines.html",
    outputKind: "rule",
    workspacePath: ".junie/AGENTS.md",
    requiredFiles: [],
    frontmatterRules: { required: [] },
    sizeLimit: 20000,
  },

  detect(projectRoot: string): boolean {
    return existsSync(join(projectRoot, ".junie")) || existsSync(join(projectRoot, ".idea"));
  },

  getDefaultOutput(projectRoot: string, _projectName: string): string {
    return join(projectRoot, ".junie", "AGENTS.md");
  },

  async generate(
    index: SourceIndex | null,
    context: SkillsGenerationContext,
  ): Promise<GeneratedSkillFile[]> {
    const outputPath = this.getDefaultOutput(context.projectRoot, context.projectName);
    return renderConciseRules(index, context, outputPath, {
      titleTemplate: "{projectName} Junie Guidelines",
      blockquoteNote: false,
    });
  },
};
