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
   * - 'exclude-first': Apply excludePatterns first, then match remaining with 'any'
   */
  patternMatchMode?: "any" | "all" | "exclude-first";
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
  /** Source indexing configuration */
  indexing?: Partial<IndexingConfig>;
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
    | "indexing"
  >
> & {
  localReview: LocalReviewConfig;
  enableSkillsFetch: boolean;
  skillsFetchTimeout: number;
  ai: AIReviewConfig;
  indexing: Required<Pick<IndexingConfig, "enabled" | "languages" | "cachePath" | "maxFileSize">>;
} = {
  techStack: "",
  rules: [],
  bypassKeyword: "skip:",
  commitFormat: "",
  maxConcurrency: 5,
  cacheEnabled: true,
  enableSkillsFetch: true,
  skillsFetchTimeout: 3000,
  indexing: {
    enabled: false,
    languages: ["typescript", "tsx", "javascript", "jsx"],
    cachePath: ".mp-sentinel-cache/source-index.json",
    maxFileSize: 512000,
  },
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

// ====================================================================================
// Source Index Types (Tree-sitter AST-based indexing)
// ====================================================================================

/**
 * Supported languages for tree-sitter parsing
 */
export type IndexableLanguage = "typescript" | "tsx" | "javascript" | "jsx";

/**
 * Symbol types extracted from AST
 */
export interface SymbolInfo {
  name: string;
  type:
    | "function"
    | "class"
    | "interface"
    | "type"
    | "enum"
    | "variable"
    | "method"
    | "arrow-function";
  line: number;
  column: number;
  parent?: string;
  /** For classes: extends/implements, for functions: return type hint */
  metadata?: Record<string, string>;
}

/**
 * Import/Export information extracted from AST
 */
export interface ImportInfo {
  source: string;
  kind: "default" | "named" | "namespace" | "dynamic";
  names: string[];
  line: number;
}

export interface ExportInfo {
  kind: "default" | "named" | "namespace";
  names: string[];
  line: number;
  source?: string; // For re-exports
}

/**
 * Parsed file information stored in source index
 */
export interface SourceIndexFile {
  /** Relative path from project root */
  path: string;
  /** Detected language */
  language: IndexableLanguage;
  /** File SHA256 hash for cache validation */
  sha256: string;
  /** File size in bytes */
  sizeBytes: number;
  /** Last modified timestamp (milliseconds since epoch) */
  mtimeMs: number;
  /** Import statements found */
  imports: ImportInfo[];
  /** Export statements found */
  exports: ExportInfo[];
  /** Symbols (functions, classes, interfaces, types) */
  symbols: SymbolInfo[];
  /** Parse errors if any */
  parseErrors?: string[];
  /** Dependency graph - files this file imports from */
  importsFrom?: string[];
  /** Files that import this file */
  importedBy?: string[];
  /** Symbols this file exports (expanded for quick lookup) */
  exportedSymbols?: string[];
}

/**
 * Project manifest information
 */
export interface ProjectManifest {
  packageName?: string | undefined;
  packageVersion?: string | undefined;
  nodeEngine?: string | undefined;
  packageManager?: string | undefined;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  detectedFrameworks: string[];
  scripts?: Record<string, string> | undefined;
  bin?: string | Record<string, string> | undefined;
  tsConfig?:
    | {
        compilerOptions: Record<string, unknown>;
        extends?: string;
      }
    | undefined;
  toolVersion?: string | undefined;
}

/**
 * Source index schema v1.0
 */
export interface SourceIndex {
  schemaVersion: "1.0" | "1.1";
  generatedAt: string;
  toolVersion: string;
  project: ProjectManifest;
  files: SourceIndexFile[];
  /** Deterministic hash of manifest inputs (package.json, tsconfig, lockfile). Absent = manifest-stale. */
  manifestHash?: string;
  stats: {
    totalFiles: number;
    indexedFiles: number;
    skippedFiles: number;
    parseErrors: number;
    /** Duration of indexing in milliseconds */
    durationMs?: number;
    /** Number of files served from cache */
    cacheHitFiles?: number;
    /** Number of files parsed in this session */
    parsedFiles?: number;
    /** Number of import edges resolved in dependency graph (optional) */
    importEdges?: number;
  };
}

/**
 * Indexing configuration schema
 */
export interface IndexingConfig {
  enabled: boolean;
  languages: IndexableLanguage[];
  cachePath: string;
  maxFileSize: number;
}

/**
 * Project config extended with indexing options
 */
export interface ProjectConfigWithIndexing extends ProjectConfig {
  indexing?: IndexingConfig;
}

/**
 * Cache validity information
 */
export interface CacheValidity {
  valid: boolean;
  staleFiles?: string[];
  missingFiles?: string[];
  modifiedFiles?: string[];
}

// ====================================================================================
// Skills Generator Types (create-skills command)
// ====================================================================================

/**
 * Supported agent adapter identifiers
 */
export type AgentAdapterId =
  | "claude"
  | "cursor"
  | "codex"
  | "windsurf"
  | "antigravity"
  | "cline"
  | "generic";

/**
 * Context passed to an adapter's generate() call
 */
export interface SkillsGenerationContext {
  projectRoot: string;
  projectName: string;
  force: boolean;
}

/**
 * A single file to be written by an adapter
 */
export interface GeneratedSkillFile {
  outputPath: string;
  content: string;
}

/**
 * Adapter interface — each supported AI agent/IDE implements this
 */
export interface AgentAdapter {
  id: AgentAdapterId;
  label: string;
  detect(projectRoot: string): boolean;
  getDefaultOutput(projectRoot: string, projectName: string): string;
  generate(
    index: SourceIndex | null,
    context: SkillsGenerationContext,
  ): Promise<GeneratedSkillFile[]>;
}

/**
 * Result of generating skills for one agent
 */
export interface SkillsGenerationResult {
  agent: AgentAdapterId;
  label: string;
  outputPaths: string[];
  skipped: boolean;
  skipReason?: string;
}

/**
 * Metadata embedded in every generated skill file header.
 */
export interface SkillsMetadata {
  generatorVersion: string;
  sourceIndexSchema: string;
  sourceIndexHash: string;
  agent: AgentAdapterId;
  projectName: string;
}

// ── Dry-run types ─────────────────────────────────────────────────────────────

/** `conflict` = another adapter in the same batch has already claimed this path. */
export type DryRunFileAction = "create" | "skip" | "overwrite" | "conflict";

export interface SkillsDryRunFile {
  outputPath: string;
  action: DryRunFileAction;
}

export interface SkillsDryRunResult {
  agent: AgentAdapterId;
  label: string;
  files: SkillsDryRunFile[];
}

// ── Check types ───────────────────────────────────────────────────────────────

/** `wrong-agent` = file exists with matching hash but was generated by a different adapter. */
export type CheckFileStatus = "up-to-date" | "stale" | "missing" | "wrong-agent";

export interface SkillsCheckFile {
  outputPath: string;
  status: CheckFileStatus;
}

export interface SkillsCheckResult {
  agent: AgentAdapterId;
  label: string;
  files: SkillsCheckFile[];
}
