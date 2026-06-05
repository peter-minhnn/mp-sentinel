/**
 * Indexing Command - Build source index cache for enhanced review context
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { log, setLogQuietMode } from "../utils/logger.js";
import type {
  IndexedLanguage,
  IndexingConfig,
  SourceIndex,
  SourceIndexFile,
  IndexHealthOutput,
} from "../types/index.js";
import { CURRENT_SOURCE_INDEX_SCHEMA } from "../types/index.js";
import {
  getRecoveredFileCount,
  getParserModeBreakdown,
  getChunkTelemetry,
} from "../services/source-index/diagnostics.js";
import { FileHandler } from "../services/file-handler/index.js";
import {
  readManifest,
  isIndexableLanguage,
  isLexicallyExtractableLanguage,
  getLanguageForFile,
  computeManifestHash,
} from "../services/source-index/manifest.js";
import { parseFile, parseNonIndexableFile } from "../services/source-index/parser.js";
import { defaultIndexingConcurrency, parallelMap } from "../services/source-index/parallel.js";
import {
  readIndex,
  writeIndex,
  hydrateIndex,
  getSidecarStatus,
  getFilesToIndex,
  calculateSHA256,
} from "../services/source-index/storage.js";
import type { IndexHydration } from "../services/source-index/storage.js";
import { ImportResolver } from "../services/source-index/resolver.js";
import { buildIndexInsights } from "../services/skills-generator/insights.js";
import type { CLIValues } from "../cli/args.js";
import { loadProjectConfig } from "../utils/config.js";
import { UserError } from "../utils/errors.js";
import { getToolVersion } from "../utils/version.js";
import { getCurrentHeadSha } from "../utils/git.js";
import {
  handleRecovered,
  handleParseErrors,
  handleExplain,
  handleStats,
  handleFindSymbol,
  handleFindImport,
  handleFindCode,
  handleAgentContext,
} from "./indexing-queries.js";

const DEFAULT_INDEXING_CONFIG: Required<
  Pick<IndexingConfig, "enabled" | "languages" | "cachePath" | "maxFileSize">
> = {
  enabled: true,
  languages: ["typescript", "tsx", "javascript", "jsx"],
  cachePath: ".mp-sentinel-cache/source-index.json",
  maxFileSize: 512000,
};

const SUPPORTED_INDEX_FORMATS = new Set(["console", "json"]);
const MAX_PARSE_ERROR_RATE = 0.5;

interface ExplainOptions {
  explainIndex?: string;
  stats?: boolean;
}

async function assertTreeSitterAvailable(): Promise<void> {
  // In tests, tree-sitter is preloaded by jest.setup.cjs onto globalThis.
  // Skipping the dynamic import() avoids loading the native addon a second
  // time when it's already alive in the root CJS context.
  if (globalThis.__mpTreeSitter || process.__mpTreeSitter) {
    return;
  }
  try {
    await Promise.all([
      import("tree-sitter"),
      import("tree-sitter-typescript"),
      import("tree-sitter-javascript"),
    ]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new UserError(
      "Tree-sitter dependencies are not installed or could not be loaded. " +
        "Install compatible versions with: npm install tree-sitter@0.21.1 tree-sitter-typescript@0.23.2 tree-sitter-javascript@0.23.1. " +
        `Details: ${detail}`,
    );
  }
}

const resolveIndexFormat = (raw: string | undefined): "console" | "json" => {
  const format = raw ?? "console";
  if (SUPPORTED_INDEX_FORMATS.has(format)) {
    return format as "console" | "json";
  }
  throw new UserError(`Unsupported indexing format "${format}". Expected one of: console, json.`);
};

const getIndexParseErrorRate = (index: SourceIndex): number => {
  if (index.files.length === 0) return 0;
  const filesWithErrors = index.files.filter(
    (file) => file.parseErrors && file.parseErrors.length > 0,
  ).length;
  return filesWithErrors / index.files.length;
};

/**
 * Get indexing configuration from project config
 */
export function getIndexingConfig(config: {
  indexing?: Partial<IndexingConfig>;
}): Required<Pick<IndexingConfig, "enabled" | "languages" | "cachePath" | "maxFileSize">> &
  Pick<IndexingConfig, "cacheMode" | "validationMode"> {
  const indexing = config.indexing;

  return {
    enabled: indexing?.enabled ?? DEFAULT_INDEXING_CONFIG.enabled,
    languages: indexing?.languages ?? DEFAULT_INDEXING_CONFIG.languages,
    cachePath: indexing?.cachePath ?? DEFAULT_INDEXING_CONFIG.cachePath,
    maxFileSize: indexing?.maxFileSize ?? DEFAULT_INDEXING_CONFIG.maxFileSize,
    ...(indexing?.cacheMode && { cacheMode: indexing.cacheMode }),
    ...(indexing?.validationMode && { validationMode: indexing.validationMode }),
  };
}

/**
 * Read file content safely
 */
