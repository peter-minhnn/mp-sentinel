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
  /** Create-skills AI enrichment configuration */
  createSkills?: CreateSkillsConfig;
}

// ====================================================================================
// Create Skills AI Enrichment Config
// ====================================================================================

export interface CreateSkillsAIConfig {
  enabled?: boolean;
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface CreateSkillsConfig {
  ai?: CreateSkillsAIConfig;
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
    | "createSkills"
  >
> & {
  localReview: LocalReviewConfig;
  enableSkillsFetch: boolean;
  skillsFetchTimeout: number;
  ai: AIReviewConfig;
  indexing: Required<
    Pick<IndexingConfig, "enabled" | "languages" | "cachePath" | "maxFileSize" | "maxRelatedFiles">
  >;
  createSkills: Required<CreateSkillsConfig>;
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
    maxRelatedFiles: 3,
  },
  ai: {
    maxFiles: 15,
    maxDiffLines: 1200,
    maxCharsPerFile: 12000,
    promptVersion: "2026-02-16",
  },
  createSkills: {
    ai: {
      enabled: false,
    },
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
  /** Whether this is a type-only import (import type { X } from ...) */
  typeOnly?: boolean;
}

export interface ExportInfo {
  kind: "default" | "named" | "namespace";
  names: string[];
  line: number;
  source?: string; // For re-exports
  /** Whether this is a type-only re-export (export type { X } from ...) */
  typeOnly?: boolean;
  /** Whether this is an export default */
  isDefault?: boolean;
}

// ====================================================================================
// Index Insights (schema 1.2+)
// ====================================================================================

/**
 * Detected role of a file in the project
 */
export type FileRole =
  | "cli-entry"
  | "command"
  | "service"
  | "adapter"
  | "provider"
  | "test"
  | "config"
  | "type"
  | "example"
  | "utils"
  | "unknown";

/**
 * Classification of npm scripts
 */
export type ScriptCategory =
  | "build"
  | "test"
  | "typecheck"
  | "format"
  | "release"
  | "indexing"
  | "dev"
  | "other";

/**
 * Index insights extracted from source index for skill generation
 */
export interface IndexInsights {
  /** File role map: file path -> role */
  fileRoles: Record<string, FileRole>;
  /** Public API files (exported via lib/entry) */
  publicApiFiles: string[];
  /** Test map: source file -> associated test files */
  testMap: Record<string, string[]>;
  /** Command map: script name -> category */
  commandMap: Record<string, ScriptCategory>;
  /** Dependency usage map: package name -> files importing it */
  dependencyUsage: Record<string, string[]>;
  /** Files with default exports */
  defaultExportFiles: string[];
  /** Files with re-exports */
  reExportFiles: string[];
  /** Files with type-only imports */
  typeOnlyImportFiles: string[];
  /** Files with dynamic imports */
  dynamicImportFiles: string[];
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
  /** Detected file role (schema 1.2+) */
  role?: FileRole;
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
 * Source index schema v1.0 / v1.1 / v1.2
 */
export interface SourceIndex {
  schemaVersion: "1.0" | "1.1" | "1.2";
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
  /** Index insights (schema 1.2+) */
  insights?: IndexInsights;
}

/**
 * Indexing configuration schema
 */
export interface IndexingConfig {
  enabled: boolean;
  languages: IndexableLanguage[];
  cachePath: string;
  maxFileSize: number;
  maxRelatedFiles: number;
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

/**
 * Skill profile for review context (same as in skills-generator)
 */
export type SkillProfile = "cli-tooling" | "node-service" | "react-next" | "library";

/**
 * Metadata about the review context generation (for testing/debug)
 */
export interface ReviewContextMetadata {
  profile: SkillProfile;
  relatedFileCount: number;
  relationTypes: RelationType[];
  includedFiles: string[];
  truncated: boolean;
  budgetChars: number;
}

/**
 * Types of relations between files in the dependency graph
 */
export type RelationType = "changed" | "import" | "dependent" | "hub";

// ====================================================================================
// Explain Context Types
// ====================================================================================

/**
 * Status of the explain-context diagnostic
 */
export type ExplainContextStatus = "available" | "unavailable";

/**
 * Output of the explain-context mode (JSON format)
 */
export interface ExplainContextOutput {
  status: ExplainContextStatus;
  reason?: string;
  profile?: SkillProfile;
  budgetChars?: number;
  truncated?: boolean;
  relatedFileCount?: number;
  relationTypes?: RelationType[];
  includedFiles?: string[];
  contextPreview?: string;
  indexUsed?: boolean;
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
  /** Optional AI enrichment output to include in generated content */
  enrichment?: AIEnrichmentOutput | undefined;
  /** Codebase-aware knowledge base (v2). Built once, shared across adapters. */
  knowledgeBase?: SkillKnowledgeBase | undefined;
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

// ====================================================================================
// AI Enrichment Types
// ====================================================================================

/**
 * AI enrichment mode
 */
export type EnrichmentMode = "none" | "ai";

/**
 * AI enrichment input - compact JSON from index
 */
export interface AIEnrichmentInput {
  projectName: string;
  packageVersion: string;
  packageManager: string;
  scripts: Record<string, string>;
  bin: string | Record<string, string> | undefined;
  engines: Record<string, string> | undefined;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  detectedFrameworks: string[];
  profile: SkillProfile;
  fileCount: number;
  moduleRoles: Record<string, string[]>;
  publicApiFiles: string[];
  testFileCount: number;
  topDependencies: string[];
  /** Test gap count (source files without tests) */
  testGapCount: number;
  /** Top dependencies with versions */
  topDependenciesWithVersions: Record<string, string>;
  /** Count of default-export files */
  defaultExportCount: number;
  /** Count of dynamic-import files */
  dynamicImportCount: number;
  /** Count of hub files (imported by >1 file) */
  hubFileCount: number;
}

/**
 * AI enrichment output - validated JSON from AI provider
 */
export interface AIEnrichmentOutput {
  languageRules: string[];
  libraryRules: string[];
  versionNotes: string[];
  riskWarnings: string[];
  recommendedChecks: string[];
}

// ====================================================================================
// SkillKnowledgeBase Types (v2 — codebase-aware skill generation)
// ====================================================================================

/** Module ownership info for a top-level directory */
export interface ModuleInfo {
  /** Top-level directory name, e.g. "src" or "(root)" */
  directory: string;
  /** Dominant role assigned to files in this directory */
  dominantRole: FileRole;
  /** Total source files in this directory (excluding tests) */
  sourceFileCount: number;
  /** Test files in this directory */
  testFileCount: number;
  /** Key source file paths (non-test, most symbols first, max 5) */
  keyFiles: string[];
  /** Key symbols across the module (max 10) */
  keySymbols: Array<{ name: string; type: string; file: string }>;
  /** Other directories that files in this directory import from */
  importsFromDirs: string[];
  /** Other directories that import files from this directory */
  importedByDirs: string[];
}

/** Entrypoint classification */
export interface EntrypointInfo {
  type: "cli" | "public-api" | "config" | "command";
  path: string;
  /** Description: for commands the script string, for CLI the bin target */
  label: string;
}

/** A source file lacking test coverage */
export interface TestGapEntry {
  sourceFile: string;
  reason: "no-test-file" | "no-import-graph-match";
}

/** Testing knowledge from the index */
export interface TestingMap {
  /** Source file path -> associated test file paths */
  testAssociations: Record<string, string[]>;
  /** Source files with no associated test */
  testGaps: TestGapEntry[];
  /** Directories sorted by test file count (descending, max 10) */
  mostTestedModules: ModuleInfo[];
}

/** A package dependency with version and usage info */
export interface DepMapEntry {
  packageName: string;
  /** Version string from package.json */
  version: string;
  /** Files that import from this package */
  files: string[];
  /** Number of importing files */
  fileCount: number;
}

/** A single risk item in the risk map */
export interface RiskEntry {
  file: string;
  type: "default-export" | "re-export" | "dynamic-import" | "type-only-import" | "hub-file";
  /** Human-readable description of the risk */
  detail: string;
  /** For hub-files: how many files import this file */
  importCount?: number;
}

/** Top-level knowledge base derived from SourceIndex for skill generation */
export interface SkillKnowledgeBase {
  projectName: string;
  projectVersion: string;
  packageManager: string;
  /** Module ownership by top-level directory */
  modules: ModuleInfo[];
  /** Detected entrypoints */
  entrypoints: EntrypointInfo[];
  /** Testing map and coverage gaps */
  testing: TestingMap;
  /** Top dependencies by usage count with versions (max 20) */
  dependencies: DepMapEntry[];
  /** Risk surface items */
  risks: RiskEntry[];
}

/**
 * Enrichment metadata embedded in skill file headers
 */
export type EnrichmentMetadata =
  | {
      mode: "none";
    }
  | {
      mode: "ai";
      provider: string;
      model: string;
      promptVersion: string;
      inputHash: string;
      outputHash: string;
    };

/**
 * Metadata embedded in every generated skill file header.
 */
export interface SkillsMetadata {
  generatorVersion: string;
  sourceIndexSchema: string;
  sourceIndexHash: string;
  agent: AgentAdapterId;
  projectName: string;
  enrichment?: EnrichmentMetadata;
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
