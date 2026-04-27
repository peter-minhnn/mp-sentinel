/**
 * create-skills command — generate agent/IDE skill files from the source index.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { log, setLogQuietMode } from "../utils/logger.js";
import { loadProjectConfig } from "../utils/config.js";
import { UserError } from "../utils/errors.js";
import { getToolVersion } from "../utils/version.js";
import type {
  AgentAdapter,
  AIEnrichmentOutput,
  CheckFileStatus,
  DryRunFileAction,
  EnrichmentMetadata,
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
  enrichIndex,
  parseAgentFlag,
  parseMetadataFromContent,
  renderMetadataHeader,
  resolveAIEnrichmentConfig,
} from "../services/skills-generator/index.js";
import { buildSourceIndex, getIndexingConfig } from "./indexing.js";

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
}

interface RunOutput {
  results: SkillsGenerationResult[];
}

interface DryRunOutput {
  dryRun: SkillsDryRunResult[];
}

interface CheckOutput {
  check: SkillsCheckResult[];
  status: "ok" | "stale";
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
    };
  }

  const writtenPaths: string[] = [];
  for (const file of files) {
    await ensureDir(file.outputPath);
    await writeFile(file.outputPath, file.content, "utf-8");
    writtenPaths.push(file.outputPath);
  }

  return { agent: adapter.id, label: adapter.label, outputPaths: writtenPaths, skipped: false };
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

  const files = raw.map((file) => {
    if (seenPaths.has(file.outputPath)) {
      return { outputPath: file.outputPath, action: "conflict" as DryRunFileAction };
    }
    seenPaths.add(file.outputPath);
    const exists = existsSync(file.outputPath);
    const action: DryRunFileAction = !exists ? "create" : force ? "overwrite" : "skip";
    return { outputPath: file.outputPath, action };
  });

  return { agent: adapter.id, label: adapter.label, files };
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

  const files = await Promise.all(
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

      // Check enrichment metadata staleness
      const fileHasAI = meta.enrichment && meta.enrichment.mode === "ai";
      const currentHasAI = enrichmentMeta && enrichmentMeta.mode === "ai";

      if (fileHasAI && !currentHasAI) {
        // AI was used before but is now disabled
        return { outputPath: file.outputPath, status: "stale" as CheckFileStatus };
      }
      if (!fileHasAI && currentHasAI) {
        // AI wasn't used before but is now enabled
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

      return { outputPath: file.outputPath, status: "up-to-date" as CheckFileStatus };
    }),
  );

  return { agent: adapter.id, label: adapter.label, files };
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

    // ── Build shared SkillKnowledgeBase (once, reused across adapters) ──────
    const knowledgeBase: SkillKnowledgeBase = buildSkillKnowledgeBase(index);

    // ── AI Enrichment ───────────────────────────────────────────────────────
    // Check if AI enrichment is enabled in config AND not overridden by CLI flag
    let enrichment: AIEnrichmentOutput | undefined = undefined;
    let enrichmentMetadata: EnrichmentMetadata = { mode: "none" };

    const config = await loadProjectConfig(projectRoot);
    const aiConfig = config.createSkills?.ai;
    const aiEnabled = Boolean(aiConfig?.enabled) && !values["create-skills-no-ai-enrich"];

    if (aiEnabled) {
      const aiEnrichConfig = resolveAIEnrichmentConfig(aiConfig ?? {});
      const result = await enrichIndex(index, aiEnrichConfig);
      if (result) {
        enrichment = result.output;
        enrichmentMetadata = result.metadata;
        log.success("AI enrichment complete.");
      }
    }

    // ── Check mode ──────────────────────────────────────────────────────────
    if (isCheck) {
      const currentHash = computeIndexHash(index);

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
          const icon = allOk ? "✓" : "✗";
          log.info(`[${icon}] ${result.agent}:`);
          for (const f of result.files) {
            const mark = f.status === "up-to-date" ? "  ✓" : "  ✗";
            log.info(`${mark}  ${f.outputPath} (${f.status})`);
          }
        }
      }

      const isStale = checkResults.some((r) => r.files.some((f) => f.status !== "up-to-date"));
      const overallStatus = isStale ? "stale" : "ok";

      if (isJson) {
        const out: CheckOutput = { check: checkResults, status: overallStatus };
        console.log(JSON.stringify(out, null, 2));
      } else if (isStale) {
        log.warning("Skills are stale or missing. Re-run without --check to regenerate.");
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
        console.log(JSON.stringify(out, null, 2));
      }

      return 0;
    }

    // ── Normal generate mode ─────────────────────────────────────────────────
    const indexHash = computeIndexHash(index);
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
        enrichment,
        knowledgeBase,
      );
      results.push(result);

      if (!isJson) {
        if (result.skipped) {
          log.warning(`[${result.agent}] Skipped — ${result.skipReason}`);
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
      console.log(JSON.stringify(out, null, 2));
    } else {
      const anySkipped = results.some((r) => r.skipped);
      if (anySkipped) {
        log.warning("Some outputs were skipped. Re-run with --force to overwrite.");
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
