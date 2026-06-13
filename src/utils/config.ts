/**
 * Configuration loader with caching and strict Zod validation
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { ProjectConfig, IndexingConfig } from "../types/index.js";
import type { MCPPreset } from "../types/index.js";
import { DEFAULT_CONFIG } from "../types/index.js";
import { log } from "./logger.js";
import { UserError } from "./errors.js";
import { stableJson } from "../services/mcp/cache.js";
import { expandPresets, findDuplicateServerIds } from "../services/mcp/presets.js";

let cachedConfig: ProjectConfig | null = null;
const CONFIG_FILENAME = ".mp-sentinelrc.json" as const;
const MAX_RULE_FILES = 10;
const MAX_CHARS_PER_RULE_FILE = 12000;

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
  patternMatchMode: z.enum(["any", "all", "exclude-first"]).optional(),
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
  severityCeilings: z
    .record(z.string(), z.enum(["CRITICAL", "WARNING", "INFO"]))
    .optional()
    .describe("Per-category severity ceilings applied to AI findings after parsing"),
  fallbackProvider: z.string().optional(),
  tokenLimit: z.number().int().positive("ai.tokenLimit must be a positive integer").optional(),
  modelTier: z.enum(["premium", "balanced", "budget"]).optional(),
});

const IndexingConfigSchema = z.object({
  enabled: z.boolean().optional(),
  languages: z
    .array(z.enum(["typescript", "tsx", "javascript", "jsx"]))
    .optional()
    .describe("Languages to include in source indexing"),
  cachePath: z.string().optional(),
  maxFileSize: z
    .number()
    .int()
    .positive("indexing.maxFileSize must be a positive integer")
    .optional(),
  maxRelatedFiles: z
    .number()
    .int()
    .positive("indexing.maxRelatedFiles must be a positive integer")
    .optional()
    .describe(
      "Maximum number of related files (imports/dependents) per changed file in review context",
    ),
  cacheMode: z
    .enum(["light", "full"])
    .optional()
    .describe("Cache layout: light (compact core + sidecars, default) or full (inline payloads)"),
  validationMode: z
    .enum(["fast", "strict"])
    .optional()
    .describe("Cache validation: fast (size+mtime first, default) or strict (hash every file)"),
});

/**
 * CreateSkills AI enrichment config schema
 */
const CreateSkillsAIConfigSchema = z.object({
  enabled: z.boolean().optional().describe("Enable AI enrichment for create-skills"),
  provider: z
    .string()
    .optional()
    .describe("AI provider for enrichment (gemini, openai, anthropic, grok)"),
  model: z.string().optional().describe("Model name for enrichment provider"),
  temperature: z.number().min(0).max(2).optional().describe("Temperature for enrichment (0-2)"),
  maxTokens: z.number().int().positive().optional().describe("Max tokens for enrichment response"),
});

/**
 * CreateSkills clean-code policy thresholds schema.
 * All fields required when the object is present -- partial policies would
 * silently fall back to defaults for missing fields, which is confusing.
 */
const CreateSkillsPoliciesSchema = z.object({
  maxFileLines: z.number().int().positive("createSkills.policies.maxFileLines must be positive"),
  warnFileLines: z.number().int().positive("createSkills.policies.warnFileLines must be positive"),
  maxFunctionLines: z
    .number()
    .int()
    .positive("createSkills.policies.maxFunctionLines must be positive"),
  maxParams: z.number().int().positive("createSkills.policies.maxParams must be positive"),
  maxCyclomaticHint: z
    .number()
    .int()
    .positive("createSkills.policies.maxCyclomaticHint must be positive"),
  forbidDefaultExports: z.boolean(),
});

/**
 * CreateSkills config schema
 */
const CreateSkillsConfigSchema = z.object({
  ai: CreateSkillsAIConfigSchema.optional(),
  /** Clean-code policy thresholds applied to generated skill content. */
  policies: CreateSkillsPoliciesSchema.optional(),
  /**
   * Phase 4.3: rule ids (`<packId>/<ruleId>`) to omit from generated
   * SKILL.md output. Rules without an `id` can't be disabled.
   */
  disableRules: z
    .array(z.string().min(1, "createSkills.disableRules entries must be non-empty"))
    .optional(),
});

// ──────────────────────────────────────────────────────────────────────────────
// MCP schemas
// ──────────────────────────────────────────────────────────────────────────────

