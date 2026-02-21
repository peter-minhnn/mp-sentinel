/**
 * Core AI service with multi-provider support
 * Supports: Google Gemini, OpenAI GPT, Anthropic Claude
 * Features: retry with exponential backoff, fallback provider chain
 */

import type { AuditResult, ProjectConfig, FileAuditResult } from "../../types/index.js";
import {
  buildSystemPrompt,
  buildCommitPrompt,
  DEFAULT_PROMPT_VERSION,
} from "../../config/prompts.js";
import { parseAuditResponse } from "../../utils/parser.js";
import { log } from "../../utils/logger.js";
import { withRetry, isRetryableError } from "../../utils/retry.js";
import type { IAIProvider, AIProvider } from "./types.js";
import { AIProviderFactory } from "./factory.js";
import { AIConfig } from "./config.js";
import { buildAuditCacheKey, readCachedAuditResult, writeCachedAuditResult } from "./cache.js";

let providerInstance: IAIProvider | null = null;
let providerConfigCache: ReturnType<typeof AIConfig.fromEnvironment> | null = null;

const TOOL_VERSION = process.env.npm_package_version || "1.0.3";

const getProviderConfig = (): ReturnType<typeof AIConfig.fromEnvironment> => {
  if (providerConfigCache) {
    return providerConfigCache;
  }
  providerConfigCache = AIConfig.fromEnvironment();
  return providerConfigCache;
};

/**
 * Initialize AI provider (singleton pattern)
 */
const getProvider = (): IAIProvider => {
  if (providerInstance) {
    return providerInstance;
  }

  const config = getProviderConfig();
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
    .filter((p): p is AIProvider => ["gemini", "openai", "anthropic"].includes(p));
};

/**
 * Try to generate content using a fallback provider chain.
 * Returns null if all fallbacks fail.
 */
const tryFallbackProviders = async (
  fallbackChain: AIProvider[],
  systemPrompt: string,
  userPrompt: string,
): Promise<string | null> => {
  for (const providerName of fallbackChain) {
    try {
      const fallbackConfig = AIConfig.fromEnvironmentForProvider(providerName);
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
  const provider = getProvider();

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
): Promise<AuditResult> => {
  const provider = getProvider();
  const userPrompt = `Code to review:\n${content}`;

  try {
    const response = await withRetry(() => provider.generateContent(systemPrompt, userPrompt));
    return parseAuditResponse(response);
  } catch (primaryError) {
    const primaryMsg = primaryError instanceof Error ? primaryError.message : "Unknown error";

    // Attempt fallback providers if primary fails with a retryable error
    if (fallbackChain.length > 0 && isRetryableError(primaryError)) {
      const fallbackResponse = await tryFallbackProviders(fallbackChain, systemPrompt, userPrompt);
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
 * Audit multiple files with concurrency control
 * PERFORMANCE: Uses Promise.allSettled for true parallel processing
 * ERROR HANDLING: Failed files are tracked and reported, but don't stop the process
 * RETRY: Each file audit uses withRetry internally (via auditFile)
 * FALLBACK: Falls back to config.ai.fallbackProvider chain on retryable errors
 */
export const auditFilesWithConcurrency = async (
  files: Array<{ path: string; content: string }>,
  config: ProjectConfig,
  maxConcurrency: number = 5,
): Promise<FileAuditResult[]> => {
  // Build system prompt once (with skills.sh integration)
  const systemPrompt = await buildSystemPrompt(config);
  const providerConfig = getProviderConfig();
  const cacheEnabled = config.cacheEnabled !== false;
  const promptVersion = config.ai?.promptVersion || DEFAULT_PROMPT_VERSION;
  const fallbackChain = parseFallbackChain(config.ai?.fallbackProvider);

  if (fallbackChain.length > 0) {
    log.info(`Fallback provider chain: ${fallbackChain.join(" → ")}`);
  }

  const results: FileAuditResult[] = [];
  const failedFiles: Array<{ path: string; error: string }> = [];

  // Process files in batches for concurrency control
  for (let i = 0; i < files.length; i += maxConcurrency) {
    const batch = files.slice(i, i + maxConcurrency);

    const batchPromises = batch.map(async (file) => {
      const startTime = performance.now();
      log.audit(`Auditing: ${file.path}`);

      try {
        const cacheKey = buildAuditCacheKey({
          provider: providerConfig.provider,
          model: providerConfig.model,
          promptVersion,
          systemPrompt,
          filePath: file.path,
          payload: file.content,
          toolVersion: TOOL_VERSION,
        });

        if (cacheEnabled) {
          const cached = await readCachedAuditResult(cacheKey);
          if (cached) {
            const duration = performance.now() - startTime;
            return {
              success: true as const,
              data: {
                filePath: file.path,
                result: cached,
                duration,
                cached: true,
              },
            };
          }
        }

        const result = await auditFile(file.path, file.content, systemPrompt, fallbackChain);
        const duration = performance.now() - startTime;

        if (cacheEnabled && result.status !== "ERROR") {
          await writeCachedAuditResult(cacheKey, result);
        }

        return {
          success: true as const,
          data: {
            filePath: file.path,
            result,
            duration,
            cached: false,
          },
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        log.error(`Failed to audit ${file.path}: ${errorMsg}`);

        return {
          success: false as const,
          path: file.path,
          error: errorMsg,
        };
      }
    });

    // Use Promise.allSettled to ensure all files are processed
    const batchResults = await Promise.allSettled(batchPromises);

    // Process results
    for (const promiseResult of batchResults) {
      if (promiseResult.status === "fulfilled") {
        const fileResult = promiseResult.value;

        if (fileResult.success) {
          results.push(fileResult.data);
        } else {
          failedFiles.push({
            path: fileResult.path,
            error: fileResult.error,
          });
        }
      } else {
        // Promise rejected (shouldn't happen with our error handling, but just in case)
        log.error(`Unexpected promise rejection: ${promiseResult.reason}`);
      }
    }

    log.progress(
      Math.min(i + maxConcurrency, files.length),
      files.length,
      `${results.length}/${files.length} files audited`,
    );
  }

  log.progressEnd();

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
 * Clear provider cache (useful for testing)
 */
export const clearProviderCache = (): void => {
  providerInstance = null;
  providerConfigCache = null;
};

// Export types and utilities
export * from "./types.js";
export { AIProviderFactory } from "./factory.js";
export { AIConfig } from "./config.js";
