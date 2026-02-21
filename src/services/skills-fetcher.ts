/**
 * Skills Fetcher Service
 * Fetches relevant skills from skills.sh based on techStack
 * Implements fail-fast pattern: if fetch fails, continue with default prompts
 *
 * Caching strategy:
 *  1. In-memory cache (fast, per-process)
 *  2. Persistent disk cache in OS temp dir (survives restarts, TTL = 1 hour)
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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

const SKILLS_API_BASE = "https://skills.sh/api";
const FETCH_TIMEOUT = 3000; // 3 seconds - fail fast
const CACHE_TTL = 3_600_000; // 1 hour in ms
const MAX_SKILLS_IN_PROMPT = 8;
const MAX_SKILL_PROMPT_LENGTH = 280;

// ── In-memory cache (fast, per-process) ──────────────────────────────────────
const skillsCache = new Map<string, { data: SkillPrompt[]; timestamp: number }>();

// ── Persistent disk cache helpers ────────────────────────────────────────────
const DISK_CACHE_DIR = join(tmpdir(), "mp-sentinel-skills-cache");

interface DiskCacheEntry {
  data: SkillPrompt[];
  timestamp: number;
}

const diskCachePath = (key: string): string =>
  join(DISK_CACHE_DIR, `${key.replace(/[^a-z0-9]/gi, "_")}.json`);

const readDiskCache = async (key: string): Promise<SkillPrompt[] | null> => {
  const filePath = diskCachePath(key);
  if (!existsSync(filePath)) return null;
  try {
    const raw = await readFile(filePath, "utf-8");
    const entry = JSON.parse(raw) as DiskCacheEntry;
    if (Date.now() - entry.timestamp < CACHE_TTL) {
      return entry.data;
    }
    return null; // expired
  } catch {
    return null;
  }
};

const writeDiskCache = async (key: string, data: SkillPrompt[]): Promise<void> => {
  try {
    await mkdir(DISK_CACHE_DIR, { recursive: true });
    const entry: DiskCacheEntry = { data, timestamp: Date.now() };
    await writeFile(diskCachePath(key), JSON.stringify(entry), "utf-8");
  } catch {
    // Non-critical — silently ignore write failures
  }
};

/**
 * Parse techStack string to extract technologies
 * Example: "TypeScript 5.7, Node.js 18 (ESM), tsup (esbuild)"
 * Returns: ["typescript", "nodejs", "esm", "tsup", "esbuild"]
 */
const parseTechStack = (techStack: string): string[] => {
  if (!techStack) return [];

  return techStack
    .toLowerCase()
    .replace(/[()]/g, " ") // Remove parentheses
    .split(/[,\s]+/) // Split by comma or space
    .map((tech) => tech.trim())
    .filter((tech) => tech.length > 2) // Filter out short strings
    .map((tech) => tech.replace(/\d+(\.\d+)?/g, "").trim()) // Remove version numbers
    .filter((tech) => tech.length > 0);
};

/**
 * Fetch skills from skills.sh API with timeout
 */
const fetchWithTimeout = async (url: string, timeout: number): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "mp-sentinel/1.0",
        Accept: "application/json",
      },
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
};

/**
 * Fetch skills from skills.sh based on technologies
 * CRITICAL: This function NEVER throws - always returns a result object
 */
