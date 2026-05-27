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
  // GCP service-account composite pattern comes BEFORE the generic PEM
  // pattern. Otherwise PEM would redact the inner private_key block on
  // its own pass, leaving the outer `private_key_id` field intact and
  // unrecognised by the GCP-specific matcher (Phase 2.2 fix).
  {
    name: "GCP Service Account private_key block",
    pattern:
      /"private_key_id"\s*:\s*"[a-f0-9]{20,}"[\s\S]{0,200}?"private_key"\s*:\s*"-----BEGIN[\s\S]*?-----END[\s\S]*?-----\\n?"/g,
  },
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

  // ── AI provider keys (Phase 2.2) ──────────────────────────────────────
  {
    name: "Anthropic API Key",
    // Format: sk-ant-api{NN}-… (admin keys use sk-ant-admin01-…). The
    // suffix is base62-with-underscores-and-hyphens, conventionally 93+ chars.
    pattern: /sk-ant-(?:api\d{2}|admin\d{2})-[A-Za-z0-9_-]{90,}/g,
  },
  {
    name: "OpenAI API Key",
    // Three accepted shapes:
    //   sk-{48,}              — legacy keys (48 base62 chars)
    //   sk-proj-{40,}         — project keys
    //   sk-svcacct-{40,}      — service-account keys
    // Anchored to a non-word boundary on the right so we don't match the
    // tail of a longer token. Stripe (`sk_(live|test)_…`) uses underscores
    // and is matched separately.
    pattern: /\bsk-(?:proj-[A-Za-z0-9_-]{40,}|svcacct-[A-Za-z0-9_-]{40,}|[A-Za-z0-9]{48,})\b/g,
  },

  // ── Azure ──────────────────────────────────────────────────────────────
  {
    name: "Azure Storage Connection String",
    pattern:
      /(?:DefaultEndpointsProtocol|AccountName|AccountKey|SharedAccessSignature|EndpointSuffix)\s*=\s*[^;\s"']+/gi,
  },
  {
    name: "Azure SAS Token",
    pattern: /[?&]sig=[A-Za-z0-9%]{20,}/g,
  },

  // ── Twilio ─────────────────────────────────────────────────────────────
  {
    name: "Twilio API Key",
    pattern: /\bSK[0-9a-fA-F]{32}\b/g,
  },
  {
    name: "Twilio Account SID",
    pattern: /\bAC[0-9a-fA-F]{32}\b/g,
  },

  // ── SendGrid ───────────────────────────────────────────────────────────
  {
    name: "SendGrid API Key",
    pattern: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/g,
  },

  // ── Datadog ────────────────────────────────────────────────────────────
  {
    name: "Datadog API/App Key",
    pattern: /\bdd[ap]_[A-Za-z0-9]{32,}\b/g,
  },

  // ── Postman ────────────────────────────────────────────────────────────
  {
    name: "Postman API Key",
    pattern: /PMAK-[A-Fa-f0-9]{24}-[A-Fa-f0-9]{34}/g,
  },

  // ── Shopify / Square (high-confidence shapes) ─────────────────────────
  {
    name: "Shopify Access Token",
    pattern: /\bshpat_[a-fA-F0-9]{32}\b/g,
  },
  {
    name: "Square Access Token",
    pattern: /\bEAAA[A-Za-z0-9_-]{60,}\b/g,
  },
  // (GCP Service Account private_key block is registered earlier — before
  // PEM Private Key — so its composite pattern can match the outer block
  // first. See the Private Key Blocks section above.)
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