const MUTATING_TOOL_PREFIXES = [
  "create",
  "update",
  "delete",
  "merge",
  "close",
  "add",
  "commit",
  "checkout",
  "reset",
  "rerun",
  "trigger",
] as const;

const isMutatingTool = (tool: string): boolean => {
  const lower = tool.toLowerCase();
  return MUTATING_TOOL_PREFIXES.some((prefix) => lower.startsWith(prefix));
};

const MCPCallSchema = z.object({
  tool: z
    .string()
    .min(1, "MCP call tool name must be a non-empty string")
    .refine((val) => !isMutatingTool(val), {
      message:
        `MCP tool "${"${val}"}" matches a mutating prefix. ` +
        "Mutating tools (create*, update*, delete*, merge*, close*, add*, " +
        "commit*, checkout*, reset*, rerun*, trigger*) are rejected.",
    }),
  input: z.record(z.string(), z.unknown()).describe("JSON input for the MCP tool call"),
  maxChars: z.number().int().positive().optional(),
});

const PresetEnvSchema = z.record(z.string(), z.string()).optional();

const MCPGitHubPresetSchema = z.object({
  preset: z.literal("github"),
  calls: z.array(MCPCallSchema).min(1, "GitHub preset must have at least one tool call"),
  env: PresetEnvSchema,
});

const MCPFetchPresetSchema = z
  .object({
    preset: z.literal("fetch"),
    calls: z.array(MCPCallSchema).optional(),
    urls: z.array(z.string().min(1)).optional(),
    env: PresetEnvSchema,
  })
  .refine((val) => (val.calls && val.calls.length > 0) || (val.urls && val.urls.length > 0), {
    message: 'Fetch preset requires at least one of "calls" or "urls" to be non-empty.',
  });

// Phase 4.4 -- additional preset schemas (filesystem, git, slack, linear, postgres)
const MCPFilesystemPresetSchema = z.object({
  preset: z.literal("filesystem"),
  rootPaths: z.array(z.string().min(1)).optional(),
  calls: z.array(MCPCallSchema).min(1, "Filesystem preset must have at least one tool call"),
});

const MCPGitPresetSchema = z.object({
  preset: z.literal("git"),
  repository: z.string().min(1).optional(),
  calls: z.array(MCPCallSchema).min(1, "Git preset must have at least one tool call"),
});

const MCPSlackPresetSchema = z.object({
  preset: z.literal("slack"),
  calls: z.array(MCPCallSchema).min(1, "Slack preset must have at least one tool call"),
  env: PresetEnvSchema,
});

const MCPLinearPresetSchema = z.object({
  preset: z.literal("linear"),
  calls: z.array(MCPCallSchema).min(1, "Linear preset must have at least one tool call"),
  env: PresetEnvSchema,
});

const MCPPostgresPresetSchema = z.object({
  preset: z.literal("postgres"),
  calls: z.array(MCPCallSchema).min(1, "Postgres preset must have at least one tool call"),
  /** Env var name holding the postgresql:// connection URL (default: DATABASE_URL). */
  connectionUrlEnv: z
    .string()
    .min(1, "connectionUrlEnv must be a non-empty env var name")
    .optional(),
  env: PresetEnvSchema,
});

const MCPPresetSchema = z.discriminatedUnion("preset", [
  MCPGitHubPresetSchema,
  MCPFetchPresetSchema,
  MCPFilesystemPresetSchema,
  MCPGitPresetSchema,
  MCPSlackPresetSchema,
  MCPLinearPresetSchema,
  MCPPostgresPresetSchema,
]);

const MCPServerSchema = z.object({
  id: z.string().min(1, "MCP server id must be a non-empty string"),
  transport: z.literal("stdio"),
  command: z.string().min(1, "MCP server command must be a non-empty string"),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
  calls: z
    .array(MCPCallSchema)
    .min(1, "MCP server must have at least one tool call")
    .refine(
      (calls) => {
        const seen = new Set<string>();
        for (const call of calls) {
          const key = call.tool + "::" + stableJson(call.input);
          if (seen.has(key)) return false;
          seen.add(key);
        }
        return true;
      },
      { message: "Duplicate tool+input pairs are not allowed in MCP server calls" },
    ),
});

