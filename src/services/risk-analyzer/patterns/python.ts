/**
 * Python-specific risk patterns (Phase 2.3).
 *
 * Targets the most common code-execution and deserialization footguns
 * specific to Python's ecosystem. Each pattern is line-anchored and
 * conservative — we err on the side of false negatives over noise.
 */

import type { LanguageRiskPattern } from "./types.js";

export const PYTHON_RISK_PATTERNS: LanguageRiskPattern[] = [
  {
    category: "security",
    confidence: "high",
    label: "pickle.loads / cPickle.loads",
    regex: /\b(?:c?Pickle|pickle)\.loads?\s*\(/g,
    message:
      "pickle deserialization on untrusted input is a known RCE vector — any input controlled by a user can execute arbitrary code on load.",
    suggestion: "Use json.loads(), pydantic.parse_obj_as(), or a constrained schema instead.",
    severity: "CRITICAL",
  },
  {
    category: "security",
    confidence: "high",
    label: "yaml.load without SafeLoader",
    // yaml.load(x) without `Loader=yaml.SafeLoader` — captures both
    // `yaml.load(x)` and `yaml.load(x, Loader=yaml.Loader)`.
    regex:
      /\byaml\.load\s*\([^)]*?(?<!Safe)Loader\s*=\s*(?!yaml\.SafeLoader)[^)]*\)|\byaml\.load\s*\([^,)]+\)/g,
    message:
      "yaml.load() without SafeLoader can execute arbitrary Python objects encoded in the YAML document.",
    suggestion: "Use yaml.safe_load() or pass Loader=yaml.SafeLoader explicitly.",
    severity: "CRITICAL",
  },
  {
    category: "security",
    confidence: "high",
    label: "subprocess with shell=True",
    regex:
      /\b(?:subprocess|os)\.(?:run|call|check_call|check_output|Popen)\s*\([^)]*shell\s*=\s*True/g,
    message: "subprocess shell=True with any interpolated argument enables command injection.",
    suggestion: "Pass the command as a list (shell=False default) and validate every argument.",
    severity: "CRITICAL",
  },
  {
    category: "security",
    confidence: "high",
    label: "Python eval()",
    regex: /(?<![.\w])eval\s*\(/g,
    message:
      "eval() executes arbitrary Python expressions on untrusted strings — a top-tier RCE vector.",
    suggestion:
      "Use ast.literal_eval() for safe parsing, or a constrained dispatch table for known commands.",
    severity: "CRITICAL",
  },
  {
    category: "security",
    confidence: "high",
    label: "Python exec()",
    regex: /(?<![.\w])exec\s*\(/g,
    message: "exec() executes arbitrary Python statements — a top-tier RCE vector.",
    suggestion: "Refactor to a constrained dispatch or a domain-specific evaluator.",
    severity: "CRITICAL",
  },
  {
    category: "security",
    confidence: "medium",
    label: "os.system",
    regex: /\bos\.system\s*\(/g,
    message: "os.system() spawns a shell — vulnerable to argument injection.",
    suggestion: "Use subprocess.run([...], shell=False) with a list of arguments.",
    severity: "WARNING",
  },
  {
    category: "security",
    confidence: "medium",
    label: "Django mark_safe",
    regex: /\bmark_safe\s*\(/g,
    message:
      "mark_safe() disables Django's template auto-escaping. Calling it on user input is an XSS vector.",
    suggestion:
      "Render the value through Django's templating layer or sanitize with bleach before marking safe.",
    severity: "WARNING",
  },
];
