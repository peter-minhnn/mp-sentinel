/**
 * PHP-specific risk patterns (Phase 2.3).
 */

import type { LanguageRiskPattern } from "./types.js";

export const PHP_RISK_PATTERNS: LanguageRiskPattern[] = [
  {
    category: "security",
    confidence: "high",
    label: "PHP eval()",
    regex: /(?<![.\w])eval\s*\(/g,
    message: "eval() executes arbitrary PHP code — historically the #1 root cause of PHP RCEs.",
    suggestion: "Refactor to a constrained dispatch table or template engine.",
    severity: "CRITICAL",
  },
  {
    category: "security",
    confidence: "high",
    label: "unserialize on user input",
    regex: /\bunserialize\s*\(\s*\$(?:_GET|_POST|_REQUEST|_COOKIE|_FILES)\b/g,
    message: "unserialize() on user input executes magic methods and is a classic PHP RCE chain.",
    suggestion: "Use json_decode() with assoc=true, or a typed DTO library.",
    severity: "CRITICAL",
  },
  {
    category: "security",
    confidence: "high",
    label: "extract() on superglobal",
    regex: /\bextract\s*\(\s*\$(?:_GET|_POST|_REQUEST|_COOKIE|GLOBALS)\b/g,
    message:
      "extract() turns array keys into local variables — letting users overwrite any local variable in scope.",
    suggestion: "Read fields explicitly: $name = $_POST['name'] ?? null;",
    severity: "CRITICAL",
  },
  {
    category: "security",
    confidence: "high",
    label: "include / require with superglobal",
    regex: /\b(?:include|require)(?:_once)?\s*(?:\(|\s)\s*\$(?:_GET|_POST|_REQUEST|_COOKIE)\b/g,
    message:
      "include/require with a user-controlled path enables Local/Remote File Inclusion (LFI/RFI).",
    suggestion: "Allowlist the include paths or map IDs to known files.",
    severity: "CRITICAL",
  },
  {
    category: "security",
    confidence: "medium",
    label: "shell_exec / passthru / system",
    regex: /\b(?:shell_exec|passthru|system|exec|popen)\s*\(/g,
    message:
      "Direct shell execution. If any argument is user-influenced this is command injection.",
    suggestion: "Use escapeshellarg() / escapeshellcmd() and prefer typed APIs over shell.",
    severity: "WARNING",
  },
];
