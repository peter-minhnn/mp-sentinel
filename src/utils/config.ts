/**
 * Configuration loader with caching and strict Zod validation
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { ProjectConfig } from "../types/index.js";
import { DEFAULT_CONFIG } from "../types/index.js";
import { log } from "./logger.js";
import { UserError } from "./errors.js";

let cachedConfig: ProjectConfig | null = null;
const CONFIG_FILENAMES = [".mp-sentinelrc.json", ".sentinelrc.json"] as const;

// ──────────────────────────────────────────────────────────────────────────────
// Zod schemas
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Validates that a string is a valid regex pattern.
 */
const zodRegexString = z.string().refine(
  (val) => {
    try {
      new RegExp(val);
      return true;
    } catch {
      return false;
    }
  },
  { message: "Must be a valid regular expression" },
);

const CommitPatternSchema = z.object({
  type: z.string().min(1, "CommitPattern.type must be a non-empty string"),
  pattern: zodRegexString,
  description: z.string().optional(),
  required: z.boolean().optional(),
});

const LocalReviewConfigSchema = z.object({
  enabled: z.boolean().optional(),
  commitCount: z
    .number()
    .int()
    .positive("localReview.commitCount must be a positive integer")
    .optional(),
  commitPatterns: z.array(CommitPatternSchema).optional(),
  filterByPattern: z.boolean().optional(),
  skipPatterns: z.array(z.string()).optional(),
  excludePatterns: z
    .array(zodRegexString)
    .optional()
    .describe("Regex patterns — commits matching any of these are excluded"),
  includeMergeCommits: z.boolean().optional(),
  branchDiffMode: z.boolean().optional(),
  compareBranch: z.string().optional(),
  patternMatchMode: z.enum(["any", "all"]).optional(),
  verbosePatternMatching: z.boolean().optional(),
});

const AIReviewConfigSchema = z.object({
  enabled: z.boolean().optional(),
  maxFiles: z.number().int().positive("ai.maxFiles must be a positive integer").optional(),
  maxDiffLines: z.number().int().positive("ai.maxDiffLines must be a positive integer").optional(),
  maxCharsPerFile: z
    .number()
    .int()
    .positive("ai.maxCharsPerFile must be a positive integer")
    .optional(),
  promptVersion: z.string().optional(),
  fallbackProvider: z.string().optional(),
  tokenLimit: z.number().int().positive("ai.tokenLimit must be a positive integer").optional(),
});

export const ProjectConfigSchema = z.object({
  techStack: z.string().optional(),
  rules: z.array(z.string()).optional(),
  bypassKeyword: z.string().optional(),
  commitFormat: z.string().optional(),
  maxConcurrency: z.number().int().positive("maxConcurrency must be a positive integer").optional(),
  cacheEnabled: z.boolean().optional(),
  gitProvider: z.enum(["github", "gitlab"]).optional(),
  repoUrl: z.string().url("repoUrl must be a valid URL").optional(),
  projectId: z.string().optional(),
  localReview: LocalReviewConfigSchema.optional(),
  enableSkillsFetch: z.boolean().optional(),
  skillsFetchTimeout: z
    .number()
    .int()
    .positive("skillsFetchTimeout must be a positive integer")
    .optional(),
  ai: AIReviewConfigSchema.optional(),
});

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

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

// ──────────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Load and validate project configuration using Zod.
 * Throws UserError with detailed field-level messages on invalid configs.
 */
export const loadProjectConfig = async (cwd: string = process.cwd()): Promise<ProjectConfig> => {
  if (cachedConfig) {
    return cachedConfig;
  }

  const configPath = resolveConfigPath(cwd);

  if (!configPath) {
    cachedConfig = { ...DEFAULT_CONFIG };
    return cachedConfig;
  }

  let raw: unknown;
  try {
    const content = await readFile(configPath, "utf-8");
    raw = JSON.parse(content);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new UserError(`Failed to read or parse config file at "${configPath}": ${msg}`);
  }

  const result = ProjectConfigSchema.safeParse(raw);

  if (!result.success) {
    const fieldErrors = result.error.issues
      .map((e: z.ZodIssue) => `  • ${e.path.join(".")} — ${e.message}`)
      .join("\n");
    throw new UserError(
      `Invalid configuration in "${configPath}":\n${fieldErrors}\n\nFix the above fields or remove the config file to use defaults.`,
    );
  }

  cachedConfig = mergeConfig(result.data as Partial<ProjectConfig>);
  log.info(`Loaded project-specific rules from ${configPath}`);
  return cachedConfig;
};

/**
 * Clear config cache (useful for testing)
 */
export const clearConfigCache = (): void => {
  cachedConfig = null;
};

/**
 * Validate configuration schema (legacy shim — prefer loadProjectConfig).
 * Returns true/false; does NOT throw.
 */
export const validateConfig = (config: unknown): config is ProjectConfig => {
  return ProjectConfigSchema.safeParse(config).success;
};
