/**
 * create-skills command — generate agent/IDE skill files from the source index.
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { log, setLogQuietMode } from "../utils/logger.js";
import { loadProjectConfig } from "../utils/config.js";
import { UserError } from "../utils/errors.js";
import { getToolVersion } from "../utils/version.js";
import type {
  AgentAdapter,
  AIEnrichmentOutput,
  CheckFileStatus,
  DoctorActionEntry,
  DoctorAIEnrichmentCacheInfo,
  DoctorAIEnrichmentReadinessInfo,
  DoctorIndexInfo,
  DoctorOutput,
  DoctorScriptInfo,
  DoctorSkillInfo,
  DoctorSkillStatus,
  DoctorStatus,
  DryRunFileAction,
  EnrichmentMetadata,
  ExplainAgentsOutput,
  LegacyFileInfo,
  QualityReport,
  SkillsCheckFile,
  SkillsCheckResult,
  SkillsDryRunResult,
  SkillsGenerationContext,
  SkillsGenerationResult,
  SkillKnowledgeBase,
  SourceIndex,
} from "../types/index.js";
import {
  ADAPTER_REGISTRY,
  applyMetadataHeader,
  buildSkillKnowledgeBase,
  computeIndexHash,
  detectAdapters,
  detectAllLegacyAndUnexpected,
  enrichIndex,
  explainAgentDetection,
  parseAgentFlag,
  parseMetadataFromContent,
  renderMetadataHeader,
  resolveAIEnrichmentConfig,
  validateSkillQuality,
} from "../services/skills-generator/index.js";
import { buildSourceIndex, getIndexingConfig, getParserModeBreakdown } from "./indexing.js";
import { computeManifestHash } from "../services/source-index/manifest.js";

const GENERATOR_VERSION = getToolVersion();

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CreateSkillsValues {
  agent?: string;
  "all-agents": boolean;
  "create-skills-format"?: string;
  "create-skills-force": boolean;
  "skip-index-refresh": boolean;
  "create-skills-dry-run"?: boolean;
  "create-skills-check"?: boolean;
  "create-skills-no-ai-enrich": boolean;
  "explain-agents"?: boolean;
  doctor?: boolean;
}

interface RunOutput {
  results: SkillsGenerationResult[];
  legacyFiles?: LegacyFileInfo[];
}

interface DryRunOutput {
  dryRun: SkillsDryRunResult[];
  legacyFiles?: LegacyFileInfo[];
}

interface CheckOutput {
  check: SkillsCheckResult[];
  status: "ok" | "stale";
  legacyFiles?: LegacyFileInfo[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sanitizeProjectName(raw: string): string {
  return (
    raw
      .replace(/^@/, "")
      .replace(/\//g, "-")
      .replace(/[^a-zA-Z0-9._-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "project"
  );
}

async function ensureDir(filePath: string): Promise<void> {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

function resolveFormat(raw: string | undefined): "console" | "json" {
  if (!raw || raw === "console") return "console";
  if (raw === "json") return "json";
  throw new UserError(`Unsupported format "${raw}" for create-skills. Expected: console or json.`);
}

/**
 * Load or build the source index.
 * Always returns a valid SourceIndex or throws a UserError.
 */
async function resolveIndex(projectRoot: string, skipRefresh: boolean): Promise<SourceIndex> {
  const config = await loadProjectConfig(projectRoot);
  const indexingConfig = { ...getIndexingConfig(config), enabled: true };
  const cachePath = resolve(projectRoot, indexingConfig.cachePath);

  if (skipRefresh) {
    if (!existsSync(cachePath)) {
      throw new UserError(
        `Source index cache not found at "${indexingConfig.cachePath}". ` +
          `Run "mp-sentinel indexing" first, or remove --skip-index-refresh.`,
      );
    }
    const { readIndex } = await import("../services/source-index/storage.js");
    const cached = await readIndex(cachePath);
    if (!cached) {
      throw new UserError(
        `Source index cache at "${indexingConfig.cachePath}" is missing or corrupt. ` +
          `Run "mp-sentinel indexing" to rebuild it.`,
      );
    }
    return cached;
  }

  const built = await buildSourceIndex(projectRoot, indexingConfig, false);
  if (!built) {
    throw new UserError(
      `Failed to build source index. Run "mp-sentinel indexing" manually to diagnose the error.`,
    );
  }
  return built;
}

/**
 * Select adapters based on CLI flags or interactive prompt.
 */
async function selectAdapters(
  values: CreateSkillsValues,
  projectRoot: string,
  isJsonMode: boolean,
): Promise<AgentAdapter[]> {
  // generic is a pure fallback — excluded from --all-agents to avoid colliding with codex
  if (values["all-agents"]) return ADAPTER_REGISTRY.filter((a) => a.id !== "generic");
  if (values.agent) return parseAgentFlag(values.agent);

  if (isJsonMode) {
    throw new UserError(
      `--format json requires --agent <ids> or --all-agents to avoid interactive prompts.`,
    );
  }

  const isTTY = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!isTTY) {
    const detected = detectAdapters(projectRoot);
    if (detected.length > 0) return detected;
    const claude = ADAPTER_REGISTRY.find((a) => a.id === "claude");
    const generic = ADAPTER_REGISTRY.find((a) => a.id === "generic");
    return [claude, generic].filter((a): a is AgentAdapter => a !== undefined);
  }

  const detected = detectAdapters(projectRoot);
  const detectedIds = new Set(detected.map((a) => a.id));

  const { default: prompts } = await import("prompts");

  const response = await prompts({
    type: "multiselect",
    name: "agents",
    message: "Select agents to generate skills for (Space to toggle, Enter to confirm):",
    choices: ADAPTER_REGISTRY.map((a) => ({
      title: `${a.label}`,
      value: a.id,
      selected: detectedIds.has(a.id) || (detected.length === 0 && a.id === "claude"),
    })),
    min: 1,
  });

  if (!response.agents || (response.agents as string[]).length === 0) {
    log.warning("No agents selected. Exiting.");
    return [];
  }

  return ADAPTER_REGISTRY.filter((a) => (response.agents as string[]).includes(a.id));
}

