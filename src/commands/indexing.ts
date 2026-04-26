/**
 * Indexing Command - Build source index cache for enhanced review context
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { log, setLogQuietMode } from "../utils/logger.js";
import type { IndexingConfig, SourceIndex, SourceIndexFile } from "../types/index.js";
import { FileHandler } from "../services/file-handler/index.js";
import {
  readManifest,
  isIndexableLanguage,
  getLanguageForFile,
  computeManifestHash,
} from "../services/source-index/manifest.js";
import { parseFile } from "../services/source-index/parser.js";
import {
  readIndex,
  writeIndex,
  getFilesToIndex,
  calculateSHA256,
} from "../services/source-index/storage.js";
import { ImportResolver } from "../services/source-index/resolver.js";
import type { CLIValues } from "../cli/args.js";
import { loadProjectConfig } from "../utils/config.js";
import { UserError } from "../utils/errors.js";

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
  explain?: string;
  stats?: boolean;
}

async function assertTreeSitterAvailable(): Promise<void> {
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
}): Required<Pick<IndexingConfig, "enabled" | "languages" | "cachePath" | "maxFileSize">> {
  const indexing = config.indexing;

  return {
    enabled: indexing?.enabled ?? DEFAULT_INDEXING_CONFIG.enabled,
    languages: indexing?.languages ?? DEFAULT_INDEXING_CONFIG.languages,
    cachePath: indexing?.cachePath ?? DEFAULT_INDEXING_CONFIG.cachePath,
    maxFileSize: indexing?.maxFileSize ?? DEFAULT_INDEXING_CONFIG.maxFileSize,
  };
}

/**
 * Read file content safely
 */
