/**
 * Skill quality gate — deterministic validation of generated skill content.
 *
 * Runs before files are written. Errors fail --check; warnings are informational.
 * No external dependencies — purely a function of the generated files, adapter, and index.
 */

import type {
  AdapterSpec,
  AgentAdapterId,
  GeneratedSkillFile,
  QualityCheck,
  QualityReport,
  SourceIndex,
} from "../../types/index.js";

// ── Size limits ────────────────────────────────────────────────────────────

const SKILL_MD_MAX = 3000;
const REF_MD_MAX = 6000;
const SINGLE_FILE_MAX = 20000;

// ── Unknown-path allowlist ──────────────────────────────────────────────────
// These paths are valid references in generated skills but are not source files
// in the index (config files, agent instructions, cache, etc.).

const KNOWN_NON_SOURCE_PATHS = new Set([
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "AGENTS.md",
  "CLAUDE.md",
  ".claude/",
  ".claude",
  ".cursor/",
  ".cursor",
  ".agents/",
  ".agents",
  ".clinerules/",
  ".clinerules",
  ".windsurf/",
  ".windsurf",
  ".antigravity/",
  ".antigravity",
  ".agent/",
  ".agent",
  ".codex/",
  ".codex",
  ".mp-sentinel-cache/source-index.json",
  ".sentinelrc.json",
  "references/codebase-map.md",
  "references/testing-map.md",
  "references/dependencies.md",
  "references/public-api.md",
  "references/architecture.md",
  "references/modules.md",
  "references/commands.md",
]);

// ── Multi-file adapters ─────────────────────────────────────────────────────

const MULTI_FILE_ADAPTERS = new Set<AgentAdapterId>(["claude"]);

// ── Required H2 sections per Claude reference file ──────────────────────────

const CLAUDE_REQUIRED_SECTIONS: Record<string, string[]> = {
  "SKILL.md": ["Required Agent Workflow", "Overview", "References"],
  "architecture.md": ["Architecture"], // "Hub Files" is content-dependent, not invariant
  "modules.md": ["Module Map"],
  "commands.md": [], // "Project Profile: *" matched by prefix below
  "codebase-map.md": ["Codebase Map"],
  "testing-map.md": ["Testing Map"],
  "dependencies.md": ["Dependencies"],
  "public-api.md": ["Public API Surface"],
};

// H2 that starts with this prefix satisfies the requirement
const PREFIX_MATCH_SECTIONS: Record<string, string[]> = {
  "commands.md": ["Project Profile"],
};

