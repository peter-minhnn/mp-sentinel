/**
 * Type definitions for mp-sentinel CLI
 */

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
  patternMatchMode?: 'any' | 'all';
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
  gitProvider?: 'github' | 'gitlab';
  repoUrl?: string; // Optional
  projectId?: string; // For GitLab
  /** Local review mode configuration */
  localReview?: LocalReviewConfig;
}

export interface AuditIssue {
  line: number;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  message: string;
  suggestion: string;
}

export interface AuditResult {
  status: 'PASS' | 'FAIL';
  issues?: AuditIssue[];
  message?: string;
  suggestion?: string;
}

export interface FileAuditResult {
  filePath: string;
  result: AuditResult;
  duration: number;
}

export interface CLIOptions {
  files?: string[];
  commit?: boolean;
  bypass?: boolean;
  verbose?: boolean;
  maxConcurrency?: number;
  targetBranch?: string;
}

export const DEFAULT_CONFIG: Required<Omit<ProjectConfig, 'gitProvider' | 'repoUrl' | 'projectId' | 'localReview'>> & { localReview: LocalReviewConfig } = {
  techStack: '',
  rules: [],
  bypassKeyword: 'skip:',
  commitFormat: '',
  maxConcurrency: 5,
  cacheEnabled: true,
  localReview: {
    enabled: false,
    commitCount: 1,
    commitPatterns: [],
    filterByPattern: false,
    skipPatterns: [],
    includeMergeCommits: false,
    branchDiffMode: false,
    compareBranch: 'origin/main',
    patternMatchMode: 'any',
    verbosePatternMatching: false,
  },
};