const MCPConfigSchema = z.object({
  enabled: z.boolean().optional(),
  timeoutMs: z.number().int().positive("mcp.timeoutMs must be a positive integer").optional(),
  maxContextChars: z
    .number()
    .int()
    .positive("mcp.maxContextChars must be a positive integer")
    .optional(),
  cacheEnabled: z.boolean().optional(),
  cacheTtlMs: z.number().int().positive("mcp.cacheTtlMs must be a positive integer").optional(),
  servers: z.array(MCPServerSchema).optional(),
  presets: z.array(MCPPresetSchema).optional(),
});

/**
 * Review settings — controls pass/fail thresholds (Phase 1.5).
 */
const SeverityThresholdSchema = z.enum(["CRITICAL", "WARNING", "INFO"]);

const ReviewSettingsSchema = z.object({
  severityThreshold: SeverityThresholdSchema.optional(),
  protectedBranches: z.record(z.string().min(1), SeverityThresholdSchema).optional(),
  maxFindingsPerFile: z
    .number()
    .int()
    .nonnegative("review.maxFindingsPerFile must be a non-negative integer")
    .optional(),
});

/**
 * Security settings — Phase 2.1.
 *
 * `entropyEnabled` turns on the Shannon-entropy fallback secret detector.
 * `allowValues` / `allowPaths` are escape hatches for known-safe values
 * (publishable keys, fixtures) and known-safe file paths.
 * `customPatterns` lets users add project-specific regexes without forking.
 */
/**
 * Cache backend settings (Phase 3.3).
 */
const CacheSettingsSchema = z.object({
  backend: z.enum(["fs", "http"]).optional(),
  fs: z
    .object({
      cacheDir: z.string().min(1, "cache.fs.cacheDir must be non-empty").optional(),
    })
    .optional(),
  http: z
    .object({
      baseUrl: z.string().url("cache.http.baseUrl must be a valid URL").optional(),
      headers: z.record(z.string(), z.string()).optional(),
      timeoutMs: z
        .number()
        .int()
        .positive("cache.http.timeoutMs must be a positive integer")
        .optional(),
    })
    .optional(),
});

const SecuritySettingsSchema = z.object({
  entropyEnabled: z.boolean().optional(),
  entropyMinLength: z
    .number()
    .int()
    .positive("security.entropyMinLength must be a positive integer")
    .optional(),
  entropyMinBitsPerChar: z.number().positive().optional(),
  allowValues: z.array(z.string()).optional(),
  allowPaths: z.array(z.string()).optional(),
  customPatterns: z
    .array(
      z.object({
        name: z.string().min(1, "security.customPatterns[].name must be non-empty"),
        pattern: zodRegexString,
        flags: z.string().optional(),
      }),
    )
    .optional(),
});

export const ProjectConfigSchema = z.object({
  techStack: z.string().optional(),
  rules: z.array(z.string()).optional(),
  ruleFiles: z.array(z.string()).optional(),
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
  indexing: IndexingConfigSchema.optional(),
  createSkills: CreateSkillsConfigSchema.optional(),
  mcp: MCPConfigSchema.optional(),
  review: ReviewSettingsSchema.optional(),
  security: SecuritySettingsSchema.optional(),
  cache: CacheSettingsSchema.optional(),
});

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

