/**
 * MCP agent/skill diagnostics — read-only service functions.
 * These wrap existing skills-generator helpers without writing files,
 * building indexes, or calling AI.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import type {
  AgentAdapterId,
  ExplainAgentsOutput,
  DoctorIndexInfo,
  SkillsCheckFile,
  SourceIndex,
} from "../../types/index.js";
import { loadProjectConfig } from "../../utils/config.js";
import { readIndex } from "../source-index/storage.js";
import { computeManifestHash } from "../source-index/manifest.js";
import { ADAPTER_REGISTRY, explainAgentDetection, detectAdapters } from "./registry.js";
import { computeIndexHash, parseMetadataFromContent } from "./metadata.js";

// ── Path helpers ────────────────────────────────────────────────────

const resolveCachePath = async (projectRoot: string): Promise<string> => {
  const config = await loadProjectConfig(projectRoot);
  const relPath = config.indexing?.cachePath ?? ".mp-sentinel-cache/source-index.json";
  return resolve(projectRoot, relPath);
};

const resolveWorkspace = (template: string, projectName: string): string =>
  template.replace(/\{projectName\}/g, projectName);

/**
 * Get the expected file paths for an adapter for the given project name.
 * Skill adapters: workspacePath + requiredFiles[0].
 * Rule adapters: workspacePath (the path itself is the file).
 */
const getAdapterFilePaths = (
  adapter: (typeof ADAPTER_REGISTRY)[number],
  projectName: string,
): { primaryPath: string; primaryFile: string }[] => {
  const ws = resolveWorkspace(adapter.spec.workspacePath, projectName);
  if (adapter.spec.outputKind === "skill" && adapter.spec.requiredFiles[0]) {
    return [{ primaryPath: ws, primaryFile: adapter.spec.requiredFiles[0] }];
  }
  // Rule adapters: workspacePath is the file itself
  return [{ primaryPath: ws, primaryFile: "" }];
};

/**
 * Resolve a primary file path relative to projectRoot.
 */
const resolvePrimaryFile = (
  projectRoot: string,
  primaryPath: string,
  primaryFile: string,
): string =>
  primaryFile ? join(projectRoot, primaryPath, primaryFile) : join(projectRoot, primaryPath);

interface SkillFileCheck {
  outputPath: string;
  status: SkillsCheckFile["status"];
}

/**
 * Check a single adapter's generated files on disk.
 * Reads metadata from existing files and compares sourceIndexHash.
 * Does NOT call adapter.generate().
 */
const checkAdapterFiles = (
  projectRoot: string,
  projectName: string,
  adapter: (typeof ADAPTER_REGISTRY)[number],
  currentHash: string | null,
): SkillFileCheck[] => {
  const paths = getAdapterFilePaths(adapter, projectName);
  return paths.map((p) => {
    const fullPath = resolvePrimaryFile(projectRoot, p.primaryPath, p.primaryFile);
    if (!existsSync(fullPath)) {
      return { outputPath: fullPath, status: "missing" as const };
    }

    // Read file and check metadata
    try {
      const content = readFileSyncSafe(fullPath);
      if (!content) return { outputPath: fullPath, status: "missing" as const };

      if (!currentHash) return { outputPath: fullPath, status: "up-to-date" as const };

      const meta = parseMetadataFromContent(content);
      if (!meta) return { outputPath: fullPath, status: "stale" as const };

      if (meta.sourceIndexHash !== currentHash) {
        return { outputPath: fullPath, status: "stale" as const };
      }
      if (meta.agent !== adapter.id) {
        return { outputPath: fullPath, status: "wrong-agent" as const };
      }

      return { outputPath: fullPath, status: "up-to-date" as const };
    } catch {
      return { outputPath: fullPath, status: "missing" as const };
    }
  });
};

/** Synchronous file read with string return. */
const readFileSyncSafe = (path: string): string | null => {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
};

// ── Sanitize project name ───────────────────────────────────────────