const SINGLE_FILE_REQUIRED_SECTIONS = [
  "Required Agent Workflow",
  "Overview",
  "Architecture",
  "Module Map",
  "Codebase Map",
  "Testing Map",
  "Dependencies",
  "Public API Surface",
];
// Note: "Hub Files" is content-dependent (only present when hub files exist).
// "Development Commands" is also content-dependent.
// "Project Profile" is matched by prefix.

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Extract all H2 (## heading) lines from markdown content */
function extractH2Headings(content: string): string[] {
  const headings: string[] = [];
  for (const line of content.split("\n")) {
    const match = line.match(/^## (.+)/);
    if (match && match[1]) {
      headings.push(match[1].trim());
    }
  }
  return headings;
}

/** Extract H2 sections (heading → body text until next H2 or EOF) */
function extractSections(content: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = content.split("\n");
  let currentHeading: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    const h2 = line.match(/^## (.+)/);
    if (h2 && h2[1]) {
      if (currentHeading !== null) {
        sections.set(currentHeading, currentLines.join("\n"));
      }
      currentHeading = h2[1].trim();
      currentLines = [];
    } else if (currentHeading !== null) {
      currentLines.push(line);
    }
  }
  if (currentHeading !== null) {
    sections.set(currentHeading, currentLines.join("\n"));
  }
  return sections;
}

/** Check if any heading in the file starts with the given prefix */
function hasHeadingPrefix(headings: string[], prefix: string): boolean {
  return headings.some((h) => h.startsWith(prefix));
}

/** Check if a token looks like a file path (not a command or package name) */
function isPathToken(token: string): boolean {
  // Skip URLs
  if (/^https?:\/\//i.test(token)) return false;
  // Skip tokens with spaces (commands, prose)
  if (/\s/.test(token)) return false;
  // Skip scoped npm packages like @scope/name
  if (/^@[^/]+\//.test(token)) return false;
  // Backtick-wrapped reference links like [text](./path)
  // Must have a path indicator
  return (
    token.includes("/") ||
    token.includes("\\") ||
    token.startsWith(".") ||
    /\.[a-z]{1,8}$/i.test(token)
  );
}

/** Extract backtick-enclosed tokens that look like file paths */
function extractPathTokens(content: string): string[] {
  const tokens: string[] = [];
  const regex = /`([^`]+)`/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const candidate = match[1]!;
    if (isPathToken(candidate)) {
      tokens.push(candidate);
    }
  }
  return [...new Set(tokens)];
}

/** Normalize a path for comparison — strip ./ prefix and trailing slashes */
function normalizePathToken(token: string): string {
  let t = token;
  if (t.startsWith("./")) t = t.slice(2);
  if (t.endsWith("/")) t = t.slice(0, -1);
  return t;
}

// ── Individual checks ──────────────────────────────────────────────────────

function checkMaxFileSize(file: GeneratedSkillFile, adapterId: AgentAdapterId): QualityCheck[] {
  const checks: QualityCheck[] = [];
  const size = file.content.length;
  const isMultiFile = MULTI_FILE_ADAPTERS.has(adapterId);
  const basename = file.outputPath.replace(/\\/g, "/").split("/").pop() ?? file.outputPath;

  if (isMultiFile) {
    if (basename === "SKILL.md" && size > SKILL_MD_MAX) {
      checks.push({
        type: "max-file-size",
        severity: "error",
        file: file.outputPath,
        message: `SKILL.md is ${size} chars (max ${SKILL_MD_MAX})`,
      });
    } else if (basename !== "SKILL.md" && size > REF_MD_MAX) {
      checks.push({
        type: "max-file-size",
        severity: "error",
        file: file.outputPath,
        message: `Reference file is ${size} chars (max ${REF_MD_MAX})`,
      });
    }
  } else {
    if (size > SINGLE_FILE_MAX) {
      checks.push({
        type: "max-file-size",
        severity: "error",
        file: file.outputPath,
        message: `Single-file output is ${size} chars (max ${SINGLE_FILE_MAX})`,
      });
    }
  }

  return checks;
}

function checkRequiredSections(
  file: GeneratedSkillFile,
  adapterId: AgentAdapterId,
): QualityCheck[] {
  const checks: QualityCheck[] = [];
  const headings = extractH2Headings(file.content);
  const basename = file.outputPath.replace(/\\/g, "/").split("/").pop() ?? file.outputPath;
  const isMultiFile = MULTI_FILE_ADAPTERS.has(adapterId);

  let required: string[];
  if (isMultiFile) {
    const lookup = CLAUDE_REQUIRED_SECTIONS[basename];
    if (!lookup) return []; // Unknown file in multi-file layout, skip
    required = lookup;
  } else {
    required = SINGLE_FILE_REQUIRED_SECTIONS;
  }

  for (const section of required) {
    const found = headings.includes(section);
    if (!found) {
      checks.push({
        type: "required-section",
        severity: "error",
        file: file.outputPath,
        message: `Missing required H2 section: "## ${section}"`,
      });
    }
  }

  // Prefix-matched sections
  if (isMultiFile) {
    const prefixes = PREFIX_MATCH_SECTIONS[basename];
    if (prefixes) {
      for (const prefix of prefixes) {
        if (!hasHeadingPrefix(headings, prefix)) {
          checks.push({
            type: "required-section",
            severity: "error",
            file: file.outputPath,
            message: `Missing required H2 section starting with: "## ${prefix}"`,
          });
        }
      }
    }
  } else {
    // For single-file, "Project Profile" and "Development Commands" should exist
    if (!hasHeadingPrefix(headings, "Project Profile")) {
      checks.push({
        type: "required-section",
        severity: "error",
        file: file.outputPath,
        message: `Missing required H2 section starting with: "## Project Profile"`,
      });
    }
  }

  return checks;
}

function checkRequiredReferences(
  file: GeneratedSkillFile,
  adapterId: AgentAdapterId,
): QualityCheck[] {
  const checks: QualityCheck[] = [];
  if (adapterId !== "claude") return checks;

  const basename = file.outputPath.replace(/\\/g, "/").split("/").pop();
  if (basename !== "SKILL.md") return checks;

  const refMatches = file.content.match(/\(\.\/references\/[^)]+\.md\)/g);
  const refCount = refMatches ? new Set(refMatches).size : 0;

  if (refCount !== 7) {
    checks.push({
      type: "required-references",
      severity: "error",
      file: file.outputPath,
      message: `SKILL.md should link exactly 7 references, found ${refCount}`,
    });
  }

  return checks;
}

function checkDuplicateSections(file: GeneratedSkillFile): QualityCheck[] {
  const checks: QualityCheck[] = [];
  const headings = extractH2Headings(file.content);
  const seen = new Set<string>();

  for (const h of headings) {
    if (seen.has(h)) {
      checks.push({
        type: "duplicate-section",
        severity: "error",
        file: file.outputPath,
        message: `Duplicate H2 section: "## ${h}"`,
      });
    }
    seen.add(h);
  }

  return checks;
}

function checkEmptySections(file: GeneratedSkillFile): QualityCheck[] {
  const checks: QualityCheck[] = [];
  const sections = extractSections(file.content);

  for (const [heading, body] of sections) {
    if (body.trim().length === 0) {
      checks.push({
        type: "empty-section",
        severity: "warning",
        file: file.outputPath,
        message: `H2 section "## ${heading}" has no body content`,
      });
    }
  }

  return checks;
}

// ── Risky Unicode ─────────────────────────────────────────────────────────────

// Characters likely to cause mojibake or readability issues when agents read
// generated skills in a terminal environment.
const RISKY_UNICODE: Array<{ char: string; name: string }> = [
  // Punctuation dashes
  { char: "—", name: "em dash (--)" },
  { char: "–", name: "en dash (-)" },
  // Arrows
  { char: "→", name: "right arrow (->)" },
  { char: "←", name: "left arrow (<-)" },
  // Typographic
  { char: "…", name: "ellipsis (...)" },
  { char: "‘", name: "left single quote" },
  { char: "’", name: "right single quote" },
  { char: "“", name: "left double quote" },
  { char: "”", name: "right double quote" },
  // Symbols
  { char: "✓", name: "checkmark" },
  { char: "✗", name: "ballot x" },
];

function checkRiskyUnicode(file: GeneratedSkillFile): QualityCheck[] {
  const checks: QualityCheck[] = [];
  for (const rc of RISKY_UNICODE) {
    if (file.content.includes(rc.char)) {
      // Count occurrences for a useful message
      let count = 0;
      let idx = file.content.indexOf(rc.char);
      while (idx !== -1) {
        count++;
        idx = file.content.indexOf(rc.char, idx + 1);
      }
      checks.push({
        type: "risky-unicode",
        severity: "error",
        file: file.outputPath,
        message: `Found ${count} occurrence(s) of ${rc.name} (U+${rc.char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}) — replace with ASCII equivalent`,
      });
    }
  }
  return checks;
}

function checkUnknownPaths(
  file: GeneratedSkillFile,
  index: SourceIndex | null,
  knownRefPaths: Set<string>,
): QualityCheck[] {
  const checks: QualityCheck[] = [];
  if (!index) return checks;

  const tokens = extractPathTokens(file.content);
  if (tokens.length === 0) return checks;

  // Build set of known paths from index + generated references
  const known = new Set<string>();
  for (const f of index.files) {
    known.add(f.path);
  }
  for (const ref of knownRefPaths) {
    known.add(ref);
  }

  for (const token of tokens) {
    // Skip reference links (they use ./references/ format)
    if (token.startsWith("./references/")) continue;
    // Skip directory-only references (e.g. `src/`, `(root)/`)
    const normalized = normalizePathToken(token);
    if (token.endsWith("/") && !token.includes(".")) continue;
    // Skip if found in known paths (try both raw and normalized)
    if (known.has(token) || known.has(normalized)) continue;
    // Also try matching as a suffix (e.g. "src/index.ts" might match "src/index.ts" in index)
    const suffixMatch = [...known].some((p) => p === token || p.endsWith("/" + token));
    if (suffixMatch) continue;
    // Skip known non-source paths (config files, agent dirs, etc.)
    if (KNOWN_NON_SOURCE_PATHS.has(token) || KNOWN_NON_SOURCE_PATHS.has(normalized)) continue;
    // Skip paths under known non-source directories (e.g. ".claude/skills/...")
    const underKnownDir = [...KNOWN_NON_SOURCE_PATHS].some(
      (prefix) =>
        prefix.endsWith("/") && (token.startsWith(prefix) || normalized.startsWith(prefix)),
    );
    if (underKnownDir) continue;
    // Try .ts/.tsx variant for .js paths (ESM convention uses .js but index stores .ts)
    const tsVariant = normalized.replace(/\.js$/, ".ts");
    const tsxVariant = normalized.replace(/\.js$/, ".tsx");
    if (tsVariant !== normalized && (known.has(tsVariant) || known.has(tsxVariant))) continue;

    checks.push({
      type: "unknown-path",
      severity: "warning",
      file: file.outputPath,
      message: `Path \`${token}\` not found in source index or generated references`,
    });
  }

  return checks;
}

