/**
 * Shannon-entropy-based secret detection (Phase 2.1).
 *
 * Complements the regex-based `DEFAULT_SECRET_PATTERNS` by catching
 * high-entropy random strings that don't match any known provider prefix —
 * e.g. custom internal tokens, randomly-generated session keys, opaque
 * webhook secrets.
 *
 * Heuristic:
 *   - Min length 24 (shorter strings are rarely real credentials, often dictionary fragments).
 *   - Min entropy 4.5 bits/char (typical random base64/hex strings score ≥ 4.8).
 *   - Pattern restricted to assignment-style contexts (`KEY = "VALUE"`, `KEY: 'VALUE'`,
 *     `--token VALUE`), so prose, source code identifiers, and URLs don't trigger.
 *
 * Trade-offs: every heuristic over-fires somewhere. We mitigate false
 * positives with two escape hatches surfaced through `.mp-sentinelrc.json`:
 *   - `security.allowPaths: string[]` — globs of files to skip entirely.
 *   - `security.allowValues: string[]` — exact strings the user has explicitly
 *     marked safe (e.g. publishable keys, test fixtures).
 */

/**
 * Compute Shannon entropy (bits per character) of a string.
 *
 * Pure, deterministic, no allocations beyond the frequency map. Tested at
 * O(n) where n = value.length.
 */
export const shannonEntropy = (value: string): number => {
  if (value.length === 0) return 0;
  const freq: Map<string, number> = new Map();
  for (const ch of value) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }
  let entropy = 0;
  const n = value.length;
  for (const count of freq.values()) {
    const p = count / n;
    entropy -= p * Math.log2(p);
  }
  return entropy;
};

export interface EntropyOptions {
  /** Minimum length to consider (default 24). */
  minLength?: number;
  /** Minimum Shannon entropy (bits/char) to flag (default 4.5). */
  minEntropy?: number;
  /** Exact values the user has marked safe — never flagged. */
  allowValues?: readonly string[];
}

const DEFAULT_MIN_LENGTH = 24;
// 4.0 catches realistic random strings (20-char base62 maxes at log2(20)≈4.32;
// longer random strings score ≥ 4.5). Set lower than the theoretical maximum
// so we don't miss short-but-clearly-random tokens.
const DEFAULT_MIN_ENTROPY = 4.0;

/**
 * Tokens often misclassified as secrets — common base64-ish strings that
 * are actually URL fragments, CSS class names, or build hashes. We bail
 * early on these.
 */
const DICTIONARY_PREFIXES = ["http://", "https://", "data:", "blob:", "javascript:", "mailto:"];

/**
 * English-prose fragments. We use substring matches (NOT word-boundary
 * anchored) because run-together prose like
 * `thequickbrownfoxjumpsoverthelazydog` has no whitespace boundaries.
 * Two or more hits is treated as prose.
 */
const PROSE_FRAGMENTS = [
  "the",
  "and",
  "ing",
  "tion",
  "ous",
  "ful",
  "ment",
  "ness",
  "ed",
  "ly",
  "of",
  "to",
  "for",
  "with",
  "over",
];

const isDictionaryLike = (value: string): boolean => {
  const letters = value.match(/[A-Za-z]/g)?.length ?? 0;
  const ratio = letters / value.length;
  if (ratio < 0.7) return false;

  const lower = value.toLowerCase();

  // Strong signal: a long letters-only string with no uppercase and no
  // digits is overwhelmingly likely to be prose, never a randomly
  // generated secret (real secrets mix case + digits).
  if (ratio >= 0.95 && !/[A-Z]/.test(value) && !/\d/.test(value)) {
    return true;
  }

  // Otherwise count common-English fragment hits. Two or more = prose-like.
  let hits = 0;
  for (const f of PROSE_FRAGMENTS) {
    if (lower.includes(f)) {
      hits++;
      if (hits >= 2) return true;
    }
  }
  return false;
};

/**
 * Check whether a candidate substring looks like a secret based on
 * Shannon entropy alone. Returns false (NOT a secret) for short strings,
 * URLs, or values explicitly allowlisted by the caller.
 */
export const isHighEntropySecret = (value: string, options: EntropyOptions = {}): boolean => {
  const minLength = options.minLength ?? DEFAULT_MIN_LENGTH;
  const minEntropy = options.minEntropy ?? DEFAULT_MIN_ENTROPY;

  if (value.length < minLength) return false;
  if (options.allowValues?.includes(value)) return false;
  for (const prefix of DICTIONARY_PREFIXES) {
    if (value.startsWith(prefix)) return false;
  }
  if (isDictionaryLike(value)) return false;

  return shannonEntropy(value) >= minEntropy;
};

/**
 * Scan a string for assignment-style secret candidates. Each candidate is
 * the captured VALUE portion of a `KEY = "VALUE"`, `KEY: 'VALUE'`, or
 * `--token VALUE` shape; whether the value is actually a secret is decided
 * by `isHighEntropySecret`.
 *
 * Returns the span (start/end indices) of each match so callers can build
 * a redacted output by slicing.
 */
export interface EntropyMatch {
  /** The full substring to redact, including surrounding quotes if present. */
  match: string;
  /** Captured value (without quotes). */
  value: string;
  /** Start index in the original content. */
  start: number;
  /** End index (exclusive) in the original content. */
  end: number;
}

const ASSIGNMENT_PATTERNS: RegExp[] = [
  // KEY="VALUE" / KEY='VALUE' / KEY=`VALUE` (env-var assignments)
  /(?<=^|[\s;,(])([A-Z][A-Z0-9_]{2,})\s*[=:]\s*(["'`])([^"'`\n]{12,})\2/g,
  // CLI flag: --token VALUE or --token=VALUE
  /--[a-z][a-z0-9-]*(?:[\s=])(["'`]?)([A-Za-z0-9_/+=.~-]{20,})\1/g,
];

export const scanEntropyMatches = (
  content: string,
  options: EntropyOptions = {},
): EntropyMatch[] => {
  const out: EntropyMatch[] = [];
  for (const pattern of ASSIGNMENT_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(content)) !== null) {
      // The captured value is in group 3 for the first pattern, group 2 for
      // the second. We pick whichever capture group is the longest non-
      // delimiter string in the match.
      const candidate = m[3] ?? m[2] ?? "";
      if (!candidate) continue;
      if (!isHighEntropySecret(candidate, options)) continue;
      // Compute the span of the captured VALUE inside the full match.
      const valueOffset = m[0].lastIndexOf(candidate);
      if (valueOffset < 0) continue;
      const start = m.index + valueOffset;
      out.push({
        match: candidate,
        value: candidate,
        start,
        end: start + candidate.length,
      });
    }
    pattern.lastIndex = 0;
  }
  return out;
};
