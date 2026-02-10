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

/**
 * Load and validate project configuration
 */
export const loadProjectConfig = async (
  cwd: string = process.cwd(),
): Promise<ProjectConfig> => {
  if (cachedConfig) {
    return cachedConfig;
  }

  const configPath = resolve(cwd, ".sentinelrc.json");

  if (!existsSync(configPath)) {
    cachedConfig = { ...DEFAULT_CONFIG };
    return cachedConfig;
  }

  try {
    const content = await readFile(configPath, "utf-8");
    const userConfig = JSON.parse(content) as Partial<ProjectConfig>;

    // Merge with defaults
    cachedConfig = {
      ...DEFAULT_CONFIG,
      ...userConfig,
    };

    log.info("Loaded project-specific rules from .sentinelrc.json");
    return cachedConfig;
  } catch (error) {
    log.warning("Found .sentinelrc.json but failed to parse it.");
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

  return true;
};