async function readFileContent(path: string): Promise<string> {
  return await readFile(path, "utf-8");
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
  >,
  force: boolean = false,
): Promise<SourceIndex | null> {
  const startTime = performance.now();

  await assertTreeSitterAvailable();

  const cachePath = resolve(projectRoot, indexingConfig.cachePath);

  // Compute manifest fingerprint (before cache check)
  const manifestHash = await computeManifestHash(projectRoot);

  // Read manifest
  log.info("Reading project manifest...");
  const manifest = await readManifest(projectRoot);
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

  log.info(`Files to index (JS/TS): ${indexableFiles.length}`);

  // Check cache validity unless forcing rebuild
  let filesToIndex: string[];
  let cachedFiles: SourceIndexFile[];
  let manifestChanged = false;

  if (!force && existsSync(cachePath)) {
    const existingIndex = await readIndex(cachePath);
    if (existingIndex && getIndexParseErrorRate(existingIndex) > MAX_PARSE_ERROR_RATE) {
      log.warning("Existing source index has too many parse errors. Rebuilding full cache.");
      filesToIndex = indexableFiles;
      cachedFiles = [];
    } else {
      const { toIndex, fromCache, validity } = await getFilesToIndex(
        cachePath,
        projectRoot,
        indexableFiles,
        readFileContent,
        getFileMtime,
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

      if (validity.valid && !manifestChanged) {
        log.info("Cache is up-to-date, skipping re-index");
        return existingIndex!;
      }

      filesToIndex = toIndex;
      cachedFiles = fromCache;

      if (filesToIndex.length === 0 && manifestChanged) {
        // Source files unchanged but manifest changed: reuse all cached parsed files,
        // rebuild dependency graph with new manifest/tsconfig below.
        log.info("Manifest-only change — reusing cached parsed files, rebuilding graph");
        filesToIndex = [];
        cachedFiles = existingIndex?.files ?? [];
      }

      if (filesToIndex.length === 0 && !manifestChanged) {
        // All files are cached and manifest unchanged
        log.info("Cache is up-to-date, skipping re-index");
        return existingIndex!;
      }

      log.info(`Cache invalid: ${filesToIndex.length} files need re-indexing`);
    }
  } else {
    filesToIndex = indexableFiles;
    cachedFiles = [];
  }

  // Parse files
  log.info(`Parsing ${filesToIndex.length} files...`);
  const parsedFiles: SourceIndexFile[] = [];
  let parseErrors = 0;

  for (let i = 0; i < filesToIndex.length; i++) {
    const relPath = filesToIndex[i];
    if (!relPath) continue;
    const absPath = resolve(projectRoot, relPath);
    const language = getLanguageForFile(relPath);

    if (!language) {
      log.debug(`Skipping unsupported language: ${relPath}`);
      continue;
    }

    try {
      const content = await readFile(absPath, "utf-8");
      const sha256 = await calculateSHA256(content);
      const mtimeMs = await getFileMtime(absPath);

      const parsed = await parseFile(relPath, content, language);

      if (parsed) {
        parsedFiles.push({
          ...parsed,
          sha256,
          mtimeMs,
        });

        if (parsed.parseErrors && parsed.parseErrors.length > 0) {
          parseErrors++;
        }
      }
    } catch (error) {
      log.warning(
        `Failed to parse ${relPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
      parseErrors++;
    }

    // Progress logging
    if ((i + 1) % 100 === 0 || i === filesToIndex.length - 1) {
      log.info(`  Progress: ${i + 1}/${filesToIndex.length} files`);
    }
  }

  // Combine with cached files
  const allFiles = [...cachedFiles, ...parsedFiles];
  const totalParseErrors = allFiles.filter(
    (file) => file.parseErrors && file.parseErrors.length > 0,
  ).length;

  const parseErrorRate = filesToIndex.length > 0 ? parseErrors / filesToIndex.length : 0;
  if (parseErrorRate > MAX_PARSE_ERROR_RATE) {
    throw new UserError(
      `Source indexing aborted because ${parseErrors}/${filesToIndex.length} parsed file(s) had errors. Existing cache was not overwritten.`,
    );
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

  // Build importedBy reverse relationships
  for (const file of allFiles) {
    const importedBy: string[] = [];
    for (const other of allFiles) {
      if (other.importsFrom?.includes(file.path)) {
        importedBy.push(other.path);
      }
    }
    if (importedBy.length > 0) {
      file.importedBy = importedBy;
    }
  }

  // Build index
  const index: SourceIndex = {
    schemaVersion: "1.1",
    generatedAt: new Date().toISOString(),
    toolVersion: manifest.toolVersion ?? manifest.packageVersion ?? "unknown",
    project: manifest,
    files: allFiles,
    manifestHash,
    stats: {
      totalFiles: indexableFiles.length,
      indexedFiles: allFiles.length,
      skippedFiles: indexableFiles.length - allFiles.length,
      parseErrors: totalParseErrors,
      durationMs: performance.now() - startTime,
      parsedFiles: parsedFiles.length,
      cacheHitFiles: cachedFiles.length,
      importEdges,
    },
  };

  // Write cache
  log.info("Writing source index cache...");
  await writeIndex(index, cachePath);

  const duration = performance.now() - startTime;
  log.info(`Indexing complete in ${duration.toFixed(0)}ms`);
  log.info(`  Indexed: ${allFiles.length} files`);
  log.info(`  Parse errors: ${totalParseErrors}`);
  log.info(`  Cache: ${cachePath}`);

  return index;
}

/**
 * Run the indexing command
 */
export async function runIndexingCommand(
  values: CLIValues & { force?: boolean; stats?: boolean; explain?: string },
  projectRoot: string = process.cwd(),
): Promise<number> {
  const startTime = performance.now();
  const format = resolveIndexFormat(values["index-format"]);

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

    const index = await buildSourceIndex(projectRoot, indexingConfig, values.force);

    // Handle --explain option
    if (values.explain) {
      return handleExplain(values.explain, index, format, projectRoot);
    }

    // Handle --stats option
    if (values.stats) {
      return handleStats(index, format);
    }

    if (format === "json") {
      if (index) {
        console.log(JSON.stringify(index, null, 2));
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

/**
 * Handle --stats option
 */
function handleStats(index: SourceIndex | null, format: "console" | "json"): number {
  if (!index) {
    if (format === "json") {
      console.log(JSON.stringify({ error: "No index available" }, null, 2));
    } else {
      console.log("No index available");
    }
    return 1;
  }

  const stats = {
    totalFiles: index.stats.totalFiles,
    indexedFiles: index.stats.indexedFiles,
    skippedFiles: index.stats.skippedFiles,
    parseErrors: index.stats.parseErrors,
    durationMs: index.stats.durationMs,
    importEdges: index.stats.importEdges,
    graphEnabled: index.files.some((f) => f.importsFrom || f.importedBy),
  };

  if (format === "json") {
    console.log(JSON.stringify(stats, null, 2));
  } else {
    console.log();
    log.header("Index Statistics");
    console.log(`  Total files:      ${stats.totalFiles}`);
    console.log(`  Indexed files:    ${stats.indexedFiles}`);
    console.log(`  Skipped files:    ${stats.skippedFiles}`);
    console.log(`  Parse errors:     ${stats.parseErrors}`);
    console.log(`  Import edges:     ${stats.importEdges ?? "N/A"}`);
    console.log(`  Graph enabled:    ${stats.graphEnabled ? "yes" : "no"}`);
    console.log(`  Duration:         ${(stats.durationMs ?? 0).toFixed(0)}ms`);
    console.log();
  }

  return 0;
}

/**
 * Handle --explain option
 */
async function handleExplain(
  filePath: string,
  index: SourceIndex | null,
  format: "console" | "json",
  projectRoot: string,
): Promise<number> {
  if (!index) {
    if (format === "json") {
      console.log(JSON.stringify({ error: "No index available" }, null, 2));
    } else {
      console.log("No index available. Run 'mp-sentinel indexing' first.");
    }
    return 1;
  }

  // Normalize path relative to project root
  const normalizedPath =
    filePath.startsWith("/") || filePath.startsWith("\\")
      ? filePath.replace(/^[/\\]+/, "")
      : filePath;

  const file = index.files.find((f) => f.path === normalizedPath || f.path === filePath);

  if (!file) {
    if (format === "json") {
      console.log(JSON.stringify({ error: `File not found in index: ${filePath}` }, null, 2));
    } else {
      console.log(`File not found in index: ${filePath}`);
      console.log("\nIndexed files:");
      index.files.forEach((f) => console.log(`  ${f.path}`));
    }
    return 1;
  }

  const info = {
    path: file.path,
    language: file.language,
    symbols: file.symbols,
    imports: file.imports,
    exports: file.exports,
    importsFrom: file.importsFrom,
    importedBy: file.importedBy,
    exportedSymbols: file.exportedSymbols,
  };

  if (format === "json") {
    console.log(JSON.stringify(info, null, 2));
  } else {
    console.log();
    log.header(`Dependency Info: ${file.path}`);
    console.log(`  Language: ${file.language}`);

    if (file.importsFrom && file.importsFrom.length > 0) {
      console.log(`\n  Imports from:`);
      file.importsFrom.forEach((p) => console.log(`    ${p}`));
    }

    if (file.importedBy && file.importedBy.length > 0) {
      console.log(`\n  Imported by:`);
      file.importedBy.forEach((p) => console.log(`    ${p}`));
    }

    if (file.symbols.length > 0) {
      console.log(`\n  Symbols (${file.symbols.length}):`);
      file.symbols.slice(0, 20).forEach((s) => {
        console.log(`    ${s.type} ${s.name}${s.parent ? ` (in ${s.parent})` : ""}`);
      });
      if (file.symbols.length > 20) {
        console.log(`    ... and ${file.symbols.length - 20} more`);
      }
    }

    if (file.exportedSymbols && file.exportedSymbols.length > 0) {
      console.log(`\n  Exported symbols:`);
      file.exportedSymbols.slice(0, 20).forEach((e) => console.log(`    ${e}`));
      if (file.exportedSymbols.length > 20) {
        console.log(`    ... and ${file.exportedSymbols.length - 20} more`);
      }
    }

    console.log();
  }

  return 0;
}
