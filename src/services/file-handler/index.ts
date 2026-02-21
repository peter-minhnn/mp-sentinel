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
import { log } from "../../utils/logger.js";
import {
  ALLOWED_EXTENSIONS,
  BLOCKED_DIRECTORIES,
  BLOCKED_FILE_PATTERNS,
  DEFAULT_MAX_FILE_SIZE,
} from "./constants.js";
import type { FileHandlerOptions, FileFilterResult } from "./constants.js";

// Re-export types for consumers
export type { FileHandlerOptions, FileFilterResult } from "./constants.js";

// ──────────────────────────────────────────────────────────────────────────────
// FileHandler class
// ──────────────────────────────────────────────────────────────────────────────

export class FileHandler {
  private readonly cwd: string;
  private readonly allowedExtensions: Set<string>;
  private readonly blockedPatterns: string[];
  private readonly blockedRegexes: RegExp[];
  private readonly maxFileSize: number;
  private readonly disableGitIgnore: boolean;
  private readonly disableArchIgnore: boolean;

  private ignoreFilter: Ignore | null = null;
  private ignoreFilterInitialized = false;

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

    // Pre-compile blocked patterns into RegExp objects once (performance fix H-04)
    this.blockedRegexes = this.blockedPatterns.map(
      (p) =>
        new RegExp("^" + p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$", "i"),
    );
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
    await this.initIgnoreFilter();

    const globIgnore = BLOCKED_DIRECTORIES.map((d) => `**/${d}/**`);
    const allFiles = await fg("**/*", {
      cwd: this.cwd,
      dot: true,
      onlyFiles: true,
      absolute: false,
      ignore: globIgnore,
      followSymbolicLinks: false,
      suppressErrors: true,
    });

    return this.classifyFiles(allFiles);
  }

  /**
   * Filter a pre-existing list of file paths (e.g. from `git diff`) through
   * the same security pipeline.
   *
   * NOTE: This sync variant does not initialize ignore files.
   * Use `filterPathsWithIgnores` in runtime paths.
   */
  filterPaths(paths: string[]): FileFilterResult {
    const filePaths = paths.map((p) => relative(this.cwd, resolve(this.cwd, p)));
    return this.classifyFiles(filePaths);
  }

  /**
   * Filter a pre-existing list of file paths with `.gitignore`/`.archignore`
   * initialization included.
   */
  async filterPathsWithIgnores(paths: string[]): Promise<FileFilterResult> {
    await this.initIgnoreFilter();
    return this.filterPaths(paths);
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

  // ── Internal helpers ──────────────────────────────────────────────────

  /**
   * Classify a list of file paths into accepted and rejected.
   */
  private classifyFiles(filePaths: string[]): FileFilterResult {
    const accepted: string[] = [];
    const rejected: Array<{ path: string; reason: string }> = [];
    const byReason: Record<string, number> = {};

    const reject = (path: string, reason: string): void => {
      rejected.push({ path, reason });
      byReason[reason] = (byReason[reason] ?? 0) + 1;
    };

    for (const relPath of filePaths) {
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
        total: filePaths.length,
        accepted: accepted.length,
        rejected: rejected.length,
        byReason,
      },
    };
  }

  /**
   * Check whether the file extension is on the allowlist.
   */
  private isAllowedExtension(filePath: string): boolean {
    const ext = extname(filePath).replace(/^\./, "").toLowerCase();
    if (!ext) return false;
    return this.allowedExtensions.has(ext);
  }

  /**
   * Check whether the file matches any blocked pattern.
   * Uses pre-compiled RegExp objects for performance (fix H-04).
   */
  private isBlockedFile(filePath: string): boolean {
    const name = basename(filePath);
    return this.blockedRegexes.some((re) => re.test(name));
  }

  // ── Ignore rule initialisation ─────────────────────────────────────────

  /**
   * Build the combined `ignore` instance from `.gitignore` + `.archignore`.
   * Guarded to run only once per FileHandler instance (fix M-05).
   */
  private async initIgnoreFilter(): Promise<void> {
    if (this.ignoreFilterInitialized) return;
    this.ignoreFilterInitialized = true;
    const ig = ignore();
    let hasRules = false;

    if (!this.disableGitIgnore) {
      const gitRules = await this.readIgnoreFile(resolve(this.cwd, ".gitignore"));
      if (gitRules) {
        ig.add(gitRules);
        hasRules = true;
      }
    }

    if (!this.disableArchIgnore) {
      const archRules = await this.readIgnoreFile(resolve(this.cwd, ".archignore"));
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
      return await readFile(filePath, "utf-8");
    } catch {
      log.warning(`Could not read ignore file: ${filePath}`);
      return null;
    }
  }
}
