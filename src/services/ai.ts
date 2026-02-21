/**
 * Core AI service - Re-exports from modular AI service
 * @deprecated Import from './ai/index.js' instead
 */

export {
  auditCommit,
  auditFile,
  auditFilesWithConcurrency,
  clearProviderCache as clearModelCache,
  AIProviderFactory,
  AIConfig,
} from "./ai/index.js";

export type { AIProvider, AIModelConfig, IAIProvider } from "./ai/types.js";
