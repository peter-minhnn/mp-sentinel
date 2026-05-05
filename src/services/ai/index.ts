/**
 * Core AI service with multi-provider support
 * Supports: Google Gemini, OpenAI GPT, Anthropic Claude
 * Features: retry with exponential backoff, fallback provider chain, auto-chunking
 */

import type { AuditResult, ProjectConfig, FileAuditResult, AuditIssue } from "../../types/index.js";
import {
  buildSystemPrompt,
  buildCommitPrompt,
  DEFAULT_PROMPT_VERSION,
} from "../../config/prompts.js";
import { parseAuditResponse } from "../../utils/parser.js";
import { log } from "../../utils/logger.js";
import { withRetry, isRetryableError } from "../../utils/retry.js";
import { chunkFileWithMetadata } from "../../utils/tokens.js";
import type { IAIProvider, AIProvider, ModelTier } from "./types.js";
import { AIProviderFactory } from "./factory.js";
import { AIConfig } from "./config.js";
import { buildAuditCacheKey, readCachedAuditResult, writeCachedAuditResult } from "./cache.js";
import { getToolVersion } from "../../utils/version.js";

let providerInstance: IAIProvider | null = null;
let providerConfigCache: ReturnType<typeof AIConfig.fromEnvironment> | null = null;

const TOOL_VERSION = getToolVersion();

/**
 * Resolve provider config with optional modelTier.
 * Invalidates the cached provider instance when the resolved
 * provider/model differs from the cached config.
 */
const getProviderConfig = (modelTier?: ModelTier): ReturnType<typeof AIConfig.fromEnvironment> => {
  const config = AIConfig.fromEnvironment({ modelTier });

  // Invalidate provider if resolved config changed
  if (
    providerConfigCache &&
    (providerConfigCache.provider !== config.provider ||
      providerConfigCache.model !== config.model ||
      providerConfigCache.baseUrl !== config.baseUrl)
  ) {
    providerInstance = null;
    log.info(`AI provider config changed: ${providerConfigCache.model} → ${config.model}`);
  }

  providerConfigCache = config;
  return providerConfigCache;
};

/**
 * Get or create AI provider instance.
 * Accepts an optional modelTier so the resolved model can change
 * without stale cache issues.
 */
const getProvider = (modelTier?: ModelTier): IAIProvider => {
  // Always resolve config first (may invalidate cached provider)
  const config = getProviderConfig(modelTier);

  if (providerInstance) {
    return providerInstance;
  }

  AIConfig.validate(config);

  providerInstance = AIProviderFactory.createProvider(config);
  log.info(`AI Provider initialized: ${config.provider} (${config.model})`);

  return providerInstance;
};

/**
 * Parse fallbackProvider config string into an ordered list of provider names.
 * Example: "gemini,openai" → ["gemini", "openai"]
 */
const parseFallbackChain = (fallbackProvider?: string): AIProvider[] => {
  if (!fallbackProvider) return [];
  return fallbackProvider
    .split(",")
    .map((p) => p.trim().toLowerCase() as AIProvider)
    .filter((p): p is AIProvider =>
      ["gemini", "openai", "anthropic", "grok", "openrouter"].includes(p),
    );
};

/**
 * Try to generate content using a fallback provider chain.
 * Returns null if all fallbacks fail.
 */
const tryFallbackProviders = async (
  fallbackChain: AIProvider[],
  systemPrompt: string,
  userPrompt: string,
  modelTier?: ModelTier,
): Promise<string | null> => {
  for (const providerName of fallbackChain) {
    try {
      const fallbackConfig = AIConfig.fromEnvironmentForProvider(providerName, { modelTier });
      const fallbackProvider = AIProviderFactory.createProvider(fallbackConfig);
      log.warning(
        `Primary provider failed. Trying fallback: ${providerName} (${fallbackConfig.model})`,
      );
      const response = await withRetry(() =>
        fallbackProvider.generateContent(systemPrompt, userPrompt),
      );
      log.info(`Fallback provider ${providerName} succeeded.`);
      return response;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warning(`Fallback provider ${providerName} also failed: ${msg}`);
    }
  }
  return null;
};

/**
 * Audit commit message
 */
export const auditCommit = async (message: string, config: ProjectConfig): Promise<AuditResult> => {
  log.audit(`Auditing Commit Message: "${message}"...`);

  const systemPrompt = buildCommitPrompt(config.commitFormat);
  const modelTier = config.ai?.modelTier;
  const provider = getProvider(modelTier);

  try {
    const response = await withRetry(() =>
      provider.generateContent(systemPrompt, `Commit Message: "${message}"`),
    );
    return parseAuditResponse(response);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    log.warning(`AI commit check failed: ${errorMsg}`);
    return { status: "ERROR", message: `AI unavailable: ${errorMsg}`, issues: [] };
  }
};

/**
 * Audit single file with retry and optional fallback provider chain.
 * CRITICAL: Never throws - always returns a result (even on error)
 */
