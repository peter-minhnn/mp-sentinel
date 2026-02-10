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
 */
export const auditFile = async (
  _filePath: string,
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
    return {
      status: "FAIL",
      message: `Error auditing file: ${error instanceof Error ? error.message : "Unknown error"}`,
      issues: [],
    };
  }
};

/**
 * Audit multiple files with concurrency control
 */
export const auditFilesWithConcurrency = async (
  files: Array<{ path: string; content: string }>,
  config: ProjectConfig,
  maxConcurrency: number = 5,
): Promise<FileAuditResult[]> => {
  const systemPrompt = buildSystemPrompt(config);
  const results: FileAuditResult[] = [];

  for (let i = 0; i < files.length; i += maxConcurrency) {
    const batch = files.slice(i, i + maxConcurrency);

    const batchPromises = batch.map(async (file) => {
      const startTime = performance.now();
      log.audit(`Auditing: ${file.path}`);

      const result = await auditFile(file.path, file.content, systemPrompt);
      const duration = performance.now() - startTime;

      return {
        filePath: file.path,
        result,
        duration,
      };
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    log.progress(
      Math.min(i + maxConcurrency, files.length),
      files.length,
      `${results.length}/${files.length} files audited`,
    );
  }

  log.progressEnd();
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
