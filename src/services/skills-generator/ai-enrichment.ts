/**
 * AI Enrichment - uses an AI provider to generate supplementary
 * best-practice notes for skill files.
 *
 * This is an **opt-in** feature controlled by `createSkills.ai.enabled` in
 * `.mp-sentinelrc.json`. When disabled (the default), all skill generation is
 * purely deterministic from the source index.
 *
 * The AI enrichment pipeline:
 *   SourceIndex -> AIEnrichmentInput -> provider.generateContent() -> AIEnrichmentOutput
 *
 * Output is validated with a Zod schema. If parsing or validation fails,
 * the command fails with exit code 2.
 */

import { createHash } from "node:crypto";
import { readFile, writeFile, rename, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type {
  SourceIndex,
  AIEnrichmentInput,
  AIEnrichmentOutput,
  EnrichmentMetadata,
  FileRole,
  CreateSkillsAIConfig,
  SkillKnowledgeBase,
  LanguageProfile,
  CodeStyleProfile,
  CreateSkillsPolicies,
} from "../../types/index.js";
import type { AIProvider, AIModelConfig } from "../ai/types.js";
import { log } from "../../utils/logger.js";
import { ProviderError } from "../../utils/errors.js";
import { AIProviderFactory } from "../ai/factory.js";
import { AIConfig } from "../ai/config.js";
import { detectProfile } from "./profile.js";
import { buildSkillKnowledgeBase } from "./knowledge-base.js";
import { computeIndexHash } from "./metadata.js";

// ── Zod validation ─────────────────────────────────────────────────────────

import { z } from "zod";

/**
 * Zod schema for AI enrichment output validation.
 * AI providers may return free-form text; we validate it against this schema
 * and fail if the output does not conform.
 */
const AIEnrichmentOutputSchema = z.object({
  languageRules: z.array(z.string()).max(20, "Too many language rules"),
  libraryRules: z.array(z.string()).max(30, "Too many library rules"),
  versionNotes: z.array(z.string()).max(10, "Too many version notes"),
  riskWarnings: z.array(z.string()).max(15, "Too many risk warnings"),
  recommendedChecks: z.array(z.string()).max(15, "Too many recommended checks"),
  // v2 additive fields (all optional for backward compat)
  rulesByLanguage: z.record(z.string(), z.array(z.string()).max(15)).optional(),
  cleanCodeRules: z.array(z.string()).max(15).optional(),
  antiPatterns: z
    .array(
      z.object({
        pattern: z.string(),
        files: z.array(z.string()).max(5),
        fix: z.string(),
      }),
    )
    .max(10)
    .optional(),
  styleEnforcement: z.array(z.string()).max(10).optional(),
});

/**
 * Validate that a raw string from the AI provider conforms to AIEnrichmentOutput.
 */
export function validateAIEnrichmentOutput(raw: string): AIEnrichmentOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`AI enrichment output is not valid JSON. Raw output:\n${raw.slice(0, 500)}`);
  }

  const result = AIEnrichmentOutputSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  * ${i.path.join(".")} - ${i.message}`)
      .join("\n");
    throw new Error(
      `AI enrichment output failed Zod validation:\n${issues}\n\nRaw output:\n${raw.slice(0, 500)}`,
    );
  }

  return result.data as AIEnrichmentOutput;
}

// ── Input builder ──────────────────────────────────────────────────────────

export interface EnrichmentInputOptions {
  knowledgeBase?: SkillKnowledgeBase | null;
  projectRules?: string[] | undefined;
  languageMix?: LanguageProfile | undefined;
  codeStyleProfile?: CodeStyleProfile | undefined;
  policies?: CreateSkillsPolicies | undefined;
  codeSamples?: Array<{ path: string; content: string; __scrubbed?: boolean }> | undefined;
  observedAntiPatterns?: string[] | undefined;
}

/**
 * Build an AIEnrichmentInput from a SourceIndex.
 * This is a compact representation designed to fit within token budgets.
 */
export function buildEnrichmentInput(
  index: SourceIndex,
  knowledgeBase?: SkillKnowledgeBase | null,
  projectRules: string[] = [],
  options?: EnrichmentInputOptions,
): AIEnrichmentInput {
  const { project } = index;
  const kb = knowledgeBase ?? buildSkillKnowledgeBase(index);

  // Categorize modules by role
  const moduleRoles: Record<string, string[]> = {
    cli: [],
    services: [],
    tests: [],
    types: [],
    utils: [],
    config: [],
    other: [],
  };

  if (index.insights?.fileRoles) {
    for (const [filePath, role] of Object.entries(index.insights.fileRoles)) {
      const category = roleToCategory(role as FileRole);
      if (!moduleRoles[category]) moduleRoles[category] = [];
      moduleRoles[category]!.push(filePath);
    }
  }

  // Sort moduleRoles keys for determinism
  const sortedModuleRoles: Record<string, string[]> = {};
  for (const key of Object.keys(moduleRoles).sort()) {
    sortedModuleRoles[key] = (moduleRoles[key] ?? []).slice().sort();
  }

  // Top dependencies by usage count
  const topDependencies: string[] = [];
  const depUsage = index.insights?.dependencyUsage ?? {};
  const sortedDeps = Object.entries(depUsage).sort(([, a], [, b]) => b.length - a.length);
  for (let i = 0; i < Math.min(15, sortedDeps.length); i++) {
    const dep = sortedDeps[i];
    if (dep) topDependencies.push(dep[0]);
  }

  // Top dependencies with versions from SkillKnowledgeBase
  const topDependenciesWithVersions: Record<string, string> = {};
  for (const dep of kb.dependencies.slice(0, 15)) {
    topDependenciesWithVersions[dep.packageName] = dep.version;
  }

  const profile = detectProfile(index);

  return {
    projectName: project.packageName ?? "unknown",
    packageVersion: project.packageVersion ?? "0.0.0",
    packageManager: project.packageManager ?? "npm",
    scripts: project.scripts ?? {},
    bin: project.bin,
    engines: project.nodeEngine ? { node: project.nodeEngine } : undefined,
    dependencies: project.dependencies,
    devDependencies: project.devDependencies,
    detectedFrameworks: project.detectedFrameworks,
    profile,
    fileCount: index.files.length,
    moduleRoles: sortedModuleRoles,
    publicApiFiles: (index.insights?.publicApiFiles ?? []).slice().sort(),
    testFileCount: index.insights ? Object.keys(index.insights.testMap).length : 0,
    topDependencies: topDependencies.slice().sort(),
    testGapCount: kb.testing.testGaps.length,
    topDependenciesWithVersions,
    defaultExportCount: kb.risks.filter((r) => r.type === "default-export").length,
    dynamicImportCount: kb.risks.filter((r) => r.type === "dynamic-import").length,
    hubFileCount: kb.risks.filter((r) => r.type === "hub-file").length,
    projectRules: projectRules.slice(0, 20),
    // v2 optional fields from EnrichmentInputOptions
    ...(options?.languageMix ? { languageMix: options.languageMix } : {}),
    ...(options?.codeStyleProfile ? { codeStyleProfile: options.codeStyleProfile } : {}),
    ...(options?.policies ? { policies: options.policies } : {}),
    ...(options?.codeSamples
      ? (() => {
          // Runtime assertion: every sample must carry the __scrubbed brand
          const unscrubbed = options.codeSamples!.filter((s) => !s.__scrubbed);
          if (unscrubbed.length > 0) {
            throw new Error(
              `Code samples must be scrubbed before reaching the AI prompt. Unscrubbed files: ${unscrubbed.map((s) => s.path).join(", ")}. ` +
                "Use loadAndScrubCodeSamples() from code-samples.ts.",
            );
          }
          return { codeSamples: options.codeSamples };
        })()
      : {}),
    ...(options?.observedAntiPatterns
      ? { observedAntiPatterns: options.observedAntiPatterns }
      : {}),
  };
}

function roleToCategory(role: FileRole): string {
  switch (role) {
    case "cli-entry":
    case "command":
      return "cli";
    case "service":
    case "provider":
    case "adapter":
      return "services";
    case "test":
      return "tests";
    case "type":
      return "types";
    case "utils":
      return "utils";
    case "config":
      return "config";
    default:
      return "other";
  }
}

// ── Prompt template ────────────────────────────────────────────────────────

const ENRICHMENT_PROMPT_VERSION = "2026-05-08";

export function buildEnrichmentPrompt(input: AIEnrichmentInput): string {
  const { projectName, packageVersion, packageManager, dependencies, devDependencies } = input;
  const allDeps = { ...dependencies, ...devDependencies };

  const depLines = Object.entries(allDeps)
    .slice(0, 30)
    .map(([name, ver]) => `    "${name}": "${ver}"`)
    .join("\n");

  const scriptLines = Object.entries(input.scripts)
    .slice(0, 20)
    .map(([name, cmd]) => `    "${name}": "${cmd.replace(/"/g, "'")}"`)
    .join("\n");

  const roleLines = Object.entries(input.moduleRoles)
    .filter(([, paths]) => paths.length > 0)
    .map(([category, paths]) => `    ${category}: ${paths.length} file(s)`)
    .join("\n");

  const depsWithVersions = Object.entries(input.topDependenciesWithVersions)
    .map(([name, ver]) => `    "${name}": "${ver}"`)
    .join("\n");

  const projectRuleLines = input.projectRules
    .slice(0, 20)
    .map((rule, index) => `    ${index + 1}. ${rule.replace(/"/g, "'")}`)
    .join("\n");

  // v2: Language mix info
  const langMixLines = input.languageMix
    ? `    dominant: ${input.languageMix.dominant}
    secondary: [${input.languageMix.secondary.join(", ")}]
    languages: ${JSON.stringify(input.languageMix.distribution)}`
    : "    (not detected)";

  // v2: Code style info
  const styleLines = input.codeStyleProfile
    ? `    indent: ${input.codeStyleProfile.indent}
    quotes: ${input.codeStyleProfile.singleQuoteRatio > 0.6 ? "single" : input.codeStyleProfile.singleQuoteRatio < 0.4 ? "double" : "mixed"}
    semicolons: ${input.codeStyleProfile.semicolonRatio > 0.6 ? "yes" : input.codeStyleProfile.semicolonRatio < 0.4 ? "no" : "mixed"}
    formatters: [${input.codeStyleProfile.formatterConfigs.join(", ")}]
    maxFileLines: ${input.codeStyleProfile.maxFileLines}
    p95FileLines: ${input.codeStyleProfile.p95FileLines}
    oversizedFiles: ${input.codeStyleProfile.oversizedFiles.length}`
    : "    (not detected)";

  // v2: Code samples (secret-scrubbed via SecurityService)
  const sampleLines = input.codeSamples
    ? input.codeSamples
        .slice(0, 5)
        .map((s) => `  -- ${s.path} --\n${s.content.split("\n").slice(0, 40).join("\n")}`)
        .join("\n")
    : "    (none)";

  // v2: Anti-patterns
  const antiPatternLines = input.observedAntiPatterns
    ? input.observedAntiPatterns
        .slice(0, 10)
        .map((a) => `    - ${a}`)
        .join("\n")
    : "    (none detected)";

  // v2: Policies
  const policyLines = input.policies
    ? `    maxFileLines: ${input.policies.maxFileLines}
    maxFunctionLines: ${input.policies.maxFunctionLines}
    forbidDefaultExports: ${input.policies.forbidDefaultExports}`
    : "    (defaults)";

  return JSON.stringify({
    modelInfo: {
      role: "You are an expert codebase quality advisor. Analyze the project manifest, code samples, language mix, and code style below and return a JSON object with best-practice recommendations.",
      projectName,
      packageVersion,
      packageManager,
      profile: input.profile,
    },
    projectDetails: {
      detectedFrameworks: input.detectedFrameworks,
      fileCount: input.fileCount,
      testFileCount: input.testFileCount,
      testGapCount: input.testGapCount,
      publicApiCount: input.publicApiFiles.length,
      defaultExportCount: input.defaultExportCount,
      dynamicImportCount: input.dynamicImportCount,
      hubFileCount: input.hubFileCount,
      languageMix: `{\n${langMixLines}\n  }`,
      codeStyle: `{\n${styleLines}\n  }`,
      cleanCodePolicy: `{\n${policyLines}\n  }`,
    },
    manifest: {
      scripts: `{\n${scriptLines}\n  }`,
      dependencies: `{\n${depLines}\n  }`,
      topDependenciesWithVersions: `{\n${depsWithVersions}\n  }`,
      engines: input.engines ?? {},
      bin: input.bin ?? null,
    },
    projectRules: `{\n${projectRuleLines}\n  }`,
    moduleBreakdown: `{\n${roleLines}\n  }`,
    codeSamples:
      input.codeSamples && input.codeSamples.length > 0 ? `\n${sampleLines}\n` : undefined,
    observedAntiPatterns:
      input.observedAntiPatterns && input.observedAntiPatterns.length > 0
        ? `\n${antiPatternLines}\n`
        : undefined,
    outputFormat: {
      instructions: `Return ONLY valid JSON in the following shape, with no markdown or commentary around it. Ground every rule in the actual dependency versions or code samples provided above:

{
  "languageRules": [
    "Array of 2-5 language/framework best-practice rules tailored to the project's tech stack and detected frameworks. Reference the exact package versions found in topDependenciesWithVersions above."
  ],
  "libraryRules": [
    "Array of 2-5 library-specific best-practice rules. Use the version information from topDependenciesWithVersions - e.g., 'With zod v4.3.6, use .parse() for input validation'."
  ],
  "versionNotes": [
    "Array of 1-3 notes about version constraints or gotchas based on the actual dependency versions in the manifest."
  ],
  "riskWarnings": [
    "Array of 1-3 risk warnings informed by the project metrics above: test gaps (${input.testGapCount} untested files), default exports (${input.defaultExportCount}), dynamic imports (${input.dynamicImportCount}), hub files (${input.hubFileCount}), and detected profile."
  ],
  "recommendedChecks": [
    "Array of 1-3 recommended review checks specific to this project's architecture and dependency versions."
  ],
  "rulesByLanguage": {
    "languageName": [
      "Array of 2-5 rules per detected language, grounded in code samples if provided. Only include languages present in the languageMix above."
    ]
  },
  "cleanCodeRules": [
    "Array of 2-5 clean-code rules derived from the actual code style and policies observed."
  ],
  "antiPatterns": [
    {
      "pattern": "Description of an anti-pattern observed in code samples or project metrics",
      "files": ["file path(s) where this pattern appears — use real paths from codeSamples when available"],
      "fix": "Actionable fix suggestion"
    }
  ],
  "styleEnforcement": [
    "Array of 2-3 style enforcement rules based on the detected codeStyle above (indent, quotes, semicolons). Match these to the project's actual style, not a preference."
  ]
}

Base all recommendations on actual dependency versions and code samples, not generic advice. Treat projectRules as highest-priority project-specific constraints. Do NOT invent rules for packages not listed in the dependencies. Be concise. Do NOT include any text outside the JSON block. Do NOT wrap in markdown code fences. When codeSamples are provided, use them to ground antiPatterns with real file paths. If codeSamples are not provided, skip antiPatterns and styleEnforcement.`,
    },
  });
}