export const auditFile = async (
  filePath: string,
  content: string,
  systemPrompt: string,
  fallbackChain: AIProvider[] = [],
  modelTier?: ModelTier,
): Promise<AuditResult> => {
  const provider = getProvider(modelTier);
  const userPrompt = `Code to review:\n${content}`;

  try {
    const response = await withRetry(() => provider.generateContent(systemPrompt, userPrompt));
    return parseAuditResponse(response);
  } catch (primaryError) {
    const primaryMsg = primaryError instanceof Error ? primaryError.message : "Unknown error";

    // Attempt fallback providers if primary fails with a retryable error
    if (fallbackChain.length > 0 && isRetryableError(primaryError)) {
      const fallbackResponse = await tryFallbackProviders(
        fallbackChain,
        systemPrompt,
        userPrompt,
        modelTier,
      );
      if (fallbackResponse !== null) {
        return parseAuditResponse(fallbackResponse);
      }
    }

    log.warning(`Failed to audit ${filePath}: ${primaryMsg}`);
    return {
      status: "ERROR",
      message: `Error auditing file: ${primaryMsg}`,
      issues: [],
    };
  }
};

/**
 * Normalise a concurrency value to a safe positive integer.
 * - non-finite (NaN, Infinity, -Infinity) → 1
 * - value <= 0 → 1
 * - positive float → Math.floor(value), minimum 1
 */
const normalizeConcurrency = (value: number): number => {
  if (!isFinite(value)) return 1;
  if (value <= 0) return 1;
  return Math.max(1, Math.floor(value));
};

/**
 * Internal concurrency limiter: wraps async functions so that no more than
 * `concurrency` are executing simultaneously at any point.
 * Uses a slot reservation protocol to prevent queue bypass: the finishing
 * task reserves the slot for the next queued task before waking it, so no
 * external caller can observe a free slot and jump the queue.
 */
const createConcurrencyLimiter = <T>(concurrency: number) => {
  const effective = normalizeConcurrency(concurrency);
  const queue: Array<() => void> = [];
  let active = 0;

  const run = async (fn: () => Promise<T>): Promise<T> => {
    if (active >= effective) {
      // Must wait — the waker already reserved our slot before waking us,
      // so we must NOT increment active.
      await new Promise<void>((resolve) => queue.push(resolve));
    } else {
      active++;
    }
    try {
      return await fn();
    } finally {
      if (queue.length > 0) {
        // Reserve the slot for the next queued task before waking it,
        // so no caller can observe a free slot and jump the queue.
        // The woken task skips its own active++ because the slot is pre-reserved.
        queue.shift()!();
      } else {
        active--;
      }
    }
  };

  return run;
};

/**
 * Audit multiple files with concurrency control
 * PERFORMANCE: Uses a shared concurrency limiter so that individual chunk audits
 *              within a file also respect maxConcurrency (not just at the file level).
 * ERROR HANDLING: Failed files are tracked and reported, but don't stop the process
 * RETRY: Each file audit uses withRetry internally (via auditFile)
 * FALLBACK: Falls back to config.ai.fallbackProvider chain on retryable errors
 */