// ── Adapter runners ───────────────────────────────────────────────────────────

/**
 * Generate and write skill files for one adapter, with metadata header prepended.
 */
async function runAdapter(
  adapter: AgentAdapter,
  index: SourceIndex,
  projectName: string,
  projectRoot: string,
  force: boolean,
  metadataHeader: string,
  isJson: boolean,
  enrichment?: AIEnrichmentOutput | undefined,
  knowledgeBase?: SkillKnowledgeBase | undefined,
): Promise<SkillsGenerationResult> {
  const context: SkillsGenerationContext = {
    projectRoot,
    projectName,
    force,
    enrichment,
    knowledgeBase,
  };
  const raw = await adapter.generate(index, context);

  // ── Quality gate ──
  const quality = validateSkillQuality(raw, adapter.id, index, adapter.spec, projectName);
  if (!isJson) {
    for (const check of quality.checks) {
      const prefix = `[quality:${adapter.id}]`;
      if (check.severity === "error") {
        log.warning(`${prefix} ${check.file}: ${check.message}`);
      } else {
        log.info(`${prefix} ${check.file}: ${check.message}`);
      }
    }
  }

  const files = raw.map((f) => ({ ...f, content: applyMetadataHeader(f.content, metadataHeader) }));

  const conflictPaths: string[] = [];
  for (const file of files) {
    if (existsSync(file.outputPath) && !force) {
      conflictPaths.push(file.outputPath);
    }
  }

  if (conflictPaths.length > 0) {
    return {
      agent: adapter.id,
      label: adapter.label,
      outputPaths: conflictPaths,
      skipped: true,
      skipReason: `${conflictPaths.length} file(s) already exist. Re-run with --force to overwrite.`,
      quality,
    };
  }

  const writtenPaths: string[] = [];
  for (const file of files) {
    await ensureDir(file.outputPath);
    await writeFile(file.outputPath, file.content, "utf-8");
    writtenPaths.push(file.outputPath);
  }

  return {
    agent: adapter.id,
    label: adapter.label,
    outputPaths: writtenPaths,
    skipped: false,
    quality,
  };
}

/**
 * Dry-run: report what would happen without writing any files.
 * seenPaths tracks paths claimed by earlier adapters in the same batch to detect conflicts.
 */
async function dryRunAdapter(
  adapter: AgentAdapter,
  index: SourceIndex,
  projectName: string,
  projectRoot: string,
  force: boolean,
  seenPaths: Set<string>,
  isJson: boolean,
  enrichment?: AIEnrichmentOutput | undefined,
  knowledgeBase?: SkillKnowledgeBase | undefined,
): Promise<SkillsDryRunResult> {
  const context: SkillsGenerationContext = {
    projectRoot,
    projectName,
    force,
    enrichment,
    knowledgeBase,
  };
  const raw = await adapter.generate(index, context);

  // ── Quality gate ──
  const quality = validateSkillQuality(raw, adapter.id, index, adapter.spec, projectName);
  if (!isJson) {
    for (const check of quality.checks) {
      const prefix = `[quality:${adapter.id}]`;
      if (check.severity === "error") {
        log.warning(`${prefix} ${check.file}: ${check.message}`);
      } else {
        log.info(`${prefix} ${check.file}: ${check.message}`);
      }
    }
  }

  const files = raw.map((file) => {
    if (seenPaths.has(file.outputPath)) {
      return { outputPath: file.outputPath, action: "conflict" as DryRunFileAction };
    }
    seenPaths.add(file.outputPath);
    const exists = existsSync(file.outputPath);
    const action: DryRunFileAction = !exists ? "create" : force ? "overwrite" : "skip";
    return { outputPath: file.outputPath, action };
  });

  return { agent: adapter.id, label: adapter.label, files, quality };
}

/**
 * Check: compare on-disk metadata against the current index hash, adapter id,
 * and enrichment metadata.
 */
async function checkAdapter(
  adapter: AgentAdapter,
  index: SourceIndex,
  projectName: string,
  projectRoot: string,
  currentHash: string,
  enrichment?: AIEnrichmentOutput | undefined,
  enrichmentMeta?: EnrichmentMetadata,
  knowledgeBase?: SkillKnowledgeBase | undefined,
): Promise<SkillsCheckResult> {
  const context: SkillsGenerationContext = {
    projectRoot,
    projectName,
    force: false,
    enrichment,
    knowledgeBase,
  };
  const raw = await adapter.generate(index, context);

  // ── Quality gate ──
  const quality = validateSkillQuality(raw, adapter.id, index, adapter.spec, projectName);

  const files = await Promise.all(
    raw.map(async (file) => {
      // If quality errors exist for this file, mark it as stale
      const fileQualityErrors = quality.checks.filter(
        (c) => c.file === file.outputPath && c.severity === "error",
      );

      if (!existsSync(file.outputPath)) {
        return { outputPath: file.outputPath, status: "missing" as CheckFileStatus };
      }
      const content = await readFile(file.outputPath, "utf-8");
      const meta = parseMetadataFromContent(content);
      if (!meta || meta.sourceIndexHash !== currentHash) {
        return { outputPath: file.outputPath, status: "stale" as CheckFileStatus };
      }
      if (meta.agent !== adapter.id) {
        return { outputPath: file.outputPath, status: "wrong-agent" as CheckFileStatus };
      }

      // Check enrichment metadata staleness
      const fileHasAI = meta.enrichment && meta.enrichment.mode === "ai";
      const currentHasAI = enrichmentMeta && enrichmentMeta.mode === "ai";

      if (fileHasAI && !currentHasAI) {
        return { outputPath: file.outputPath, status: "stale" as CheckFileStatus };
      }
      if (!fileHasAI && currentHasAI) {
        return { outputPath: file.outputPath, status: "stale" as CheckFileStatus };
      }
      if (fileHasAI && currentHasAI && meta.enrichment && enrichmentMeta) {
        const fileEnrich = meta.enrichment;
        const curEnrich = enrichmentMeta;
        if (
          fileEnrich.mode !== "ai" ||
          curEnrich.mode !== "ai" ||
          fileEnrich.provider !== curEnrich.provider ||
          fileEnrich.model !== curEnrich.model ||
          fileEnrich.promptVersion !== curEnrich.promptVersion ||
          fileEnrich.inputHash !== curEnrich.inputHash ||
          fileEnrich.outputHash !== curEnrich.outputHash
        ) {
          return { outputPath: file.outputPath, status: "stale" as CheckFileStatus };
        }
      }

      // If quality errors exist for this file, mark as stale
      if (fileQualityErrors.length > 0) {
        return { outputPath: file.outputPath, status: "stale" as CheckFileStatus };
      }

      return { outputPath: file.outputPath, status: "up-to-date" as CheckFileStatus };
    }),
  );

  return { agent: adapter.id, label: adapter.label, files, quality };
}