// ── Deep sort for deterministic hashing ────────────────────────────────────

/**
 * Deep-sort an object for deterministic JSON serialization.
 * Recursively sorts object keys; preserves array element order.
 */
export function deepSortForHash(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(deepSortForHash);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = deepSortForHash((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

// ── Hash helpers ───────────────────────────────────────────────────────────

/**
 * Compute a deterministic hash of the enrichment input.
 * Uses deep-sort to guarantee stability regardless of key order.
 */
export function computeEnrichmentInputHash(input: AIEnrichmentInput): string {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(deepSortForHash(input)));
  return hash.digest("hex").slice(0, 16);
}

/**
 * Compute a deterministic hash of the enrichment output.
 * Uses deep-sort to handle nested object key ordering.
 */
export function computeEnrichmentOutputHash(output: AIEnrichmentOutput): string {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(deepSortForHash(output)));
  return hash.digest("hex").slice(0, 16);
}

// ── Cache helpers ──────────────────────────────────────────────────────────

const ENRICHMENT_CACHE_DIR = "ai-enrichment";

/**
 * Composite cache key for AI enrichment results.
 * Combines source index hash, provider, model, prompt version, and input hash
 * so that any change to these components produces a different key.
 */
export function computeEnrichmentCacheKey(
  sourceIndexHash: string,
  provider: string,
  model: string,
  promptVersion: string,
  inputHash: string,
  baseUrl?: string,
): string {
  const parts = [
    sourceIndexHash,
    provider,
    model,
    ...(baseUrl ? [baseUrl] : []),
    promptVersion,
    inputHash,
  ];
  const composite = parts.join("::");
  return createHash("sha256").update(composite).digest("hex").slice(0, 16);
}

/** Zod schema for cache envelope validation. */
const EnrichmentCacheEnvelopeSchema = z.object({
  cacheKey: z.string(),
  createdAt: z.string(),
  metadata: z.object({
    mode: z.literal("ai"),
    provider: z.string(),
    model: z.string(),
    promptVersion: z.string(),
    inputHash: z.string(),
    outputHash: z.string(),
  }),
  output: z
    .object({
      languageRules: z.array(z.string()),
      libraryRules: z.array(z.string()),
      versionNotes: z.array(z.string()),
      riskWarnings: z.array(z.string()),
      recommendedChecks: z.array(z.string()),
      // v2 additive — allow extra keys in cache
    })
    .passthrough(),
});

interface EnrichmentCacheEnvelope {
  cacheKey: string;
  createdAt: string;
  metadata: EnrichmentMetadata & { mode: "ai" };
  output: AIEnrichmentOutput;
}

function cacheFilePath(projectRoot: string, cacheKey: string): string {
  return join(projectRoot, ".mp-sentinel-cache", ENRICHMENT_CACHE_DIR, `${cacheKey}.json`);
}

async function deleteCacheFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // best-effort
  }
}