export const auditFilesWithConcurrency = async (
  files: Array<{ path: string; content: string }>,
  config: ProjectConfig,
  maxConcurrency: number = 5,
  indexContext?: string,
): Promise<FileAuditResult[]> => {
  // Normalise maxConcurrency to a safe positive integer — guards against NaN,
  // Infinity, negative values, and floats from programmatic API misuse.
  const effectiveConcurrency = normalizeConcurrency(maxConcurrency);

  // Shared concurrency limiter for ALL provider calls (non-chunked and chunked alike)
  const limit = createConcurrencyLimiter<AuditResult>(effectiveConcurrency);

  // Model tier from config — passed through to provider resolution so
  // .mp-sentinelrc.json ai.modelTier affects model selection at runtime
  const modelTier = config.ai?.modelTier;

  // Build system prompt once (with local skills enrichment and optional source index)
  const systemPrompt = await buildSystemPrompt(config, indexContext);
  const providerConfig = getProviderConfig(modelTier);
  const cacheEnabled = config.cacheEnabled !== false;
  const promptVersion = config.ai?.promptVersion || DEFAULT_PROMPT_VERSION;
  const fallbackChain = parseFallbackChain(config.ai?.fallbackProvider);
  const maxCharsPerFile = Math.max(1000, config.ai?.maxCharsPerFile ?? 12_000);

  if (fallbackChain.length > 0) {
    log.info(`Fallback provider chain: ${fallbackChain.join(" → ")}`);
  }

  const results: FileAuditResult[] = [];
  const failedFiles: Array<{ path: string; error: string }> = [];
  let completedCount = 0;

  // Map every file to a promise. Only the provider audit calls go through the
  // shared limiter — cache reads/writes and local computation are not throttled.
  const allFilePromises = files.map(async (file) => {
    const startTime = performance.now();

    // Auto-chunk large files that exceed maxCharsPerFile
    // Uses chunkFileWithMetadata to preserve original file line numbers
    const chunkMetas = chunkFileWithMetadata(file.content, maxCharsPerFile);
    const isChunked = chunkMetas.length > 1;

    if (isChunked) {
      log.audit(`Auditing: ${file.path} (${chunkMetas.length} chunks)`);
    } else {
      log.audit(`Auditing: ${file.path}`);
    }

    try {
      const cacheKeyInput: {
        provider: string;
        model: string;
        baseUrl?: string;
        promptVersion: string;
        systemPrompt: string;
        filePath: string;
        payload: string;
        toolVersion: string;
      } = {
        provider: providerConfig.provider,
        model: providerConfig.model,
        promptVersion,
        systemPrompt,
        filePath: file.path,
        payload: file.content,
        toolVersion: TOOL_VERSION,
      };
      if (providerConfig.baseUrl) {
        cacheKeyInput.baseUrl = providerConfig.baseUrl;
      }
      const cacheKey = buildAuditCacheKey(cacheKeyInput);

      if (cacheEnabled) {
        const cached = await readCachedAuditResult(cacheKey);
        if (cached) {
          const duration = performance.now() - startTime;
          return {
            success: true as const,
            data: { filePath: file.path, result: cached, duration, cached: true },
          };
        }
      }

      // For chunked files: audit each chunk and merge issues with line offset
      let result: AuditResult;
      if (isChunked) {
        // Every chunk audit goes through the shared limiter so chunks from
        // multiple files never collectively exceed maxConcurrency.
        // We yield to the microtask queue after each enqueue to allow other
        // file promises to enqueue their own chunks, creating fair interleaving
        // rather than one file filling the entire queue before others.
        const chunkPromises: Array<Promise<AuditResult>> = [];
        for (const meta of chunkMetas) {
          chunkPromises.push(
            limit(() =>
              auditFile(
                `${file.path} [chunk ${meta.index + 1}/${chunkMetas.length}]`,
                meta.content,
                systemPrompt,
                fallbackChain,
                modelTier,
              ),
            ),
          );
          // Yield to the microtask queue so other file callbacks get a chance
          // to enqueue their chunk limit() calls before this file continues.
          await 0;
        }
        const chunkResults = await Promise.all(chunkPromises);
        // Merge: FAIL if any chunk fails, collect all issues with line offset
        const allIssues = chunkResults.flatMap((r, idx) =>
          offsetChunkIssues(r.issues ?? [], chunkMetas[idx]!.startLine),
        );
        const hasError = chunkResults.some((r) => r.status === "ERROR");
        const hasFail = chunkResults.some((r) => r.status === "FAIL");
        result = {
          status: hasError ? "ERROR" : hasFail ? "FAIL" : "PASS",
          issues: allIssues,
          ...(hasError && { message: "One or more chunks failed to audit" }),
        };
      } else {
        result = await limit(() =>
          auditFile(file.path, file.content, systemPrompt, fallbackChain, modelTier),
        );
      }
      const duration = performance.now() - startTime;

      if (cacheEnabled && result.status !== "ERROR") {
        await writeCachedAuditResult(cacheKey, result);
      }

      return {
        success: true as const,
        data: { filePath: file.path, result, duration, cached: false },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      log.error(`Failed to audit ${file.path}: ${errorMsg}`);
      return { success: false as const, path: file.path, error: errorMsg };
    }
  });

  // Live progress tracking — fires as each individual file promise settles,
  // providing real-time feedback even while other files are still being audited.
  for (const p of allFilePromises) {
    p.finally(() => {
      completedCount++;
      log.progress(completedCount, files.length, `${completedCount}/${files.length} files audited`);
    });
  }

  // Resolve all file promises — the limiter handles actual provider concurrency
  const settled = await Promise.allSettled(allFilePromises);
  log.progressEnd();

  // Process results (maintains input order from Promise.allSettled)
  for (const promiseResult of settled) {
    if (promiseResult.status === "fulfilled") {
      const fileResult = promiseResult.value;
      if (fileResult.success) {
        results.push(fileResult.data);
      } else {
        failedFiles.push({ path: fileResult.path, error: fileResult.error });
      }
    } else {
      log.error(`Unexpected promise rejection: ${promiseResult.reason}`);
    }
  }

  // Report failed files at the end
  if (failedFiles.length > 0) {
    console.log();
    log.warning(`⚠️  ${failedFiles.length} file(s) could not be audited:`);
    for (const failed of failedFiles) {
      log.file(`   ❌ ${failed.path}: ${failed.error}`);
    }
    console.log();
  }

  return results;
};

/**
 * Offset chunk-relative issue line numbers back to original file line numbers.
 * Uses line + Math.max(0, chunkStartLine - 1) so that chunk 1 (startLine=1) is
 * a no-op on the line value while still returning new objects.
 * Preserves all issue metadata (category, confidence, evidence, suggestion).
 */
export const offsetChunkIssues = (issues: AuditIssue[], chunkStartLine: number): AuditIssue[] =>
  issues.map((i) => ({ ...i, line: i.line + Math.max(0, chunkStartLine - 1) }));

/**
 * Clear provider cache (useful for testing)
 */
export const clearProviderCache = (modelTier?: ModelTier): void => {
  providerInstance = null;
  providerConfigCache = null;
};

// Export types and utilities
export * from "./types.js";
export { AIProviderFactory } from "./factory.js";
export { AIConfig } from "./config.js";
