/**
 * Shared utility for normalizing Anthropic-compatible base URLs.
 * Used by both AIConfig and AnthropicProvider.
 */

const DEFAULT_ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

/**
 * Normalize an Anthropic-compatible base URL.
 *
 * - unset / empty -> "https://api.anthropic.com/v1/messages"
 * - trailing slash stripped
 * - "/v1/messages" kept as-is
 * - "/v1" -> "/v1/messages"
 * - any other http/https URL -> URL + "/v1/messages"
 */
export function normalizeAnthropicBaseUrl(url?: string): string {
  if (!url) return DEFAULT_ANTHROPIC_URL;

  const trimmed = url.replace(/\/+$/, "");

  if (trimmed.endsWith("/v1/messages")) return trimmed;
  if (trimmed.endsWith("/v1")) return trimmed + "/messages";

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed + "/v1/messages";
  }

  return trimmed;
}

/**
 * Validate that a custom base URL is a valid http/https URL.
 * Returns true for valid URLs, false otherwise.
 */
export function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
