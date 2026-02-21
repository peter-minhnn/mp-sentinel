/**
 * Security Types & Secret Patterns
 *
 * Defines all secret detection patterns and security-related types
 * used by the SecurityService for content sanitization.
 */

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

export const REDACTION_MARKER = "<REDACTED_SECRET>";

// ──────────────────────────────────────────────────────────────────────────────
// Secret patterns
//
// Each regex is designed to catch the most common shape of a secret while
// minimising false positives.  We deliberately keep the list extensible so
// consumers can add project-specific patterns.
// ──────────────────────────────────────────────────────────────────────────────

export const DEFAULT_SECRET_PATTERNS: SecretPattern[] = [
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
    pattern: /(?:client_secret|GOOGLE_CLIENT_SECRET)\s*[=:]\s*["']?([A-Za-z0-9_-]{24,})["']?/gi,
  },

  // ── Private Key Blocks ────────────────────────────────────────────────
  {
    name: "PEM Private Key",
    pattern:
      /-----BEGIN\s(?:RSA\s)?PRIVATE\sKEY-----[\s\S]*?-----END\s(?:RSA\s)?PRIVATE\sKEY-----/g,
  },
  {
    name: "PEM Certificate (private)",
    pattern: /-----BEGIN\sEC\sPRIVATE\sKEY-----[\s\S]*?-----END\sEC\sPRIVATE\sKEY-----/g,
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
    pattern: /(?:SECRET|TOKEN|PASSWORD|CREDENTIAL|AUTH)[A-Z_]*\s*[=:]\s*["']([^"']{8,})["']/gi,
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

export const SUSPICIOUS_KEYWORDS: readonly string[] = [
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