const sanitizeProjectName = (raw: string): string =>
  raw
    .replace(/^@/, "")
    .replace(/\//g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "project";

// ── Exported functions ──────────────────────────────────────────────

const SCRIPTS_TO_CHECK = [
  { name: "agent:skills:check", description: "CI staleness check" },
  { name: "agent:skills:refresh", description: "Regenerate skill files" },
  { name: "dogfood", description: "Dogfood validation" },
  { name: "release:check", description: "Release consistency check" },
];

/**
 * Explain agents — read-only diagnostic matching --explain-agents --format json.
 */
export const getExplainAgents = async (projectRoot: string): Promise<ExplainAgentsOutput> => {
  let projectName = "project";
  try {
    const pkgPath = join(projectRoot, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      projectName = sanitizeProjectName(pkg.name ?? "project");
    }
  } catch {
    // Use default projectName
  }

  const { entries, defaultSelection } = explainAgentDetection(projectRoot, projectName);
  return { projectName, defaultSelection, agents: entries };
};

/**
 * Resolve adapter selection.
 * Default: detected adapters; fallback to claude + generic.
 * allAgents: all non-generic adapters.
 * agents: exact requested (unknown ids → error).
 */
const resolveAdapters = (
  projectRoot: string,
  agents?: AgentAdapterId[],
  allAgents?: boolean,
): (typeof ADAPTER_REGISTRY)[number][] => {
  if (agents && allAgents) {
    throw new Error("'agents' and 'allAgents' cannot be used together");
  }
  if (allAgents) {
    return ADAPTER_REGISTRY.filter((a) => a.id !== "generic");
  }
  if (agents) {
    const result: (typeof ADAPTER_REGISTRY)[number][] = [];
    const validIds = new Set(ADAPTER_REGISTRY.map((a) => a.id));
    for (const id of agents) {
      if (!validIds.has(id)) {
        throw new Error(`Unknown agent adapter: "${id}". Valid ids: ${[...validIds].join(", ")}`);
      }
      const adapter = ADAPTER_REGISTRY.find((a) => a.id === id);
      if (adapter) result.push(adapter);
    }
    return result;
  }
  // Default: detected adapters; fallback to claude + generic
  const detected = detectAdapters(projectRoot);
  if (detected.length > 0) return detected;
  return ADAPTER_REGISTRY.filter((a) => a.id === "claude" || a.id === "generic");
};

/**
 * Skills doctor — read-only diagnostic matching --doctor --format json.
 * Missing index is diagnostic data, not an error.
 */
export const getSkillsDoctor = async (
  projectRoot: string,
  options?: { agents?: AgentAdapterId[]; allAgents?: boolean },
): Promise<Record<string, unknown>> => {
  let projectName = "project";
  try {
    const pkgPath = join(projectRoot, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      projectName = sanitizeProjectName(pkg.name ?? "project");
    }
  } catch {
    // Use default
  }

  // Agent detection
  const { entries, defaultSelection } = explainAgentDetection(projectRoot, projectName);

  // Resolve selected adapters
  let selectedAdapters: (typeof ADAPTER_REGISTRY)[number][];
  try {
    selectedAdapters = resolveAdapters(projectRoot, options?.agents, options?.allAgents);
  } catch (e) {
    return { status: "error", message: (e as Error).message };
  }

  // Index health
  const cachePath = await resolveCachePath(projectRoot);
  const index = await readIndex(cachePath);
  const indexInfo = await buildDoctorIndexInfo(index, cachePath, projectRoot);
  const currentHash = index ? computeIndexHash(index, projectRoot) : null;

  // Check each adapter's skill files
  const skills: Record<string, unknown>[] = [];
  for (const adapter of selectedAdapters) {
    const fileChecks = checkAdapterFiles(projectRoot, projectName, adapter, currentHash);
    const statuses = fileChecks.map((f) => f.status);
    const overallStatus = statuses.every((s) => s === "up-to-date")
      ? "up-to-date"
      : statuses.some((s) => s === "stale" || s === "wrong-agent")
        ? "stale"
        : statuses.some((s) => s === "missing")
          ? "missing"
          : "up-to-date";

    skills.push({
      agent: adapter.id,
      label: adapter.label,
      status: overallStatus,
      files: fileChecks,
    });
  }

  // Scripts check
  const scripts: Record<string, unknown>[] = [];
  let pkgScripts: Record<string, string> = {};
  try {
    const pkgPath = join(projectRoot, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      pkgScripts = pkg.scripts ?? {};
    }
  } catch {
    // Scripts will all be "missing"
  }
  for (const s of SCRIPTS_TO_CHECK) {
    scripts.push({
      name: s.name,
      status: pkgScripts[s.name] ? "available" : "missing",
      description: s.description,
    });
  }

  // Build recommended actions and commands
  const recommendedActions: string[] = [];
  const recommendedCommands: string[] = [];

  if (indexInfo.status === "missing") {
    recommendedActions.push("Build source index cache");
    recommendedCommands.push("mp-sentinel indexing");
  } else if (indexInfo.status === "stale") {
    recommendedActions.push("Refresh source index");
    recommendedCommands.push("mp-sentinel indexing --force");
  }

  const hasStaleSkills = skills.some(
    (s) => s.status !== "up-to-date" && s.status !== "unverifiable",
  );
  if (hasStaleSkills) {
    recommendedActions.push("Regenerate skill files");
    recommendedCommands.push("npm run agent:skills:refresh");
  }

  const hasMissingScripts = scripts.some((s) => s.status === "missing");
  if (hasMissingScripts) {
    const missing = scripts.filter((s) => s.status === "missing").map((s) => s.name);
    recommendedActions.push(`Add npm scripts: ${missing.join(", ")}`);
  }

  return {
    status: indexInfo.status === "unreadable" ? "error" : hasStaleSkills ? "action-required" : "ok",
    projectName,
    agents: entries,
    defaultSelection,
    index: indexInfo,
    skills,
    scripts,
    recommendedActions,
    recommendedCommands,
  };
};

/**
 * Build DoctorIndexInfo from a source index or null.
 * Compares manifest hash to detect staleness.
 */
const buildDoctorIndexInfo = async (
  index: SourceIndex | null,
  _cachePath: string,
  projectRoot: string,
): Promise<DoctorIndexInfo> => {
  if (!index) {
    return { status: "missing" };
  }

  const errorCount = index.files.filter((f) => (f.parseErrors?.length ?? 0) > 0).length;
  const recoveredCount = index.files.filter(
    (f) =>
      (f.parserMode === "chunked-tree-sitter" ||
        f.parserMode === "ascii-fallback" ||
        f.parserMode === "lexical-fallback") &&
      (!f.parseErrors || f.parseErrors.length === 0),
  ).length;

  const parserModeBreakdown: Record<string, number> = {
    "tree-sitter": 0,
    "chunked-tree-sitter": 0,
    "ascii-fallback": 0,
    "lexical-fallback": 0,
  };
  for (const f of index.files) {
    const mode = f.parserMode ?? "tree-sitter";
    parserModeBreakdown[mode] = (parserModeBreakdown[mode] ?? 0) + 1;
  }

  // Check manifest staleness
  let status: DoctorIndexInfo["status"] = "ok";
  if (index.manifestHash) {
    try {
      const currentManifestHash = await computeManifestHash(projectRoot);
      if (currentManifestHash !== index.manifestHash) {
        status = "stale";
      }
    } catch {
      // If we can't compute hash, trust the cached status
    }
  }

  const result: DoctorIndexInfo = {
    status,
    schemaVersion: index.schemaVersion,
    totalFiles: index.files.length,
    parseErrorRate: index.files.length > 0 ? errorCount / index.files.length : 0,
    recoveredFiles: recoveredCount,
    parserModeBreakdown,
    parseErrorCount: errorCount,
  };

  if (index.manifestHash) {
    result.manifestHash = index.manifestHash;
  }

  return result;
};

/**
 * Skills check — read-only diagnostic matching --check --format json.
 * Missing/corrupt index returns an error for the caller to convert to MCP isError.
 */
export const getSkillsCheck = async (
  projectRoot: string,
  options?: { agents?: AgentAdapterId[]; allAgents?: boolean },
): Promise<Record<string, unknown>> => {
  // Resolve selected adapters
  let selectedAdapters: (typeof ADAPTER_REGISTRY)[number][];
  try {
    selectedAdapters = resolveAdapters(projectRoot, options?.agents, options?.allAgents);
  } catch (e) {
    return { error: (e as Error).message };
  }

  // Read index — error if missing
  const cachePath = await resolveCachePath(projectRoot);
  const index = await readIndex(cachePath);
  if (!index) {
    return { error: "No source index found" };
  }

  // Get project name
  let projectName = "project";
  try {
    const pkgPath = join(projectRoot, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      projectName = sanitizeProjectName(pkg.name ?? "project");
    }
  } catch {
    // Use default
  }

  const currentHash = computeIndexHash(index, projectRoot);

  // Check each adapter
  const check: Record<string, unknown>[] = [];
  for (const adapter of selectedAdapters) {
    const fileChecks = checkAdapterFiles(projectRoot, projectName, adapter, currentHash);
    check.push({
      agent: adapter.id,
      label: adapter.label,
      files: fileChecks,
    });
  }

  const hasIssues = check.some((c) =>
    (c.files as SkillFileCheck[]).some((f) => f.status !== "up-to-date"),
  );

  return {
    status: hasIssues ? "stale" : "ok",
    check,
  };
};