/**
 * Read a cached enrichment result. Returns null on cache miss,
 * corrupt cache (deleted if possible), or key mismatch (deleted if possible).
 */
export async function readEnrichmentCache(
  projectRoot: string,
  cacheKey: string,
): Promise<{ metadata: EnrichmentMetadata; output: AIEnrichmentOutput } | null> {
  const path = cacheFilePath(projectRoot, cacheKey);
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    log.warning(`Corrupt AI enrichment cache (invalid JSON), deleting`);
    await deleteCacheFile(path);
    return null;
  }

  const result = EnrichmentCacheEnvelopeSchema.safeParse(parsed);
  if (!result.success) {
    log.warning(`Corrupt AI enrichment cache (schema mismatch), deleting`);
    await deleteCacheFile(path);
    return null;
  }

  if (result.data.cacheKey !== cacheKey) {
    log.warning(`AI enrichment cache key mismatch, deleting`);
    await deleteCacheFile(path);
    return null;
  }

  log.info(`Using cached AI enrichment (${ENRICHMENT_CACHE_DIR}/${cacheKey}.json)`);
  return {
    metadata: result.data.metadata,
    output: result.data.output,
  };
}

/**
 * Write an enrichment result to the cache. Best-effort — never throws.
 */
export async function writeEnrichmentCache(
  projectRoot: string,
  cacheKey: string,
  metadata: EnrichmentMetadata & { mode: "ai" },
  output: AIEnrichmentOutput,
): Promise<void> {
  const dir = join(projectRoot, ".mp-sentinel-cache", ENRICHMENT_CACHE_DIR);
  const path = join(dir, `${cacheKey}.json`);

  const envelope: EnrichmentCacheEnvelope = {
    cacheKey,
    createdAt: new Date().toISOString(),
    metadata,
    output,
  };

  try {
    await mkdir(dir, { recursive: true });
    const tmp = path + ".tmp." + Date.now();
    await writeFile(tmp, JSON.stringify(envelope, null, 2), "utf-8");
    await rename(tmp, path);
    log.info(`AI enrichment cached -> ${ENRICHMENT_CACHE_DIR}/${cacheKey}.json`);
  } catch (err) {
    log.warning(`Failed to write AI enrichment cache: ${(err as Error).message}`);
  }
}

