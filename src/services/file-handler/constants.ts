/**
 * File Handler Constants
 *
 * Defines the extension allowlist, blocked file patterns, and blocked
 * directories used by FileHandler for smart file filtering.
 */

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface FileHandlerOptions {
  /** Project root directory (default: `process.cwd()`) */
  cwd?: string;
  /** Extra extensions to allow beyond the built-in list */
  extraAllowedExtensions?: string[];
  /** Extra filenames / patterns to block (glob-style) */
  extraBlockedPatterns?: string[];
  /** Disables `.gitignore` parsing (e.g. for testing) */
  disableGitIgnore?: boolean;
  /** Disables `.archignore` parsing */
  disableArchIgnore?: boolean;
  /** Maximum file size in bytes (default: 500 KB) */
  maxFileSize?: number;
}

export interface FileFilterResult {
  /** Files that passed all filters and may be sent to the AI */
  accepted: string[];
  /** Files that were rejected, with the reason */
  rejected: Array<{ path: string; reason: string }>;
  /** Summary stats */
  stats: {
    total: number;
    accepted: number;
    rejected: number;
    byReason: Record<string, number>;
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Defaults
// ──────────────────────────────────────────────────────────────────────────────

export const DEFAULT_MAX_FILE_SIZE = 500 * 1024; // 500 KB

/**
 * Extension allowlist — only files with these extensions are eligible.
 * Lowercase, without the leading dot.
 */
export const ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set([
  // JavaScript / TypeScript
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  // Config / data
  "json",
  "yaml",
  "yml",
  "toml",
  // Python
  "py",
  "pyi",
  // Go
  "go",
  // Rust
  "rs",
  // C / C++
  "c",
  "h",
  "cpp",
  "hpp",
  "cc",
  "hh",
  "cxx",
  // Java / Kotlin
  "java",
  "kt",
  "kts",
  // C#
  "cs",
  // Ruby
  "rb",
  // PHP
  "php",
  // Swift
  "swift",
  // Shell
  "sh",
  "bash",
  "zsh",
  // Dart / Flutter
  "dart",
  // Elixir / Erlang
  "ex",
  "exs",
  "erl",
  // Scala
  "scala",
  // Lua
  "lua",
  // SQL
  "sql",
  // Markdown / documentation
  "md",
  "mdx",
  // HTML / CSS
  "html",
  "htm",
  "css",
  "scss",
  "sass",
  "less",
  // Vue / Svelte
  "vue",
  "svelte",
  // GraphQL / Protobuf
  "graphql",
  "gql",
  "proto",
  // Terraform / HCL
  "tf",
  "hcl",
]);

/**
 * Hard-blocked filenames and patterns.
 * These are ALWAYS excluded even if the extension is allowed.
 */
export const BLOCKED_FILE_PATTERNS: readonly string[] = [
  // ── Environment / secret files ────────────────────────────────────────
  ".env",
  ".env.*",
  ".env.local",
  ".env.development",
  ".env.production",
  ".env.staging",
  ".env.test",

  // ── Cryptographic material ────────────────────────────────────────────
  "*.pem",
  "*.key",
  "*.cert",
  "*.crt",
  "*.p12",
  "*.pfx",
  "*.jks",
  "*.keystore",
  "id_rsa",
  "id_rsa.pub",
  "id_ed25519",
  "id_ed25519.pub",
  "id_dsa",
  "id_ecdsa",
  "*.pub",

  // ── Lock files / dependency manifests ─────────────────────────────────
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "composer.lock",
  "Gemfile.lock",
  "Pipfile.lock",
  "poetry.lock",
  "Cargo.lock",
  "go.sum",

  // ── Build artifacts & caches ──────────────────────────────────────────
  "*.min.js",
  "*.min.css",
  "*.map",
  "*.chunk.js",
  "*.bundle.js",

  // ── Credential / config files ─────────────────────────────────────────
  ".npmrc",
  ".pypirc",
  ".netrc",
  ".htpasswd",
  "credentials.json",
  "service-account*.json",
  "firebase-adminsdk*.json",
  "*.tfstate",
  "*.tfstate.backup",
  "terraform.tfvars",

  // ── Database / binary data ────────────────────────────────────────────
  "*.sqlite",
  "*.sqlite3",
  "*.db",
  "*.bak",

  // ── OS / editor ───────────────────────────────────────────────────────
  ".DS_Store",
  "Thumbs.db",
  "*.swp",
  "*.swo",
];

/**
 * Directory names that are always skipped during traversal.
 */
export const BLOCKED_DIRECTORIES: readonly string[] = [
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  "__pycache__",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  ".venv",
  "venv",
  "vendor",
  "target", // Rust / Java
  ".gradle",
  ".idea",
  ".vscode",
  "coverage",
  ".nyc_output",
  ".turbo",
  ".cache",
  "tmp",
];
