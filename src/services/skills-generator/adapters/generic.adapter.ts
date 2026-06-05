import { join } from "node:path";
import type {
  AgentAdapter,
  AgentAdapterId,
  GeneratedSkillFile,
  SkillsGenerationContext,
  SourceIndex,
} from "../../../types/index.js";
import { renderConciseRules } from "./rule-renderer.js";

export const genericAdapter: AgentAdapter = {
  id: "generic" as AgentAdapterId,
  label: "Generic (.agents/rules/)",

  spec: {
    officialDocsUrl: "",
    outputKind: "rule",
    workspacePath: ".agents/rules/{projectName}-best-practices.md",
    requiredFiles: [],
    frontmatterRules: {
      required: [],
    },
    sizeLimit: 20000,
  },

  // Generic is a fallback - never auto-detected; only added explicitly
  detect(_projectRoot: string): boolean {
    return false;
  },

  getDefaultOutput(projectRoot: string, projectName: string): string {
    return join(projectRoot, ".agents", "rules", `${projectName}-best-practices.md`);
  },

  async generate(
    index: SourceIndex | null,
    context: SkillsGenerationContext,
  ): Promise<GeneratedSkillFile[]> {
    const outputPath = this.getDefaultOutput(context.projectRoot, context.projectName);
    return renderConciseRules(index, context, outputPath, {
      titleTemplate: "{projectName} Best Practices",
    });
  },
};
