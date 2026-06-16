/**
 * Type definitions for mp-sentinel CLI
 */

export type ReviewMode = "commit" | "range" | "staged" | "files";
export type ReviewFormat = "console" | "json" | "markdown" | "sarif";

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
  /**
   * Aggregate token usage across all AI calls in this review (Phase 1.1).
   * Absent when no AI calls were made (dry-run / deterministic / all-cached).
   */
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    /** Number of AI calls that contributed usage data (may be < auditedFiles when some calls were cached) */
    callCount: number;
    /** Best-effort USD cost estimate. Absent when the model has no entry in the pricing table. */
    estimatedCostUsd?: number;
  };
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
  /** MCP runtime observability (only when MCP is enabled) */
  mcp?: MCPContextSummary;
  /**
   * Commits covered by the reviewed range, in CHRONOLOGICAL order
   * (index 0 = oldest). Optional and additive (schema-compatible). Lets
   * report consumers reason about "fixed in a later commit" without
   * re-deriving — and without misreading `git log`'s newest-first order.
   * (v3.1.1+)
   */
  commits?: CommitInfo[];
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
  /** File paths (relative to project root) to load additional rules from */
  ruleFiles?: string[];
  bypassKeyword?: string;
  commitFormat?: string;
  maxConcurrency?: number;
  cacheEnabled?: boolean;
  gitProvider?: "github" | "gitlab";
  repoUrl?: string; // Optional
  projectId?: string; // For GitLab
  /** Local review mode configuration */
  localReview?: LocalReviewConfig;
  /** Enable local skills fetch for enhanced prompts */
  enableSkillsFetch?: boolean;
  /** Timeout for skills fetch in milliseconds (default: 3000) */
  skillsFetchTimeout?: number;
  ai?: AIReviewConfig;
  /** Source indexing configuration */
  indexing?: Partial<IndexingConfig>;
  /** Create-skills AI enrichment configuration */
  createSkills?: CreateSkillsConfig;
  /** MCP (Model Context Protocol) external context configuration */
  mcp?: MCPConfig;
  /** Review pass/fail decision controls (Phase 1.5) */
  review?: ReviewSettings;
  /** Security service tuning (Phase 2.1) — entropy detection + custom patterns */
  security?: SecuritySettings;
  /** Cache backend selection (Phase 3.3) — fs (default) or http */
  cache?: CacheSettings;
  /** ESLint adapter — merge the reviewed project's own ESLint findings (opt-in) */
  eslint?: ESLintAdapterConfig;
}

/**
 * ESLint adapter settings. The adapter runs the reviewed project's own
 * ESLint installation and merges its findings into the review report.
 * Fail-open: if ESLint or its config is missing, the review proceeds
 * without ESLint findings (a warning is logged).
 */
export interface ESLintAdapterConfig {
  /** Run the project's ESLint and merge findings (default: false). */
  enabled?: boolean;
  /**
   * Per-ruleId severity overrides, e.g. { "no-console": "INFO" }.
   * Overrides win over the built-in CRITICAL whitelist and the default
   * ESLint level mapping (2 → WARNING, 1 → INFO).
   */
  severityOverrides?: Record<string, "CRITICAL" | "WARNING" | "INFO">;
  /** Timeout for each spawned ESLint process in ms (default: 60000). */
  timeoutMs?: number;
}

/**
 * Cache backend settings (Phase 3.3). Choose where audit-result cache
 * entries are stored:
 *   - `fs` (default): local `.mp-sentinel-cache/` directory
 *   - `http`: shared HTTP key-value store (e.g. for CI runners)
 *
 * The fs and http backends share the same SHA-256 key derivation, so an
 * entry written by one is readable by the other if both point at the
 * same logical store.
 */
export interface CacheSettings {
  /** Which backend to use. Defaults to `fs`. */
  backend?: "fs" | "http";
  /** Filesystem backend options (cwd-relative). */
  fs?: {
    /** Override the default `.mp-sentinel-cache/` directory. */
    cacheDir?: string;
  };
  /** HTTP backend options. */
  http?: {
    /** Required. Base URL — joined with `/<key>` per entry. */
    baseUrl?: string;
    /** Extra headers (e.g. Authorization). */
    headers?: Record<string, string>;
    /** Per-request timeout in milliseconds (default 5000). */
    timeoutMs?: number;
  };
}

export interface SecurityCustomPattern {
  /** Display name used in logs (e.g. "Internal Webhook Secret"). */
  name: string;
  /** Source string for the RegExp body — must be a valid regular expression. */
  pattern: string;
  /** Regex flags (default: "g"). */
  flags?: string;
}

export interface SecuritySettings {
  /** Turn on the Shannon-entropy secret detector (Phase 2.1). Default: false. */
  entropyEnabled?: boolean;
  /** Minimum length for entropy candidates (default: 24). */
  entropyMinLength?: number;
  /** Minimum bits/char for entropy candidates (default: 4.5). */
  entropyMinBitsPerChar?: number;
  /** Exact values never flagged — useful for publishable keys, fixtures. */
  allowValues?: string[];
  /** Globs of files where the security service is skipped entirely. */
  allowPaths?: string[];
  /** Project-specific extra regex patterns appended after the defaults. */
  customPatterns?: SecurityCustomPattern[];
}

/**
 * Severity levels used by the review pass/fail decision (Phase 1.5).
 * `CRITICAL` is the strictest (only CRITICAL fails), `INFO` is the loosest
 * (any finding at INFO or higher fails).
 */
export type SeverityThreshold = "CRITICAL" | "WARNING" | "INFO";