// ── Codebase fidelity ──────────────────────────────────────────────────────

/**
 * Check that generated content references real project signals from the index.
 * When the index has data (scripts, entrypoints, test files, modules), the
 * content should mention at least some of them. Missing signals are warnings,
 * not errors — adapters may summarize differently.
 */
function checkRealSignals(file: GeneratedSkillFile, index: SourceIndex | null): QualityCheck[] {
  const checks: QualityCheck[] = [];
  if (!index) return checks;

  const relPath = file.outputPath.replace(/\\/g, "/");
  const basename = relPath.split("/").pop() ?? relPath;

  // Only check the main skill file, not reference files or supplementary files
  const isMainSkill =
    basename === "SKILL.md" || // Claude multi-file
    (!relPath.includes("/references/") && // not a reference file
      !relPath.includes("/skills/") && // not under skills dir (reference)
      (basename.endsWith(".md") || basename.endsWith(".mdc"))); // is a skill file

  if (!isMainSkill) return checks;

  const content = file.content;

  // Check for real entrypoint signals
  const insights = index.insights;
  if (insights) {
    const cliEntries = Object.entries(insights.fileRoles).filter(
      ([, role]) => role === "cli-entry",
    );
    const commandFiles = Object.entries(insights.fileRoles).filter(
      ([, role]) => role === "command",
    );

    if (cliEntries.length > 0) {
      const mentioned = cliEntries.some(([path]) => content.includes(path));
      if (!mentioned) {
        checks.push({
          type: "missing-real-signal",
          severity: "warning",
          file: file.outputPath,
          message: `Content does not mention any CLI entrypoint (index has ${cliEntries.length}: ${cliEntries.map(([p]) => p).join(", ")})`,
        });
      }
    }

    if (commandFiles.length > 0) {
      const mentioned = commandFiles.some(([path]) => content.includes(path));
      if (!mentioned) {
        checks.push({
          type: "missing-real-signal",
          severity: "warning",
          file: file.outputPath,
          message: `Content does not mention any command file (index has ${commandFiles.length}: ${commandFiles.map(([p]) => p).join(", ")})`,
        });
      }
    }
  }

  // Check for real scripts from package.json — look for backtick-wrapped or run-command patterns
  const scripts = index.project.scripts;
  if (scripts && Object.keys(scripts).length > 0) {
    const scriptKeys = Object.keys(scripts);
    // Match patterns like `npm run test`, `npm test`, or `\`test\``
    const anyMentioned = scriptKeys.some((key) => {
      if (content.includes(`\`${key}\``)) return true;
      if (
        new RegExp(
          `(?:npm|pnpm|yarn)\\s+(?:run\\s+)?${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
        ).test(content)
      )
        return true;
      if (content.includes(`"${key}"`)) return true;
      return false;
    });
    if (!anyMentioned) {
      checks.push({
        type: "missing-real-signal",
        severity: "warning",
        file: file.outputPath,
        message: `Content does not mention any package.json script (available: ${scriptKeys.slice(0, 5).join(", ")}${scriptKeys.length > 5 ? "..." : ""})`,
      });
    }
  }

  // Check for top modules — only real directories (contain at least one sub-path file)
  if (index.files.length > 0) {
    const dirCounts = new Map<string, number>();
    for (const f of index.files) {
      const firstSlash = f.path.indexOf("/");
      if (firstSlash === -1) continue; // root-level file, not a directory
      const dir = f.path.slice(0, firstSlash);
      dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
    }
    const sourceDirs = [...dirCounts.keys()].filter((d) => !d.startsWith("."));
    if (sourceDirs.length > 0) {
      const anyMentioned = sourceDirs.some((dir) => content.includes(`${dir}/`));
      if (!anyMentioned) {
        checks.push({
          type: "missing-real-signal",
          severity: "warning",
          file: file.outputPath,
          message: `Content does not mention any top-level source directory (available: ${sourceDirs.slice(0, 5).join(", ")})`,
        });
      }
    }
  }

  return checks;
}

// ── Agent Workflow Contract (v1.0.16+) ───────────────────────────────────────

/**
 * Verify that the Required Agent Workflow section contains mandatory instructions:
 * 1. Read skill/rules before writing code
 * 2. Use indexing diagnostics before broad scans
 */
function checkAgentWorkflowContract(
  file: GeneratedSkillFile,
  adapterId: AgentAdapterId,
): QualityCheck[] {
  const checks: QualityCheck[] = [];
  const content = file.content;

  const sections = extractSections(content);
  const workflowBody = sections.get("Required Agent Workflow");
  if (!workflowBody) return checks; // Missing section is caught by required-section check

  // Check 1: Must instruct to read skill or rules before coding
  const hasReadSkill =
    workflowBody.includes("Read this skill") ||
    workflowBody.includes("read this skill") ||
    workflowBody.includes("read the skill") ||
    workflowBody.includes("SKILL.md") ||
    workflowBody.includes("best-practices") ||
    workflowBody.includes("Read the relevant");
  if (!hasReadSkill) {
    checks.push({
      type: "agent-workflow-contract",
      severity: "error",
      file: file.outputPath,
      message:
        "Required Agent Workflow must instruct agent to read this skill or generated rules before coding",
    });
  }

  // Check 2: Must mention using indexing diagnostics before broad scans
  const hasIndexDiag =
    workflowBody.includes("explain-index") ||
    workflowBody.includes("indexing --stats") ||
    workflowBody.includes("explain-context") ||
    workflowBody.includes("source index diagnostics");
  if (!hasIndexDiag) {
    checks.push({
      type: "agent-workflow-contract",
      severity: "error",
      file: file.outputPath,
      message:
        "Required Agent Workflow must instruct agent to use indexing diagnostics before scanning broadly",
    });
  }

  return checks;
}

// ── Adapter Layout Contract (v1.0.17+) ─────────────────────────────────────

/**
 * Validate that generated files conform to the adapter's official layout spec.
 * - Skill-style adapters must have a SKILL.md in the correct workspace path.
 * - Rule-style adapters must write to the correct workspace path.
 * - SKILL.md must have required YAML frontmatter keys.
 * - Disallowed legacy paths (e.g. .antigravity/rules/, .agents/rules/ for skill adapters) are hard errors.
 */
function checkAdapterLayoutContract(
  files: GeneratedSkillFile[],
  adapterId: AgentAdapterId,
  spec: AdapterSpec,
  projectName: string,
): QualityCheck[] {
  const checks: QualityCheck[] = [];
  const resolvedWs = spec.workspacePath.replace(/\{projectName\}/g, projectName);

  // Normalize all output paths for comparison
  const normalizedFiles = files.map((f) => ({
    ...f,
    normalizedPath: f.outputPath.replace(/\\/g, "/"),
  }));

  // Every file must be under the resolved workspace path (or match it for single-file rules).
  // Output paths include the project root (absolute), while workspacePath is relative.
  // We check containment rather than prefix matching.
  for (const file of normalizedFiles) {
    if (spec.outputKind === "skill") {
      // Skill-style: file must be under the workspace directory (contain the resolved ws)
      if (!file.normalizedPath.includes(resolvedWs)) {
        checks.push({
          type: "adapter-layout-contract",
          severity: "error",
          file: file.outputPath,
          message: `File path must contain workspace "${resolvedWs}"`,
        });
      }
    } else {
      // Rule-style: file path must end with the resolved workspace path
      if (!file.normalizedPath.endsWith(resolvedWs)) {
        checks.push({
          type: "adapter-layout-contract",
          severity: "error",
          file: file.outputPath,
          message: `File path must end with "${resolvedWs}"`,
        });
      }
    }
  }

  // Skill-style: must have a SKILL.md
  if (spec.outputKind === "skill") {
    const skillMdFile = normalizedFiles.find((f) => f.normalizedPath.endsWith("/SKILL.md"));
    if (!skillMdFile) {
      checks.push({
        type: "adapter-layout-contract",
        severity: "error",
        file: resolvedWs + "SKILL.md",
        message: `Skill-style adapter must produce a SKILL.md file in "${resolvedWs}"`,
      });
    } else {
      // Check required YAML frontmatter
      const requiredKeys = spec.frontmatterRules.required;
      if (requiredKeys.length > 0) {
        const content = skillMdFile.content;
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (!fmMatch) {
          checks.push({
            type: "adapter-layout-contract",
            severity: "error",
            file: skillMdFile.outputPath,
            message: `SKILL.md must have YAML frontmatter (---) with required keys: ${requiredKeys.join(", ")}`,
          });
        } else {
          const fm = fmMatch[1]!;
          for (const key of requiredKeys) {
            const keyRegex = new RegExp(`^${key}:`, "m");
            if (!keyRegex.test(fm)) {
              checks.push({
                type: "adapter-layout-contract",
                severity: "error",
                file: skillMdFile.outputPath,
                message: `SKILL.md frontmatter missing required key: "${key}"`,
              });
            }
          }
        }
      }
    }

    // Check required files from spec
    for (const reqFile of spec.requiredFiles) {
      const expectedPath = resolvedWs + reqFile;
      const found = normalizedFiles.some(
        (f) => f.normalizedPath === expectedPath || f.normalizedPath.endsWith("/" + reqFile),
      );
      if (!found) {
        checks.push({
          type: "adapter-layout-contract",
          severity: "error",
          file: expectedPath,
          message: `Required file "${reqFile}" is missing from workspace "${resolvedWs}"`,
        });
      }
    }
  }

  // Antigravity-specific: reject legacy .antigravity/rules paths
  if (adapterId === "antigravity") {
    const hasLegacyAntigravity = normalizedFiles.some((f) =>
      f.normalizedPath.includes(".antigravity/rules/"),
    );
    if (hasLegacyAntigravity) {
      checks.push({
        type: "adapter-layout-contract",
        severity: "error",
        file: ".antigravity/rules/",
        message: `Antigravity adapter must use .agents/skills/ layout, not legacy .antigravity/rules/`,
      });
    }
    const hasAgentsRules = normalizedFiles.some((f) => f.normalizedPath.includes(".agents/rules/"));
    if (hasAgentsRules) {
      checks.push({
        type: "adapter-layout-contract",
        severity: "error",
        file: ".agents/rules/",
        message: `Antigravity adapter must use .agents/skills/ layout, not .agents/rules/`,
      });
    }
  }

  // Codex-specific: reject legacy .agents/rules paths
  if (adapterId === "codex") {
    const hasAgentsRules = normalizedFiles.some((f) => f.normalizedPath.includes(".agents/rules/"));
    if (hasAgentsRules) {
      checks.push({
        type: "adapter-layout-contract",
        severity: "error",
        file: ".agents/rules/",
        message: `Codex adapter must use .agents/skills/ layout, not .agents/rules/`,
      });
    }
  }

  // Generic-specific: reject .agents/skills/ (it's a rule-style fallback)
  if (adapterId === "generic") {
    const hasSkillsPath = normalizedFiles.some((f) => f.normalizedPath.includes(".agents/skills/"));
    if (hasSkillsPath) {
      checks.push({
        type: "adapter-layout-contract",
        severity: "error",
        file: ".agents/skills/",
        message: `Generic adapter must use .agents/rules/ layout, not .agents/skills/`,
      });
    }
  }

  return checks;
}

// ── Main entry point ────────────────────────────────────────────────────────

export function validateSkillQuality(
  files: GeneratedSkillFile[],
  adapterId: AgentAdapterId,
  index: SourceIndex | null,
  adapterSpec?: AdapterSpec,
  projectName?: string,
): QualityReport {
  if (files.length === 0) {
    return { passed: true, checks: [], errors: 0, warnings: 0 };
  }

  // Build set of known reference paths from the generated files themselves
  const knownRefPaths = new Set<string>();
  for (const f of files) {
    const relPath = f.outputPath.replace(/\\/g, "/");
    knownRefPaths.add(relPath);
    // Also add just the filename for cross-reference validation
    const basename = relPath.split("/").pop();
    if (basename) knownRefPaths.add(basename);
  }

  const allChecks: QualityCheck[] = [];

  // Adapter layout contract — validate before per-file checks
  if (adapterSpec && projectName) {
    allChecks.push(...checkAdapterLayoutContract(files, adapterId, adapterSpec, projectName));
  }

  for (const file of files) {
    allChecks.push(...checkMaxFileSize(file, adapterId));
    allChecks.push(...checkRequiredSections(file, adapterId));
    allChecks.push(...checkRequiredReferences(file, adapterId));
    allChecks.push(...checkDuplicateSections(file));
    allChecks.push(...checkEmptySections(file));
    allChecks.push(...checkUnknownPaths(file, index, knownRefPaths));
    allChecks.push(...checkRealSignals(file, index));
    allChecks.push(...checkAgentWorkflowContract(file, adapterId));
    allChecks.push(...checkRiskyUnicode(file));
  }

  const errors = allChecks.filter((c) => c.severity === "error");
  return {
    passed: errors.length === 0,
    checks: allChecks,
    errors: errors.length,
    warnings: allChecks.filter((c) => c.severity === "warning").length,
  };
}
