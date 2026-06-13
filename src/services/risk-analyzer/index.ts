/**
 * ReviewRiskAnalyzer — deterministic pre-AI scanner
 *
 * Scans sanitized diff inputs for dangerous patterns before the AI review.
 * Produces local findings that are merged with AI findings.
 * CRITICAL local findings always cause review failure, even when AI is enabled.
 *
 * Patterns are grouped by category matching the AuditIssue category rubric:
 *   security, runtime-crash, architecture, dependency-version,
 *   test-gap, performance, maintainability
 */

import type { AuditIssue, FileAuditResult } from "../../types/index.js";
import { PYTHON_RISK_PATTERNS } from "./patterns/python.js";
import { GO_RISK_PATTERNS } from "./patterns/go.js";
import { RUST_RISK_PATTERNS } from "./patterns/rust.js";
import { PHP_RISK_PATTERNS } from "./patterns/php.js";
import { RUBY_RISK_PATTERNS } from "./patterns/ruby.js";

// ── Pattern definitions ────────────────────────────────────────────────────

export interface RiskPattern {
  category: string;
  confidence: "high" | "medium";
  /** Human-readable label */
  label: string;
  /** Regex applied line-by-line against the content */
  regex: RegExp;
  /** Message template. Use $1, $2, etc. for capture groups. */
  message: string;
  /** Suggestion template. Use $1, $2, etc. for capture groups. */
  suggestion?: string;
  /** Severity override — default is WARNING */
  severity?: "CRITICAL" | "WARNING" | "INFO";
  /** When true, the regex spans multiple lines and is applied to full content (not per line) */
  multiLine?: boolean;
}

// ── Security patterns ──────────────────────────────────────────────────────

