/**
 * Aider adapter (Phase 4.2).
 *
 * Aider is a terminal-based AI pair-programming tool. It picks up a
 * project-level conventions file at `CONVENTIONS.md` (or a path passed
 * via `--read CONVENTIONS.md` / configured under `read:` in
 * `.aider.conf.yml`). Aider's official docs explicitly call out the
 * conventions-file pattern as the recommended way to ship project rules
 * to the model. Conventions files load eagerly, so we ship the concise
 * rule body.
 *
 * Detection signals:
 *   - `.aider.conf.yml` at the project root
 *   - existing `CONVENTIONS.md`
 *
 * We write to `CONVENTIONS.md` -- the canonical name Aider documents.
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

export const aiderAdapter: AgentAdapter = {
  id: "aider" as AgentAdapterId,
  label: "Aider (CONVENTIONS.md)",

  spec: {
    officialDocsUrl: "https://aider.chat/docs/usage/conventions.html",
    outputKind: "rule",
    workspacePath: "CONVENTIONS.md",
    requiredFiles: [],
    frontmatterRules: { required: [] },
    sizeLimit: 20000,
  },

  detect(projectRoot: string): boolean {
    return (
      existsSync(join(projectRoot, ".aider.conf.yml")) ||
      existsSync(join(projectRoot, "CONVENTIONS.md"))
    );
  },

  getDefaultOutput(projectRoot: string, _projectName: string): string {
    return join(projectRoot, "CONVENTIONS.md");
  },

  async generate(
    index: SourceIndex | null,
    context: SkillsGenerationContext,
  ): Promise<GeneratedSkillFile[]> {
    const outputPath = this.getDefaultOutput(context.projectRoot, context.projectName);
    return renderConciseRules(index, context, outputPath, {
      titleTemplate: "{projectName} Conventions",
    });
  },
};
