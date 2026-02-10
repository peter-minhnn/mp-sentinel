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
import { log } from "../utils/logger.js";
import { formatBytes } from "../utils/parser.js";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface SecretPattern {
  /** Human-readable label shown in logs */
  name: string;
  /** Regex used to detect the secret */
  pattern: RegExp;
}

export interface SanitizationResult {
  /** The sanitized (redacted) content */
  content: string;
  /** Number of secrets that were redacted */
  redactedCount: number;
  /** Names of the pattern categories that matched */
  matchedPatterns: string[];
}

export interface SuspiciousKeyword {
  /** The keyword that was detected */
  keyword: string;
  /** 1-based line number */
  line: number;
  /** Surrounding context (trimmed) */
  context: string;
}

export interface PayloadFileSummary {
  /** Relative file path */
  path: string;
  /** Character count of the file content */
  characters: number;
  /** Estimated token count (chars / 4 heuristic) */
  estimatedTokens: number;
}

export interface PayloadSummary {
  /** Total number of files to be sent */
  fileCount: number;
  /** Per-file breakdown */
  files: PayloadFileSummary[];
  /** Total character count across all files */
  totalCharacters: number;
  /** Total estimated token count */
  totalEstimatedTokens: number;
  /** Formatted human-readable total size */
  formattedSize: string;
  /** Suspicious keywords found in file contents */
  warnings: SuspiciousKeyword[];
}

// ──────────────────────────────────────────────────────────────────────────────
// Redaction placeholder
// ──────────────────────────────────────────────────────────────────────────────

const REDACTION_MARKER = "<REDACTED_SECRET>";

// ──────────────────────────────────────────────────────────────────────────────
// Secret patterns
//
// Each regex is designed to catch the most common shape of a secret while
// minimising false positives.  We deliberately keep the list extensible so
// consumers can add project-specific patterns.
// ──────────────────────────────────────────────────────────────────────────────

