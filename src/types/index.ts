/**
 * Type definitions for mp-sentinel CLI
 */

export type ReviewMode = "commit" | "range" | "staged" | "files";
export type ReviewFormat = "console" | "json" | "markdown";

export interface ReviewTarget {
  mode: ReviewMode;
  value?: string;
  files?: string[];
}

export interface ReviewInputFile {
  path: string;
  patch: string;
  additions: number;
  deletions: number;
  changedLines: number;
  truncated?: boolean;
}

export interface ReviewSkippedItem {
  path: string;
  reason: string;
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
}

export interface ReviewReport {
  schemaVersion: "1.0";
  status: "PASS" | "FAIL" | "ERROR";
  target: ReviewTarget;
  aiEnabled: boolean;
  promptVersion: string;
  summary: ReviewSummary;
  results: FileAuditResult[];
  skipped: ReviewSkippedItem[];
  errors: string[];
  generatedAt: string;
}

/**
 * Commit pattern configuration for local review mode
 * Allows defining valid commit message patterns that will be reviewed
 */
export interface CommitPattern {
  /** Pattern name/type (e.g., 'feat', 'fix', 'chore') */
  type: string;
  /** Regex pattern to match commit messages */
  pattern: string;
  /** Description of this pattern */
  description?: string;
  /** Whether to require this pattern for all commits */
  required?: boolean;
}

/**
 * Local review mode configuration
 * For running reviews directly on branches without CI/CD
 */
export interface LocalReviewConfig {
  /** Enable local review mode */
  enabled?: boolean;
  /** Number of recent commits to review (default: 1) */
  commitCount?: number;
  /** Commit patterns to match for review */
  commitPatterns?: CommitPattern[];
  /** Only review commits matching these patterns */
  filterByPattern?: boolean;
  /** Skip review for these commit message prefixes */
  skipPatterns?: string[];
  /**
   * Exclude patterns — commits whose messages match ANY of these regex strings
   * are excluded from review even if they match commitPatterns.
   * Example: ["^Merge", "^Revert", "^chore\\(release\\)"]
   */
  excludePatterns?: string[];
  /** Include merge commits in review */
  includeMergeCommits?: boolean;
  /**
   * Enable branch diff mode - get commits that differ from target branch
   * When enabled, ignores commitCount and gets all commits since branching from compareBranch
   */
  branchDiffMode?: boolean;
  /**
   * Target branch to compare against (default: 'origin/main')
   * Used when branchDiffMode is enabled
   */
  compareBranch?: string;
  /**
   * Match mode for patterns:
   * - 'any': Match if any pattern matches (default)
   * - 'all': Match only if all required patterns match
   */
  patternMatchMode?: "any" | "all";
  /**
   * Show detailed pattern matching info in output
   */
  verbosePatternMatching?: boolean;
}

/**
 * Commit info for local review
 */
export interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
  files: string[];
}

export interface ProjectConfig {
  techStack?: string;
  rules?: string[];
  bypassKeyword?: string;
  commitFormat?: string;
  maxConcurrency?: number;
  cacheEnabled?: boolean;
  gitProvider?: "github" | "gitlab";
  repoUrl?: string; // Optional
  projectId?: string; // For GitLab
  /** Local review mode configuration */
  localReview?: LocalReviewConfig;
  /** Enable skills.sh integration for enhanced prompts */
  enableSkillsFetch?: boolean;
  /** Timeout for skills.sh API calls in milliseconds (default: 3000) */
  skillsFetchTimeout?: number;
  ai?: AIReviewConfig;
}

export interface AuditIssue {
  line: number;
  severity: "CRITICAL" | "WARNING" | "INFO";
  message: string;
  suggestion?: string;
}

export interface AuditResult {
  status: "PASS" | "FAIL" | "ERROR";
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

export interface CLIOptions {
  files?: string[];
  commit?: boolean;
  bypass?: boolean;
  verbose?: boolean;
  maxConcurrency?: number;
  targetBranch?: string;
}

export interface AIReviewConfig {
  enabled?: boolean;
  maxFiles?: number;
  maxDiffLines?: number;
  maxCharsPerFile?: number;
  promptVersion?: string;
  /**
   * Comma-separated list of provider names to try in order when the primary fails.
   * Example: "gemini,openai" — tries Gemini first, falls back to OpenAI.
   */
  fallbackProvider?: string;
  /**
   * Provider-specific context-window token limit override.
   * Defaults are: gemini=1_000_000, openai=128_000, anthropic=200_000.
   */
  tokenLimit?: number;
}

export const DEFAULT_CONFIG: Required<
  Omit<
    ProjectConfig,
    | "gitProvider"
    | "repoUrl"
    | "projectId"
    | "localReview"
    | "enableSkillsFetch"
    | "skillsFetchTimeout"
    | "ai"
  >
> & {
  localReview: LocalReviewConfig;
  enableSkillsFetch: boolean;
  skillsFetchTimeout: number;
  ai: AIReviewConfig;
} = {
  techStack: "",
  rules: [],
  bypassKeyword: "skip:",
  commitFormat: "",
  maxConcurrency: 5,
  cacheEnabled: true,
  enableSkillsFetch: true,
  skillsFetchTimeout: 3000,
  ai: {
    maxFiles: 15,
    maxDiffLines: 1200,
    maxCharsPerFile: 12000,
    promptVersion: "2026-02-16",
  },
  localReview: {
    enabled: false,
    commitCount: 1,
    commitPatterns: [],
    filterByPattern: false,
    skipPatterns: [],
    includeMergeCommits: false,
    branchDiffMode: false,
    compareBranch: "origin/main",
    patternMatchMode: "any",
    verbosePatternMatching: false,
  },
};
