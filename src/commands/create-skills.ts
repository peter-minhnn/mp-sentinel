/**
 * create-skills command — generate agent/IDE skill files from the source index.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { log, setLogQuietMode } from "../utils/logger.js";
import { loadProjectConfig } from "../utils/config.js";
import { UserError } from "../utils/errors.js";
import type {
  AgentAdapter,
  CheckFileStatus,
  DryRunFileAction,
  SkillsCheckResult,
  SkillsDryRunResult,
  SkillsGenerationResult,
  SourceIndex,
} from "../types/index.js";
import {
  ADAPTER_REGISTRY,
  computeIndexHash,
  detectAdapters,
  parseAgentFlag,
  parseMetadataFromContent,
  renderMetadataHeader,
} from "../services/skills-generator/index.js";
import { buildSourceIndex, getIndexingConfig } from "./indexing.js";

const GENERATOR_VERSION = process.env["npm_package_version"] ?? "1.0.9";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CreateSkillsValues {
  agent?: string;
  "all-agents": boolean;
  "create-skills-format"?: string;
  "create-skills-force": boolean;
  "skip-index-refresh": boolean;
  "create-skills-dry-run": boolean;
  "create-skills-check": boolean;
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
  if (values["all-agents"]) return ADAPTER_REGISTRY.slice();
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
): Promise<SkillsGenerationResult> {
  const context = { projectRoot, projectName, force };
  const raw = await adapter.generate(index, context);

  const files = raw.map((f) => ({ ...f, content: metadataHeader + "\n" + f.content }));

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
 */
async function dryRunAdapter(
  adapter: AgentAdapter,
  index: SourceIndex,
  projectName: string,
  projectRoot: string,
  force: boolean,
): Promise<SkillsDryRunResult> {
  const raw = await adapter.generate(index, { projectRoot, projectName, force });

  const files = raw.map((file) => {
    const exists = existsSync(file.outputPath);
    let action: DryRunFileAction;
    if (!exists) {
      action = "create";
    } else if (force) {
      action = "overwrite";
    } else {
      action = "skip";
    }
    return { outputPath: file.outputPath, action };
  });

  return { agent: adapter.id, label: adapter.label, files };
}

/**
 * Check: compare on-disk metadata hash against the current index hash.
 */
async function checkAdapter(
  adapter: AgentAdapter,
  index: SourceIndex,
  projectName: string,
  projectRoot: string,
  currentHash: string,
): Promise<SkillsCheckResult> {
  const raw = await adapter.generate(index, { projectRoot, projectName, force: false });

  const files = await Promise.all(
    raw.map(async (file) => {
      if (!existsSync(file.outputPath)) {
        return { outputPath: file.outputPath, status: "missing" as CheckFileStatus };
      }
      const content = await readFile(file.outputPath, "utf-8");
      const meta = parseMetadataFromContent(content);
      const status: CheckFileStatus =
        meta && meta.sourceIndexHash === currentHash ? "up-to-date" : "stale";
      return { outputPath: file.outputPath, status };
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

    // ── Check mode ──────────────────────────────────────────────────────────
    if (isCheck) {
      const currentHash = computeIndexHash(index);

      const checkResults: SkillsCheckResult[] = [];
      for (const adapter of adapters) {
        const result = await checkAdapter(adapter, index, projectName, projectRoot, currentHash);
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
      const dryRunResults: SkillsDryRunResult[] = [];
      for (const adapter of adapters) {
        const result = await dryRunAdapter(adapter, index, projectName, projectRoot, force);
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
      });

      const result = await runAdapter(adapter, index, projectName, projectRoot, force, metaHeader);
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