// ── Doctor diagnostic ─────────────────────────────────────────────────────────

function worstFileStatus(files: SkillsCheckFile[]): DoctorSkillStatus {
  if (files.length === 0) return "unverifiable";
  if (files.some((f) => f.status === "missing")) return "missing";
  if (files.some((f) => f.status === "wrong-agent")) return "wrong-agent";
  if (files.some((f) => f.status === "stale")) return "stale";
  return "up-to-date";
}

interface CategorizedFindings {
  recommendedActions: string[];
  recommendedCommands: string[];
  failItems: DoctorActionEntry[];
  warnItems: DoctorActionEntry[];
}

function categorizeDoctorFindings(
  indexInfo: DoctorIndexInfo,
  skills: DoctorSkillInfo[],
  legacyFiles: LegacyFileInfo[],
  scripts: DoctorScriptInfo[],
  cachePath: string,
  hasRefreshScript: boolean,
  aiEnrichment: DoctorAIEnrichmentReadinessInfo,
): CategorizedFindings {
  const recommendedActions: string[] = [];
  const recommendedCommands: string[] = [];
  const failItems: DoctorActionEntry[] = [];
  const warnItems: DoctorActionEntry[] = [];

  // ── Index (fail) ──────────────────────────────────────────────────────────
  if (indexInfo.status === "missing") {
    const action = `Run "mp-sentinel indexing" to build the source index at "${cachePath}".`;
    recommendedActions.push(action);
    recommendedCommands.push("mp-sentinel indexing");
    failItems.push({ label: "Index: missing", action, commands: ["mp-sentinel indexing"] });
  } else if (indexInfo.status === "unreadable") {
    const action = `Delete corrupt cache at "${cachePath}" and run "mp-sentinel indexing" to rebuild.`;
    recommendedActions.push(action);
    failItems.push({ label: "Index: unreadable", action });
  } else if (indexInfo.status === "stale") {
    const action =
      'Run "mp-sentinel indexing --force" to rebuild the source index with current manifest hash.';
    recommendedActions.push(action);
    recommendedCommands.push("mp-sentinel indexing --force");
    failItems.push({ label: "Index: stale", action, commands: ["mp-sentinel indexing --force"] });
  }

  // ── Parser: hard parse errors (fail) ───────────────────────────────────────
  const hardErrorCount = indexInfo.parseErrorCount ?? 0;
  const errorSample =
    indexInfo.hardParseErrorFilesSample && indexInfo.hardParseErrorFilesSample.length > 0
      ? indexInfo.hardParseErrorFilesSample
      : [];
  if (hardErrorCount > 0 && errorSample.length > 0) {
    const firstFile = errorSample[0]!;
    const sampleStr = errorSample.map((f) => `"${f}"`).join(", ");
    const action = `${hardErrorCount} file(s) have hard parse errors. Run "mp-sentinel indexing --parse-errors --index-format json" to list them, or "mp-sentinel indexing --health --index-format json" for the overview.`;
    recommendedActions.push(action);
    recommendedCommands.push("mp-sentinel indexing --parse-errors --index-format json");
    recommendedCommands.push("mp-sentinel indexing --health --index-format json");
    failItems.push({
      label: `Index: ${hardErrorCount} hard parse error(s)`,
      action: `Sample: ${sampleStr}. ${action}`,
      commands: [
        "mp-sentinel indexing --parse-errors --index-format json",
        "mp-sentinel indexing --health --index-format json",
      ],
    });
  }

  // ── Parser: recovered files (warn) ─────────────────────────────────────────
  const recoveredCount = indexInfo.recoveredFiles ?? 0;
  if (recoveredCount > 0) {
    const breakdown = indexInfo.parserModeBreakdown;
    const detail = breakdown
      ? ` (${breakdown["ascii-fallback"] ?? 0} ascii-fallback, ${breakdown["lexical-fallback"] ?? 0} lexical-fallback)`
      : "";
    const action = `${recoveredCount} file(s) recovered via fallback parser${detail}. Run "mp-sentinel indexing --recovered --index-format json" to list them.`;
    recommendedActions.push(action);
    // Recovered-only is advisory: keep in index.suggestedCommands but NOT in top-level recommendedCommands.
    warnItems.push({
      label: `Index: ${recoveredCount} fallback-parsed file(s)`,
      action,
      commands: ["mp-sentinel indexing --recovered --index-format json"],
    });
  }

  // ── Skills (fail) ─────────────────────────────────────────────────────────
  const hasQualityErrors = skills.some((s) => s.quality && s.quality.errors > 0);

  // Skills remediation only applies when the index is usable (ok or stale)
  if (indexInfo.status === "ok" || indexInfo.status === "stale") {
    const problemSkills = skills.filter((s) => s.status !== "up-to-date");

    if (problemSkills.length > 0) {
      const command = hasRefreshScript
        ? "npm run agent:skills:refresh"
        : "mp-sentinel create-skills --all-agents --force";
      const action = hasRefreshScript
        ? 'Run "npm run agent:skills:refresh" to regenerate skill files.'
        : 'Run "mp-sentinel create-skills --all-agents --force" to regenerate skill files.';
      recommendedActions.push(action);
      recommendedCommands.push(command);

      for (const s of problemSkills) {
        const fileSummary = s.files
          .filter((f) => f.status !== "up-to-date")
          .map((f) => `${f.outputPath} (${f.status})`)
          .join(", ");
        failItems.push({
          label: `Skills (${s.agent}): ${s.status}`,
          action: fileSummary ? `${action} Affected: ${fileSummary}` : action,
          commands: [command],
        });
      }
    }

    if (hasQualityErrors) {
      const action =
        "Quality errors detected in generated skills. Review adapter quality rules and generated content.";
      recommendedActions.push(action);
      for (const s of skills) {
        if (s.quality && s.quality.errors > 0) {
          failItems.push({
            label: `Quality (${s.agent}): ${s.quality.errors} error(s)`,
            action,
          });
        }
      }
    }
  }

  // ── Legacy files (warn) ───────────────────────────────────────────────────
  // Group by agent so recommendedActions and console output stay concise.
  // The full per-file list is preserved in JSON legacyFiles field.
  const legacyByAgent = new Map<string, LegacyFileInfo[]>();
  for (const lf of legacyFiles) {
    const key = lf.agent;
    if (!legacyByAgent.has(key)) {
      legacyByAgent.set(key, []);
    }
    legacyByAgent.get(key)!.push(lf);
  }

  for (const [agent, files] of legacyByAgent) {
    const count = files.length;
    const summary = `${count} legacy generated file(s) for ${agent} at unexpected path. Review and delete after confirming official output exists.`;
    recommendedActions.push(summary);
    warnItems.push({
      label: `Legacy: ${count} generated file(s) for ${agent} at unexpected path`,
      action: summary,
    });
  }

  // ── Scripts (warn) ────────────────────────────────────────────────────────
  for (const s of scripts) {
    if (s.status === "missing") {
      const action = `Add "${s.name}" script to package.json for local bootstrap support (${s.description.toLowerCase()}).`;
      recommendedActions.push(action);
      warnItems.push({ label: `Script: ${s.name}`, action });
    }
  }

  // ── AI enrichment readiness (fail / warn) ─────────────────────────────────
  if (aiEnrichment.status === "action-required") {
    const action = aiEnrichment.reason ?? "AI enrichment requires configuration.";
    recommendedActions.push(action);
    failItems.push({ label: "AI enrichment: action-required", action });
  } else if (aiEnrichment.status === "disabled") {
    const action =
      "AI enrichment is disabled. Enable it in .sentinelrc.json (createSkills.ai.enabled) for richer generated skills.";
    recommendedActions.push(action);
    warnItems.push({ label: "AI enrichment: disabled", action });
  }

  // ── Dedupe commands while preserving order ────────────────────────────────
  const seen = new Set<string>();
  const dedupedCommands = recommendedCommands.filter((c) => {
    if (seen.has(c)) return false;
    seen.add(c);
    return true;
  });

  return {
    recommendedActions,
    recommendedCommands: dedupedCommands,
    failItems,
    warnItems,
  };
}

