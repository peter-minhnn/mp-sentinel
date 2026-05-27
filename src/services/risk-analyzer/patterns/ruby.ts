/**
 * Ruby-specific risk patterns (Phase 2.3).
 */

import type { LanguageRiskPattern } from "./types.js";

export const RUBY_RISK_PATTERNS: LanguageRiskPattern[] = [
  {
    category: "security",
    confidence: "high",
    label: "Marshal.load",
    regex: /\bMarshal\.load\s*\(/g,
    message:
      "Marshal.load on untrusted input is an RCE vector — Ruby objects can execute methods on load.",
    suggestion: "Use JSON.parse or a typed schema like dry-struct.",
    severity: "CRITICAL",
  },
  {
    category: "security",
    confidence: "high",
    label: "YAML.load (Psych) without safe_load",
    // Catches YAML.load(...) but NOT YAML.safe_load(...) — Ruby < 3.1
    // YAML.load was unsafe by default.
    regex: /\bYAML\.load\s*\((?!.*safe_load)/g,
    message:
      "YAML.load on untrusted input deserializes arbitrary Ruby objects. Use YAML.safe_load.",
    suggestion: "Replace with YAML.safe_load(input).",
    severity: "CRITICAL",
  },
  {
    category: "security",
    confidence: "high",
    label: "Ruby eval()",
    regex: /(?<![.\w])eval\s*\(/g,
    message: "eval() runs arbitrary Ruby — a top-tier RCE vector if the string has user input.",
    suggestion: "Use a constrained DSL, or send/respond_to? with an explicit allowlist.",
    severity: "CRITICAL",
  },
  {
    category: "security",
    confidence: "medium",
    label: "Shell exec with interpolation",
    // Catches: system("ls #{user_input}"), `ls #{x}`, `Open3.popen3("cmd #{x}")`
    regex: /\b(?:system|exec|`|Open3\.(?:popen3|capture[23]))\s*[\(`]\s*[^,)`]*#\{/g,
    message:
      "Shell command containing string interpolation. Any interpolated user input becomes command injection.",
    suggestion:
      "Pass args as separate array elements: system('ls', user_input) — avoids the shell entirely.",
    severity: "CRITICAL",
  },
  {
    category: "security",
    confidence: "medium",
    label: "send/public_send with user input",
    regex: /\.\s*(?:public_)?send\s*\(\s*params\[/g,
    message:
      "send/public_send with user-controlled method name can invoke arbitrary public methods.",
    suggestion: "Allowlist the permitted method names and dispatch via case/when.",
    severity: "WARNING",
  },
];