const SECURITY_PATTERNS: RiskPattern[] = [
  // Dangerous HTML injection in client components
  {
    category: "security",
    confidence: "high",
    label: "dangerouslySetInnerHTML",
    regex: /dangerouslySetInnerHTML\s*=/g,
    message:
      "dangerouslySetInnerHTML exposes the application to XSS attacks. Consider using safe rendering or sanitizing HTML input.",
    suggestion:
      "Use a sanitization library (e.g., DOMPurify) or safe React patterns instead of dangerouslySetInnerHTML.",
    severity: "CRITICAL",
  },
  {
    category: "security",
    confidence: "high",
    label: "innerHTML assignment",
    regex: /\.innerHTML\s*=/g,
    message:
      "Direct innerHTML assignment is an XSS vector. Use textContent or safe DOM APIs instead.",
    suggestion: "Use .textContent for text, or sanitize input before setting innerHTML.",
    severity: "CRITICAL",
  },
  // Direct eval / Function constructor
  {
    category: "security",
    confidence: "high",
    label: "eval usage",
    regex: /(?<![.\w])eval\s*\(/g,
    message:
      "eval() executes arbitrary code and is a code injection vector. Avoid dynamic code execution.",
    suggestion: "Use safer alternatives like JSON.parse for JSON, or a proper expression parser.",
    severity: "CRITICAL",
  },
  {
    category: "security",
    confidence: "high",
    label: "Function constructor",
    regex: /new\s+Function\s*\(/g,
    message:
      "new Function() creates dynamic functions from strings and is a code injection vector.",
    suggestion: "Use predefined functions or a safe evaluation library instead.",
    severity: "CRITICAL",
  },
  // Wildcard CORS with credentials
  {
    category: "security",
    confidence: "high",
    label: "Wildcard CORS with credentials",
    regex:
      /(?:Access-Control-Allow-Origin|['"]Access-Control-Allow-Origin['"])\s*[,=:]\s*['"]?\*['"]?\s*(?:[\s\S]{0,200})?(?:Access-Control-Allow-Credentials|['"]Access-Control-Allow-Credentials['"])\s*[,=:]\s*['"]?true['"]?/gi,
    message:
      "Wildcard CORS origin with credentials enabled exposes authenticated endpoints to any origin.",
    suggestion: "Use an explicit allowed origin list instead of '*' when credentials are enabled.",
    severity: "CRITICAL",
    multiLine: true,
  },
  {
    category: "security",
    confidence: "medium",
    label: "Open redirect",
    regex: /res\.(?:redirect|redirectTo)\s*\(\s*req\.(?:query|params|body)\./g,
    message: "Unvalidated redirect based on user input can be used for phishing attacks.",
    suggestion: "Validate the redirect target against an allowlist of URLs.",
    severity: "WARNING",
  },
  // SQL injection via string concatenation
  // Three detection strategies:
  //   1) SQL keyword + `+` concat within 100 chars  e.g. "SELECT ... " + userId
  //   2) Unsafe raw DB API: $queryRawUnsafe, executeRawUnsafe
  //   3) execute/query() with template interpolation or string concat
  {
    category: "security",
    confidence: "medium",
    label: "SQL string concatenation",
    regex:
      /(?:\b(?:SELECT|INSERT|UPDATE|DELETE)\b[\s\S]{0,100}?\+\s*|(?:\w+\.)?\$?(?:query|execute)RawUnsafe\s*\(|\.(?:execute|query)\s*\(\s*`[\s\S]{0,200}?(?:\$\{|['"]\s*\+))/gi,
    message: "SQL query built via string concatenation may be vulnerable to SQL injection.",
    suggestion: "Use parameterized queries or an ORM with prepared statements.",
    severity: "CRITICAL",
  },
  // Path traversal (Phase 2.4: scoped to runtime path/fs APIs to avoid
  // matching every relative import statement). The pattern requires the
  // `../` to appear inside a known filesystem call (fs.*, path.*, readFile,
  // writeFile, createReadStream, etc.) OR inside a template string used by
  // such a call. Keeps a real signal while dropping the noise from
  // `import "../foo"` and `require("../bar")`.
  {
    category: "security",
    confidence: "medium",
    label: "Path traversal in fs/path call",
    regex:
      /\b(?:fs|fsPromises|fsp|path)\.[A-Za-z_$][\w$]*\s*\([^)]*\.\.\/|\b(?:readFile|writeFile|readFileSync|writeFileSync|createReadStream|createWriteStream|open|openSync|stat|statSync|lstat|lstatSync|access|accessSync|unlink|unlinkSync|rmdir|rmdirSync|mkdir|mkdirSync|rename|renameSync|copyFile|copyFileSync|sendFile|download|attachment)\s*\([^)]*\.\.\//g,
    message:
      "Path traversal sequences ('../') passed to a filesystem or HTTP send API. Ensure user-controlled path segments are validated.",
    suggestion: "Use path.resolve() and validate against an allowlist of permitted directories.",
    severity: "WARNING",
  },
];

// ── Runtime crash patterns ──────────────────────────────────────────────────

const CRASH_PATTERNS: RiskPattern[] = [
  // Non-null assertion on potentially null values
  // Uses (?!\s*=) negative lookahead to avoid matching != / !==
  // Uses [a-zA-Z_$]\w* instead of \w+ to avoid matching Tailwind numeric suffixes (e.g. text-red-500!)
  // Uses positive lookahead to ensure ! is in a TS post-expression position, not sentence/string punctuation
  {
    category: "runtime-crash",
    confidence: "medium",
    label: "Non-null assertion",
    regex: /(?:[a-zA-Z_$]\w*(?:\.\w+)*(?:\[\d+\])?)\s*!(?!\s*=)(?=[.,;:)\]}\s]|$)/g,
    message:
      "Non-null assertion (!) bypasses TypeScript strict null checks and can cause runtime crashes if the value is nullish.",
    suggestion: "Add explicit null checks or optional chaining (?.) instead of non-null assertion.",
    severity: "WARNING",
  },
  // Unsafe property access on potentially undefined
  {
    category: "runtime-crash",
    confidence: "medium",
    label: "Unsafe optional chain bypass",
    regex: /\.\w+\s*\!\s*\./g,
    message:
      "Non-null assertion after a property access bypasses undefined checks and may crash at runtime.",
    suggestion: "Use optional chaining (?.) and nullish coalescing (??) for safe property access.",
    severity: "WARNING",
  },
  // parseInt without radix (Phase 2.4: downgraded to INFO + test/fixture
  // files are filtered out via MATCH_FILTERS to reduce noise). Modern
  // engines no longer interpret leading-zero as octal, so this is more of
  // a hygiene hint than a bug.
  {
    category: "runtime-crash",
    confidence: "medium",
    label: "parseInt without radix",
    regex: /\bparseInt\s*\(\s*[^,)]+\s*\)/g,
    message:
      "parseInt() called without a radix. Modern engines default to 10, but explicit is safer and matches lint rules.",
    suggestion: "Always provide the radix: parseInt(value, 10).",
    severity: "INFO",
  },
];

// ── Architecture patterns ──────────────────────────────────────────────────

const ARCHITECTURE_PATTERNS: RiskPattern[] = [
  // Direct console.log in production code (Node services)
  {
    category: "architecture",
    confidence: "medium",
    label: "Console.log in production code",
    regex: /(?<![.\w])console\.(?:log|debug|trace)\s*\(/g,
    message: "console.log/debug/trace in non-test files suggests debug code left in production.",
    suggestion: "Use a structured logger with configurable log levels for production code.",
    severity: "INFO",
  },
  // Hardcoded URLs / environment-dependent values
  {
    category: "architecture",
    confidence: "medium",
    label: "Hardcoded URL",
    regex: /https?:\/\/localhost[^\s"')\]]*/g,
    message:
      "Hardcoded localhost URL detected. Ensure this is replaced with a configurable value for deployment.",
    suggestion: "Use environment variables or configuration for service URLs.",
    severity: "INFO",
  },
];

// ── Performances patterns ──────────────────────────────────────────────────

const PERFORMANCE_PATTERNS: RiskPattern[] = [
  // Array/object spread in hot loops
  {
    category: "performance",
    confidence: "medium",
    label: "Array/Object spread in loop",
    regex: /(?:for|while)\s*\([^)]*\)\s*\{[^}]{0,500}(?:\.\.\.\w+\s*[,;}])/g,
    message:
      "Spread operator in a loop creates new objects on every iteration — consider mutation or accumulating in a single allocation.",
    suggestion: "Build the result with push/append inside the loop and spread once after.",
    severity: "INFO",
  },
];

// ── Combine all patterns ──────────────────────────────────────────────────

const ALL_RISK_PATTERNS: RiskPattern[] = [
  ...SECURITY_PATTERNS,
  ...CRASH_PATTERNS,
  ...ARCHITECTURE_PATTERNS,
  ...PERFORMANCE_PATTERNS,
];

// ── Language-specific patterns (Phase 2.3) ────────────────────────────────

/**
 * Map a file path extension to its language-specific pattern pack.
 * Returns `[]` for languages with no extra patterns; the universal
 * `ALL_RISK_PATTERNS` always applies on top of these.
 */
const getLanguageRiskPatterns = (filePath: string): RiskPattern[] => {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "py":
    case "pyi":
      return PYTHON_RISK_PATTERNS;
    case "go":
      return GO_RISK_PATTERNS;
    case "rs":
      return RUST_RISK_PATTERNS;
    case "php":
      return PHP_RISK_PATTERNS;
    case "rb":
      return RUBY_RISK_PATTERNS;
    default:
      return [];
  }
};

// ── Exported analyzer ──────────────────────────────────────────────────────

/**
 * Parsed line from a unified diff, with target-file line number.
 */
interface ParsedDiffLine {
  targetLine: number;
  content: string;
}

/**
 * Parse unified diff content and extract only added lines.
 * Removed lines (-) and diff headers are skipped.
 * Returns the parsed lines with their target-file line numbers (1-based).
 * When content is not a diff, returns all lines as-is for backward compat.
 */
const parseDiffContent = (
  content: string,
): { lines: ParsedDiffLine[]; contextLines: ParsedDiffLine[]; isDiff: boolean } => {
  const rawLines = content.split("\n");

  // Detect if this is unified diff format
  const isDiff = rawLines.some(
    (l) => l.startsWith("diff --git") || l.startsWith("--- ") || l.startsWith("@@ -"),
  );

  if (!isDiff) {
    // Raw source — treat every line as-is (backward compat for tests)
    return {
      lines: rawLines.map((l, i) => ({ targetLine: i + 1, content: l })),
      contextLines: rawLines.map((l, i) => ({ targetLine: i + 1, content: l })),
      isDiff: false,
    };
  }

  // Parse unified diff: extract only added lines (+ prefix)
  const lines: ParsedDiffLine[] = [];
  const contextLines: ParsedDiffLine[] = [];
  let hunkOffset = 0;

  for (const rawLine of rawLines) {
    if (rawLine.startsWith("@@ ")) {
      // Hunk header: @@ -a,b +c,d @@
      const m = rawLine.match(/@@\s+-\d+(?:,\d+)?\s\+(\d+)(?:,\d+)?\s+@@/);
      if (m) {
        hunkOffset = parseInt(m[1]!, 10);
      }
      continue;
    }

    // Skip diff metadata lines and "\ No newline at end of file"
    if (
      rawLine.startsWith("diff --git") ||
      rawLine.startsWith("index ") ||
      rawLine.startsWith("--- ") ||
      rawLine.startsWith("+++ ") ||
      rawLine.startsWith("\\ ")
    ) {
      continue;
    }

    if (rawLine.startsWith("+")) {
      // Added line — include with current hunk offset
      const line = { targetLine: hunkOffset, content: rawLine.slice(1) };
      lines.push(line);
      contextLines.push(line);
      hunkOffset++;
    } else if (rawLine.startsWith("-")) {
      // Removed line — skip entirely
      continue;
    } else if (rawLine.startsWith(" ")) {
      // Context line — usable for import context but not scanned for issues
      contextLines.push({ targetLine: hunkOffset, content: rawLine.slice(1) });
      hunkOffset++;
      continue;
    }
    // Trailing content (malformed diff) — skip
  }

  return { lines, contextLines, isDiff: true };
};

/**
 * Build a scan text from added diff lines, preserving small target-file gaps
 * but inserting long barriers for large gaps to prevent multi-line regexes
 * (with a 200-char window) from falsely matching across distant hunks.
 *
 * Returns the scan text and a lookup to map scan-line indices to target-file
 * line numbers.
 */
const MAX_UNOBSERVED_GAP_LINES = 5;
const MULTILINE_BARRIER_SIZE = 201; // enough to break [\s\S]{0,200} windows

const buildAddedScanText = (
  parsedLines: ParsedDiffLine[],
): { text: string; targetLineAt: (scanLineIndex: number) => number } => {
  if (parsedLines.length === 0) return { text: "", targetLineAt: () => 1 };

  const lineNumberMap: number[] = [];
  const parts: string[] = [];

  for (let i = 0; i < parsedLines.length; i++) {
    const line = parsedLines[i]!;

    if (i > 0) {
      const prev = parsedLines[i - 1]!;
      const gap = line.targetLine - prev.targetLine - 1;
      if (gap > MAX_UNOBSERVED_GAP_LINES) {
        // Large gap: insert enough blank lines to break the multi-line regex
        // window. Each blank line contributes one \n in the joined text.
        // MULTILINE_BARRIER_SIZE + 1 = 202 \n between content, > 200-char limit.
        for (let b = 0; b < MULTILINE_BARRIER_SIZE; b++) {
          parts.push("");
          lineNumberMap.push(line.targetLine - gap + b);
        }
      } else {
        // Small gap: insert individual blank lines for nearby hunks
        for (let g = 0; g < gap; g++) {
          parts.push("");
          lineNumberMap.push(prev.targetLine + 1 + g);
        }
      }
    }

    parts.push(line.content);
    lineNumberMap.push(line.targetLine);
  }

  return {
    text: parts.join("\n"),
    targetLineAt: (scanLineIndex: number): number => lineNumberMap[scanLineIndex] ?? 1,
  };
};

export interface FileAnalysis {
  path: string;
  issues: AuditIssue[];
  localSeverityCounts: {
    critical: number;
    warning: number;
    info: number;
  };
}

export interface RiskAnalysisResult {
  files: FileAnalysis[];
  totalCritical: number;
  totalWarning: number;
  totalInfo: number;
  /** True if any file has CRITICAL local findings */
  hasCriticalFindings: boolean;
}

/**
 * Check if file path matches test or example patterns.
 */
const isTestOrExamplePath = (filePath: string): boolean =>
  /(?:\/|^)(?:__tests__|test|spec|examples?)\/|\.(?:test|spec|stories)\.(?:ts|js|tsx|jsx)$/.test(
    filePath,
  );

/**
 * Per-pattern match filters to reduce false positives.
 * Return false to suppress a match. Keyed by pattern label.
 */
const MATCH_FILTERS: Record<string, (line: string, filePath: string) => boolean> = {
  // Skip lines where ! is inside a className/class attribute value (Tailwind important modifier)
  "Non-null assertion": (line) => {
    if (/\bclass(?:Name)?\s*=/.test(line)) return false;
    // Skip pure comment lines (// or JSDoc * lines)
    if (/^\s*(?:\/\/|\*)/.test(line)) return false;
    // Skip bare JSX text content — lines with no TS constructs (no operators, no keywords).
    // Real non-null assertions always appear in an expression/statement context.
    if (
      !/[=;{}()[\]]/.test(line) &&
      !/\b(?:const|let|var|return|throw|await|yield|export|import|type|interface)\b/.test(line)
    )
      return false;
    return true;
  },
  "SQL string concatenation": (line, filePath) => {
    // Skip test, spec, and stories files — they use component/library names that may coincidentally match SQL keywords
    if (isTestOrExamplePath(filePath)) return false;
    // Skip comment lines (JSDoc or inline)
    if (/^\s*(?:\/\/|\*)/.test(line)) return false;
    // Skip tagged template literals: sql`...`, Prisma.sql`...`, prisma.$queryRaw`...`
    if (/(?:sql|Prisma\.sql|prisma\.\$queryRaw|prisma\.\$executeRaw)\s*`/.test(line)) return false;
    // Skip logger/console template strings
    if (/(?:log|logger|console)\.\w+\s*`/.test(line)) return false;
    // Skip formatting/report template strings
    if (/\b(?:report|markdown|format|html)\s*`/.test(line)) return false;
    return true;
  },
  "Path traversal in fs/path call": (line) => {
    // The regex itself already scopes to fs/path API calls, but we still
    // suppress matches inside import/require/from/export module specifiers
    // that happen to mention fs.* or readFile in adjacent code (rare).
    if (/['"`]\.\.\//.test(line) && /\b(?:import|export|require|from)\b/.test(line)) return false;
    return true;
  },
  "Console.log in production code": (_line, filePath) => {
    // Skip for test/example files
    return !isTestOrExamplePath(filePath);
  },
  "parseInt without radix": (line, filePath) => {
    // Phase 2.4: noise reducer.
    if (isTestOrExamplePath(filePath)) return false;
    // Skip when a second argument is present on the SAME line. The previous
    // check (`[^,)]+,`) could not see past nested parens in the first
    // argument — `parseInt(String(x ?? ''), 10)` was flagged even though the
    // radix is right there (field-tested false positive). Greedy `.*` accepts
    // nested calls; a numeric literal or identifier radix both count.
    // Conservative by design: one radix-bearing call on the line suppresses
    // the hint for that line — missing a hint is fine, a wrong hint is not.
    if (/\bparseInt\s*\(.*,\s*[\w$]+\s*\)/.test(line)) return false;
    return true;
  },
  // Phase 2.3 — Rust pack filters
  "Result/Option unwrap() outside tests": (_line, filePath) => {
    return !isTestOrExamplePath(filePath);
  },
  "unsafe block": (_line, filePath) => {
    // Skip in FFI / sys / bindings modules where `unsafe` is expected.
    const lower = filePath.toLowerCase();
    if (/(?:^|\/)(?:ffi|sys|bindings|libc)\//.test(lower)) return false;
    if (/-sys\//.test(lower)) return false;
    return !isTestOrExamplePath(filePath);
  },
};

interface ChildProcessBindings {
  namedExec: Set<string>;
  namespaces: Set<string>;
}

const CHILD_PROCESS_MODULE = String.raw`(?:node:)?child_process`;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const addNamedChildProcessBinding = (bindings: ChildProcessBindings, specifier: string): void => {
  const trimmed = specifier.trim();
  if (!trimmed) return;

  const asParts = trimmed.split(/\s+as\s+/);
  const colonParts = trimmed.split(/\s*:\s*/);
  const imported = (asParts[0] ?? colonParts[0] ?? "").trim();
  const local = (asParts[1] ?? colonParts[1] ?? imported).trim();

  if ((imported === "exec" || imported === "execSync") && /^[A-Za-z_$][\w$]*$/.test(local)) {
    bindings.namedExec.add(local);
  }
};

const collectChildProcessBindings = (lines: ParsedDiffLine[]): ChildProcessBindings => {
  const bindings: ChildProcessBindings = {
    namedExec: new Set(["execSync"]),
    namespaces: new Set(["child_process"]),
  };

  for (const line of lines) {
    const content = line.content;

    const namedImport = content.match(
      new RegExp(`\\bimport\\s*\\{([^}]+)\\}\\s*from\\s*['"]${CHILD_PROCESS_MODULE}['"]`),
    );
    if (namedImport?.[1]) {
      for (const specifier of namedImport[1].split(",")) {
        addNamedChildProcessBinding(bindings, specifier);
      }
    }

    const namespaceImport = content.match(
      new RegExp(
        `\\bimport\\s+\\*\\s+as\\s+([A-Za-z_$][\\w$]*)\\s+from\\s*['"]${CHILD_PROCESS_MODULE}['"]`,
      ),
    );
    if (namespaceImport?.[1]) bindings.namespaces.add(namespaceImport[1]);

    const defaultImport = content.match(
      new RegExp(`\\bimport\\s+([A-Za-z_$][\\w$]*)\\s+from\\s*['"]${CHILD_PROCESS_MODULE}['"]`),
    );
    if (defaultImport?.[1]) bindings.namespaces.add(defaultImport[1]);

    const destructuredRequire = content.match(
      new RegExp(
        `\\b(?:const|let|var)\\s*\\{([^}]+)\\}\\s*=\\s*require\\s*\\(\\s*['"]${CHILD_PROCESS_MODULE}['"]\\s*\\)`,
      ),
    );
    if (destructuredRequire?.[1]) {
      for (const specifier of destructuredRequire[1].split(",")) {
        addNamedChildProcessBinding(bindings, specifier);
      }
    }

    const namespaceRequire = content.match(
      new RegExp(
        `\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*require\\s*\\(\\s*['"]${CHILD_PROCESS_MODULE}['"]\\s*\\)`,
      ),
    );
    if (namespaceRequire?.[1]) bindings.namespaces.add(namespaceRequire[1]);
  }

  return bindings;
};

const lineHasChildProcessExecCall = (line: string, bindings: ChildProcessBindings): boolean => {
  if (
    new RegExp(
      `\\brequire\\s*\\(\\s*['"]${CHILD_PROCESS_MODULE}['"]\\s*\\)\\s*\\.\\s*(?:execSync|exec)\\s*\\(`,
    ).test(line)
  ) {
    return true;
  }

  for (const namespace of bindings.namespaces) {
    const escaped = escapeRegExp(namespace);
    if (new RegExp(`(?<![\\w$])${escaped}\\s*\\.\\s*(?:execSync|exec)\\s*\\(`).test(line)) {
      return true;
    }
  }

  for (const name of bindings.namedExec) {
    const escaped = escapeRegExp(name);
    if (new RegExp(`(?<![.\\w$])${escaped}\\s*\\(`).test(line)) {
      return true;
    }
  }

  return false;
};

const makeChildProcessExecIssue = (line: ParsedDiffLine): AuditIssue => ({
  line: line.targetLine,
  severity: "WARNING",
  category: "runtime-crash",
  confidence: "high",
  evidence: `pattern: child_process execSync/exec, match: "${line.content.trim().slice(0, 200)}"`,
  message:
    "[Deterministic] Synchronous child_process execution can crash the runtime on large output or blocking operations.",
  suggestion: "Use async alternatives (spawn, execFile) with proper timeout and error handling.",
});

/**
 * Run deterministic risk analysis on sanitized diff content.
 * Scans added lines from diffs for dangerous patterns.
 * Removed lines and diff headers are ignored to reduce false positives.
 * Multi-line patterns are applied against added lines only (with gap preservation).
 */
export const analyzeDiffs = (
  files: Array<{ path: string; content: string }>,
): RiskAnalysisResult => {
  const results: FileAnalysis[] = [];
  let totalCritical = 0;
  let totalWarning = 0;
  let totalInfo = 0;

  for (const file of files) {
    const issues: AuditIssue[] = [];
    const parsed = parseDiffContent(file.content);
    const childProcessBindings = collectChildProcessBindings(parsed.contextLines);

    for (const parsedLine of parsed.lines) {
      if (lineHasChildProcessExecCall(parsedLine.content, childProcessBindings)) {
        issues.push(makeChildProcessExecIssue(parsedLine));
        totalWarning++;
      }
    }

    // Phase 2.3: universal patterns + per-language extras. Language packs
    // run on Python/Go/Rust/PHP/Ruby files based on extension; the JS/TS-
    // leaning universal set always applies.
    const patternsForFile: RiskPattern[] = [
      ...ALL_RISK_PATTERNS,
      ...getLanguageRiskPatterns(file.path),
    ];
    for (const pattern of patternsForFile) {
      if (pattern.multiLine) {
        // Multi-line patterns scan only added lines (with gap preservation
        // between non-contiguous hunks) to avoid false positives from
        // removed lines or distant context
        const addedText = buildAddedScanText(parsed.lines);
        if (addedText.text.length > 0) {
          pattern.regex.lastIndex = 0;
          const matches = addedText.text.matchAll(pattern.regex);
          for (const match of matches) {
            const severity = pattern.severity ?? "WARNING";
            if (severity === "CRITICAL") totalCritical++;
            else if (severity === "WARNING") totalWarning++;
            else totalInfo++;

            let message = pattern.message;
            let suggestion: string | undefined = pattern.suggestion;
            if (match.length > 1) {
              for (let g = 1; g < match.length; g++) {
                const val = match[g] ?? "";
                message = message.replace(`$${g}`, val);
                if (suggestion) suggestion = suggestion.replace(`$${g}`, val);
              }
            }

            // Map the match position to target-file line number
            const lineBeforeMatch = addedText.text.slice(0, match.index);
            const scanLineIndex = lineBeforeMatch.split("\n").length - 1;
            const matchLine = addedText.targetLineAt(scanLineIndex);

            const issueBody: {
              line: number;
              severity: "CRITICAL" | "WARNING" | "INFO";
              message: string;
              suggestion?: string;
              category: string;
              confidence: "low" | "medium" | "high";
              evidence: string;
            } = {
              line: matchLine,
              severity,
              category: pattern.category,
              confidence: pattern.confidence,
              evidence: `pattern: ${pattern.label}, match: "${match[0]!.slice(0, 200)}"`,
              message: `[Deterministic] ${message}`,
            };
            if (suggestion) issueBody.suggestion = suggestion;
            issues.push(issueBody);
          }
        }
        continue;
      }

      const filter = MATCH_FILTERS[pattern.label];

      for (const parsedLine of parsed.lines) {
        pattern.regex.lastIndex = 0;

        const match = pattern.regex.exec(parsedLine.content);
        if (!match) continue;

        // Apply per-pattern match filter
        if (filter && !filter(parsedLine.content, file.path)) continue;

        const severity = pattern.severity ?? "WARNING";
        if (severity === "CRITICAL") totalCritical++;
        else if (severity === "WARNING") totalWarning++;
        else totalInfo++;

        let message = pattern.message;
        let suggestion: string | undefined = pattern.suggestion;
        if (match.length > 1) {
          for (let g = 1; g < match.length; g++) {
            const val = match[g] ?? "";
            message = message.replace(`$${g}`, val);
            if (suggestion) suggestion = suggestion.replace(`$${g}`, val);
          }
        }

        const issueBody: {
          line: number;
          severity: "CRITICAL" | "WARNING" | "INFO";
          message: string;
          suggestion?: string;
          category: string;
          confidence: "low" | "medium" | "high";
          evidence: string;
        } = {
          line: parsedLine.targetLine,
          severity,
          category: pattern.category,
          confidence: pattern.confidence,
          evidence: `pattern: ${pattern.label}, match: "${parsedLine.content.trim().slice(0, 200)}"`,
          message: `[Deterministic] ${message}`,
        };
        if (suggestion) issueBody.suggestion = suggestion;
        issues.push(issueBody);
      }
    }

    results.push({
      path: file.path,
      issues,
      localSeverityCounts: {
        critical: issues.filter((i) => i.severity === "CRITICAL").length,
        warning: issues.filter((i) => i.severity === "WARNING").length,
        info: issues.filter((i) => i.severity === "INFO").length,
      },
    });
  }

  return {
    files: results,
    totalCritical,
    totalWarning,
    totalInfo,
    hasCriticalFindings: totalCritical > 0,
  };
};

/**
 * Merge local risk-analyzer findings with AI-sourced findings per file.
 * - Local CRITICAL and WARNING findings force status FAIL regardless of AI result.
 * - Local INFO findings do NOT affect status (unless AI already FAIL/ERROR).
 * - Redacted paths always get a deterministic CRITICAL security issue in the result.
 * - AI findings are preserved as-is but local findings are added first.
 * - Deduplicates by category + line.
 * - Preserves FileAuditResult fields (duration, cached).
 */
export const mergeFindings = (
  local: RiskAnalysisResult,
  aiResults: FileAuditResult[],
  securityRedactionPaths: Set<string> = new Set(),
): FileAuditResult[] => {
  const localByPath = new Map<string, AuditIssue[]>();
  for (const f of local.files) {
    localByPath.set(f.path, f.issues);
  }

  const mergedResults: FileAuditResult[] = aiResults.map((ar) => {
    const localIssues = localByPath.get(ar.filePath) ?? [];
    const aiIssues = ar.result.issues ?? [];
    const merged: AuditIssue[] = [...localIssues];

    // Deduplicate: skip AI issues that match a local issue by category + line
    const localKeySet = new Set(localIssues.map((l) => `${l.category ?? ""}:${l.line}`));

    for (const aiIssue of aiIssues) {
      const key = `${aiIssue.category ?? ""}:${aiIssue.line}`;
      if (!localKeySet.has(key)) {
        merged.push(aiIssue);
      }
    }

    // Determine final status — actionable local findings always FAIL
    const hasLocalActionable = localIssues.some(
      (i) => i.severity === "CRITICAL" || i.severity === "WARNING",
    );
    const hasRedaction = securityRedactionPaths.has(ar.filePath);
    const status =
      hasLocalActionable || hasRedaction || ar.result.status === "FAIL"
        ? ("FAIL" as const)
        : ar.result.status;

    // Ensure redacted paths always include a CRITICAL secret-redaction issue
    if (hasRedaction) {
      const hasRedactionIssue = merged.some(
        (i) => i.evidence === "secret-redaction" && i.severity === "CRITICAL",
      );
      if (!hasRedactionIssue) {
        merged.push({
          line: 1,
          severity: "CRITICAL",
          category: "security",
          confidence: "high",
          evidence: "secret-redaction",
          message:
            "[Deterministic] Potential secret redacted — review report requires manual verification",
          suggestion:
            "Remove secrets from the diff and use environment variables or secret managers.",
        });
      }
    }

    const mergedResult: FileAuditResult = {
      filePath: ar.filePath,
      duration: ar.duration,
      result: {
        ...ar.result,
        issues: merged,
        status,
      },
    };
    if (ar.cached) mergedResult.cached = true;
    return mergedResult;
  });

  // Add synthetic FAIL entries for redacted files that AI didn't return
  const coveredPaths = new Set(mergedResults.map((r) => r.filePath));
  for (const redactedPath of securityRedactionPaths) {
    if (!coveredPaths.has(redactedPath)) {
      mergedResults.push({
        filePath: redactedPath,
        duration: 0,
        result: {
          status: "FAIL",
          issues: [
            {
              line: 1,
              severity: "CRITICAL",
              category: "security",
              confidence: "high",
              evidence: "secret-redaction",
              message:
                "[Deterministic] Potential secret redacted — review report requires manual verification",
              suggestion:
                "Remove secrets from the diff and use environment variables or secret managers.",
            },
          ],
          message: "Secret redaction — AI review did not include this file",
        },
      });
    }
  }

  // Add synthetic entries for local-only files with deterministic issues
  for (const f of local.files) {
    if (!coveredPaths.has(f.path) && f.issues.length > 0) {
      const hasCriticalOrWarning =
        f.localSeverityCounts.critical > 0 || f.localSeverityCounts.warning > 0;
      mergedResults.push({
        filePath: f.path,
        duration: 0,
        result: {
          status: hasCriticalOrWarning ? "FAIL" : "PASS",
          issues: f.issues,
          ...(hasCriticalOrWarning
            ? { message: "Deterministic findings — AI review did not include this file" }
            : {}),
        },
      });
    }
  }

  return mergedResults;
};
