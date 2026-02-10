/**
 * FileHandler - Smart File Filtering (The Ignore Layer)
 *
 * Layer 1: Determines which files are eligible to be sent to the AI provider
 * by applying three cascading filters:
 *
 *   1. **Ignore rules** – `.gitignore` + `.archignore` (project-specific)
 *   2. **Extension allowlist** – only source-code extensions pass through
 *   3. **Sensitive file blocklist** – hard-blocked regardless of other rules
 *
 * The module uses `fast-glob` for high-performance traversal and the `ignore`
 * package for gitignore-compatible pattern matching.
 */

import fg from "fast-glob";
import ignore, { type Ignore } from "ignore";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, relative, basename, extname } from "node:path";
import { log } from "../utils/logger.js";

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

const DEFAULT_MAX_FILE_SIZE = 500 * 1024; // 500 KB

/**
 * Extension allowlist — only files with these extensions are eligible.
 * Lowercase, without the leading dot.
 */
const ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set([
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
  // Dockerfile (handled by filename blocklist separately)
]);

/**
 * Hard-blocked filenames and patterns.
 *
 * These are ALWAYS excluded even if the extension is allowed and the file
 * is not in `.gitignore`.  The check is performed against the **basename**
 * (filename + extension) and uses simple glob-style matching.
 */