async function readFileContent(path: string): Promise<string> {
  return await readFile(path, "utf-8");
}

/**
 * Get file size in bytes (0 on error — caller falls back to hashing)
 */
async function getFileSize(path: string): Promise<number> {
  try {
    return (await import("node:fs/promises")).stat(path).then((stat) => stat.size);
  } catch {
    return 0;
  }
}

/**
 * Get file mtime
 */
async function getFileMtime(path: string): Promise<number> {
  try {
    return (await import("node:fs/promises")).stat(path).then((stat) => stat.mtimeMs);
  } catch {
    return 0;
  }
}

/**
 * Build source index
 */
export async function buildSourceIndex(
  projectRoot: string,
  indexingConfig: Required<
    Pick<IndexingConfig, "enabled" | "languages" | "cachePath" | "maxFileSize">
  > &
    Pick<IndexingConfig, "cacheMode" | "validationMode">,
  force: boolean = false,
  /**
   * How much sidecar payload to hydrate when a valid light cache is
   * returned as-is. Queries that don't touch calls/codeSearch pass
   * "none"/"calls" to skip loading megabytes they won't read.
   */
  cacheHydration: IndexHydration = "full",
): Promise<SourceIndex | null> {
  const startTime = performance.now();

  await assertTreeSitterAvailable();

  const cachePath = resolve(projectRoot, indexingConfig.cachePath);

  // Compute manifest fingerprint (before cache check)
  const manifestHash = await computeManifestHash(projectRoot);

  // Read manifest
  log.info("Reading project manifest...");
  const manifest = await readManifest(projectRoot);
  const currentToolVersion = getToolVersion();
  log.info(`Project: ${manifest.packageName || "unknown"} v${manifest.packageVersion || "n/a"}`);
  log.info(`Frameworks: ${manifest.detectedFrameworks.join(", ") || "none detected"}`);

  // Discover files using FileHandler
  log.info("Discovering files...");
  const fileHandler = new FileHandler({
    cwd: projectRoot,
    maxFileSize: indexingConfig.maxFileSize,
  });
  const { accepted } = await fileHandler.discoverFiles();

  log.info(`Total files discovered: ${accepted.length}`);

  // Filter to indexable languages
  const indexableFiles = accepted.filter((path) => {
    const lang = isIndexableLanguage(path);
    return lang !== null && indexingConfig.languages.includes(lang);
  });

  // Filter to lexically-extractable (Svelte/Vue) files
  // These use regex-based extractors instead of tree-sitter
  const lexExtractableFiles = accepted.filter((path) => {
    return isLexicallyExtractableLanguage(path) !== null;
  });

  log.info(`Files to index (JS/TS): ${indexableFiles.length}`);
  if (lexExtractableFiles.length > 0) {
    log.info(`Files to index (Svelte/Vue): ${lexExtractableFiles.length}`);
  }

  // Combine both sets for the cache/parse pipeline
  const allCandidateFiles = [...indexableFiles, ...lexExtractableFiles];

  // Check cache validity unless forcing rebuild
  let filesToIndex: string[];
  let cachedFiles: SourceIndexFile[];
  let existingIndex: SourceIndex | null = null;
  let manifestChanged = false;

  if (!force && existsSync(cachePath)) {
    existingIndex = await readIndex(cachePath, { hydrate: "none" });
    if (existingIndex && getIndexParseErrorRate(existingIndex) > MAX_PARSE_ERROR_RATE) {
      log.warning("Existing source index has too many parse errors. Rebuilding full cache.");
      filesToIndex = allCandidateFiles;
      cachedFiles = [];
    } else {
      const { toIndex, fromCache, validity } = await getFilesToIndex(
        cachePath,
        projectRoot,
        allCandidateFiles,
        readFileContent,
        getFileMtime,
        {
          mode: indexingConfig.validationMode ?? "fast",
          getFileSize,
          index: existingIndex,
        },
      );

      // Manifest hash check: old indexes without manifestHash are treated as manifest-stale
      const existingHash = existingIndex?.manifestHash;
      if (existingHash === undefined || existingHash !== manifestHash) {
        manifestChanged = true;
        log.info(
          existingHash === undefined
            ? "Manifest fingerprint missing in cache — treating as stale"
            : "Manifest inputs changed (package.json / tsconfig / lockfile) — rebuilding",
        );
      }

      // Tool version check: if the cache was built by a different tool version, rebuild.
      const cacheToolVersion = existingIndex?.toolVersion;
      if (cacheToolVersion && cacheToolVersion !== currentToolVersion) {
        log.info(
          `Tool version changed (${cacheToolVersion} → ${currentToolVersion}) — rebuilding source index`,
        );
        // Force full rebuild by treating all files as needing re-indexing.
        filesToIndex = allCandidateFiles;
        cachedFiles = [];
        manifestChanged = true;
      } else if (validity.valid && !manifestChanged) {
        log.info("Cache is up-to-date, skipping re-index");
        await hydrateIndex(existingIndex!, cachePath, cacheHydration);
        return existingIndex!;
      } else {
        filesToIndex = toIndex;
        cachedFiles = fromCache;
      }

      if (filesToIndex.length === 0 && manifestChanged) {
        // Source files unchanged but manifest changed: reuse all cached parsed files,
        // rebuild dependency graph with new manifest/tsconfig below.
        log.info("Manifest-only change — reusing cached parsed files, rebuilding graph");
        filesToIndex = [];
        if (existingIndex) {
          await hydrateIndex(existingIndex, cachePath, "full");
        }
        cachedFiles = existingIndex?.files ?? [];
      }

      if (filesToIndex.length === 0 && !manifestChanged) {
        // The file set can change only by deleting indexed files. Reuse the
        // remaining cached parsed files and rebuild the graph/cache below.
        log.info("Indexed file set changed - reusing cached parsed files, rebuilding graph");
      }

      log.info(`Cache invalid: ${filesToIndex.length} files need re-indexing`);
    }
  } else {
    filesToIndex = allCandidateFiles;
    cachedFiles = [];
  }

  // Parse files (Phase 3.1: bounded-concurrency parallel map).
  // Each file pipeline is independent: readFile + sha256 + mtime + parse.
  // We overlap the async I/O across N files in flight so the wall-clock
  // time drops even though tree-sitter's parse() itself is synchronous.
  const concurrency = defaultIndexingConcurrency();
  log.info(`Parsing ${filesToIndex.length} files (concurrency=${concurrency})...`);
  let parseErrors = 0;
  let parsedSoFar = 0;
  const PROGRESS_INTERVAL = 100;

  /**
   * Parse a single file, returning either a SourceIndexFile or null if
   * the language is unsupported. Errors are converted into a return of
   * `{ kind: "error", path }` so the parallel driver can keep going and
   * we can count them centrally.
   */
  type ParseOutcome =
    | { kind: "ok"; file: SourceIndexFile }
    | { kind: "skipped" }
    | { kind: "error" };

  const parseSingleFile = async (relPath: string): Promise<ParseOutcome> => {
    const absPath = resolve(projectRoot, relPath);
    const language = getLanguageForFile(relPath);

    if (!language) {
      const lexLang = isLexicallyExtractableLanguage(relPath);
      if (!lexLang) return { kind: "skipped" };
      try {
        const content = await readFile(absPath, "utf-8");
        const sha256 = await calculateSHA256(content);
        const mtimeMs = await getFileMtime(absPath);
        const parsed = parseNonIndexableFile(relPath, content);
        return {
          kind: "ok",
          file: {
            ...parsed,
            language: lexLang as IndexedLanguage,
            sha256,
            sizeBytes: content.length,
            mtimeMs,
            parserMode: "lexical-fallback",
            parseErrors: [],
          },
        };
      } catch (error) {
        log.warning(
          `Failed to parse ${relPath}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return { kind: "error" };
      }
    }

    try {
      const content = await readFile(absPath, "utf-8");
      const sha256 = await calculateSHA256(content);
      const mtimeMs = await getFileMtime(absPath);
      const parsed = await parseFile(relPath, content, language);
      if (!parsed) return { kind: "skipped" };
      const fileEntry: SourceIndexFile = { ...parsed, sha256, mtimeMs };
      return { kind: "ok", file: fileEntry };
    } catch (error) {
      log.warning(
        `Failed to parse ${relPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { kind: "error" };
    }
  };

  const outcomes = await parallelMap(
    filesToIndex,
    async (relPath) => {
      if (!relPath) return { kind: "skipped" } as ParseOutcome;
      const result = await parseSingleFile(relPath);
      parsedSoFar++;
      if (parsedSoFar % PROGRESS_INTERVAL === 0 || parsedSoFar === filesToIndex.length) {
        log.info(`  Progress: ${parsedSoFar}/${filesToIndex.length} files`);
      }
      return result;
    },
    concurrency,
  );

  const parsedFiles: SourceIndexFile[] = [];
  for (const outcome of outcomes) {
    if (outcome.kind === "ok") {
      parsedFiles.push(outcome.file);
      if (outcome.file.parseErrors && outcome.file.parseErrors.length > 0) {
        parseErrors++;
      }
    } else if (outcome.kind === "error") {
      parseErrors++;
    }
  }

  // ── Incremental parse-error resilience ───────────────────────────────────
  // When doing incremental indexing with an existing cache, files that fail to
  // re-parse should fall back to their existing cached entries (if available).
  // This avoids a small batch of transient parse failures blocking the entire
  // operation even though a healthy cache exists.
  const existingFileMap =
    !force && existingIndex
      ? new Map(existingIndex.files.map((f) => [f.path, f]))
      : new Map<string, SourceIndexFile>();

  if (!force && existingIndex && cachedFiles.length > 0) {
    for (let i = parsedFiles.length - 1; i >= 0; i--) {
      const parsed = parsedFiles[i];
      if (!parsed) continue;
      if (parsed.parseErrors && parsed.parseErrors.length > 0) {
        const existing = existingFileMap.get(parsed.path);
        // Fall back only for TRANSIENT flakes: the cached entry must be
        // healthy AND describe the same content (same sha). If the file
        // actually changed — or the old entry also failed parsing — keep
        // the fresh parse: its sha/mtime reflect the current file, while a
        // stale zombie entry would flag --health "source files changed"
        // forever.
        const isTransientFlake =
          existing &&
          existing.sha256 === parsed.sha256 &&
          (!existing.parseErrors || existing.parseErrors.length === 0);
        if (isTransientFlake) {
          log.warning(
            `Incremental re-parse failed for ${parsed.path} — keeping existing cached entry`,
          );
          parsedFiles.splice(i, 1);
          cachedFiles.push(existing);
          parseErrors = Math.max(0, parseErrors - 1);
        }
      }
    }
  }

  // Combine with cached files
  const allFiles = [...cachedFiles, ...parsedFiles];
  const totalParseErrors = allFiles.filter(
    (file) => file.parseErrors && file.parseErrors.length > 0,
  ).length;

  // Decision based on final index health, not just the incremental batch
  const finalErrorRate = allFiles.length > 0 ? totalParseErrors / allFiles.length : 0;
  // A true full rebuild has no existing cache to fall back on.
  // cachedFiles can be empty during incremental when all files changed,
  // but existingIndex still provides a safety net.
  const isFullRebuild = force || !existingIndex;

  if (finalErrorRate > MAX_PARSE_ERROR_RATE) {
    if (isFullRebuild) {
      throw new UserError(
        `Source indexing aborted: ${totalParseErrors}/${allFiles.length} file(s) have parse errors ` +
          `(${(finalErrorRate * 100).toFixed(0)}% > ${(MAX_PARSE_ERROR_RATE * 100).toFixed(0)}% max). ` +
          `Existing cache was not overwritten.`,
      );
    }

    // Incremental update would result in a degraded index — compare with existing
    if (existingIndex) {
      const existingRate = getIndexParseErrorRate(existingIndex);
      if (existingRate <= finalErrorRate) {
        log.warning(
          `Incremental index update would degrade index health ` +
            `(${(existingRate * 100).toFixed(0)}% → ${(finalErrorRate * 100).toFixed(0)}% parse errors). ` +
            `Keeping existing cache.`,
        );
        return existingIndex;
      }
    }
  }

  // Build dependency graph
  log.info("Building dependency graph...");
  const resolver = new ImportResolver(projectRoot);
  await resolver.initialize();

  const importGraph = await resolver.resolveBatch(
    allFiles.map((f) => ({ path: f.path, imports: f.imports })),
  );

  let importEdges = 0;
  for (const file of allFiles) {
    const importsFrom = importGraph.get(file.path) ?? [];
    file.importsFrom = importsFrom;
    file.exportedSymbols = file.exports.map((e) => e.names.join(", "));
    importEdges += importsFrom.length;
  }

  // Build importedBy reverse relationships (one pass over importsFrom —
  // the old per-file scan was O(files^2) and dominated large rebuilds)
  const importedByMap = new Map<string, string[]>();
  for (const file of allFiles) {
    for (const target of file.importsFrom ?? []) {
      const bucket = importedByMap.get(target);
      if (bucket) {
        bucket.push(file.path);
      } else {
        importedByMap.set(target, [file.path]);
      }
    }
  }
  for (const file of allFiles) {
    const importedBy = importedByMap.get(file.path);
    if (importedBy && importedBy.length > 0) {
      file.importedBy = importedBy;
    }
  }

  // Phase 3.1: capture git HEAD SHA so health checks can detect drift
  // between the indexed snapshot and the current working tree. Absent
  // when projectRoot isn't a git repo — never throws.
  const gitHeadSha = await getCurrentHeadSha(projectRoot);

  // Build preliminary index for insights computation
  const preIndex: SourceIndex = {
    schemaVersion: CURRENT_SOURCE_INDEX_SCHEMA,
    generatedAt: new Date().toISOString(),
    toolVersion: currentToolVersion,
    project: manifest,
    files: allFiles,
    manifestHash,
    ...(gitHeadSha && { gitHeadSha }),
    stats: {
      totalFiles: allCandidateFiles.length,
      indexedFiles: allFiles.length,
      skippedFiles: allCandidateFiles.length - allFiles.length,
      parseErrors: totalParseErrors,
      durationMs: performance.now() - startTime,
      parsedFiles: parsedFiles.length,
      cacheHitFiles: cachedFiles.length,
      importEdges,
    },
  };

  // Compute insights
  log.info("Computing index insights...");
  const insights = buildIndexInsights(preIndex);

  // Apply roles to files and build final index with insights
  for (const file of allFiles) {
    const role = insights.fileRoles[file.path];
    if (role && role !== "unknown") {
      file.role = role;
    }
  }

  // Build index
  const index: SourceIndex = {
    schemaVersion: CURRENT_SOURCE_INDEX_SCHEMA,
    generatedAt: new Date().toISOString(),
    toolVersion: currentToolVersion,
    project: manifest,
    files: allFiles,
    manifestHash,
    ...(gitHeadSha && { gitHeadSha }),
    stats: {
      totalFiles: allCandidateFiles.length,
      indexedFiles: allFiles.length,
      skippedFiles: Math.max(0, allCandidateFiles.length - allFiles.length),
      parseErrors: totalParseErrors,
      durationMs: performance.now() - startTime,
      parsedFiles: parsedFiles.length,
      cacheHitFiles: cachedFiles.length,
      importEdges,
    },
    insights,
  };

  // Never overwrite a previously healthy cache with a degraded one.
  // Allow minor regressions (e.g., new files with parse errors) as long as
  // the overall rate stays within acceptable bounds.
  if (existingIndex && !force) {
    const existingRate = getIndexParseErrorRate(existingIndex);
    const newRate = finalErrorRate;
    if (existingRate <= MAX_PARSE_ERROR_RATE && newRate > MAX_PARSE_ERROR_RATE) {
      log.warning(
        `New index parse-error rate crosses threshold ` +
          `(${(existingRate * 100).toFixed(0)}% → ${(newRate * 100).toFixed(0)}%). ` +
          `Keeping existing cache.`,
      );
      return existingIndex;
    }
  }

  // Write cache
  log.info("Writing source index cache...");
  await writeIndex(index, cachePath, { cacheMode: indexingConfig.cacheMode ?? "light" });

  const duration = performance.now() - startTime;
  log.info(`Indexing complete in ${duration.toFixed(0)}ms`);
  log.info(`  Indexed: ${allFiles.length} files`);
  log.info(`  Parse errors: ${totalParseErrors}`);
  log.info(`  Cache: ${cachePath}`);

  return index;
}

/**
 * Read-only source index health check.
 * Examines cache integrity without building, writing, or calling AI.
 */
async function handleHealth(
  projectRoot: string,
  format: "console" | "json",
  indexingConfig: Required<
    Pick<IndexingConfig, "enabled" | "languages" | "cachePath" | "maxFileSize">
  >,
): Promise<number> {
  const cachePath = resolve(projectRoot, indexingConfig.cachePath);

  // ── Missing cache ──────────────────────────────────────────────────────────
  if (!existsSync(cachePath)) {
    if (format === "json") {
      console.log(JSON.stringify({ status: "missing" }, null, 2));
    } else {
      console.log(`Index health: MISSING`);
      console.log(`  Cache not found at: ${cachePath}`);
    }
    return 1;
  }

  // ── Read raw cache (distinguish unreadable from missing) ───────────────────
  let raw: string;
  try {
    raw = await readFile(cachePath, "utf-8");
  } catch {
    if (format === "json") {
      console.log(JSON.stringify({ status: "unreadable" }, null, 2));
    } else {
      console.log(`Index health: UNREADABLE`);
      console.log(`  Cache exists but cannot be read at: ${cachePath}`);
    }
    return 1;
  }

  // ── Unparseable cache ──────────────────────────────────────────────────────
  let index: SourceIndex;
  try {
    index = JSON.parse(raw) as SourceIndex;
  } catch {
    if (format === "json") {
      console.log(JSON.stringify({ status: "unreadable" }, null, 2));
    } else {
      console.log(`Index health: UNREADABLE`);
      console.log(`  Cache exists but contains invalid JSON at: ${cachePath}`);
    }
    return 1;
  }

  // ── Compute current manifest hash ──────────────────────────────────────────
  let currentManifestHash: string;
  try {
    currentManifestHash = await computeManifestHash(projectRoot);
  } catch {
    if (format === "json") {
      console.log(
        JSON.stringify({ status: "ERROR", error: "Failed to compute manifest hash" }, null, 2),
      );
    } else {
      console.log(`Index health check failed: could not compute manifest hash`);
    }
    return 2;
  }

  const cachedHash = index.manifestHash;
  const parseErrorRate = getIndexParseErrorRate(index);
  const staleReasons: string[] = [];
  const changedFilesSample: string[] = [];
  const missingFilesSample: string[] = [];

  // ── Schema staleness ───────────────────────────────────────────────────────
  if (index.schemaVersion !== CURRENT_SOURCE_INDEX_SCHEMA) {
    staleReasons.push("schema outdated");
  }

  // ── Manifest hash staleness ────────────────────────────────────────────────
  if (cachedHash === undefined) {
    staleReasons.push("manifest fingerprint missing");
  } else if (cachedHash !== currentManifestHash) {
    staleReasons.push("manifest changed");
  }

  // ── Tool version staleness ─────────────────────────────────────────────────
  const currentToolVersion = getToolVersion();
  const cacheToolVersion = index.toolVersion;
  if (cacheToolVersion !== currentToolVersion) {
    staleReasons.push("tool version changed");
  }

  // ── File integrity check ───────────────────────────────────────────────────
  const MAX_SAMPLES = 5;
  for (const file of index.files) {
    const absPath = resolve(projectRoot, file.path);
    if (!existsSync(absPath)) {
      staleReasons.push("indexed files deleted");
      if (missingFilesSample.length < MAX_SAMPLES) {
        missingFilesSample.push(file.path);
      }
      continue;
    }
    try {
      const content = await readFile(absPath, "utf-8");
      const currentSha = await calculateSHA256(content);
      if (currentSha !== file.sha256) {
        staleReasons.push("source files changed");
        if (changedFilesSample.length < MAX_SAMPLES) {
          changedFilesSample.push(file.path);
        }
      }
    } catch {
      staleReasons.push("indexed files deleted");
      if (missingFilesSample.length < MAX_SAMPLES) {
        missingFilesSample.push(file.path);
      }
    }
  }

  // ── Sidecar integrity (schema 1.5 light cache) ─────────────────────────────
  const sidecarStatus = await getSidecarStatus(index, cachePath);
  if (!sidecarStatus.sidecarsValid) {
    staleReasons.push("sidecar files missing");
  }

  // Deduplicate stale reasons
  const uniqueReasons = [...new Set(staleReasons)];

  const status = uniqueReasons.length === 0 ? "ok" : "stale";

  const recoveredFiles = getRecoveredFileCount(index);
  const parserModeBreakdown = getParserModeBreakdown(index);
  const parseErrorCount = index.files.filter(
    (f) => f.parseErrors && f.parseErrors.length > 0,
  ).length;
  const suggestedCommands: string[] = [];
  if (recoveredFiles > 0) {
    suggestedCommands.push("mp-sentinel indexing --recovered --index-format json");
  }
  if (parseErrorCount > 0) {
    suggestedCommands.push("mp-sentinel indexing --parse-errors --index-format json");
  }

  const chunkTelemetry = getChunkTelemetry(index);

  // Phase 3.1: report git HEAD drift between indexed snapshot and the
  // current working tree. Both fields are optional so older caches
  // (no `gitHeadSha`) or non-git projects degrade gracefully.
  const currentGitHeadSha = await getCurrentHeadSha(projectRoot);
  const gitHeadDrift =
    !!index.gitHeadSha && !!currentGitHeadSha && index.gitHeadSha !== currentGitHeadSha;

  const output: IndexHealthOutput = {
    status,
    schemaVersion: index.schemaVersion,
    totalFiles: index.files.length,
    parseErrorRate,
    manifestHash: cachedHash ?? "",
    currentManifestHash,
    toolVersion: cacheToolVersion,
    currentToolVersion,
    staleReasons: uniqueReasons,
    changedFilesSample,
    missingFilesSample,
    recoveredFiles,
    parserModeBreakdown,
    parseErrorCount,
    ...(chunkTelemetry && chunkTelemetry),
    ...(suggestedCommands.length > 0 && { suggestedCommands }),
    ...(index.gitHeadSha && { gitHeadSha: index.gitHeadSha }),
    ...(currentGitHeadSha && { currentGitHeadSha }),
    ...(gitHeadDrift && { gitHeadDrift: true }),
    cacheMode: sidecarStatus.cacheMode,
    sidecarsPresent: sidecarStatus.sidecarsPresent,
    sidecarsValid: sidecarStatus.sidecarsValid,
    coreBytes: sidecarStatus.coreBytes,
    sidecarBytes: sidecarStatus.sidecarBytes,
  };

  if (format === "json") {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log();
    console.log(`Index health: ${status.toUpperCase()}`);
    console.log(`  Schema version:  ${index.schemaVersion}`);
    console.log(`  Total files:     ${index.files.length}`);
    console.log(`  Parse error rate: ${(parseErrorRate * 100).toFixed(1)}%`);
    console.log(
      `  Cache layout:    ${sidecarStatus.cacheMode} (core ${sidecarStatus.coreBytes} B, sidecars ${sidecarStatus.sidecarBytes} B${sidecarStatus.sidecarsValid ? "" : ", MISSING SIDECARS"})`,
    );
    console.log(`  Recovered files:  ${recoveredFiles}`);
    if (
      parserModeBreakdown["chunked-tree-sitter"] ||
      parserModeBreakdown["ascii-fallback"] ||
      parserModeBreakdown["lexical-fallback"]
    ) {
      console.log(
        `  Parser breakdown:  tree-sitter=${parserModeBreakdown["tree-sitter"]}, chunked-tree-sitter=${parserModeBreakdown["chunked-tree-sitter"]}, ascii-fallback=${parserModeBreakdown["ascii-fallback"]}, lexical-fallback=${parserModeBreakdown["lexical-fallback"]}`,
      );
    }
    if (chunkTelemetry) {
      console.log(
        `  Chunks:           ${chunkTelemetry.chunkedFiles} files, ${chunkTelemetry.totalChunks} chunks @ ${chunkTelemetry.chunkSize} bytes/chunk, ${chunkTelemetry.totalChunkWarnings} warnings (${chunkTelemetry.totalChunkBoundaryWarnings} boundary, ${chunkTelemetry.totalChunkActionableWarnings} actionable)`,
      );
    }
    console.log(`  Manifest hash:    ${cachedHash ?? "missing"}`);
    console.log(`  Current manifest: ${currentManifestHash}`);
    console.log(`  Tool version (cache):  ${cacheToolVersion}`);
    console.log(`  Tool version (current): ${currentToolVersion}`);
    if (index.gitHeadSha || currentGitHeadSha) {
      console.log(`  Git HEAD (cache):  ${index.gitHeadSha ?? "(unrecorded)"}`);
      console.log(`  Git HEAD (current): ${currentGitHeadSha ?? "(not a git repo)"}`);
      if (gitHeadDrift) {
        console.log(`  Git HEAD drift:    yes (run \`mp-sentinel indexing\` to refresh)`);
      }
    }
    if (uniqueReasons.length > 0) {
      console.log(`  Stale reasons:`);
      for (const reason of uniqueReasons) {
        console.log(`    - ${reason}`);
      }
    }
    if (changedFilesSample.length > 0) {
      console.log(`  Changed files (sample):`);
      for (const f of changedFilesSample) {
        console.log(`    - ${f}`);
      }
    }
    if (missingFilesSample.length > 0) {
      console.log(`  Missing files (sample):`);
      for (const f of missingFilesSample) {
        console.log(`    - ${f}`);
      }
    }
    console.log();
  }

  return status === "ok" ? 0 : 1;
}

/**
 * Run the indexing command
 */
export async function runIndexingCommand(
  values: Partial<CLIValues> & {
    force?: boolean;
    stats?: boolean;
    explainIndex?: string;
    findSymbol?: string;
    findImport?: string;
    findCode?: string;
    agentContext?: string;
    recovered?: boolean;
    parseErrors?: boolean;
    fullIndex?: boolean;
  },
  projectRoot: string = process.cwd(),
): Promise<number> {
  const startTime = performance.now();
  const format = resolveIndexFormat(values["index-format"]);

  // --find-symbol, --find-import, --find-code, and --agent-context are read-only queries: they use the existing index only.
  // Build/update the index if absent, but don't force rebuild.
  const isReadOnlyQuery = !!(
    values.findSymbol ||
    values.findImport ||
    values.findCode ||
    values.agentContext
  );

  // --recovered and --parse-errors are read-only cache queries — disallow together.
  if (values.recovered && values.parseErrors) {
    throw new UserError("--recovered and --parse-errors cannot be used together.");
  }

  // --health is a read-only diagnostic: examine cache integrity, no build/write/AI.
  if (values.health) {
    // Suppress informational logs when emitting structured JSON so stdout contains only valid JSON.
    if (format === "json") setLogQuietMode(true);
    try {
      const config = await loadProjectConfig(projectRoot);
      const indexingConfig = {
        ...getIndexingConfig(config),
        enabled: true,
      };
      return await handleHealth(projectRoot, format, indexingConfig);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Health check failed with unknown error";
      if (format === "json") {
        console.log(JSON.stringify({ status: "ERROR", error: message }, null, 2));
      } else {
        if (error instanceof Error) {
          log.critical(`Health check failed: ${error.message}`);
        } else {
          log.critical("Health check failed with unknown error");
        }
      }
      return 2;
    } finally {
      if (format === "json") setLogQuietMode(false);
    }
  }

  // --recovered is a read-only diagnostic: list files recovered via fallback parser.
  if (values.recovered) {
    if (format === "json") setLogQuietMode(true);
    try {
      const config = await loadProjectConfig(projectRoot);
      const indexingConfig = {
        ...getIndexingConfig(config),
        enabled: true,
      };
      return await handleRecovered(projectRoot, format, indexingConfig);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Recovered drilldown failed with unknown error";
      if (format === "json") {
        console.log(JSON.stringify({ status: "ERROR", error: message }, null, 2));
      } else {
        if (error instanceof Error) {
          log.critical(`Recovered drilldown failed: ${error.message}`);
        } else {
          log.critical("Recovered drilldown failed with unknown error");
        }
      }
      return 2;
    } finally {
      if (format === "json") setLogQuietMode(false);
    }
  }

  // --parse-errors is a read-only diagnostic: list files with hard parse errors.
  if (values.parseErrors) {
    if (format === "json") setLogQuietMode(true);
    try {
      const config = await loadProjectConfig(projectRoot);
      const indexingConfig = {
        ...getIndexingConfig(config),
        enabled: true,
      };
      return await handleParseErrors(projectRoot, format, indexingConfig);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Parse-errors drilldown failed with unknown error";
      if (format === "json") {
        console.log(JSON.stringify({ status: "ERROR", error: message }, null, 2));
      } else {
        if (error instanceof Error) {
          log.critical(`Parse-errors drilldown failed: ${error.message}`);
        } else {
          log.critical("Parse-errors drilldown failed with unknown error");
        }
      }
      return 2;
    } finally {
      if (format === "json") setLogQuietMode(false);
    }
  }

  // Validate query strings are non-empty
  if (values.findSymbol !== undefined && values.findSymbol.trim() === "") {
    throw new UserError("--find-symbol query must not be empty");
  }
  if (values.findImport !== undefined && values.findImport.trim() === "") {
    throw new UserError("--find-import query must not be empty");
  }
  if (values.findCode !== undefined && values.findCode.trim() === "") {
    throw new UserError("--find-code query must not be empty");
  }
  if (values.agentContext !== undefined && values.agentContext.trim() === "") {
    throw new UserError("--agent-context file path must not be empty");
  }

  // Suppress informational logs when emitting structured JSON so stdout contains only valid JSON.
  if (format === "json") setLogQuietMode(true);
  try {
    const config = await loadProjectConfig(projectRoot);
    // For the CLI command, always enable indexing - the user explicitly asked to build the index
    // This overrides any `indexing.enabled: false` in config for the command itself.
    const indexingConfig = {
      ...getIndexingConfig(config),
      enabled: true,
    };

    // Queries hydrate only the sidecar payload they actually read:
    // symbol/import/code work from the compact core (code search streams its
    // sidecar); agent context needs call edges for incoming-call matching.
    const hydration: IndexHydration = values.agentContext
      ? "calls"
      : isReadOnlyQuery
        ? "none"
        : values.fullIndex
          ? "full"
          : "none";

    const cachePath = resolve(projectRoot, indexingConfig.cachePath);
    const index = await buildSourceIndex(
      projectRoot,
      indexingConfig,
      isReadOnlyQuery ? false : values.force,
      hydration,
    );

    // Handle --find-symbol query
    if (values.findSymbol) {
      return handleFindSymbol(values.findSymbol, index, format);
    }

    // Handle --find-import query
    if (values.findImport) {
      return handleFindImport(values.findImport, index, format);
    }

    // Handle --find-code query
    if (values.findCode) {
      return await handleFindCode(values.findCode, index, format, cachePath);
    }

    // Handle --agent-context query
    if (values.agentContext) {
      return handleAgentContext(values.agentContext, index, format, projectRoot);
    }

    // Handle --explain-index option
    if (values.explainIndex) {
      return handleExplain(values.explainIndex, index, format, projectRoot);
    }

    // Handle --stats option
    if (values.stats) {
      return await handleStats(index, format, cachePath);
    }

    if (format === "json") {
      if (index) {
        // Light mode prints the compact core + sidecar metadata by default;
        // --full-index hydrates sidecar payloads into the JSON export.
        if (values.fullIndex) {
          await hydrateIndex(index, cachePath, "full");
          console.log(JSON.stringify(index, null, 2));
        } else {
          const coreView = (await readIndex(cachePath, { hydrate: "none" })) ?? index;
          console.log(JSON.stringify(coreView, null, 2));
        }
      } else {
        // Indexing failed or returned null for other reasons (shouldn't happen with new semantics)
        console.log(JSON.stringify({ status: "NO_INDEX" }, null, 2));
      }
    } else {
      // Console format
      if (index) {
        console.log();
        log.header("Source Index Summary");
        console.log(
          `  Project:  ${index.project.packageName || "unknown"} v${index.project.packageVersion || "n/a"}`,
        );
        console.log(
          `  Files:    ${index.stats.indexedFiles} indexed, ${index.stats.skippedFiles} skipped`,
        );
        console.log(`  Errors:   ${index.stats.parseErrors} parse errors`);
        console.log(`  Cache:    ${indexingConfig.cachePath}`);
        console.log(`  Generated: ${index.generatedAt}`);
        console.log(`  Schema:    ${index.schemaVersion}`);
        if (index.insights) {
          console.log(
            `  Insights: ${Object.keys(index.insights.fileRoles).length} roles, ${index.insights.publicApiFiles.length} public APIs, ${Object.keys(index.insights.testMap).length} test associations`,
          );
        }
        console.log();
      } else {
        console.log("Indexing completed but no index was generated.");
      }
    }

    const duration = performance.now() - startTime;
    log.info(`Total time: ${duration.toFixed(0)}ms`);

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Indexing failed with unknown error";
    if (format === "json") {
      console.log(
        JSON.stringify(
          {
            status: "ERROR",
            error: message,
          },
          null,
          2,
        ),
      );
      return 2;
    }
    if (error instanceof Error) {
      log.critical(`Indexing failed: ${error.message}`);
    } else {
      log.critical("Indexing failed with unknown error");
    }
    return 2;
  } finally {
    if (format === "json") setLogQuietMode(false);
  }
}