export const fetchSkillsForTechStack = async (
  techStack: string,
  timeout: number = FETCH_TIMEOUT,
): Promise<SkillsFetchResult> => {
  // Early return if no techStack provided
  if (!techStack || techStack.trim().length === 0) {
    return {
      success: false,
      skills: [],
      error: "No techStack provided",
    };
  }

  const technologies = parseTechStack(techStack);

  if (technologies.length === 0) {
    return {
      success: false,
      skills: [],
      error: "Could not parse technologies from techStack",
    };
  }

  // Check cache first — use a copy to avoid mutating the array in-place (fix H-08)
  const cacheKey = [...technologies].sort().join(",");

  // 1. In-memory cache
  const memCached = skillsCache.get(cacheKey);
  if (memCached && Date.now() - memCached.timestamp < CACHE_TTL) {
    log.info(`Using in-memory cached skills for: ${technologies.join(", ")}`);
    return { success: true, skills: memCached.data };
  }

  // 2. Persistent disk cache
  const diskCached = await readDiskCache(cacheKey);
  if (diskCached) {
    log.info(`Using disk-cached skills for: ${technologies.join(", ")}`);
    // Warm the in-memory cache too
    skillsCache.set(cacheKey, { data: diskCached, timestamp: Date.now() });
    return { success: true, skills: diskCached };
  }

  // Fetch from API (fail-fast pattern)
  try {
    log.info(`Fetching skills from skills.sh for: ${technologies.join(", ")}`);

    const queryParams = technologies.map((t) => `tech=${encodeURIComponent(t)}`).join("&");
    const url = `${SKILLS_API_BASE}/skills?${queryParams}&limit=10`;

    const response = await fetchWithTimeout(url, timeout);

    if (!response.ok) {
      log.warning(`Skills.sh API returned ${response.status}. Continuing with default prompts.`);
      return {
        success: false,
        skills: [],
        error: `API returned ${response.status}`,
      };
    }

    // Runtime type guard — never trust external API data (fix C-02)
    interface RawSkillsAPIResponse {
      skills?: unknown[];
    }
    const isRawSkill = (v: unknown): v is Record<string, unknown> =>
      typeof v === "object" && v !== null;

    const data = (await response.json()) as RawSkillsAPIResponse;
    const rawSkills = Array.isArray(data?.skills) ? data.skills : [];

    const skills: SkillPrompt[] = rawSkills
      .filter(isRawSkill)
      .map((skill) => ({
        skill:
          typeof skill["name"] === "string"
            ? skill["name"]
            : typeof skill["skill"] === "string"
              ? skill["skill"]
              : "",
        category: typeof skill["category"] === "string" ? skill["category"] : "general",
        prompt:
          typeof skill["prompt"] === "string"
            ? skill["prompt"]
            : typeof skill["description"] === "string"
              ? skill["description"]
              : "",
        relevance: typeof skill["relevance"] === "number" ? skill["relevance"] : 1,
      }))
      .filter((s) => s.skill.length > 0);

    // Cache the result — in-memory and on disk
    skillsCache.set(cacheKey, { data: skills, timestamp: Date.now() });
    await writeDiskCache(cacheKey, skills);

    log.success(`Fetched ${skills.length} skills from skills.sh`);

    return {
      success: true,
      skills,
    };
  } catch (error) {
    // CRITICAL: Never throw, always return graceful failure
    const errorMsg = error instanceof Error ? error.message : "Unknown error";

    log.warning(
      `Failed to fetch skills from skills.sh: ${errorMsg}. Continuing with default prompts.`,
    );

    return {
      success: false,
      skills: [],
      error: errorMsg,
    };
  }
};

/**
 * Clear skills cache (useful for testing)
 */
export const clearSkillsCache = (): void => {
  skillsCache.clear();
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

  const sections: string[] = ["\n### TECHNOLOGY-SPECIFIC BEST PRACTICES (from skills.sh)"];

  // Group by category
  const byCategory = new Map<string, SkillPrompt[]>();

  for (const skill of limitedSkills) {
    const category = skill.category || "general";
    if (!byCategory.has(category)) {
      byCategory.set(category, []);
    }
    byCategory.get(category)!.push(skill);
  }

  // Build prompt sections
  for (const [category, categorySkills] of byCategory.entries()) {
    sections.push(`\n#### ${category.toUpperCase()}`);

    for (const skill of categorySkills) {
      if (skill.prompt && skill.prompt.trim().length > 0) {
        const compactPrompt = skill.prompt.trim().slice(0, MAX_SKILL_PROMPT_LENGTH);
        sections.push(`- **${skill.skill}**: ${compactPrompt}`);
      }
    }
  }

  return sections.join("\n");
};
