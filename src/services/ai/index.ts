/**
 * Core AI service with multi-provider support
 * Supports: Google Gemini, OpenAI GPT, Anthropic Claude
 */

import type {
  AuditResult,
  ProjectConfig,
  FileAuditResult,
} from "../../types/index.js";
import { buildSystemPrompt, buildCommitPrompt } from "../../config/prompts.js";
import { parseAuditResponse } from "../../utils/parser.js";
import { log } from "../../utils/logger.js";
import type { IAIProvider } from "./types.js";
import { AIProviderFactory } from "./factory.js";
import { AIConfig } from "./config.js";

let providerInstance: IAIProvider | null = null;

/**
 * Initialize AI provider (singleton pattern)
 */
const getProvider = (): IAIProvider => {
  if (providerInstance) {
    return providerInstance;
  }

  const config = AIConfig.fromEnvironment();
  AIConfig.validate(config);

  providerInstance = AIProviderFactory.createProvider(config);
  log.info(`AI Provider initialized: ${config.provider} (${config.model})`);

  return providerInstance;
};

/**
 * Audit commit message
 */
export const auditCommit = async (
  message: string,
  config: ProjectConfig,
): Promise<AuditResult> => {
  log.audit(`Auditing Commit Message: "${message}"...`);

  const systemPrompt = buildCommitPrompt(config.commitFormat);
  const provider = getProvider();

  try {
    const response = await provider.generateContent(
      systemPrompt,
      `Commit Message: "${message}"`,
    );
    return parseAuditResponse(response);
  } catch (error) {
    log.warning("AI check failed. Skipping commit check.");
    return { status: "PASS", message: "AI unavailable - skipped" };
  }
};

/**
 * Audit single file
 * CRITICAL: Never throws - always returns a result (even on error)
 */
export const auditFile = async (
  filePath: string,
  content: string,
  systemPrompt: string,
): Promise<AuditResult> => {
  const provider = getProvider();

  try {
    const response = await provider.generateContent(
      systemPrompt,
      `Code to review:\n${content}`,
    );
    return parseAuditResponse(response);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    log.warning(`Failed to audit ${filePath}: ${errorMsg}`);
    
    return {
      status: "FAIL",
      message: `Error auditing file: ${errorMsg}`,
      issues: [],
    };
  }
};

/**
 * Audit multiple files with concurrency control
 * PERFORMANCE: Uses Promise.allSettled for true parallel processing
 * ERROR HANDLING: Failed files are tracked and reported, but don't stop the process
 */
export const auditFilesWithConcurrency = async (
  files: Array<{ path: string; content: string }>,
  config: ProjectConfig,
  maxConcurrency: number = 5,
): Promise<FileAuditResult[]> => {
  // Build system prompt once (with skills.sh integration)
  const systemPrompt = await buildSystemPrompt(config);
  
  const results: FileAuditResult[] = [];
  const failedFiles: Array<{ path: string; error: string }> = [];

  // Process files in batches for concurrency control
  for (let i = 0; i < files.length; i += maxConcurrency) {
    const batch = files.slice(i, i + maxConcurrency);

    const batchPromises = batch.map(async (file) => {
      const startTime = performance.now();
      log.audit(`Auditing: ${file.path}`);

      try {
        const result = await auditFile(file.path, file.content, systemPrompt);
        const duration = performance.now() - startTime;

        return {
          success: true as const,
          data: {
            filePath: file.path,
            result,
            duration,
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
};

// Export types and utilities
export * from "./types.js";
export { AIProviderFactory } from "./factory.js";
export { AIConfig } from "./config.js";