// ── Provider validation ────────────────────────────────────────────────────

const VALID_AI_PROVIDERS: readonly AIProvider[] = [
  "gemini",
  "openai",
  "anthropic",
  "grok",
  "openrouter",
];

function isAIProvider(s: string): s is AIProvider {
  return (VALID_AI_PROVIDERS as readonly string[]).includes(s);
}

// ── Main enrichment function ───────────────────────────────────────────────

/**
 * Configuration for the AI enrichment call.
 */
export interface AIEnrichmentConfig {
  provider?: AIProvider;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  projectRoot?: string;
  projectRules?: string[];
  // v2 options
  languageMix?: LanguageProfile;
  codeStyleProfile?: CodeStyleProfile;
  policies?: CreateSkillsPolicies;
  codeSamples?: Array<{ path: string; content: string }>;
  observedAntiPatterns?: string[];
}

/**
 * Resolve AI enrichment configuration from user-facing CreateSkillsAIConfig.
 * Validates the provider name against the AIProvider union.
 */
export function resolveAIEnrichmentConfig(aiConfig: CreateSkillsAIConfig): AIEnrichmentConfig {
  const config: AIEnrichmentConfig = {};
  if (aiConfig.provider) {
    const provider = aiConfig.provider.toLowerCase();
    if (!isAIProvider(provider)) {
      throw new ProviderError(
        `Unsupported createSkills.ai.provider "${aiConfig.provider}". Supported: ${VALID_AI_PROVIDERS.join(", ")}.`,
      );
    }
    config.provider = provider;
  }
  if (aiConfig.model) config.model = aiConfig.model;
  if (aiConfig.temperature !== undefined) config.temperature = aiConfig.temperature;
  if (aiConfig.maxTokens !== undefined) config.maxTokens = aiConfig.maxTokens;
  return config;
}