const BLOCKED_FILE_PATTERNS: readonly string[] = [
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
const BLOCKED_DIRECTORIES: readonly string[] = [
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

// ──────────────────────────────────────────────────────────────────────────────
// FileHandler class
// ──────────────────────────────────────────────────────────────────────────────

export class FileHandler {
  private readonly cwd: string;
  private readonly allowedExtensions: Set<string>;
  private readonly blockedPatterns: string[];
  private readonly maxFileSize: number;
  private readonly disableGitIgnore: boolean;
  private readonly disableArchIgnore: boolean;

  private ignoreFilter: Ignore | null = null;

  constructor(options: FileHandlerOptions = {}) {
    this.cwd = resolve(options.cwd ?? process.cwd());
    this.maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
    this.disableGitIgnore = options.disableGitIgnore ?? false;
    this.disableArchIgnore = options.disableArchIgnore ?? false;

    // Build the merged extension set
    this.allowedExtensions = new Set(ALLOWED_EXTENSIONS);
    if (options.extraAllowedExtensions) {
      for (const ext of options.extraAllowedExtensions) {
        this.allowedExtensions.add(ext.replace(/^\./, "").toLowerCase());
      }
    }

    // Build the merged blocked patterns list
    this.blockedPatterns = [...BLOCKED_FILE_PATTERNS];
    if (options.extraBlockedPatterns) {
      this.blockedPatterns.push(...options.extraBlockedPatterns);
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * Walk the project tree and return the filtered set of files.
   *
   * Pipeline:
   *   fast-glob (respects .gitignore dirs) →
   *   ignore filter (.gitignore + .archignore rules) →
   *   extension allowlist →
   *   sensitive file blocklist
   */
  async discoverFiles(): Promise<FileFilterResult> {
    // 1. Initialise ignore rules (async, reads files once)
    await this.initIgnoreFilter();

    // 2. Glob all files, already skipping blocked directories
    const globIgnore = BLOCKED_DIRECTORIES.map((d) => `**/${d}/**`);
    const allFiles = await fg("**/*", {
      cwd: this.cwd,
      dot: true, // include dotfiles so we can explicitly filter them
      onlyFiles: true,
      absolute: false, // relative paths from cwd
      ignore: globIgnore,
      followSymbolicLinks: false,
      suppressErrors: true,
    });

    // 3. Filter & classify each file
    const accepted: string[] = [];
    const rejected: Array<{ path: string; reason: string }> = [];
    const byReason: Record<string, number> = {};

    const reject = (path: string, reason: string): void => {
      rejected.push({ path, reason });
      byReason[reason] = (byReason[reason] ?? 0) + 1;
    };

    for (const relPath of allFiles) {
      // 3a. Ignore filter (.gitignore + .archignore)
      if (this.ignoreFilter && this.ignoreFilter.ignores(relPath)) {
        reject(relPath, "ignored (.gitignore / .archignore)");
        continue;
      }

      // 3b. Extension allowlist
      if (!this.isAllowedExtension(relPath)) {
        reject(relPath, "extension not in allowlist");
        continue;
      }

      // 3c. Sensitive file blocklist
      if (this.isBlockedFile(relPath)) {
        reject(relPath, "blocked (sensitive file)");
        continue;
      }

      accepted.push(relPath);
    }

    // Sort for deterministic output
    accepted.sort();
    rejected.sort((a, b) => a.path.localeCompare(b.path));

    const result: FileFilterResult = {
      accepted,
      rejected,
      stats: {
        total: allFiles.length,
        accepted: accepted.length,
        rejected: rejected.length,
        byReason,
      },
    };

    return result;
  }

  /**
   * Filter a pre-existing list of file paths (e.g. from `git diff`) through
   * the same security pipeline.
   */
  filterPaths(paths: string[]): FileFilterResult {
    const accepted: string[] = [];
    const rejected: Array<{ path: string; reason: string }> = [];
    const byReason: Record<string, number> = {};

    const reject = (path: string, reason: string): void => {
      rejected.push({ path, reason });
      byReason[reason] = (byReason[reason] ?? 0) + 1;
    };

    for (const filePath of paths) {
      const relPath = relative(this.cwd, resolve(this.cwd, filePath));

      if (this.ignoreFilter && this.ignoreFilter.ignores(relPath)) {
        reject(relPath, "ignored (.gitignore / .archignore)");
        continue;
      }

      if (!this.isAllowedExtension(relPath)) {
        reject(relPath, "extension not in allowlist");
        continue;
      }

      if (this.isBlockedFile(relPath)) {
        reject(relPath, "blocked (sensitive file)");
        continue;
      }

      accepted.push(relPath);
    }

    accepted.sort();
    rejected.sort((a, b) => a.path.localeCompare(b.path));

    return {
      accepted,
      rejected,
      stats: {
        total: paths.length,
        accepted: accepted.length,
        rejected: rejected.length,
        byReason,
      },
    };
  }

  /**
   * Pretty-print the filter result to the console.
   */
  printFilterResult(result: FileFilterResult): void {
    log.header("🔒 File Filter Report");

    console.log(`  Total scanned:  ${result.stats.total}`);
    console.log(`  ✅ Accepted:    ${result.stats.accepted}`);
    console.log(`  ❌ Rejected:    ${result.stats.rejected}`);

    if (Object.keys(result.stats.byReason).length > 0) {
      log.divider();
      console.log("  Rejection breakdown:");
      for (const [reason, count] of Object.entries(result.stats.byReason)) {
        console.log(`    • ${reason}: ${count}`);
      }
    }

    if (result.stats.accepted > 0) {
      log.divider();
      console.log("  Accepted files:");
      for (const path of result.accepted) {
        console.log(`    📄 ${path}`);
      }
    }

    log.divider();
  }

  // ── Filter helpers ─────────────────────────────────────────────────────

  /**
   * Check whether the file extension is on the allowlist.
   */
  private isAllowedExtension(filePath: string): boolean {
    const ext = extname(filePath).replace(/^\./, "").toLowerCase();
    if (!ext) return false; // no extension → not allowed
    return this.allowedExtensions.has(ext);
  }

  /**
   * Check whether the file matches any blocked pattern.
   *
   * Matching is done against the **basename** (e.g. `.env.local`, `id_rsa`)
   * using simple glob-style rules:
   *   - `*` matches any sequence of characters (not path separators)
   *   - Literal comparison otherwise
   */
  private isBlockedFile(filePath: string): boolean {
    const name = basename(filePath);

    for (const pattern of this.blockedPatterns) {
      if (this.matchGlob(name, pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Minimal glob matcher supporting `*` wildcards only.
   * Sufficient for the filename-based patterns we use.
   */
  private matchGlob(value: string, pattern: string): boolean {
    // Escape regex special chars except `*`, then replace `*` with `.*`
    const regexStr =
      "^" +
      pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") +
      "$";
    return new RegExp(regexStr, "i").test(value);
  }

  // ── Ignore rule initialisation ─────────────────────────────────────────

  /**
   * Build the combined `ignore` instance from `.gitignore` + `.archignore`.
   */
  private async initIgnoreFilter(): Promise<void> {
    const ig = ignore();
    let hasRules = false;

    // .gitignore
    if (!this.disableGitIgnore) {
      const gitignorePath = resolve(this.cwd, ".gitignore");
      const gitRules = await this.readIgnoreFile(gitignorePath);
      if (gitRules) {
        ig.add(gitRules);
        hasRules = true;
      }
    }

    // .archignore (custom ignore file for Code Architect)
    if (!this.disableArchIgnore) {
      const archignorePath = resolve(this.cwd, ".archignore");
      const archRules = await this.readIgnoreFile(archignorePath);
      if (archRules) {
        ig.add(archRules);
        hasRules = true;
        log.info("Loaded .archignore rules");
      }
    }

    this.ignoreFilter = hasRules ? ig : null;
  }

  /**
   * Safely read an ignore file and return its contents, or `null`.
   */
  private async readIgnoreFile(filePath: string): Promise<string | null> {
    if (!existsSync(filePath)) return null;

    try {
      const content = await readFile(filePath, "utf-8");
      return content;
    } catch {
      log.warning(`Could not read ignore file: ${filePath}`);
      return null;
    }
  }
}
