/**
 * Skills Fetcher Service
 * Scans local project directories for skills added via 'npx skills' or manual user customization.
 * Replaces the defunct skills.sh remote API.
 */

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { log } from "../utils/logger.js";

export interface SkillPrompt {
  skill: string;
  category: string;
  prompt: string;
  relevance: number;
}

export interface SkillsFetchResult {
  success: boolean;
  skills: SkillPrompt[];
  error?: string;
}

const LOCAL_SKILLS_DIRS = [".skills", ".agent/skills", ".cursor/rules", ".sentinel/skills"];
const MAX_SKILLS_IN_PROMPT = 10;
const MAX_SKILL_PROMPT_LENGTH = 8000; // Increased to accommodate full local markdown files

/**
 * Parse techStack string to extract technologies
 * Example: "TypeScript 5.7, Node.js 24" -> ["typescript", "nodejs"]
 */
export const parseTechStack = (techStack: string): string[] => {
  if (!techStack) return [];

  return techStack
    .toLowerCase()
    .replace(/[()]/g, " ")
    .split(/[,\s]+/)
    .map((tech) => tech.trim())
    .filter((tech) => tech.length > 2)
    .map((tech) => tech.replace(/\d+(\.\d+)?/g, "").trim())
    .filter((tech) => tech.length > 0);
};

/**
 * Scan local directories for skills
 * Boosts relevance for skills matching the techStack
 */
export const fetchSkillsForTechStack = async (
  techStack: string,
  _timeout?: number,
): Promise<SkillsFetchResult> => {
  const technologies = parseTechStack(techStack);
  const skills: SkillPrompt[] = [];

  try {
    const cwd = process.cwd();

    for (const dir of LOCAL_SKILLS_DIRS) {
      const fullPath = join(cwd, dir);
      if (!existsSync(fullPath)) continue;

      const files = await readdir(fullPath);
      for (const file of files) {
        if (!file.endsWith(".md") && !file.endsWith(".mdc")) continue;

        const fileName = file.toLowerCase();

        // Boost relevance if the file name matches a tech in the techStack
        let relevance = 1;
        for (const tech of technologies) {
          if (fileName.includes(tech)) {
            relevance += 10;
          }
        }

        try {
          const content = await readFile(join(fullPath, file), "utf-8");
          skills.push({
            skill: file.replace(/\.mdc?$/, ""),
            category: dir,
            prompt: content,
            relevance,
          });
        } catch (err) {
          log.warning(`Could not read skill file: ${file}`);
        }
      }
    }

    if (skills.length > 0) {
      log.success(`Loaded ${skills.length} local skills from project directories.`);
    }

    return {
      success: true,
      skills,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    log.warning(`Failed to load local skills: ${errorMsg}`);

    return {
      success: false,
      skills: [],
      error: errorMsg,
    };
  }
};

/**
 * Clear skills cache (useful for testing)
 * Deprecated: now reads from local filesystem real-time
 */
export const clearSkillsCache = (): void => {
  // No-op
};

/**
 * Build additional prompt context from fetched skills
 */
export const buildSkillsPromptSection = (skills: SkillPrompt[]): string => {
  if (skills.length === 0) {
    return "";
  }

  const limitedSkills = [...skills]
    .sort((a, b) => (b.relevance || 0) - (a.relevance || 0))
    .slice(0, MAX_SKILLS_IN_PROMPT);

  const sections: string[] = ["\n### LOCAL/CUSTOM SKILLS & BEST PRACTICES"];

  for (const skill of limitedSkills) {
    if (skill.prompt && skill.prompt.trim().length > 0) {
      const compactPrompt = skill.prompt.trim().slice(0, MAX_SKILL_PROMPT_LENGTH);
      sections.push(`\n#### Skill: ${skill.skill} (from ${skill.category})`);
      sections.push(compactPrompt);
    }
  }

  return sections.join("\n");
};
