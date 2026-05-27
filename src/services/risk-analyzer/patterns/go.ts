/**
 * Go-specific risk patterns (Phase 2.3).
 */

import type { LanguageRiskPattern } from "./types.js";

export const GO_RISK_PATTERNS: LanguageRiskPattern[] = [
  {
    category: "security",
    confidence: "high",
    label: "exec.Command with /bin/sh -c",
    // Catches: exec.Command("sh", "-c", ...) / exec.CommandContext(ctx, "/bin/sh", "-c", ...)
    regex:
      /\bexec\.(?:Command|CommandContext)\s*\([^)]*?["'`](?:\/?(?:bin\/)?(?:sh|bash|zsh))["'`]\s*,\s*["'`]-c["'`]/g,
    message:
      "exec.Command with `sh -c` defeats Go's safer arg-list invocation and creates a command-injection surface.",
    suggestion:
      'Call the program directly with separate args, e.g. exec.Command("ls", "-la", dir).',
    severity: "CRITICAL",
  },
  {
    category: "security",
    confidence: "medium",
    label: "unsafe.Pointer outside FFI",
    regex: /\bunsafe\.Pointer\b/g,
    message:
      "unsafe.Pointer bypasses Go's memory-safety guarantees. Used outside cgo/FFI it commonly produces crashes or memory corruption.",
    suggestion:
      "Restrict unsafe.Pointer to a narrow FFI boundary. Prefer safe conversions via standard library helpers.",
    severity: "WARNING",
  },
  {
    category: "security",
    confidence: "medium",
    label: "crypto/md5 in security context",
    regex: /\bcrypto\/md5\b/g,
    message:
      "MD5 is broken for any authentication or signing use. Acceptable only for non-security checksums (e.g. cache keys).",
    suggestion: "Use crypto/sha256 (or crypto/hmac) for any auth-related hash.",
    severity: "WARNING",
  },
  {
    category: "performance",
    confidence: "medium",
    label: "http.Client without timeout",
    // http.Client{} struct literal with no Timeout field — pattern catches
    // empty literal and any literal that doesn't mention Timeout.
    regex: /\bhttp\.Client\s*\{\s*\}/g,
    message: "http.Client{} with no Timeout will hang forever on unresponsive remote services.",
    suggestion: "Always set http.Client{Timeout: time.X * time.Second}.",
    severity: "WARNING",
  },
];
