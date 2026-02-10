/**
 * SecurityService - Secret Scrubbing & Transparency Layer
 *
 * Layer 2: Detects and redacts potential secrets (AWS keys, GCP keys,
 *          private key blocks, DB connection strings, bearer tokens, etc.)
 *          from file contents BEFORE they leave the machine.
 *
 * Layer 3: Generates a transparent payload summary for dry-run mode so the
 *          user can inspect exactly what will be sent to the AI provider.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { log } from "../../utils/logger.js";
import { formatBytes } from "../../utils/parser.js";
import {
  REDACTION_MARKER,
  DEFAULT_SECRET_PATTERNS,
  SUSPICIOUS_KEYWORDS,
} from "./patterns.js";
import type {
  SecretPattern,
  SanitizationResult,
  SuspiciousKeyword,
  PayloadFileSummary,
  PayloadSummary,
} from "./patterns.js";

// Re-export types for consumers
export type {
  SecretPattern,
  SanitizationResult,
  SuspiciousKeyword,
  PayloadFileSummary,
  PayloadSummary,
} from "./patterns.js";

// ──────────────────────────────────────────────────────────────────────────────
// SecurityService class
// ──────────────────────────────────────────────────────────────────────────────

export class SecurityService {
  private readonly patterns: SecretPattern[];

  constructor(extraPatterns?: SecretPattern[]) {
    // Clone the default patterns so each instance is independent, then append
    // any caller-supplied extras.
    this.patterns = [
      ...DEFAULT_SECRET_PATTERNS.map((p) => ({
        name: p.name,
        pattern: new RegExp(p.pattern.source, p.pattern.flags),
      })),
      ...(extraPatterns ?? []),
    ];
  }

  // ── Layer 2 – Secret Scrubbing ──────────────────────────────────────────

  /**
   * Sanitize a string by replacing all detected secrets with `<REDACTED_SECRET>`.
   */
  sanitizeContent(content: string): SanitizationResult {
    let sanitized = content;
    let totalRedacted = 0;
    const matchedPatterns: string[] = [];

    for (const { name, pattern } of this.patterns) {
      // Reset lastIndex for global regexes between files
      pattern.lastIndex = 0;

      const matches = sanitized.match(pattern);
      if (matches && matches.length > 0) {
        totalRedacted += matches.length;
        matchedPatterns.push(name);
        sanitized = sanitized.replace(pattern, REDACTION_MARKER);
        // Reset again after replacement
        pattern.lastIndex = 0;
      }
    }

    return {
      content: sanitized,
      redactedCount: totalRedacted,
      matchedPatterns,
    };
  }

  /**
   * Sanitize an array of file entries in bulk.
   */
  sanitizeFiles(files: Array<{ path: string; content: string }>): {
    sanitizedFiles: Array<{ path: string; content: string }>;
    totalRedacted: number;
    redactionReport: Array<{
      path: string;
      redactedCount: number;
      matchedPatterns: string[];
    }>;
  } {
    const sanitizedFiles: Array<{ path: string; content: string }> = [];
    const redactionReport: Array<{
      path: string;
      redactedCount: number;
      matchedPatterns: string[];
    }> = [];
    let totalRedacted = 0;

    for (const file of files) {
      const result = this.sanitizeContent(file.content);
      sanitizedFiles.push({ path: file.path, content: result.content });

      if (result.redactedCount > 0) {
        totalRedacted += result.redactedCount;
        redactionReport.push({
          path: file.path,
          redactedCount: result.redactedCount,
          matchedPatterns: result.matchedPatterns,
        });
      }
    }

    if (totalRedacted > 0) {
      log.warning(
        `🔐 Redacted ${totalRedacted} potential secret(s) across ${redactionReport.length} file(s):`,
      );
      for (const entry of redactionReport) {
        log.file(
          `  ${entry.path}: ${entry.redactedCount} redaction(s) [${entry.matchedPatterns.join(", ")}]`,
        );
      }
    }

    return { sanitizedFiles, totalRedacted, redactionReport };
  }

  // ── Layer 3 – Transparency & Dry-Run ───────────────────────────────────

  /**
   * Generate a human-readable payload summary from file paths on disk.
   */
  async generatePayloadSummary(
    filePaths: string[],
    cwd: string = process.cwd(),
  ): Promise<PayloadSummary> {
    const files: PayloadFileSummary[] = [];
    let totalCharacters = 0;
    const allWarnings: SuspiciousKeyword[] = [];

    for (const filePath of filePaths) {
      try {
        const absolutePath = resolve(cwd, filePath);
        const content = await readFile(absolutePath, "utf-8");
        const chars = content.length;
        const tokens = Math.ceil(chars / 4);

        files.push({
          path: filePath,
          characters: chars,
          estimatedTokens: tokens,
        });
        totalCharacters += chars;

        allWarnings.push(...this.detectSuspiciousKeywords(content, filePath));
      } catch {
        log.warning(`Could not read file for summary: ${filePath}`);
      }
    }

    return this.buildSummary(files, totalCharacters, allWarnings);
  }

  /**
   * Generate a summary from already-loaded file contents (avoids re-reading).
   */
  generatePayloadSummaryFromContents(
    files: Array<{ path: string; content: string }>,
  ): PayloadSummary {
    const fileSummaries: PayloadFileSummary[] = [];
    let totalCharacters = 0;
    const allWarnings: SuspiciousKeyword[] = [];

    for (const file of files) {
      const chars = file.content.length;
      const tokens = Math.ceil(chars / 4);

      fileSummaries.push({
        path: file.path,
        characters: chars,
        estimatedTokens: tokens,
      });
      totalCharacters += chars;
      allWarnings.push(
        ...this.detectSuspiciousKeywords(file.content, file.path),
      );
    }

    return this.buildSummary(fileSummaries, totalCharacters, allWarnings);
  }

  /**
   * Pretty-print a PayloadSummary to the console for dry-run inspection.
   */
  printPayloadSummary(summary: PayloadSummary): void {
    log.header("📦 Payload Summary (Dry-Run)");

    console.log(`  Files:            ${summary.fileCount}`);
    console.log(
      `  Total Characters: ${summary.totalCharacters.toLocaleString()}`,
    );
    console.log(
      `  Est. Tokens:      ~${summary.totalEstimatedTokens.toLocaleString()}`,
    );
    console.log(`  Payload Size:     ${summary.formattedSize}`);

    log.divider();
    console.log("  Files to be sent:");
    for (const file of summary.files) {
      console.log(
        `    • ${file.path}  (${file.characters.toLocaleString()} chars, ~${file.estimatedTokens.toLocaleString()} tokens)`,
      );
    }

    if (summary.warnings.length > 0) {
      log.divider();
      log.warning(
        `⚠️  ${summary.warnings.length} suspicious keyword(s) detected — review recommended:`,
      );
      for (const w of summary.warnings) {
        log.file(`  ${w.keyword} → ${w.context}  (line ${w.line})`);
      }
    } else {
      log.divider();
      log.success("No suspicious keywords detected in payload.");
    }

    log.divider();
  }

  // ── Internals ──────────────────────────────────────────────────────────

  /**
   * Scan content line-by-line for suspicious keywords.
   */
  private detectSuspiciousKeywords(
    content: string,
    filePath: string,
  ): SuspiciousKeyword[] {
    const warnings: SuspiciousKeyword[] = [];
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lowerLine = line.toLowerCase();

      for (const keyword of SUSPICIOUS_KEYWORDS) {
        if (lowerLine.includes(keyword)) {
          warnings.push({
            keyword,
            line: i + 1,
            context: `${filePath}:${i + 1} → ${line.trim().slice(0, 120)}`,
          });
          break; // Only report each keyword once per line
        }
      }
    }

    return warnings;
  }

  /**
   * Build a PayloadSummary from computed data.
   */
  private buildSummary(
    files: PayloadFileSummary[],
    totalCharacters: number,
    warnings: SuspiciousKeyword[],
  ): PayloadSummary {
    return {
      fileCount: files.length,
      files,
      totalCharacters,
      totalEstimatedTokens: Math.ceil(totalCharacters / 4),
      formattedSize: formatBytes(totalCharacters),
      warnings,
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Convenience singleton
// ──────────────────────────────────────────────────────────────────────────────

let _instance: SecurityService | null = null;

/**
 * Return a lazily-created singleton `SecurityService`.
 * Call `resetSecurityService()` to clear (useful in tests).
 */
export const getSecurityService = (): SecurityService => {
  if (!_instance) {
    _instance = new SecurityService();
  }
  return _instance;
};

export const resetSecurityService = (): void => {
  _instance = null;
};