const DOCTOR_SCRIPTS = [
  { name: "agent:skills:check", description: "Checks skill file freshness" },
  { name: "agent:skills:refresh", description: "Regenerates stale/missing skill files" },
  { name: "dogfood", description: "Validates end-to-end local workflow" },
  { name: "release:check", description: "Verifies version consistency and lockfile integrity" },
];

const VALID_AI_PROVIDERS = ["gemini", "openai", "anthropic", "grok"] as const;

function getApiKeyForProviderName(provider: string): string | undefined {
  switch (provider) {
    case "gemini":
      return process.env.GEMINI_API_KEY;
    case "openai":
      return process.env.OPENAI_API_KEY;
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY;
    case "grok":
      return process.env.GROK_API_KEY || process.env.XAI_API_KEY;
    default:
      return undefined;
  }
}

function computeAIEnrichmentReadiness(
  config: Awaited<ReturnType<typeof loadProjectConfig>>,
): DoctorAIEnrichmentReadinessInfo {
  const aiConfig = config.createSkills?.ai;
  const enabled = Boolean(aiConfig?.enabled);

  if (!enabled) {
    return {
      enabled: false,
      apiKeyPresent: false,
      status: "disabled",
      reason: "AI enrichment is disabled in config (createSkills.ai.enabled).",
    };
  }

  const provider = (aiConfig?.provider ?? process.env.AI_PROVIDER ?? "gemini").toLowerCase();
  const model = aiConfig?.model;

  if (!(VALID_AI_PROVIDERS as readonly string[]).includes(provider)) {
    const result: DoctorAIEnrichmentReadinessInfo = {
      enabled: true,
      apiKeyPresent: false,
      status: "action-required",
      reason: `Unsupported AI provider "${aiConfig?.provider ?? "unspecified"}". Supported: ${VALID_AI_PROVIDERS.join(", ")}.`,
    };
    if (aiConfig?.provider) result.provider = aiConfig.provider;
    if (model) result.model = model;
    return result;
  }

  const apiKey = getApiKeyForProviderName(provider);
  if (!apiKey) {
    const envVar =
      provider === "grok" ? "GROK_API_KEY or XAI_API_KEY" : `${provider.toUpperCase()}_API_KEY`;
    const result: DoctorAIEnrichmentReadinessInfo = {
      enabled: true,
      provider,
      apiKeyPresent: false,
      status: "action-required",
      reason: `AI enrichment enabled but no API key found for provider "${provider}". Set the ${envVar} environment variable.`,
    };
    if (model) result.model = model;
    return result;
  }

  const result: DoctorAIEnrichmentReadinessInfo = {
    enabled: true,
    provider,
    apiKeyPresent: true,
    status: "ready",
  };
  if (model) result.model = model;
  return result;
}