export interface ReviewSettings {
  /**
   * Minimum severity that causes the review to FAIL (default: CRITICAL).
   * Examples:
   *   - "CRITICAL" — only CRITICAL findings fail the review
   *   - "WARNING"  — CRITICAL or WARNING findings fail the review
   *   - "INFO"     — any finding fails the review
   */
  severityThreshold?: SeverityThreshold;
  /**
   * Per-branch overrides keyed by branch name. When the current branch
   * matches a key (exact match against `getCurrentBranch()`), the override
   * supersedes `severityThreshold`.
   */
  protectedBranches?: Record<string, SeverityThreshold>;
  /**
   * Noise budget: cap the number of non-CRITICAL findings reported per file.
   * CRITICAL findings are never capped. When a file exceeds the cap, the
   * lowest-severity / least-informative WARNING and INFO findings are dropped
   * and a single summary finding records how many were hidden. 0 / unset =
   * no cap. (v3.2.0+)
   */
  maxFindingsPerFile?: number;
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

export interface CreateSkillsPolicies {
  maxFileLines: number;
  warnFileLines: number;
  maxFunctionLines: number;
  /**
   * Max lines for a React component's *logic* body (hooks, handlers, derived
   * state) — the JSX return is excluded from this count. Components legitimately
   * concentrate more lines than a plain helper, so this is higher than
   * `maxFunctionLines`. Used by the React `long-function` evaluator.
   */
  maxComponentLines: number;
  maxParams: number;
  maxCyclomaticHint: number;
  forbidDefaultExports: boolean;
}

export interface RulePackOverrideDef {
  from: string;
  override?: Array<{ id: string; severity?: "must" | "should" | "avoid" }>;
  disable?: string[];
}

export interface CreateSkillsRulePacksConfig {
  include?: string[];
  exclude?: string[];
  extends?: RulePackOverrideDef[];
}

export interface CreateSkillsConfig {
  ai?: CreateSkillsAIConfig;
  policies?: CreateSkillsPolicies;
  rulePacks?: CreateSkillsRulePacksConfig;
  /**
   * Rule ids to omit from generated SKILL.md output (Phase 4.3). Format
   * is `<packId>/<ruleId>`, matching the same convention used by file
   * evaluators. Rules without an `id` field can't be targeted.
   *
   * Example:
   *   { "createSkills": { "disableRules": ["next/image-optimization"] } }
   */
  disableRules?: string[];
}

export const DEFAULT_CREATE_SKILLS_POLICIES: CreateSkillsPolicies = {
  maxFileLines: 500,
  warnFileLines: 350,
  maxFunctionLines: 80,
  maxComponentLines: 150,
  maxParams: 5,
  maxCyclomaticHint: 12,
  forbidDefaultExports: false,
};

// ====================================================================================
// MCP (Model Context Protocol) Configuration
// ====================================================================================

/** A single tool invocation against an MCP server */
export interface MCPCall {
  /** Tool name to invoke */
  tool: string;
  /** JSON input passed to the tool. String values support template vars: ${repo.owner}, etc. */
  input: Record<string, unknown>;
  /** Per-call character limit override (defaults to mcp.maxContextChars) */
  maxChars?: number;
}

/** Definition of a single MCP server (stdio transport only for MVP) */
export interface MCPServer {
  /** Unique identifier for this server within the config */
  id: string;
  /** Transport type — only "stdio" is supported */
  transport: "stdio";
  /** Command to spawn (e.g., "npx", "node", "python") */
  command: string;
  /** Arguments passed to the command */
  args: string[];
  /**
   * Environment variables to forward to the child process.
   * Keys are the env var names in the child process.
   * Values are the names of process.env variables to copy from.
   * Only explicitly named variables are forwarded.
   */
  env?: Record<string, string>;
  /** Ordered list of tool calls to make against this server */
  calls: MCPCall[];
}

/**
 * Pre-configured MCP server preset. Each preset expands to a full
 * `MCPServer` definition with a known command + default env mapping.
 * Phase 4.4 added: filesystem, git, slack, linear, postgres.
 */
export type MCPPreset =
  | MCPGitHubPreset
  | MCPFetchPreset
  | MCPFilesystemPreset
  | MCPGitPreset
  | MCPSlackPreset
  | MCPLinearPreset
  | MCPPostgresPreset;

/** GitHub MCP server preset */
export interface MCPGitHubPreset {
  preset: "github";
  calls: MCPCall[];
  /** Env var mapping: { "CHILD_NAME": "PROCESS_ENV_NAME" }. Defaults to { "GITHUB_TOKEN": "GITHUB_TOKEN" }. */
  env?: Record<string, string>;
}

/** Fetch MCP server preset (urls[] expand to individual fetch tool calls) */
export interface MCPFetchPreset {
  preset: "fetch";
  calls?: MCPCall[];
  urls?: string[];
  /** Env var mapping: { "CHILD_NAME": "PROCESS_ENV_NAME" }. */
  env?: Record<string, string>;
}

/**
 * Filesystem MCP server (Phase 4.4). Read-only access to project files
 * via `@modelcontextprotocol/server-filesystem`. The official server
 * already enforces a sandboxed root path; `rootPaths` (defaults to the
 * project cwd) determines which directories are visible.
 */
export interface MCPFilesystemPreset {
  preset: "filesystem";
  /** Directories the MCP server may read from. Defaults to `${cwd}`. */
  rootPaths?: string[];
  /** Tool calls to make. Typically `read_file` / `list_directory`. */
  calls: MCPCall[];
}

/**
 * Git MCP server (Phase 4.4). Read-only git operations via `uvx
 * mcp-server-git`. Used for `git_log`, `git_show`, `git_diff_unstaged`,
 * etc. -- read-only verbs only; mutating tools are rejected at the
 * MCPCallSchema layer.
 */
export interface MCPGitPreset {
  preset: "git";
  /** Repository root the MCP server reads from. Defaults to `${cwd}`. */
  repository?: string;
  calls: MCPCall[];
}

/**
 * Slack MCP server (Phase 4.4). Gated on `SLACK_BOT_TOKEN` (and optionally
 * `SLACK_TEAM_ID`). Read-only verbs (`channels_list`, `channels_history`,
 * `users_list`) are typical; mutating tools (`chat_postMessage`, etc.)
 * are rejected by the global MCPCallSchema mutating-prefix guard.
 */
export interface MCPSlackPreset {
  preset: "slack";
  calls: MCPCall[];
  /** Defaults to { SLACK_BOT_TOKEN: "SLACK_BOT_TOKEN", SLACK_TEAM_ID: "SLACK_TEAM_ID" }. */
  env?: Record<string, string>;
}

/**
 * Linear MCP server (Phase 4.4). Gated on `LINEAR_API_KEY`. Read verbs
 * like `list_issues`, `get_issue`, `list_projects`.
 *
 * Note: this preset spawns the **community stdio server**
 * (`@tacticlaunch/mcp-linear` via `npx`) -- it is *not* Linear's hosted
 * remote MCP server (`https://mcp.linear.app/...`), which uses a remote
 * transport and OAuth. To use a different package or transport, define
 * an explicit entry in `mcp.servers[]` instead of this preset.
 */
export interface MCPLinearPreset {
  preset: "linear";
  calls: MCPCall[];
  /** Defaults to { LINEAR_API_KEY: "LINEAR_API_KEY" }. */
  env?: Record<string, string>;
}

/**
 * Postgres MCP server (Phase 4.4). Read-only -- the reference Postgres MCP
 * server (`@modelcontextprotocol/server-postgres`) only exposes read
 * tools and **requires the connection URL as a CLI argument**, not an
 * env var. The standard mutating-tool guard still blocks anything with
 * a `create/update/delete/...` prefix.
 */
export interface MCPPostgresPreset {
  preset: "postgres";
  /**
   * Name of the process.env variable holding the Postgres connection URL
   * (e.g. `postgresql://user:pass@host:5432/db`). The value is appended
   * as the connection-URL argument the server expects. Default:
   * `DATABASE_URL`. Expansion fails with a clear error when the variable
   * is unset.
   */
  connectionUrlEnv?: string;
  /** Extra env vars to forward to the child process (optional). */
  env?: Record<string, string>;
  calls: MCPCall[];
}

/** Top-level MCP configuration */
export interface MCPConfig {
  /** Enable MCP external context gathering (default: false) */
  enabled?: boolean;
  /** Timeout in milliseconds for MCP server connection + tool calls (default: 3000) */
  timeoutMs?: number;
  /** Maximum total characters of MCP context to inject into the system prompt (default: 6000) */
  maxContextChars?: number;
  /** Cache MCP results to avoid re-fetching on every review (default: true) */
  cacheEnabled?: boolean;
  /** TTL for MCP cache entries in milliseconds (default: 3600000 = 1 hour) */
  cacheTtlMs?: number;
  /** MCP server definitions */
  servers?: MCPServer[];
  /** Preset shortcuts that expand into full server definitions */
  presets?: MCPPreset[];
}

// ====================================================================================
// MCP Diagnostics Types
// ====================================================================================

/** Diagnostic status for a single MCP server */
export type MCPDiagnosticStatus = "disabled" | "ready" | "missing_env" | "missing_command";

/** Per-server diagnostic information */
export interface MCPDiagnosticServer {
  id: string;
  command: string;
  status: MCPDiagnosticStatus;
  toolCount: number;
  /** Origin of this server: "preset" (expanded) or "explicit" (user-defined) */
  source: "preset" | "explicit";
  missingVars?: string[];
  /** Human-readable suggested actions (e.g., "Set GITHUB_TOKEN env var") */
  recommendedActions?: string[];
}

/** MCP cache settings surfaced in diagnostics */
export interface MCPCacheSettings {
  enabled: boolean;
  ttlMs: number;
}

/** MCP diagnostics summary — read-only, no spawn */
export interface MCPDiagnostics {
  enabled: boolean;
  serverCount: number;
  servers: MCPDiagnosticServer[];
  cacheSettings?: MCPCacheSettings;
}

// ====================================================================================
// MCP Runtime Observability Types
// ====================================================================================

/** Per-call cache status */
export type MCPCacheStatus = "hit" | "miss" | "disabled";

/** Per-call execution status */
export type MCPCallStatus = "ok" | "failed" | "skipped";

/** Per-call metadata recorded during MCP context gathering (no secret values) */
export interface MCPCallDetail {
  serverId: string;
  tool: string;
  cacheStatus: MCPCacheStatus;
  status: MCPCallStatus;
}

/** MCP runtime summary surfaced in review output and diagnostics */
export interface MCPContextSummary {
  enabled: boolean;
  serverCount: number;
  attemptedCallCount: number;
  cachedCallCount: number;
  freshCallCount: number;
  failedCallCount: number;
  contextChars: number;
  truncated: boolean;
  warnings: string[];
  calls: MCPCallDetail[];
}

/** Full result from gatherMCPContextDetails */
export interface MCPGatherResult {
  context: string | null;
  summary: MCPContextSummary;
}

export interface AuditIssue {
  line: number;
  severity: "CRITICAL" | "WARNING" | "INFO";
  message: string;
  suggestion?: string;
  /** Categorization rubric: security, runtime-crash, architecture, dependency-version, test-gap, performance, maintainability (v1.34.0+) */
  category?: string;
  /** Confidence level: low | medium | high (v1.34.0+) */
  confidence?: "low" | "medium" | "high";
  /** Supporting evidence for the issue (v1.34.0+) */
  evidence?: string;
  /**
   * Reconciliation status against the current working tree (v3.1.1+).
   * Only set in historical-commit review mode (`--commit <sha>`):
   * - "resolved-at-head": the quoted evidence no longer exists at HEAD and
   *   git history shows a commit that changed it — the issue was fixed by a
   *   later commit. Excluded from pass/fail and severity counts.
   * - "unverified": the evidence appears in neither the working tree nor
   *   git history — likely paraphrased or hallucinated.
   * Absent = active finding (or reconciliation not applicable).
   */
  resolution?: "resolved-at-head" | "unverified";
  /** Short SHA of the commit that resolved this issue (when resolution = "resolved-at-head"). */
  resolvedBy?: string;
  /**
   * Structured, ready-to-apply code replacement for the single flagged line.
   * Pure code (no prose), small, and matching the file's style. Rendered as a
   * provider code-suggestion block ONLY when it passes safety checks. Distinct
   * from `suggestion`, which is a free-text recommendation.
   */
  codeSuggestion?: string;
}

export interface AuditResult {
  status: "PASS" | "FAIL" | "ERROR";
  issues?: AuditIssue[];
  message?: string;
  suggestion?: string;
  /**
   * Token usage reported by the provider for this single audit call (Phase 1.1).
   * Absent for cached, deterministic, or commit-message audits — anything that
   * did not consume provider tokens.
   */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
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
   * Severity overrides for rule-pack evaluator findings.
   * Key is `<packId>/<ruleId>` (e.g. "svelte/imports-inside-script").
   * Value is the severity to assign when the evaluator finds a violation.
   */
  rulePackSeverity?: Record<string, "CRITICAL" | "WARNING" | "INFO">;
  /**
   * Per-category severity ceilings applied to AI findings AFTER parsing.
   * Key is a rubric category (e.g. "architecture"), value is the maximum
   * severity findings of that category may carry. Merged over the defaults
   * (architecture/performance/maintainability/test-gap → WARNING); map a
   * category to "CRITICAL" to disable its default clamp. (v3.1.1+)
   */
  severityCeilings?: Record<string, "CRITICAL" | "WARNING" | "INFO">;
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
  /**
   * Model tier selector — controls which model from the provider's tier
   * catalog is used when no explicit AI_MODEL is set.
   * - premium: best / newest models for hard reviews (security, architecture)
   * - balanced: default / stable models for everyday CI
   * - budget: cheap / fast models for bulk review
   *
   * Precedence: AI_MODEL > AI_MODEL_TIER > ai.modelTier > provider default
   */
  modelTier?: "premium" | "balanced" | "budget";
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
    | "mcp"
    | "ruleFiles"
    | "review"
    | "security"
    | "cache"
    | "eslint"
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
  mcp: Required<MCPConfig>;
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
    promptVersion: "2026-05-04",
  },
  createSkills: {
    ai: {
      enabled: false,
    },
    policies: {
      maxFileLines: 500,
      warnFileLines: 350,
      maxFunctionLines: 80,
      maxComponentLines: 150,
      maxParams: 5,
      maxCyclomaticHint: 12,
      forbidDefaultExports: false,
    },
    rulePacks: {
      include: [],
      exclude: [],
      extends: [],
    },
    // Phase 4.3: list of rule ids to omit from generated SKILL.md output.
    // Empty by default -- users opt in by listing `<packId>/<ruleId>`.
    disableRules: [],
  },
  mcp: {
    enabled: false,
    timeoutMs: 3000,
    maxContextChars: 6000,
    cacheEnabled: true,
    cacheTtlMs: 3_600_000,
    servers: [],
    presets: [],
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
 * Languages that can appear in the source index `language` field,
 * including lexical-fallback languages. Superset of IndexableLanguage.
 */
export type IndexedLanguage =
  | IndexableLanguage
  | "svelte"
  | "vue"
  | "python"
  | "go"
  | "rust"
  | "dart"
  | "php"
  | "ruby";

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
  /** End line of the symbol (schema 1.3+) */
  endLine?: number;
  /** End column of the symbol (schema 1.3+) */
  endColumn?: number;
  parent?: string;
  /** For classes: extends/implements, for functions: return type hint */
  metadata?: Record<string, string>;
}

/**
 * A searchable code snippet extracted from a source file (schema 1.3+)
 */
export interface CodeSearchEntry {
  /** 1-based line number where the snippet starts */
  line: number;
  /** 0-based column number where the snippet starts */
  column: number;
  /** Trimmed, redacted snippet text */
  text: string;
  /** Name of the nearest enclosing symbol, if any */
  nearestSymbol?: string;
  /** Type of the nearest enclosing symbol */
  nearestSymbolType?: SymbolInfo["type"];
}

/**
 * A single outgoing call edge captured at parse time (schema 1.4+).
 *
 * Phase 4.1 -- call-graph indexing.
 *
 * We record the textual callee (e.g. "getUser", "user.save",
 * "axios.get") rather than resolving to a fully-qualified symbol id at
 * parse time. Resolution happens lazily at query time so the index stays
 * cheap to build and survives renames / re-exports that the symbol
 * resolver doesn't track perfectly.
 *
 * The `inSymbol` field lets queries answer "which functions in this file
 * call X" without rescanning the AST.
 */
export interface CallEdge {
  /** Callee text as written at the call site (no resolution). */
  callee: string;
  /** 1-indexed line number of the call expression. */
  line: number;
  /** 0-indexed column where the callee identifier begins. */
  column: number;
  /** Name of the nearest enclosing function/method/arrow, if any. */
  inSymbol?: string;
}

/**
 * Result of a code-text search query (schema 1.3+)
 */
export interface CodeSearchResult {
  file: string;
  language: string;
  entry: CodeSearchEntry;
  score: number;
  reason: string;
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
 * Which parser mode was used for this file.
 * - `tree-sitter`: parsed normally via tree-sitter AST
 * - `chunked-tree-sitter`: tree-sitter threw "Invalid argument" on full file, recovered via chunked parse
 * - `ascii-fallback`: tree-sitter (+ chunked) threw "Invalid argument", recovered via ASCII normalization
 * - `lexical-fallback`: tree-sitter + ASCII both failed, recovered via regex-based lexical parse
 */
export type ParserMode =
  | "tree-sitter"
  | "chunked-tree-sitter"
  | "ascii-fallback"
  | "lexical-fallback";

/**
 * Parsed file information stored in source index
 */
export interface SourceIndexFile {
  /** Relative path from project root */
  path: string;
  /** Detected language (includes lexical-fallback languages like svelte/vue) */
  language: IndexedLanguage;
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
  /** Hard parse errors — the file could not be parsed at all */
  parseErrors?: string[];
  /** Which parser mode was used. Optional parser telemetry fields; absent on older caches. */
  parserMode?: ParserMode;
  /** Recovery warnings — fallback was used but the file was recovered */
  parseWarnings?: string[];
  /** Number of chunks when parserMode is chunked-tree-sitter (optional parser telemetry) */
  chunkCount?: number;
  /** MAX_CHUNK_SIZE value used when parserMode is chunked-tree-sitter (optional parser telemetry) */
  chunkSize?: number;
  /** Number of chunk-level warnings when parserMode is chunked-tree-sitter (optional parser telemetry) */
  chunkWarningCount?: number;
  /** Number of expected chunk-boundary warnings (tree-sitter syntax errors at chunk edges) */
  chunkBoundaryWarningCount?: number;
  /** Number of actionable chunk warnings (non-boundary parser issues; 0 means all chunk warnings are boundary notices) */
  chunkActionableWarningCount?: number;
  /** Dependency graph - files this file imports from */
  importsFrom?: string[];
  /** Files that import this file */
  importedBy?: string[];
  /** Symbols this file exports (expanded for quick lookup) */
  exportedSymbols?: string[];
  /** Detected file role (schema 1.2+) */
  role?: FileRole;
  /** Code search snippets (schema 1.3+) */
  codeSearch?: CodeSearchEntry[];
  /**
   * Outgoing call edges captured during AST traversal (schema 1.4+).
   * Only populated for tree-sitter parsed JS/TS/JSX/TSX files; lexical
   * fallback languages don't currently emit call edges.
   */
  calls?: CallEdge[];
}

/**
 * Supported ecosystems for project manifest detection
 */
export type Ecosystem =
  | "node"
  | "python"
  | "go"
  | "rust"
  | "dart"
  | "php"
  | "ruby"
  | "java"
  | "dotnet"
  | "unknown";

/**
 * Project manifest information
 */
/** A package-level manifest inside a workspace monorepo */
export interface WorkspacePackageInfo {
  /** Directory relative to the workspace root, e.g. "packages/core" */
  directory: string;
  /** Package name from its package.json */
  name: string;
  /** Script names defined in the package's own package.json */
  scriptNames: string[];
}

export interface ProjectManifest {
  packageName?: string | undefined;
  packageVersion?: string | undefined;
  nodeEngine?: string | undefined;
  ecosystem: Ecosystem;
  packageManager?: string | undefined;
  /** Workspace globs from package.json `workspaces` or pnpm-workspace.yaml (monorepo root) */
  workspaces?: string[] | undefined;
  /** Package-level manifests discovered under the workspace globs (monorepo root) */
  workspacePackages?: WorkspacePackageInfo[] | undefined;
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
 * Current source index schema version.
 *
 * 1.4 (Phase 4.1) -- adds optional `calls: CallEdge[]` to SourceIndexFile.
 * Backwards compatible: older readers ignore the new field; older caches
 * still load (the field is optional). No rename or removal.
 */
export const CURRENT_SOURCE_INDEX_SCHEMA = "1.5" as const;

/** Metadata for one sidecar payload file (schema 1.5 light cache). */
export interface SidecarFileMeta {
  /** Sidecar file name, relative to the core cache file's directory. */
  file: string;
  /** Sidecar size in bytes at write time. */
  bytes: number;
  /** Number of files contributing rows to this sidecar. */
  entryCount: number;
}

/**
 * Sidecar layout metadata (schema 1.5 "light" cache mode).
 *
 * In light mode the core `source-index.json` stays compact: heavy payloads
 * (`codeSearch`, `calls`) move to JSONL sidecars next to the core file and
 * are hydrated on demand. `cacheMode: "full"` keeps everything inline and
 * omits this field entirely (as do all pre-1.5 caches).
 */
export interface SourceIndexSidecars {
  /** Random id tying the core file to its exact sidecar generation. */
  storageId: string;
  /** Code-search snippets sidecar (`source-index.<id>.code.jsonl`). */
  code?: SidecarFileMeta;
  /** Call-edge sidecar (`source-index.<id>.calls.jsonl`). */
  calls?: SidecarFileMeta;
  /** Per-path byte-offset lookup (`source-index.<id>.lookup.json`). */
  lookup?: { file: string };
}

/**
 * Source index schema v1.0 - v1.5
 */
export interface SourceIndex {
  schemaVersion: "1.0" | "1.1" | "1.2" | "1.3" | "1.4" | "1.5";
  generatedAt: string;
  toolVersion: string;
  project: ProjectManifest;
  files: SourceIndexFile[];
  /** Deterministic hash of manifest inputs (package.json, tsconfig, lockfile). Absent = manifest-stale. */
  manifestHash?: string;
  /**
   * Git HEAD SHA at index time (Phase 3.1). Used by `indexing --health` to
   * report drift between the indexed snapshot and the current working tree.
   * Absent when the project root isn't a git repo.
   */
  gitHeadSha?: string;
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
  /** Sidecar layout metadata (schema 1.5 light cache mode only). */
  sidecars?: SourceIndexSidecars;
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
  /**
   * Cache layout (schema 1.5+). "light" (default) keeps the core
   * source-index.json compact and moves codeSearch/calls payloads to
   * JSONL sidecars; "full" inlines everything (debug/compat).
   */
  cacheMode?: "light" | "full";
  /**
   * Incremental cache validation strategy. "fast" (default) compares
   * size+mtime first and hashes only changed candidates; "strict"
   * hashes every file (pre-1.5 behavior).
   */
  validationMode?: "fast" | "strict";
}

/**
 * Project config extended with indexing options
 */
export interface ProjectConfigWithIndexing extends ProjectConfig {
  indexing?: IndexingConfig;
}

/**
 * Index health status returned by --health diagnostic
 */
export type IndexHealthStatus = "ok" | "missing" | "unreadable" | "stale";

/**
 * Index health output emitted by --health in JSON mode
 */
export interface IndexHealthOutput {
  status: IndexHealthStatus;
  schemaVersion: string;
  totalFiles: number;
  parseErrorRate: number;
  manifestHash: string;
  currentManifestHash: string;
  toolVersion: string;
  currentToolVersion: string;
  staleReasons: string[];
  changedFilesSample: string[];
  missingFilesSample: string[];
  /** Number of files recovered via fallback parser (optional parser telemetry; absent on older caches) */
  recoveredFiles?: number;
  /** Breakdown of files by parser mode (optional parser telemetry; absent on older caches) */
  parserModeBreakdown?: Record<ParserMode, number>;
  /** Count of files with hard parse errors (optional parser telemetry; absent on older caches) */
  parseErrorCount?: number;
  /** Suggested next commands based on parser recovery state */
  suggestedCommands?: string[];
  /**
   * Git HEAD SHA recorded at index time (Phase 3.1). Absent for caches
   * built before 3.1 or when the project root isn't a git repo.
   */
  gitHeadSha?: string;
  /**
   * Current git HEAD SHA at health-check time. When it differs from
   * `gitHeadSha`, the index reflects an older snapshot — incremental
   * rebuilds will still produce a correct index, but the user may want
   * to run `mp-sentinel indexing` to refresh.
   */
  currentGitHeadSha?: string;
  /**
   * True when both git HEAD SHAs are known and differ. Surfaces drift
   * without requiring the user to diff the JSON output by hand.
   */
  gitHeadDrift?: boolean;
  /** Cache layout reported by --health/--stats (schema 1.5+). */
  cacheMode?: "light" | "full" | "legacy";
  /** Light cache: sidecar files referenced by the core index. */
  sidecarsPresent?: boolean;
  /** Light cache: all referenced sidecars exist on disk. */
  sidecarsValid?: boolean;
  /** Core cache file size in bytes. */
  coreBytes?: number;
  /** Combined sidecar size in bytes. */
  sidecarBytes?: number;
  /** Number of files parsed via chunked-tree-sitter (optional aggregate chunk telemetry) */
  chunkedFiles?: number;
  /** Total chunk count across all chunked files (optional aggregate chunk telemetry) */
  totalChunks?: number;
  /** Total chunk-level warnings across all chunked files (optional aggregate chunk telemetry) */
  totalChunkWarnings?: number;
  /** Total chunk-boundary warnings across all chunked files (optional aggregate chunk telemetry) */
  totalChunkBoundaryWarnings?: number;
  /** Total actionable chunk warnings across all chunked files (optional aggregate chunk telemetry) */
  totalChunkActionableWarnings?: number;
  /** Size of each chunk in bytes (optional aggregate chunk telemetry) */
  chunkSize?: number;
}

/**
 * Cache validity information
 */
export interface CacheValidity {
  valid: boolean;
  staleFiles?: string[];
  missingFiles?: string[];
  modifiedFiles?: string[];
  schemaOutdated?: boolean;
}

/**
 * Skill profile for review context (same as in skills-generator)
 */
export type SkillProfile = "cli-tooling" | "node-service" | "react-next" | "react-spa" | "library";

/**
 * Unified tech profile carrying both the high-level SkillProfile
 * and the specific technologies detected, along with the signal source.
 */
export interface TechProfile {
  /** High-level project classification */
  profile: SkillProfile;
  /** Lowercase technology/package keywords, e.g. ["typescript", "react", "vitest", "express"] */
  technologies: string[];
  /** Which source provided the primary signal for this profile */
  source: "config" | "package-json" | "generic";
}

/**
 * Structured intelligence signal explaining why a signal exists in the review.
 * Each signal links a type, file, reason, and evidence so users and agents can
 * understand why a particular risk/concern was flagged.
 */
export interface ReviewIntelligenceSignal {
  /** Signal type */
  type: "public-api" | "risk" | "test-gap" | "dependency" | "call-impact";
  /** File path that triggered the signal */
  file: string;
  /** Human-readable explanation of why this signal was raised */
  reason: string;
  /** Supporting evidence (e.g., import count, package name, test association) */
  evidence: string;
  /** Confidence level: low | medium | high */
  confidence: "low" | "medium" | "high";
}

/**
 * Compact evidence summary for each intelligence signal.
 * Designed for auditability without adding token-heavy context.
 */
export interface EvidenceSummary {
  /** File path that triggered the signal */
  sourceFile: string;
  /** Signal type */
  signalType: "public-api" | "risk" | "test-gap" | "dependency" | "call-impact";
  /** Compact evidence (path, package, or count) */
  evidence: string;
}

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
  /** Intelligence signal types included in the context (backward compat) */
  includedSignals?: string[];
  /** Structured intelligence signal metadata (v1.4.0+) */
  intelligenceSignals?: ReviewIntelligenceSignal[];
  /** Compact evidence summaries for auditability (v1.15.0+) */
  evidenceSummary?: EvidenceSummary[];
  /** Suggested follow-up index-query commands (v1.16.0+) */
  suggestedCommands?: string[];
}

/**
 * Types of relations between files in the dependency graph
 */
export type RelationType =
  | "changed"
  | "import"
  | "dependent"
  | "caller"
  | "hub"
  | "public-api"
  | "test-gap"
  | "dependency"
  | "risk";

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
  /** Intelligence signal types included in the review context */
  includedSignals?: string[];
  /** Structured intelligence signal metadata (v1.4.0+) */
  intelligenceSignals?: ReviewIntelligenceSignal[];
  /** Compact evidence summaries for auditability (v1.15.0+) */
  evidenceSummary?: EvidenceSummary[];
  /** Suggested follow-up index-query commands (v1.16.0+) */
  suggestedCommands?: string[];
  /** MCP diagnostics (when MCP is enabled or has presets/servers configured) */
  mcp?: MCPDiagnostics;
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
  | "generic"
  // Phase 4.2 -- additional adapters
  | "aider"
  | "continue"
  | "roo"
  | "copilot"
  | "zed"
  | "jetbrains";

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
  /** Deterministic code style profile (no AI needed). Populated when index is available. */
  codeStyleProfile?: CodeStyleProfile | undefined;
  /** Clean-code policy thresholds from `createSkills.policies`. */
  policies?: CreateSkillsPolicies | undefined;
  /** Rule ids to omit from generated content (Phase 4.3 -- createSkills.disableRules). */
  disableRules?: readonly string[] | undefined;
}

/**
 * A single file to be written by an adapter
 */
export interface GeneratedSkillFile {
  outputPath: string;
  content: string;
}

/**
 * Output kind for an adapter — determines layout validation in quality gate.
 * - `skill`: produces a SKILL.md in a workspace skills directory (e.g. .agents/skills/)
 * - `rule`: produces a standalone rule file (e.g. .cursor/rules/)
 */
export type AdapterOutputKind = "skill" | "rule";

/**
 * Frontmatter requirements for skill-style adapters.
 */
export interface AdapterFrontmatterRules {
  /** Required top-level YAML keys (e.g. ["description"]) */
  required: string[];
  /** Optional but recommended YAML keys */
  optional?: string[];
}

/**
 * Official adapter specification — each adapter must declare these fields
 * with values sourced from official agent/IDE documentation.
 */
export interface AdapterSpec {
  /** URL to official docs that confirm this layout */
  officialDocsUrl: string;
  /** Whether this adapter produces skills or rules */
  outputKind: AdapterOutputKind;
  /** Workspace path template. Use {projectName} placeholder. */
  workspacePath: string;
  /** Required file names relative to workspace path (e.g. ["SKILL.md"]) */
  requiredFiles: string[];
  /** YAML frontmatter validation rules */
  frontmatterRules: AdapterFrontmatterRules;
  /** Max total size in characters for all generated files (0 = no limit) */
  sizeLimit: number;
}

/**
 * Adapter interface — each supported AI agent/IDE implements this
 */
export interface AgentAdapter {
  id: AgentAdapterId;
  label: string;
  /** Official adapter spec for layout validation */
  spec: AdapterSpec;
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
  /** Quality gate report (v1.0.14+) */
  quality?: QualityReport | undefined;
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
/**
 * Language profile detected from the codebase file list.
 */
export interface LanguageProfile {
  dominant: string;
  secondary: string[];
  distribution: Record<string, number>;
  indexableShare: number;
  nonIndexableHotspots: string[];
}

/**
 * Code style profile detected from the codebase.
 */
export interface CodeStyleProfile {
  indent: "tab" | "2-spaces" | "4-spaces" | "mixed" | "unknown";
  singleQuoteRatio: number;
  semicolonRatio: number;
  p50FileLines: number;
  p95FileLines: number;
  maxFileLines: number;
  trailingNewlineRatio: number;
  formatterConfigs: string[];
  svelteImportOutsideScriptRatio: number;
  oversizedFiles: Array<{ path: string; lines: number }>;
}

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
  /** Project-specific rules loaded from .mp-sentinelrc.json */
  projectRules: string[];
  /** Language mix detected from codebase */
  languageMix?: LanguageProfile;
  /** Code style profile detected from actual files */
  codeStyleProfile?: CodeStyleProfile;
  /** Clean-code policy config */
  policies?: CreateSkillsPolicies;
  /** Secret-scrubbed code samples (max 5, max 40 lines each) */
  codeSamples?: Array<{ path: string; content: string; __scrubbed?: boolean }>;
  /** Observed anti-patterns detected during style analysis */
  observedAntiPatterns?: string[];
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
  /** Per-language rules (AI-enriched, grounded in code samples) */
  rulesByLanguage?: Record<string, string[]>;
  /** Clean-code rules suggested by AI */
  cleanCodeRules?: string[];
  /** Detected anti-patterns with file paths and fix suggestions */
  antiPatterns?: Array<{
    pattern: string;
    files: string[];
    fix: string;
  }>;
  /** Style enforcement rules derived from code samples */
  styleEnforcement?: string[];
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
  type: "cli" | "public-api" | "config" | "command" | "app" | "route";
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
  /** Number of production source files using this dependency */
  sourceFileCount: number;
  /** Number of test/spec files using this dependency */
  testFileCount: number;
  /** Number of example/tooling files using this dependency */
  exampleFileCount: number;
  /** Dominant usage category */
  usageKind: "runtime" | "test" | "mixed";
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
  /** Detected agent instruction files (v1.0.16+) */
  instructionFiles?: string[];
  /** Project-authored review rules from `.mp-sentinelrc.json` `rules` (deterministic pass-through) */
  projectRules?: string[];
  /** Project-authored rule file paths from `.mp-sentinelrc.json` `ruleFiles` */
  projectRuleFiles?: string[];
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
  /** Quality gate report (v1.0.14+) */
  quality?: QualityReport | undefined;
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
  /** Quality gate report (v1.0.14+). Present in all modes. */
  quality?: QualityReport | undefined;
}

// ── Legacy Migration types (v1.0.18+) ──────────────────────────────────────

/** A legacy generated file detected at a pre-v1.0.17 path. */
export interface LegacyFileInfo {
  /** Path to the legacy generated file */
  path: string;
  /** Which adapter generated the file */
  agent: AgentAdapterId;
  /** The current adapter that supersedes it */
  supersededBy: AgentAdapterId;
  /** Suggested action for the user */
  suggestion: string;
}

// ── Quality Gate types ──────────────────────────────────────────────────────

/** A single quality check result from the skill quality gate */
export interface QualityCheck {
  /** Check type identifier: max-file-size, required-section, required-references, duplicate-section, empty-section, unknown-path, missing-real-signal, agent-workflow-contract, adapter-layout-contract, risky-unicode */
  type: string;
  /** Error = fails --check; warning = informational only */
  severity: "error" | "warning";
  /** The generated file path that triggered the check */
  file: string;
  /** Human-readable description of the issue */
  message: string;
}

/** Report from the deterministic skill quality gate */
export interface QualityReport {
  /** True when there are zero errors (warnings do not cause failure) */
  passed: boolean;
  /** All checks performed */
  checks: QualityCheck[];
  /** Count of error-severity checks */
  errors: number;
  /** Count of warning-severity checks */
  warnings: number;
}

// ── Explain Agents types (v1.6.0+) ──────────────────────────────────────────

/** A single agent entry in the explain-agents diagnostic output */
export interface ExplainAgentEntry {
  id: AgentAdapterId;
  label: string;
  /** Whether the adapter's detect() returned true */
  detected: boolean;
  /** Whether this adapter would be selected by default (no --agent / --all-agents) */
  selected: boolean;
  /** Which paths/signals triggered detection */
  detectionSignals: string[];
  /** Output kind from adapter spec */
  outputKind: AdapterOutputKind;
  /** Workspace path template from adapter spec (with {projectName} placeholder) */
  workspacePath: string;
  /** Resolved output path with projectName substituted */
  resolvedOutput: string;
  /** Official docs URL from adapter spec */
  officialDocsUrl: string;
}

/** Top-level output of the explain-agents diagnostic */
export interface ExplainAgentsOutput {
  projectName: string;
  defaultSelection: AgentAdapterId[];
  agents: ExplainAgentEntry[];
}

// ── Doctor Diagnostic types (v1.7.0+) ─────────────────────────────────────────

/** Overall health status for the --doctor diagnostic */
export type DoctorStatus = "ok" | "action-required" | "error";

/** Source index cache status for the doctor diagnostic */
export type DoctorIndexStatus = "ok" | "missing" | "unreadable" | "stale";

/** Source index cache info reported by --doctor */
export interface DoctorIndexInfo {
  status: DoctorIndexStatus;
  schemaVersion?: string;
  totalFiles?: number;
  manifestHash?: string;
  reason?: string;
  /** Fraction of files with parse errors (0-1) */
  parseErrorRate?: number;
  /** Files recovered via fallback parser (chunked-tree-sitter, ascii-fallback, or lexical-fallback, no parse errors) */
  recoveredFiles?: number;
  /** Per-mode file count breakdown (tree-sitter / chunked-tree-sitter / ascii-fallback / lexical-fallback) */
  parserModeBreakdown?: Record<string, number>;
  /** Count of files with hard parse errors */
  parseErrorCount?: number;
  /** Sample of file paths with hard parse errors (max 3, sorted) */
  hardParseErrorFilesSample?: string[];
  /** Suggested next commands for drilldown when parser issues exist */
  suggestedCommands?: string[];
  /** Number of chunked files (optional aggregate chunk telemetry; present when chunked files exist) */
  chunkedFiles?: number;
  /** Total chunk count across all chunked files (optional aggregate chunk telemetry) */
  totalChunks?: number;
  /** Total chunk-level warnings across all chunked files (optional aggregate chunk telemetry) */
  totalChunkWarnings?: number;
  /** Total chunk-boundary warnings across all chunked files (optional aggregate chunk telemetry) */
  totalChunkBoundaryWarnings?: number;
  /** Total actionable chunk warnings across all chunked files (optional aggregate chunk telemetry) */
  totalChunkActionableWarnings?: number;
  /** Size of each chunk in bytes (optional aggregate chunk telemetry) */
  chunkSize?: number;
}

/** Bootstrap script availability status */
export type DoctorScriptStatus = "available" | "missing";

/** A single bootstrap script entry in the doctor output */
export interface DoctorScriptInfo {
  name: string;
  status: DoctorScriptStatus;
  description: string;
}

/** Per-adapter skill file status reported by --doctor */
export type DoctorSkillStatus = "up-to-date" | "stale" | "missing" | "wrong-agent" | "unverifiable";

/** Per-adapter skills check result in --doctor output */
export interface DoctorSkillInfo {
  agent: AgentAdapterId;
  label: string;
  status: DoctorSkillStatus;
  files: SkillsCheckFile[];
  quality?: QualityReport;
}

/** A single categorized finding from the doctor diagnostic */
export interface DoctorActionEntry {
  label: string;
  action: string;
  commands?: string[];
}

// ── Doctor AI Enrichment Cache types (v1.13.0+) ──────────────────────────────

/** AI enrichment cache status for the doctor diagnostic */
export type DoctorAIEnrichmentCacheStatus = "available" | "missing" | "unreadable";

/** AI enrichment cache info reported by --doctor */
export interface DoctorAIEnrichmentCacheInfo {
  status: DoctorAIEnrichmentCacheStatus;
  path: string;
  entries: number;
  bytes: number;
  reason?: string;
}

// ── Doctor AI Enrichment Readiness types (v1.19.0+) ──────────────────────────

/** AI enrichment readiness status for the doctor diagnostic */
export type DoctorAIEnrichmentReadinessStatus = "disabled" | "ready" | "action-required";

/** AI enrichment readiness info reported by --doctor */
export interface DoctorAIEnrichmentReadinessInfo {
  enabled: boolean;
  provider?: string;
  model?: string;
  apiKeyPresent: boolean;
  status: DoctorAIEnrichmentReadinessStatus;
  reason?: string;
}

/** Top-level output of the --doctor diagnostic */
export interface DoctorOutput {
  status: DoctorStatus;
  projectName: string;
  agents: ExplainAgentEntry[];
  index: DoctorIndexInfo;
  skills: DoctorSkillInfo[];
  legacyFiles: LegacyFileInfo[];
  scripts: DoctorScriptInfo[];
  aiEnrichmentCache: DoctorAIEnrichmentCacheInfo;
  aiEnrichment: DoctorAIEnrichmentReadinessInfo;
  recommendedActions: string[];
  recommendedCommands: string[];
}