/**
 * Run AI enrichment on a SourceIndex.
 *
 * @param index - The source index to enrich
 * @param config - AI provider configuration overrides
 * @returns EnrichmentMetadata + AIEnrichmentOutput, or null if enrichment is disabled
 * @throws ProviderError if AI is enabled but provider configuration is invalid
 * @throws Error if AI output validation fails
 */
export async function enrichIndex(
  index: SourceIndex,
  config: AIEnrichmentConfig = {},
): Promise<{
  metadata: EnrichmentMetadata;
  output: AIEnrichmentOutput;
} | null> {
  const enrichmentOptions: EnrichmentInputOptions = {
    projectRules: config.projectRules,
    languageMix: config.languageMix,
    codeStyleProfile: config.codeStyleProfile,
    policies: config.policies,
    codeSamples: config.codeSamples,
    observedAntiPatterns: config.observedAntiPatterns,
  };
  const input = buildEnrichmentInput(
    index,
    undefined,
    config.projectRules ?? [],
    enrichmentOptions,
  );
  const inputHash = computeEnrichmentInputHash(input);

  const probe = AIConfig.probeEnvironment({
    provider: config.provider,
    model: config.model,
  });
  if (probe.status !== "ready") {
    throw new ProviderError(probe.reason);
  }

  const providerName = probe.config.provider;
  const modelName = probe.config.model;
  const probeBaseUrl = probe.config.baseUrl;

  // ── Cache check ──────────────────────────────────────────────────────────
  if (config.projectRoot) {
    const sourceIndexHash = computeIndexHash(index, config.projectRoot);
    const cacheKey = computeEnrichmentCacheKey(
      sourceIndexHash,
      providerName,
      modelName,
      ENRICHMENT_PROMPT_VERSION,
      inputHash,
      probeBaseUrl,
    );
    const cached = await readEnrichmentCache(config.projectRoot, cacheKey);
    if (cached) {
      return cached;
    }

    // Proceed to provider call, then cache the result
    const result = await callEnrichmentProvider(
      input,
      providerName,
      modelName,
      inputHash,
      config,
      probeBaseUrl,
    );
    if (result) {
      await writeEnrichmentCache(config.projectRoot, cacheKey, result.metadata, result.output);
    }
    return result;
  }

  return callEnrichmentProvider(input, providerName, modelName, inputHash, config, probeBaseUrl);
}

