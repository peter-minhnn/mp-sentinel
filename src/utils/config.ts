/**
 * Configuration loader with caching and validation
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ProjectConfig } from "../types/index.js";
import { DEFAULT_CONFIG } from "../types/index.js";
import { log } from "./logger.js";

let cachedConfig: ProjectConfig | null = null;
const CONFIG_FILENAMES = [".mp-sentinelrc.json", ".sentinelrc.json"] as const;

const resolveConfigPath = (cwd: string): string | null => {
  for (const filename of CONFIG_FILENAMES) {
    const fullPath = resolve(cwd, filename);
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }
  return null;
};

const mergeConfig = (userConfig: Partial<ProjectConfig>): ProjectConfig => ({
  ...DEFAULT_CONFIG,
  ...userConfig,
  ai: {
    ...DEFAULT_CONFIG.ai,
    ...(userConfig.ai ?? {}),
  },
  localReview: {
    ...DEFAULT_CONFIG.localReview,
    ...(userConfig.localReview ?? {}),
  },
});

/**
 * Load and validate project configuration
 */
export const loadProjectConfig = async (
  cwd: string = process.cwd(),
): Promise<ProjectConfig> => {
  if (cachedConfig) {
    return cachedConfig;
  }

  const configPath = resolveConfigPath(cwd);

  if (!configPath) {
    cachedConfig = { ...DEFAULT_CONFIG };
    return cachedConfig;
  }

  try {
    const content = await readFile(configPath, "utf-8");
    const userConfig = JSON.parse(content) as Partial<ProjectConfig>;
    if (!validateConfig(userConfig)) {
      log.warning(`Configuration at ${configPath} is invalid. Using defaults.`);
      cachedConfig = { ...DEFAULT_CONFIG };
      return cachedConfig;
    }

    // Merge with defaults
    cachedConfig = mergeConfig(userConfig);

    log.info(`Loaded project-specific rules from ${configPath}`);
    return cachedConfig;
  } catch (error) {
    log.warning(`Found ${configPath} but failed to parse it.`);
    cachedConfig = { ...DEFAULT_CONFIG };
    return cachedConfig;
  }
};

/**
 * Clear config cache (useful for testing)
 */
export const clearConfigCache = (): void => {
  cachedConfig = null;
};

/**
 * Validate configuration schema
 */
export const validateConfig = (config: unknown): config is ProjectConfig => {
  if (typeof config !== "object" || config === null) {
    return false;
  }

  const c = config as Record<string, unknown>;

  if (c.techStack !== undefined && typeof c.techStack !== "string") {
    return false;
  }

  if (c.rules !== undefined && !Array.isArray(c.rules)) {
    return false;
  }

  if (c.bypassKeyword !== undefined && typeof c.bypassKeyword !== "string") {
    return false;
  }

  if (c.commitFormat !== undefined && typeof c.commitFormat !== "string") {
    return false;
  }

  if (c.maxConcurrency !== undefined && typeof c.maxConcurrency !== "number") {
    return false;
  }

  if (c.ai !== undefined) {
    if (typeof c.ai !== "object" || c.ai === null) {
      return false;
    }
    const aiConfig = c.ai as Record<string, unknown>;
    if (aiConfig.enabled !== undefined && typeof aiConfig.enabled !== "boolean") {
      return false;
    }
    if (aiConfig.maxFiles !== undefined && typeof aiConfig.maxFiles !== "number") {
      return false;
    }
    if (
      aiConfig.maxDiffLines !== undefined &&
      typeof aiConfig.maxDiffLines !== "number"
    ) {
      return false;
    }
    if (
      aiConfig.maxCharsPerFile !== undefined &&
      typeof aiConfig.maxCharsPerFile !== "number"
    ) {
      return false;
    }
    if (
      aiConfig.promptVersion !== undefined &&
      typeof aiConfig.promptVersion !== "string"
    ) {
      return false;
    }
  }

  return true;
};