const resolveConfigPath = (cwd: string): string | null => {
  const fullPath = resolve(cwd, CONFIG_FILENAME);
  return existsSync(fullPath) ? fullPath : null;
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
  indexing: {
    ...DEFAULT_CONFIG.indexing,
    ...(userConfig.indexing ?? {}),
  },
  createSkills: {
    ai: {
      ...DEFAULT_CONFIG.createSkills.ai,
      ...(userConfig.createSkills?.ai ?? {}),
    },
    // Preserve generation-affecting fields -- dropping them here would make
    // create-skills silently ignore user config (and --check blind to it).
    // Fall back to the same defaults loadProjectConfig returns when no
    // config file exists, so both paths produce an identical shape.
    policies: userConfig.createSkills?.policies ?? DEFAULT_CONFIG.createSkills.policies,
    disableRules: userConfig.createSkills?.disableRules ?? DEFAULT_CONFIG.createSkills.disableRules,
  },
  mcp: {
    ...DEFAULT_CONFIG.mcp,
    ...(userConfig.mcp ?? {}),
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

  const partialConfig = result.data as Partial<ProjectConfig>;

  // Validate MCP configuration post-parse (cross-field checks incompatible with
  // exactOptionalPropertyTypes in Zod refine)
  if (partialConfig.mcp) {
    const servers = partialConfig.mcp.servers ?? [];
    const presets = partialConfig.mcp.presets ?? [];

    // 1. Check for duplicate explicit server IDs (even without presets)
    if (servers.length > 1) {
      const serverDuplicates = findDuplicateServerIds([], servers);
      if (serverDuplicates.length > 0) {
        throw new UserError(
          `Invalid configuration in "${configPath}":\n` +
            `  • mcp.servers — Duplicate server IDs detected: ${serverDuplicates.join(", ")}. ` +
            `Each server id must be unique.`,
        );
      }
    }

    // 2. Expand presets and check for errors (duplicate names, etc.)
    if (presets.length > 0) {
      const expansion = expandPresets(presets);
      if (expansion.errors.length > 0) {
        const errorLines = expansion.errors.map((e) => `  • mcp.presets — ${e}`).join("\n");
        throw new UserError(`Invalid configuration in "${configPath}":\n${errorLines}`);
      }

      // 3. Check for duplicate IDs between expanded presets and explicit servers
      const duplicates = findDuplicateServerIds(expansion.servers, servers);
      if (duplicates.length > 0) {
        throw new UserError(
          `Invalid configuration in "${configPath}":\n` +
            `  • mcp — Duplicate server IDs detected: ${duplicates.join(", ")}. ` +
            `Each server id must be unique across presets and servers.`,
        );
      }
    }
  }

  // Process ruleFiles: read each file, validate paths, append content to rules
  if (partialConfig.ruleFiles && partialConfig.ruleFiles.length > 0) {
    if (partialConfig.ruleFiles.length > MAX_RULE_FILES) {
      throw new UserError(
        `ruleFiles: maximum ${MAX_RULE_FILES} files allowed, got ${partialConfig.ruleFiles.length}.`,
      );
    }

    if (!partialConfig.rules) {
      partialConfig.rules = [];
    }

    for (const filePath of partialConfig.ruleFiles) {
      if (isAbsolute(filePath)) {
        throw new UserError(`ruleFiles: "${filePath}" must be a relative path.`);
      }
      const resolvedPath = resolve(cwd, filePath);
      const relPath = relative(cwd, resolvedPath);
      // Normalize backslashes to forward slashes so that Windows-style
      // "..\\secrets.md" is caught as traversal even on Unix.
      const normalizedRel = relPath.replace(/\\/g, "/");
      // Reject traversal: ".." or "../foo" or "..\foo" (but not "..rules.md")
      if (normalizedRel === ".." || normalizedRel.startsWith("../") || isAbsolute(relPath)) {
        throw new UserError(`ruleFiles: "${filePath}" must be inside the project root.`);
      }

      let content: string;
      try {
        content = await readFile(resolvedPath, "utf-8");
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new UserError(`ruleFiles: cannot read "${filePath}": ${msg}`);
      }

      const trimmed = content.slice(0, MAX_CHARS_PER_RULE_FILE);
      partialConfig.rules.push(`From ${filePath}:\n${trimmed}`);
    }
  }

  cachedConfig = mergeConfig(partialConfig);
  // Use process.stderr directly to guarantee stdout isolation for JSON commands.
  // log.info routes to console.log (stdout), which would break JSON parse contracts
  // even if setLogQuietMode(true) is called — dynamic imports can create timing gaps.
  process.stderr.write(`Loaded project-specific rules from ${configPath}\n`);
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
  const result = ProjectConfigSchema.safeParse(config);
  if (!result.success) return false;

  const data = result.data as Partial<ProjectConfig>;
  if (data.mcp) {
    const servers = data.mcp.servers ?? [];
    const presets = data.mcp.presets ?? [];

    // Check duplicate explicit server IDs
    if (servers.length > 1) {
      if (findDuplicateServerIds([], servers).length > 0) {
        return false;
      }
    }

    // Check preset expansion errors and duplicate IDs
    if (presets.length > 0) {
      const expansion = expandPresets(presets);
      if (expansion.errors.length > 0) return false;
      if (findDuplicateServerIds(expansion.servers, servers).length > 0) {
        return false;
      }
    }
  }

  return true;
};