/**
 * Call the AI provider for enrichment. Shared by both cached and uncached paths.
 */
async function callEnrichmentProvider(
  input: AIEnrichmentInput,
  providerName: AIProvider,
  modelName: string,
  inputHash: string,
  config: AIEnrichmentConfig,
  baseUrl?: string,
): Promise<{ metadata: EnrichmentMetadata & { mode: "ai" }; output: AIEnrichmentOutput } | null> {
  const apiKey = AIConfig.getApiKey(providerName);
  if (!apiKey) {
    throw new ProviderError(
      `AI enrichment enabled but no API key found for provider "${providerName}". ` +
        `Set ${providerName === "anthropic" ? "ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN" : providerName === "grok" ? "GROK_API_KEY or XAI_API_KEY" : `${providerName.toUpperCase()}_API_KEY`} environment variable.`,
    );
  }

  const modelConfig: AIModelConfig = {
    provider: providerName,
    model: modelName,
    apiKey,
    temperature: config.temperature ?? 0.3,
    maxTokens: config.maxTokens ?? 4096,
  };
  if (baseUrl) {
    modelConfig.baseUrl = baseUrl;
  }

  const provider = AIProviderFactory.createProvider(modelConfig);

  if (!provider.isAvailable()) {
    throw new ProviderError(
      `AI enrichment provider "${providerName}" is not available. Check API key configuration.`,
    );
  }

  const prompt = buildEnrichmentPrompt(input);
  const systemPrompt = "You are an expert codebase quality advisor. Return only valid JSON.";

  log.info(`Running AI enrichment with ${providerName} (${modelName})...`);

  const response = await provider.generateContent(systemPrompt, prompt);

  log.info("Validating AI enrichment output...");
  const output = validateAIEnrichmentOutput(response);
  const outputHash = computeEnrichmentOutputHash(output);

  const metadata: EnrichmentMetadata & { mode: "ai" } = {
    mode: "ai",
    provider: providerName,
    model: modelName,
    promptVersion: ENRICHMENT_PROMPT_VERSION,
    inputHash,
    outputHash,
  };

  return { metadata, output };
}
