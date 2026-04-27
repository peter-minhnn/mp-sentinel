/**
 * AI Enrichment — uses an AI provider to generate supplementary
 * best-practice notes for skill files.
 *
 * This is an **opt-in** feature controlled by `createSkills.ai.enabled` in
 * `.sentinelrc.json`. When disabled (the default), all skill generation is
 * purely deterministic from the source index.
 *
 * The AI enrichment pipeline:
 *   SourceIndex → AIEnrichmentInput → provider.generateContent() → AIEnrichmentOutput
 *
 * Output is validated with a Zod schema. If parsing or validation fails,
 * the command fails with exit code 2.
 */

import { createHash } from "node:crypto";
import type {
  SourceIndex,
  AIEnrichmentInput,
  AIEnrichmentOutput,
  EnrichmentMetadata,
  FileRole,
  CreateSkillsAIConfig,
  SkillKnowledgeBase,
} from "../../types/index.js";
import type { AIProvider } from "../ai/types.js";
import { log } from "../../utils/logger.js";
import { ProviderError } from "../../utils/errors.js";
import { AIProviderFactory } from "../ai/factory.js";
import { detectProfile } from "./profile.js";
import { buildSkillKnowledgeBase } from "./knowledge-base.js";

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
      .map((i) => `  • ${i.path.join(".")} — ${i.message}`)
      .join("\n");
    throw new Error(
      `AI enrichment output failed Zod validation:\n${issues}\n\nRaw output:\n${raw.slice(0, 500)}`,
    );
  }

  return result.data;
}

// ── Input builder ──────────────────────────────────────────────────────────

/**
 * Build an AIEnrichmentInput from a SourceIndex.
 * This is a compact representation designed to fit within token budgets.
 */
export function buildEnrichmentInput(
  index: SourceIndex,
  knowledgeBase?: SkillKnowledgeBase | null,
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
    moduleRoles,
    publicApiFiles: index.insights?.publicApiFiles ?? [],
    testFileCount: index.insights ? Object.keys(index.insights.testMap).length : 0,
    topDependencies,
    testGapCount: kb.testing.testGaps.length,
    topDependenciesWithVersions,
    defaultExportCount: kb.risks.filter((r) => r.type === "default-export").length,
    dynamicImportCount: kb.risks.filter((r) => r.type === "dynamic-import").length,
    hubFileCount: kb.risks.filter((r) => r.type === "hub-file").length,
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

const ENRICHMENT_PROMPT_VERSION = "2026-04-28";

function buildEnrichmentPrompt(input: AIEnrichmentInput): string {
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

  return JSON.stringify({
    modelInfo: {
      role: "You are an expert codebase quality advisor. Analyze the project manifest and file structure below and return a JSON object with best-practice recommendations.",
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
    },
    manifest: {
      scripts: `{\n${scriptLines}\n  }`,
      dependencies: `{\n${depLines}\n  }`,
      topDependenciesWithVersions: `{\n${depsWithVersions}\n  }`,
      engines: input.engines ?? {},
      bin: input.bin ?? null,
    },
    moduleBreakdown: `{\n${roleLines}\n  }`,
    outputFormat: {
      instructions: `Return ONLY valid JSON in the following shape, with no markdown or commentary around it:

{
  "languageRules": [
    "Array of 2-5 language/framework best-practice rules tailored to the project's tech stack and detected frameworks. Reference the exact package versions found in topDependenciesWithVersions above."
  ],
  "libraryRules": [
    "Array of 2-5 library-specific best-practice rules. Use the version information from topDependenciesWithVersions — e.g., 'With zod v4.3.6, use .parse() for input validation'."
  ],
  "versionNotes": [
    "Array of 1-3 notes about version constraints or gotchas based on the actual dependency versions in the manifest."
  ],
  "riskWarnings": [
    "Array of 1-3 risk warnings informed by the project metrics above: test gaps (${input.testGapCount} untested files), default exports (${input.defaultExportCount}), dynamic imports (${input.dynamicImportCount}), hub files (${input.hubFileCount}), and detected profile."
  ],
  "recommendedChecks": [
    "Array of 1-3 recommended review checks specific to this project's architecture and dependency versions."
  ]
}

Base all recommendations on actual dependency versions, not generic advice. Do NOT invent rules for packages not listed in the dependencies. Be concise. Do NOT include any text outside the JSON block. Do NOT wrap in markdown code fences.`,
    },
  });
}

// ── Deep sort for deterministic hashing ────────────────────────────────────

/**
 * Deep-sort an object for deterministic JSON serialization.
 * Recursively sorts object keys; preserves array element order.
 */
function deepSortForHash(obj: unknown): unknown {
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

// ── Provider validation ────────────────────────────────────────────────────

const VALID_AI_PROVIDERS: readonly AIProvider[] = ["gemini", "openai", "anthropic", "grok"];

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
  // Build enrichment input (KB derived internally if not cached)
  const input = buildEnrichmentInput(index);
  const inputHash = computeEnrichmentInputHash(input);

  // Determine AI provider config
  const envProvider = process.env.AI_PROVIDER || "gemini";
  const rawProvider = (config.provider ?? envProvider).toLowerCase();
  if (!isAIProvider(rawProvider)) {
    throw new ProviderError(
      `Unsupported AI provider "${rawProvider}". Supported: ${VALID_AI_PROVIDERS.join(", ")}.`,
    );
  }
  const providerName: AIProvider = rawProvider;
  const modelName = config.model ?? AIProviderFactory.getDefaultModel(providerName);

  // Get API key
  const apiKey = getApiKeyForProvider(providerName);
  if (!apiKey) {
    throw new ProviderError(
      `AI enrichment enabled but no API key found for provider "${providerName}". ` +
        `Set the appropriate environment variable (e.g., GEMINI_API_KEY, OPENAI_API_KEY).`,
    );
  }

  // Build the AI model config
  const modelConfig = {
    provider: providerName,
    model: modelName,
    apiKey,
    temperature: config.temperature ?? 0.3,
    maxTokens: config.maxTokens ?? 4096,
  };

  // Create the provider
  const provider = AIProviderFactory.createProvider(modelConfig);

  if (!provider.isAvailable()) {
    throw new ProviderError(
      `AI enrichment provider "${providerName}" is not available. Check API key configuration.`,
    );
  }

  // Build and send prompt
  const prompt = buildEnrichmentPrompt(input);
  const systemPrompt = "You are an expert codebase quality advisor. Return only valid JSON.";

  log.info(`Running AI enrichment with ${providerName} (${modelName})...`);

  const response = await provider.generateContent(systemPrompt, prompt);

  // Validate the response
  log.info("Validating AI enrichment output...");
  const output = validateAIEnrichmentOutput(response);
  const outputHash = computeEnrichmentOutputHash(output);

  const metadata: EnrichmentMetadata = {
    mode: "ai",
    provider: providerName,
    model: modelName,
    promptVersion: ENRICHMENT_PROMPT_VERSION,
    inputHash,
    outputHash,
  };

  return { metadata, output };
}

/**
 * Get API key for a provider name from environment variables.
 */
function getApiKeyForProvider(provider: AIProvider): string | undefined {
  switch (provider) {
    case "gemini":
      return process.env.GEMINI_API_KEY;
    case "openai":
      return process.env.OPENAI_API_KEY;
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY;
    case "grok":
      return process.env.GROK_API_KEY || process.env.XAI_API_KEY;
  }
}