async function runDoctor(
  values: CreateSkillsValues,
  projectRoot: string,
  isJson: boolean,
): Promise<number> {
  if (isJson) setLogQuietMode(true);

  // a) Project name + scripts from package.json
  const pkg = (() => {
    try {
      const pkgPath = resolve(projectRoot, "package.json");
      if (existsSync(pkgPath)) {
        return JSON.parse(readFileSync(pkgPath, "utf-8")) as {
          name?: string;
          scripts?: Record<string, string>;
        };
      }
    } catch {
      // ignore
    }
    return {} as { name?: string; scripts?: Record<string, string> };
  })();
  const projectName = pkg.name ? sanitizeProjectName(pkg.name) : "project";
  const pkgScripts: Record<string, string> = pkg.scripts ?? {};
  const hasRefreshScript = "agent:skills:refresh" in pkgScripts;

  // b) Agent detection
  const explainResult = explainAgentDetection(projectRoot, projectName);

  // c) Adapter selection for skills check
  let selectedAdapters: AgentAdapter[];
  if (values.agent) {
    selectedAdapters = parseAgentFlag(values.agent);
  } else if (values["all-agents"]) {
    selectedAdapters = ADAPTER_REGISTRY.filter((a) => a.id !== "generic");
  } else {
    const detected = detectAdapters(projectRoot);
    if (detected.length > 0) {
      selectedAdapters = detected;
    } else {
      const claude = ADAPTER_REGISTRY.find((a) => a.id === "claude");
      const generic = ADAPTER_REGISTRY.find((a) => a.id === "generic");
      selectedAdapters = [claude, generic].filter((a): a is AgentAdapter => a !== undefined);
    }
  }

  // d) Index check
  if (isJson) setLogQuietMode(true);
  const config = await loadProjectConfig(projectRoot);
  const indexingConfig = { ...getIndexingConfig(config), enabled: true };
  const cachePath = resolve(projectRoot, indexingConfig.cachePath);

  let indexInfo: DoctorIndexInfo;
  let index: SourceIndex | null = null;

  if (!existsSync(cachePath)) {
    indexInfo = {
      status: "missing",
      reason: `No source index cache found at "${indexingConfig.cachePath}". Run "mp-sentinel indexing" to build it.`,
    };
  } else {
    if (isJson) setLogQuietMode(true);
    const { readIndex } = await import("../services/source-index/storage.js");
    const cached = await readIndex(cachePath);
    if (!cached) {
      indexInfo = {
        status: "unreadable",
        reason: `Source index cache at "${indexingConfig.cachePath}" is corrupt or uses an unsupported schema. Delete it and run "mp-sentinel indexing" to rebuild.`,
      };
    } else {
      index = cached;
      const currentManifestHash = await computeManifestHash(projectRoot);

      if (!index.manifestHash) {
        indexInfo = {
          status: "stale",
          schemaVersion: index.schemaVersion,
          totalFiles: index.stats.totalFiles,
          reason:
            'Source index is missing manifestHash. Rebuild with "mp-sentinel indexing --force".',
        };
      } else if (index.manifestHash !== currentManifestHash) {
        indexInfo = {
          status: "stale",
          schemaVersion: index.schemaVersion,
          totalFiles: index.stats.totalFiles,
          manifestHash: index.manifestHash,
          reason:
            'Manifest inputs changed (package.json / tsconfig / lockfile) since index was built. Run "mp-sentinel indexing --force" to rebuild.',
        };
      } else {
        indexInfo = {
          status: "ok",
          schemaVersion: index.schemaVersion,
          totalFiles: index.stats.totalFiles,
          manifestHash: index.manifestHash,
        };
      }
    }
  }

  // Enrich indexInfo with parser telemetry when index is available
  if (index) {
    // Recovered: fallback parser used AND no hard parse errors
    const recoveredFiles = index.files.filter(
      (f) =>
        (f.parserMode === "ascii-fallback" || f.parserMode === "lexical-fallback") &&
        (!f.parseErrors || f.parseErrors.length === 0),
    ).length;
    const breakdown = getParserModeBreakdown(index);
    const filesWithErrors = index.files.filter((f) => f.parseErrors && f.parseErrors.length > 0);
    const parseErrorCount = filesWithErrors.length;
    const parseErrorRate =
      index.files.length > 0 ? Math.round((parseErrorCount / index.files.length) * 1000) / 1000 : 0;
    const hardParseErrorFilesSample = filesWithErrors
      .slice(0, 3)
      .map((f) => f.path)
      .sort();

    indexInfo = {
      ...indexInfo,
      parseErrorRate,
      recoveredFiles,
      parserModeBreakdown: breakdown,
      parseErrorCount,
      hardParseErrorFilesSample,
    };

    // Suggested drilldown commands when parser issues exist
    const idxSuggestedCommands: string[] = [];
    if (recoveredFiles > 0) {
      idxSuggestedCommands.push("mp-sentinel indexing --recovered --index-format json");
    }
    if (parseErrorCount > 0) {
      idxSuggestedCommands.push("mp-sentinel indexing --parse-errors --index-format json");
    }
    if (idxSuggestedCommands.length > 0) {
      indexInfo = { ...indexInfo, suggestedCommands: idxSuggestedCommands };
    }
  }

  // e) Skills check
  const skills: DoctorSkillInfo[] = [];

  if (index && (indexInfo.status === "ok" || indexInfo.status === "stale")) {
    const currentHash = computeIndexHash(index, projectRoot);
    const knowledgeBase = buildSkillKnowledgeBase(index, projectRoot);
    const context: SkillsGenerationContext = {
      projectRoot,
      projectName,
      force: false,
      knowledgeBase,
    };

    for (const adapter of selectedAdapters) {
      const raw = await adapter.generate(index, context);
      const quality = validateSkillQuality(raw, adapter.id, index, adapter.spec, projectName);

      const files: SkillsCheckFile[] = await Promise.all(
        raw.map(async (file) => {
          if (!existsSync(file.outputPath)) {
            return { outputPath: file.outputPath, status: "missing" as CheckFileStatus };
          }
          const content = await readFile(file.outputPath, "utf-8");
          const meta = parseMetadataFromContent(content);
          if (!meta || meta.sourceIndexHash !== currentHash) {
            return { outputPath: file.outputPath, status: "stale" as CheckFileStatus };
          }
          if (meta.agent !== adapter.id) {
            return { outputPath: file.outputPath, status: "wrong-agent" as CheckFileStatus };
          }
          return { outputPath: file.outputPath, status: "up-to-date" as CheckFileStatus };
        }),
      );

      skills.push({
        agent: adapter.id,
        label: adapter.label,
        status: worstFileStatus(files),
        files,
        quality,
      });
    }
  } else {
    for (const adapter of selectedAdapters) {
      skills.push({
        agent: adapter.id,
        label: adapter.label,
        status: "unverifiable",
        files: [],
        quality: { passed: true, checks: [], errors: 0, warnings: 0 },
      });
    }
  }

  // f) AI enrichment cache check (advisory only — never affects status or exit code)
  const aiCacheDir = resolve(projectRoot, ".mp-sentinel-cache", "ai-enrichment");
  let aiEnrichmentCache: DoctorAIEnrichmentCacheInfo;

  if (!existsSync(aiCacheDir)) {
    aiEnrichmentCache = {
      status: "missing",
      path: aiCacheDir,
      entries: 0,
      bytes: 0,
    };
  } else {
    try {
      const dirents = await readdir(aiCacheDir);
      const jsonFiles = dirents.filter((f) => f.endsWith(".json"));
      const entries = jsonFiles.length;
      let bytes = 0;
      for (const f of jsonFiles) {
        const s = await stat(join(aiCacheDir, f));
        bytes += s.size;
      }
      aiEnrichmentCache = {
        status: "available",
        path: aiCacheDir,
        entries,
        bytes,
      };
    } catch {
      aiEnrichmentCache = {
        status: "unreadable",
        path: aiCacheDir,
        entries: 0,
        bytes: 0,
        reason: `Cannot read AI enrichment cache directory.`,
      };
    }
  }

  // h) Legacy / unexpected files
  const legacyFiles = await detectAllLegacyAndUnexpected(projectRoot, projectName);

  // i) Scripts check
  const scripts: DoctorScriptInfo[] = DOCTOR_SCRIPTS.map((def) => ({
    name: def.name,
    status: pkgScripts[def.name] ? "available" : "missing",
    description: def.description,
  }));

  // j) AI enrichment readiness (read-only — no provider call, no network, no cache write)
  const aiEnrichment = computeAIEnrichmentReadiness(config);

  // k) Categorize all findings
  const findings = categorizeDoctorFindings(
    indexInfo,
    skills,
    legacyFiles,
    scripts,
    indexingConfig.cachePath,
    hasRefreshScript,
    aiEnrichment,
  );

  // l) Determine overall status
  let overallStatus: DoctorStatus;
  if (indexInfo.status === "unreadable") {
    overallStatus = "error";
  } else if (findings.failItems.length > 0) {
    overallStatus = "action-required";
  } else {
    overallStatus = "ok";
  }

  // m) Output
  if (isJson) {
    const out: DoctorOutput = {
      status: overallStatus,
      projectName,
      agents: explainResult.entries,
      index: indexInfo,
      skills,
      legacyFiles,
      scripts,
      aiEnrichmentCache,
      aiEnrichment,
      recommendedActions: findings.recommendedActions,
      recommendedCommands: findings.recommendedCommands,
    };
    console.log(JSON.stringify(out, null, 2));
  } else {
    log.info(`Project: ${projectName}`);
    log.info(`Status:  ${overallStatus}`);
    log.info("");

    // ── [fail] Action Required ──────────────────────────────────────────
    log.info("[fail] Action Required");
    if (findings.failItems.length === 0) {
      log.info("  (none)");
    } else {
      for (const item of findings.failItems) {
        log.info(`  ${item.label}`);
        log.info(`    -> ${item.action}`);
      }
    }
    log.info("");

    // ── [warn] Advisory ─────────────────────────────────────────────────
    log.info("[warn] Advisory");
    if (findings.warnItems.length === 0 && aiEnrichmentCache.status === "available") {
      log.info("  (none)");
    } else {
      for (const item of findings.warnItems) {
        log.info(`  ${item.label}`);
        log.info(`    -> ${item.action}`);
      }
    }
    if (aiEnrichmentCache.status === "missing") {
      log.info("  AI enrichment cache: missing");
    }
    if (aiEnrichmentCache.status === "unreadable") {
      log.info("  AI enrichment cache: unreadable");
    }
    log.info("");

    // ── [ok] Healthy ────────────────────────────────────────────────────
    log.info("[ok] Healthy");

    // Agents
    for (const entry of explainResult.entries) {
      const detail = entry.detected ? "detected" : "not detected";
      const sel = entry.selected ? " [auto-selected]" : "";
      log.info(`  Agent: ${entry.id} (${detail})${sel}`);
    }

    // Index (when ok or stale)
    if (indexInfo.status === "ok" || indexInfo.status === "stale") {
      const detail = [
        `schema ${indexInfo.schemaVersion}`,
        indexInfo.totalFiles != null ? `${indexInfo.totalFiles} files` : "",
        indexInfo.manifestHash ? `hash ${indexInfo.manifestHash}` : "",
      ]
        .filter(Boolean)
        .join(", ");
      log.info(`  Index: ${indexInfo.status} (${detail})`);

      // Parser telemetry (when available)
      const recovered = indexInfo.recoveredFiles ?? 0;
      const errors = indexInfo.parseErrorCount ?? 0;
      const errorRate = indexInfo.parseErrorRate;
      const breakdown = indexInfo.parserModeBreakdown;
      if (
        recovered > 0 ||
        errors > 0 ||
        (breakdown && (breakdown["ascii-fallback"] ?? 0) + (breakdown["lexical-fallback"] ?? 0) > 0)
      ) {
        const parts: string[] = [];
        if (breakdown) {
          const bd = [
            `tree-sitter=${breakdown["tree-sitter"] ?? 0}`,
            `ascii-fallback=${breakdown["ascii-fallback"] ?? 0}`,
            `lexical-fallback=${breakdown["lexical-fallback"] ?? 0}`,
          ].join(", ");
          log.info(`  Parser: ${bd}`);
        }
        if (recovered > 0) parts.push(`${recovered} recovered`);
        if (errors > 0 && errorRate != null)
          parts.push(`${errors} hard errors (${(errorRate * 100).toFixed(1)}%)`);
        else if (errors > 0) parts.push(`${errors} hard errors`);
        if (parts.length > 0) log.info(`    ${parts.join(", ")}`);
      }
    }

    // Skills
    for (const s of skills) {
      if (s.status === "up-to-date") {
        log.info(`  Skills (${s.agent}): ${s.status}`);
      }
    }

    // Scripts
    for (const s of scripts) {
      if (s.status === "available") {
        log.info(`  Script: ${s.name} - ${s.description}`);
      }
    }

    // AI enrichment cache
    if (aiEnrichmentCache.status === "available") {
      log.info(`  AI enrichment cache: ${aiEnrichmentCache.entries} entries`);
    }

    // AI enrichment readiness
    if (aiEnrichment.status === "ready") {
      const prov = aiEnrichment.provider ?? "default";
      const mod = aiEnrichment.model ? ` (${aiEnrichment.model})` : "";
      log.info(`  AI enrichment: ready (${prov}${mod})`);
    }

    if (
      explainResult.entries.length === 0 &&
      indexInfo.status !== "ok" &&
      indexInfo.status !== "stale" &&
      skills.filter((s) => s.status === "up-to-date").length === 0 &&
      scripts.filter((s) => s.status === "available").length === 0 &&
      aiEnrichmentCache.status !== "available" &&
      aiEnrichment.status !== "ready"
    ) {
      log.info("  (no items)");
    }
    log.info("");

    // ── Recommended commands ────────────────────────────────────────────
    log.info("[Commands]");
    if (findings.recommendedCommands.length === 0) {
      log.info("  (none - no automated commands recommended)");
    } else {
      for (let i = 0; i < findings.recommendedCommands.length; i++) {
        log.info(`  ${i + 1}. ${findings.recommendedCommands[i]}`);
      }
    }
  }

  // n) Exit code
  if (overallStatus === "error") return 2;
  if (overallStatus === "action-required") return 1;
  return 0;
}