const DEFAULT_SECRET_PATTERNS: SecretPattern[] = [
  // ── AWS ────────────────────────────────────────────────────────────────
  {
    name: "AWS Access Key ID",
    pattern: /(?<![A-Za-z0-9/+=])AKIA[0-9A-Z]{16}(?![A-Za-z0-9/+=])/g,
  },
  {
    name: "AWS Secret Access Key",
    pattern:
      /(?:aws_secret_access_key|aws_secret_key|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*["']?([A-Za-z0-9/+=]{40})["']?/gi,
  },

  // ── Google Cloud / Firebase ────────────────────────────────────────────
  {
    name: "Google Cloud API Key",
    pattern: /AIza[0-9A-Za-z_-]{35}/g,
  },
  {
    name: "Google OAuth Client Secret",
    pattern:
      /(?:client_secret|GOOGLE_CLIENT_SECRET)\s*[=:]\s*["']?([A-Za-z0-9_-]{24,})["']?/gi,
  },

  // ── Private Key Blocks ────────────────────────────────────────────────
  {
    name: "PEM Private Key",
    pattern:
      /-----BEGIN\s(?:RSA\s)?PRIVATE\sKEY-----[\s\S]*?-----END\s(?:RSA\s)?PRIVATE\sKEY-----/g,
  },
  {
    name: "PEM Certificate (private)",
    pattern:
      /-----BEGIN\sEC\sPRIVATE\sKEY-----[\s\S]*?-----END\sEC\sPRIVATE\sKEY-----/g,
  },

  // ── Database connection strings ────────────────────────────────────────
  {
    name: "Database Connection String (URI)",
    pattern:
      /(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|mssql|redis|amqp|rabbitmq):\/\/[^\s'"}{)]+/gi,
  },
  {
    name: "Database Connection String (env)",
    pattern:
      /(?:DATABASE_URL|DB_CONNECTION|MONGO_URI|REDIS_URL|DATABASE_URI)\s*[=:]\s*["']?[^\s'"]+["']?/gi,
  },

  // ── Bearer / Auth Tokens ──────────────────────────────────────────────
  {
    name: "Bearer Token",
    pattern: /Bearer\s+[A-Za-z0-9_\-.~+/]+=*/g,
  },

  // ── Generic API keys / secrets ────────────────────────────────────────
  {
    name: "Generic API Key assignment",
    pattern:
      /(?:api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token|secret[_-]?key|private[_-]?key|encryption[_-]?key)\s*[=:]\s*["']([A-Za-z0-9_\-./+=]{16,})["']/gi,
  },
  {
    name: "Generic Secret env variable",
    pattern:
      /(?:SECRET|TOKEN|PASSWORD|CREDENTIAL|AUTH)[A-Z_]*\s*[=:]\s*["']([^"']{8,})["']/gi,
  },

  // ── JWT ────────────────────────────────────────────────────────────────
  {
    name: "JSON Web Token",
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g,
  },

  // ── GitHub / GitLab Tokens ────────────────────────────────────────────
  {
    name: "GitHub Personal Access Token",
    pattern: /ghp_[A-Za-z0-9]{36}/g,
  },
  {
    name: "GitHub OAuth Access Token",
    pattern: /gho_[A-Za-z0-9]{36}/g,
  },
  {
    name: "GitLab Token",
    pattern: /glpat-[A-Za-z0-9_-]{20,}/g,
  },

  // ── Slack ──────────────────────────────────────────────────────────────
  {
    name: "Slack Webhook / Token",
    pattern: /xox[bpors]-[0-9]{10,}-[A-Za-z0-9-]+/g,
  },

  // ── Stripe ─────────────────────────────────────────────────────────────
  {
    name: "Stripe Secret Key",
    pattern: /sk_(?:live|test)_[A-Za-z0-9]{24,}/g,
  },
];

// ──────────────────────────────────────────────────────────────────────────────
// Suspicious keywords (Layer 3 warnings)
//
// These are NOT secrets themselves, but their presence in variable names
// or comments can indicate that a human should double-check the payload.
// ──────────────────────────────────────────────────────────────────────────────

const SUSPICIOUS_KEYWORDS: string[] = [
  "password",
  "passwd",
  "secret",
  "credential",
  "private_key",
  "privatekey",
  "access_token",
  "accesstoken",
  "api_key",
  "apikey",
  "auth_token",
  "authtoken",
  "encryption_key",
  "master_key",
  "signing_key",
];

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
   *
   * The function iterates over every registered pattern, replaces matches,
   * and returns both the cleaned string and metadata about what was found.
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
   *
   * Returns the sanitized files **and** a cumulative report of all
   * redactions performed.
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
   * Generate a human-readable payload summary so the user can verify exactly
   * what will be sent to the AI provider.
   *
   * @param filePaths  - Absolute or project-relative paths to the files
   * @param cwd        - Working directory for resolving relative paths
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
        const tokens = Math.ceil(chars / 4); // rough GPT-style token estimate

        files.push({
          path: filePath,
          characters: chars,
          estimatedTokens: tokens,
        });

        totalCharacters += chars;

        // Scan for suspicious keywords in this file
        const fileWarnings = this.detectSuspiciousKeywords(content, filePath);
        allWarnings.push(...fileWarnings);
      } catch {
        // If we cannot read the file, skip it in the summary
        log.warning(`Could not read file for summary: ${filePath}`);
      }
    }

    const totalEstimatedTokens = Math.ceil(totalCharacters / 4);

    return {
      fileCount: files.length,
      files,
      totalCharacters,
      totalEstimatedTokens,
      formattedSize: formatBytes(totalCharacters),
      warnings: allWarnings,
    };
  }

  /**
   * Generate a summary from already-loaded file contents (avoids re-reading
   * from disk when the caller already holds the data).
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

    const totalEstimatedTokens = Math.ceil(totalCharacters / 4);

    return {
      fileCount: fileSummaries.length,
      files: fileSummaries,
      totalCharacters,
      totalEstimatedTokens,
      formattedSize: formatBytes(totalCharacters),
      warnings: allWarnings,
    };
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
   * Scan content line-by-line for suspicious keywords that might indicate
   * leftover secret references (e.g. variable names like `dbPassword`).
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
          // Only report each keyword once per line
          break;
        }
      }
    }

    return warnings;
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
