/**
 * create-skills command — generate agent/IDE skill files from the source index.
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { log, setLogQuietMode } from "../utils/logger.js";
import { loadProjectConfig } from "../utils/config.js";
import { UserError } from "../utils/errors.js";
import type { AgentAdapter, SkillsGenerationResult, SourceIndex } from "../types/index.js";
import {
  ADAPTER_REGISTRY,
  detectAdapters,
  parseAgentFlag,
} from "../services/skills-generator/index.js";
import { buildSourceIndex, getIndexingConfig } from "./indexing.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CreateSkillsValues {
  agent?: string;
  "all-agents": boolean;
  "create-skills-format"?: string;
  "create-skills-force": boolean;
  "skip-index-refresh": boolean;
}

interface RunResult {
  results: SkillsGenerationResult[];
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
 * - skipRefresh: use existing cache only; fail if absent or unreadable.
 * - default: build/refresh as needed.
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
  // --all-agents
  if (values["all-agents"]) return ADAPTER_REGISTRY.slice();

  // --agent <ids>
  if (values.agent) return parseAgentFlag(values.agent);

  // JSON mode without explicit agent selection is not allowed
  if (isJsonMode) {
    throw new UserError(
      `--format json requires --agent <ids> or --all-agents to avoid interactive prompts.`,
    );
  }

  // Interactive picker (TTY only)
  const isTTY = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!isTTY) {
    // Non-interactive fallback: claude + generic
    const detected = detectAdapters(projectRoot);
    if (detected.length > 0) return detected;
    const claude = ADAPTER_REGISTRY.find((a) => a.id === "claude");
    const generic = ADAPTER_REGISTRY.find((a) => a.id === "generic");
    return [claude, generic].filter((a): a is AgentAdapter => a !== undefined);
  }

  // Interactive multi-select
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

/**
 * Generate skill files for a single adapter.
 */
async function runAdapter(
  adapter: AgentAdapter,
  index: SourceIndex | null,
  projectName: string,
  projectRoot: string,
  force: boolean,
): Promise<SkillsGenerationResult> {
  const context = { projectRoot, projectName, force };

  const files = await adapter.generate(index, context);
  const writtenPaths: string[] = [];
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
  };
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

    if (isJson) setLogQuietMode(true);

    // Resolve source index — always returns a valid index or throws
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

    // Select adapters
    const adapters = await selectAdapters(values, projectRoot, isJson);
    if (adapters.length === 0) return 0;

    log.info(`Generating skills for: ${adapters.map((a) => a.id).join(", ")}...`);

    // Run adapters
    const results: SkillsGenerationResult[] = [];
    for (const adapter of adapters) {
      const result = await runAdapter(adapter, index, projectName, projectRoot, force);
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

    const runResult: RunResult = { results };

    if (isJson) {
      console.log(JSON.stringify(runResult, null, 2));
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