// ── Main command ──────────────────────────────────────────────────────────────

export async function runCreateSkillsCommand(
  values: CreateSkillsValues,
  projectRoot: string = process.cwd(),
): Promise<number> {
  let isJson = false;
  try {
    const format = resolveFormat(values["create-skills-format"]);
    isJson = format === "json";
    const force = values["create-skills-force"];
    const isDryRun = values["create-skills-dry-run"];
    const isCheck = values["create-skills-check"];

    if (isJson) setLogQuietMode(true);

    // ── Explain-agents diagnostic mode ────────────────────────────────────────
    if (values["explain-agents"]) {
      const rawPkgName = (() => {
        try {
          const pkgPath = resolve(projectRoot, "package.json");
          if (existsSync(pkgPath)) {
            const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
              name?: string;
            };
            return pkg.name ?? "";
          }
        } catch {
          // ignore
        }
        return "";
      })();
      const pName = rawPkgName ? sanitizeProjectName(rawPkgName) : "project";
      const { entries, defaultSelection } = explainAgentDetection(projectRoot, pName);

      if (isJson) {
        const out: ExplainAgentsOutput = {
          projectName: pName,
          defaultSelection,
          agents: entries,
        };
        console.log(JSON.stringify(out, null, 2));
      } else {
        log.info(`Project: ${pName}`);
        log.info(`Default selection: ${defaultSelection.join(", ") || "(none)"}`);
        log.info("");
        for (const entry of entries) {
          const mark = entry.detected ? "[ok]" : "[x]";
          const sel = entry.selected ? " [default]" : "";
          log.info(`${mark} ${entry.id}${sel}`);
          log.info(`  Label:       ${entry.label}`);
          log.info(`  Detected:    ${entry.detected}`);
          if (entry.detectionSignals.length > 0) {
            log.info(`  Signals:     ${entry.detectionSignals.join(", ")}`);
          } else {
            log.info(`  Signals:     (none - not auto-detected)`);
          }
          log.info(`  Output:      ${entry.outputKind}`);
          log.info(`  Template:    ${entry.workspacePath}`);
          log.info(`  Resolved:    ${entry.resolvedOutput}`);
          if (entry.officialDocsUrl) {
            log.info(`  Docs:        ${entry.officialDocsUrl}`);
          }
          log.info("");
        }
      }

      return 0;
    }

    // ── Doctor diagnostic mode ──────────────────────────────────────────────
    if (values["doctor"]) {
      return runDoctor(values, projectRoot, isJson);
    }

    log.info("Resolving source index...");
    const index = await resolveIndex(projectRoot, values["skip-index-refresh"]);

    const rawName = index.project.packageName;
    if (!rawName) {
      throw new UserError(
        `Cannot determine project name: package.json has no "name" field. ` +
          `Add a name to package.json and re-run.`,
      );
    }
    const projectName = sanitizeProjectName(rawName);

    const adapters = await selectAdapters(values, projectRoot, isJson);
    if (adapters.length === 0) return 0;

    // ── Legacy migration detection ───────────────────────────────────────────
    const legacyFiles = await detectAllLegacyAndUnexpected(projectRoot, projectName);

    // ── Build shared SkillKnowledgeBase (once, reused across adapters) ──────
    const knowledgeBase: SkillKnowledgeBase = buildSkillKnowledgeBase(index, projectRoot);

    // ── AI Enrichment ───────────────────────────────────────────────────────
    // Check if AI enrichment is enabled in config AND not overridden by CLI flag
    let enrichment: AIEnrichmentOutput | undefined = undefined;
    let enrichmentMetadata: EnrichmentMetadata = { mode: "none" };

    const config = await loadProjectConfig(projectRoot);
    const aiConfig = config.createSkills?.ai;
    const aiEnabled = Boolean(aiConfig?.enabled) && !values["create-skills-no-ai-enrich"];

    if (aiEnabled) {
      const aiEnrichConfig = resolveAIEnrichmentConfig(aiConfig ?? {});
      aiEnrichConfig.projectRoot = projectRoot;
      const result = await enrichIndex(index, aiEnrichConfig);
      if (result) {
        enrichment = result.output;
        enrichmentMetadata = result.metadata;
        log.success("AI enrichment complete.");
      }
    }

    // ── Check mode ──────────────────────────────────────────────────────────
    if (isCheck) {
      const currentHash = computeIndexHash(index, projectRoot);

      const checkResults: SkillsCheckResult[] = [];
      for (const adapter of adapters) {
        const result = await checkAdapter(
          adapter,
          index,
          projectName,
          projectRoot,
          currentHash,
          enrichment,
          enrichmentMetadata,
          knowledgeBase,
        );
        checkResults.push(result);

        if (!isJson) {
          const allOk = result.files.every((f) => f.status === "up-to-date");
          const icon = allOk ? "[ok]" : "[x]";
          log.info(`[${icon}] ${result.agent}:`);
          for (const f of result.files) {
            const mark = f.status === "up-to-date" ? "  [ok]" : "  [x]";
            log.info(`${mark}  ${f.outputPath} (${f.status})`);
          }
        }
      }

      const hasQualityErrors = checkResults.some((r) => r.quality && r.quality.errors > 0);
      const hasStaleFiles = checkResults.some((r) =>
        r.files.some((f) => f.status !== "up-to-date"),
      );
      const isStale = hasStaleFiles || hasQualityErrors;
      const overallStatus = isStale ? "stale" : "ok";

      if (isJson) {
        const out: CheckOutput = { check: checkResults, status: overallStatus };
        if (legacyFiles.length > 0) out.legacyFiles = legacyFiles;
        console.log(JSON.stringify(out, null, 2));
      } else {
        if (hasStaleFiles) {
          log.warning("Skills are stale or missing. Re-run without --check to regenerate.");
        }
        if (hasQualityErrors) {
          log.warning(
            "Quality gate errors detected. Review the generated skill content for issues.",
          );
        }
        if (legacyFiles.length > 0) {
          log.warning(
            `Detected ${legacyFiles.length} legacy generated file(s) from pre-v1.0.17 paths. ` +
              `These are advisory only - see --format json for details.`,
          );
        }
      }

      return isStale ? 1 : 0;
    }

    // ── Dry-run mode ─────────────────────────────────────────────────────────
    if (isDryRun) {
      const seenPaths = new Set<string>();
      const dryRunResults: SkillsDryRunResult[] = [];
      for (const adapter of adapters) {
        const result = await dryRunAdapter(
          adapter,
          index,
          projectName,
          projectRoot,
          force,
          seenPaths,
          isJson,
          enrichment,
          knowledgeBase,
        );
        dryRunResults.push(result);

        if (!isJson) {
          log.info(`[dry-run] ${result.agent}:`);
          for (const f of result.files) {
            log.info(`  ${f.action.toUpperCase().padEnd(9)} ${f.outputPath}`);
          }
        }
      }

      if (isJson) {
        const out: DryRunOutput = { dryRun: dryRunResults };
        if (legacyFiles.length > 0) out.legacyFiles = legacyFiles;
        console.log(JSON.stringify(out, null, 2));
      } else {
        if (legacyFiles.length > 0) {
          log.warning(
            `Detected ${legacyFiles.length} legacy generated file(s) from pre-v1.0.17 paths. ` +
              `These are advisory only - see --format json for details.`,
          );
        }
      }

      return 0;
    }

    // ── Normal generate mode ─────────────────────────────────────────────────

    // Pre-create output directories so fidelity hash is stable on first generation.
    // Without this, computeIndexHash sees a different disk state than the check
    // run (which runs after directories were created by this generate step).
    for (const adapter of adapters) {
      const dirPath = dirname(
        resolve(projectRoot, adapter.spec.workspacePath.replace(/\{projectName\}/g, projectName)),
      );
      if (!existsSync(dirPath)) {
        await mkdir(dirPath, { recursive: true });
      }
    }

    const indexHash = computeIndexHash(index, projectRoot);
    const results: SkillsGenerationResult[] = [];

    for (const adapter of adapters) {
      const metaHeader = renderMetadataHeader({
        generatorVersion: GENERATOR_VERSION,
        sourceIndexSchema: index.schemaVersion,
        sourceIndexHash: indexHash,
        agent: adapter.id,
        projectName,
        enrichment: enrichmentMetadata,
      });

      const result = await runAdapter(
        adapter,
        index,
        projectName,
        projectRoot,
        force,
        metaHeader,
        isJson,
        enrichment,
        knowledgeBase,
      );
      results.push(result);

      if (!isJson) {
        if (result.skipped) {
          log.warning(`[${result.agent}] Skipped - ${result.skipReason}`);
        } else {
          log.success(`[${result.agent}] Generated:`);
          for (const p of result.outputPaths) {
            log.file(`  ${p}`);
          }
        }
      }
    }

    if (isJson) {
      const out: RunOutput = { results };
      if (legacyFiles.length > 0) out.legacyFiles = legacyFiles;
      console.log(JSON.stringify(out, null, 2));
    } else {
      const anySkipped = results.some((r) => r.skipped);
      if (anySkipped) {
        log.warning("Some outputs were skipped. Re-run with --force to overwrite.");
      }
      if (legacyFiles.length > 0) {
        log.warning(
          `Detected ${legacyFiles.length} legacy generated file(s) from pre-v1.0.17 paths. ` +
            `These are advisory only - see --format json for details.`,
        );
      }
    }

    const allSkipped = results.every((r) => r.skipped);
    return allSkipped ? 1 : 0;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "create-skills failed with unknown error";

    if (isJson) {
      console.log(JSON.stringify({ status: "ERROR", error: message }, null, 2));
      return 2;
    }

    if (error instanceof UserError) {
      log.error(message);
    } else {
      log.critical(message);
    }
    return 2;
  } finally {
    if (isJson) setLogQuietMode(false);
  }
}
