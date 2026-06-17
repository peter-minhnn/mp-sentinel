/**
 * Typed mirrors of the `mp-sentinel` CLI JSON output contracts.
 *
 * These intentionally duplicate (a subset of) the shapes in the main package's
 * `src/types/index.ts`. The extension core consumes the CLI as a black box over
 * a child process and JSON stdout, so it must not import the CLI's internal
 * types. Only fields the extension actually reads are modelled; the CLI may emit
 * additional fields (the contract is additive), so all parsers tolerate extras.
 */

export type Severity = "CRITICAL" | "WARNING" | "INFO";

export type ReviewStatus = "PASS" | "FAIL" | "ERROR";

/** A single AI/deterministic finding for one line of one file. */
export interface AuditIssue {
  line: number;
  severity: Severity;
  message: string;
  suggestion?: string;
  category?: string;
  confidence?: "low" | "medium" | "high";
  evidence?: string;
  resolution?: "resolved-at-head" | "unverified";
  resolvedBy?: string;
  codeSuggestion?: string;
}

export interface AuditResult {
  status: ReviewStatus;
  issues?: AuditIssue[];
  message?: string;
  suggestion?: string;
}

export interface FileAuditResult {
  filePath: string;
  result: AuditResult;
  duration: number;
  cached?: boolean;
}

export interface ReviewTokenUsage {
  inputTokens: number;
  outputTokens: number;
  callCount: number;
  estimatedCostUsd?: number;
}

export interface ReviewSummary {
  totalFiles: number;
  auditedFiles: number;
  passedFiles: number;
  failedFiles: number;
  criticalIssues: number;
  warningIssues: number;
  infoIssues: number;
  durationMs: number;
  totalChangedLines: number;
  tokenUsage?: ReviewTokenUsage;
}

export interface ReviewReport {
  schemaVersion: string;
  status: ReviewStatus;
  aiEnabled: boolean;
  promptVersion: string;
  summary: ReviewSummary;
  results: FileAuditResult[];
  skipped: unknown[];
  errors: string[];
  generatedAt: string;
}

/** Subset of `mp-sentinel --explain-context --format json`. */
export interface ExplainContextOutput {
  status: string;
  reason?: string;
  profile?: string;
  budgetChars?: number;
  truncated?: boolean;
  relatedFileCount?: number;
  includedFiles?: string[];
  contextPreview?: string;
  indexUsed?: boolean;
  includedSignals?: string[];
  suggestedCommands?: string[];
}

export type IndexHealthStatus = "ok" | "stale" | "missing" | "unreadable" | "ERROR";

/** Subset of `mp-sentinel indexing --health --index-format json`. */
export interface IndexHealthOutput {
  status: IndexHealthStatus;
  schemaVersion?: string;
  totalFiles?: number;
  parseErrorRate?: number;
  staleReasons?: string[];
  changedFilesSample?: string[];
  missingFilesSample?: string[];
  recoveredFiles?: number;
  parseErrorCount?: number;
  suggestedCommands?: string[];
  gitHeadDrift?: boolean;
  error?: string;
}

/** Output of `mp-sentinel check-ai` — an AI connectivity probe. */
export interface CheckAiOutput {
  status: "ok" | "error";
  provider?: string;
  model?: string;
  error?: string;
}

/** Per-file row from `create-skills --check --format json`. */
export interface CreateSkillsCheckRow {
  outputPath: string;
  status: "up-to-date" | "stale" | "missing" | "wrong-agent";
  agent?: string;
}

export interface CreateSkillsCheckOutput {
  check: CreateSkillsCheckRow[];
  status: "ok" | "stale";
}

/** Per-file row from `create-skills --dry-run --format json`. */
export interface CreateSkillsDryRunRow {
  outputPath: string;
  action: "create" | "skip" | "overwrite" | "conflict";
  agent?: string;
}

export interface CreateSkillsDryRunOutput {
  dryRun: CreateSkillsDryRunRow[];
}
