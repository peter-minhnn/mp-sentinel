/**
 * Rust-specific risk patterns (Phase 2.3).
 */

import type { LanguageRiskPattern } from "./types.js";

export const RUST_RISK_PATTERNS: LanguageRiskPattern[] = [
  {
    category: "runtime-crash",
    confidence: "medium",
    label: "Result/Option unwrap() outside tests",
    // .unwrap() at the end of a statement. The MATCH_FILTERS layer
    // (in risk-analyzer/index.ts) suppresses this for files under
    // test/spec/__tests__ paths.
    regex: /\.unwrap\s*\(\s*\)\s*[;?]/g,
    message: ".unwrap() panics on None/Err. In non-test code this is a crash-on-bad-input bug.",
    suggestion: "Use ? for propagation, or pattern-match with a recovery branch.",
    severity: "WARNING",
  },
  {
    category: "security",
    confidence: "high",
    label: "mem::transmute",
    regex: /\bstd::mem::transmute|\bmem::transmute/g,
    message:
      "std::mem::transmute is one of the most dangerous functions in Rust — wrong sizes/representations produce UB.",
    suggestion:
      "Use safer conversions: .to_ne_bytes(), bytemuck::cast, or explicit safe casts where possible.",
    severity: "CRITICAL",
  },
  {
    category: "security",
    confidence: "medium",
    label: "unsafe block",
    // Suppressed in known-FFI files via MATCH_FILTERS (path contains
    // `ffi`, `sys`, `bindings`).
    regex: /\bunsafe\s*\{/g,
    message:
      "unsafe block invokes UB if any invariant is violated. Each one needs a SAFETY: comment justifying every invariant.",
    suggestion: "Add a // SAFETY: ... comment explaining why each invariant holds.",
    severity: "INFO",
  },
];
