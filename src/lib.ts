// Type exports
export type {
  ProjectConfig,
  AuditIssue,
  AuditResult,
  FileAuditResult,
  CLIOptions,
  ReviewFormat,
  ReviewInputFile,
  ReviewMode,
  ReviewReport,
  ReviewSkippedItem,
  ReviewSummary,
  ReviewTarget,
} from "./types/index.js";
export { DEFAULT_CONFIG } from "./types/index.js";

// Utility exports
export {
  loadProjectConfig,
  clearConfigCache,
  validateConfig,
} from "./utils/config.js";
export {
  getLastCommitMessage,
  getChangedFiles,
  collectReviewInput,
  listFilesForTarget,
  isGitRepository,
  getCurrentBranch,
} from "./utils/git.js";
export { cleanJSON, parseAuditResponse, formatBytes } from "./utils/parser.js";
export { log, formatDuration, setLogQuietMode } from "./utils/logger.js";
export { UserError, SystemError, ProviderError } from "./utils/errors.js";

// Service exports
export {
  auditCommit,
  auditFile,
  auditFilesWithConcurrency,
  clearModelCache,
} from "./services/ai.js";
export {
  readFilesForAudit,
  getFileExtension,
  isCodeFile,
} from "./services/file.js";
export type { FileContent, FileReadResult } from "./services/file.js";

// Prompt exports
export {
  DEFAULT_COMMIT_PROMPT,
  BASE_AUDIT_PROMPT,
  buildSystemPrompt,
  buildCommitPrompt,
} from "./config/prompts.js";

// Security exports
export {
  SecurityService,
  getSecurityService,
  resetSecurityService,
} from "./services/security.service.js";
export type {
  SecretPattern,
  SanitizationResult,
  SuspiciousKeyword,
  PayloadFileSummary,
  PayloadSummary,
} from "./services/security.service.js";

// File handler exports
export { FileHandler } from "./services/file-handler.js";
export type {
  FileHandlerOptions,
  FileFilterResult,
} from "./services/file-handler.js";

// Review command export (programmatic)
export { runReview } from "./cli/review.js";
