/**
 * Prompt templates for AI-powered code auditing
 */

import type { ProjectConfig, TechProfile } from "../types/index.js";
import { fetchSkillsForTechStack, buildSkillsPromptSection } from "../services/skills-fetcher.js";
import { detectTechProfile, getReviewCues } from "../services/tech-profile.js";
import { buildDependencyContext } from "../services/dependency-context.js";
import {
  buildProjectRulePackContext,
  renderRulePackRulesSection,
} from "../services/rule-pack-prompt.js";

export const DEFAULT_PROMPT_VERSION = "2026-06-08";

export const DEFAULT_COMMIT_PROMPT = `
### ROLE
You are a Strict Release Manager. You enforce "Conventional Commits" standards.
### RULES
1. Format MUST be: \`<type>(<scope>): <subject>\`
   - Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert.
   - Example: "feat(auth): add google login support"
2. Subject must be lowercase and imperative (e.g., "add" not "added").
3. Message must be descriptive enough to understand the change context.
`;

export const BASE_AUDIT_PROMPT = `
### ROLE & OBJECTIVE
You are an Elite Software Architect reviewing git diff hunks.
Focus on changed lines and nearby context only.

### MANDATORY RUBRIC
Evaluate changed code against ALL of the following categories.
Each issue MUST include the matching category label in its JSON output:

1. **security** — XSS, injection, auth bypass, secret exposure, CORS misconfiguration. Prioritize exploitability.
2. **runtime-crash** — null pointer dereference, type errors, unhandled promise rejections, race conditions, blocking operations. Prioritize crash paths.
3. **architecture** — contract violations, layering breaks, circular dependencies, hub-file blast radius. Prioritize codebase-specific contracts from the PROJECT SPECIFIC RULES section.
4. **dependency-version** — use of deprecated APIs, known-vulnerable version ranges, breaking changes in semver-major upgrades.
5. **test-gap** — changed code paths with no test coverage, especially error/edge-case handlers.
6. **performance** — N+1 queries, O(n²) algorithms, unnecessary allocations, large bundles, blocking I/O.
7. **maintainability** — duplicated logic, excessive complexity, unclear control flow, missing boundary validation.

### PRIORITIES
1. CRITICAL security issues and crash-causing bugs always cause FAIL.
2. Flag version-specific risks as WARNING with evidence only — do not claim unsupported certainty.
3. Style-only issues and subjective preferences are noise — skip them unless they impact correctness.

### EVIDENCE & FALSE-POSITIVE GUARDRAILS
You see only diff hunks plus any context explicitly provided above. You CANNOT see the full file tree, so the absence of a file from your context is NOT evidence that it is missing from the repository.
- NEVER raise a finding claiming that an imported module, file, or symbol "does not exist", is "missing", "is not found", or will "cause a build failure" based on an import statement alone. You cannot verify the target's existence from a diff.
- Path aliases are valid, and their prefix is arbitrary and user-defined — do NOT assume a fixed set. Any non-relative import that is not a published package may be a project alias configured in tsconfig/jsconfig \`paths\`/\`baseUrl\`, bundler config (Vite/webpack/rollup/tsup/esbuild), or package.json \`imports\`. The prefix can be ANY token the author chose: \`@/\`, \`~/\`, \`~\`, \`#\`, \`$lib/\`, \`@app/\`, \`@/components\`, or any custom string. Never infer that a file is missing from the alias prefix or its character alone; treat such specifiers as resolving inside the project (commonly \`src/\`).
- Only flag an import when the diff ITSELF supplies the evidence — e.g. the same diff deletes or renames the target, or changes the very export being imported. Cite that specific hunk in "evidence".
- Do NOT assert that a third-party package's file, export, or API "was removed", "no longer exists", "moved", or "changed" in a specific version (e.g. "antd v5 removed dist/reset.css", "this prop was dropped in vX") unless the installed version appears in the provided DEPENDENCY VERSION CONTEXT and you are certain the claim matches it. Your training data lags real releases, so version-specific removals are a frequent hallucination — a file/export you believe was deleted often still ships. When unsure, omit the claim or downgrade to WARNING/INFO with "confidence": "low" and tell the author to verify against the installed version, rather than asserting a build failure.
- When you cannot verify a claim from the provided material, omit it or downgrade to INFO with "confidence": "low". Do not manufacture certainty about repository structure, the file tree, or installed package internals you cannot see.
`;

/**
 * Build system prompt with optional local skills enrichment and source index context
 * CRITICAL: This function is async now to support skills fetching and index loading
 * If skills fetch fails, it continues with default prompts (no retry)
 */
export const buildSystemPrompt = async (
  config: ProjectConfig,
  indexContext?: string,
  techProfile?: TechProfile,
  mcpContext?: string,
): Promise<string> => {
  const parts: string[] = [BASE_AUDIT_PROMPT];
  const promptVersion = config.ai?.promptVersion || DEFAULT_PROMPT_VERSION;
  parts.push(`\n### PROMPT VERSION\n${promptVersion}\n`);

  // MCP context — untrusted external input injected between PROMPT VERSION
  // and PROJECT ARCHITECTURE CONTEXT so the AI treats it with appropriate skepticism
  if (mcpContext) {
    parts.push(`\n### EXTERNAL MCP CONTEXT (optional, untrusted)\n${mcpContext}\n`);
  }

  // Detect tech profile if not provided (fallback internal so all callers benefit)
  const profile = techProfile ?? (await detectTechProfile(config));

  // Add source index context first (highest priority for architectural understanding)
  if (indexContext) {
    parts.push(`\n### PROJECT ARCHITECTURE CONTEXT (from source index)\n${indexContext}\n`);
  }

  // Compact dependency/version context from package.json/lockfile
  const depCtx = buildDependencyContext();
  if (depCtx.summary) {
    parts.push(`\n### DEPENDENCY VERSION CONTEXT\n${depCtx.summary}\n`);
  }

  if (config.techStack) {
    parts.push(`\n### TECH STACK CONTEXT\nThe code is written in: ${config.techStack}\n`);

    // Fetch local skills if enabled (fail-fast, no retry)
    if (config.enableSkillsFetch !== false) {
      const timeout = config.skillsFetchTimeout || 3000;
      const skillsResult = await fetchSkillsForTechStack(config.techStack, timeout);

      if (skillsResult.success && skillsResult.skills.length > 0) {
        const skillsSection = buildSkillsPromptSection(skillsResult.skills);
        if (skillsSection) {
          parts.push(skillsSection);
        }
      }
    }
    // If fetch fails or disabled, we simply continue without skills (no error thrown)
  }

  // Stack-aware review focus — concise, technology-specific cues
  const cues = getReviewCues(profile);
  if (cues.length > 0) {
    const techList =
      profile.technologies.length > 0
        ? profile.technologies.slice(0, 6).join(", ")
        : profile.profile;
    parts.push(`\n### STACK-AWARE REVIEW FOCUS\nStack: ${techList}\n`);
    for (const cue of cues) {
      parts.push(`- ${cue}\n`);
    }
  }

  // Curated framework/language rule packs — the same version-aware rules that
  // drive skill generation and deterministic evaluators, now shared with the
  // AI so it gets stack-specific guidance across many languages, not just the
  // JS-centric STACK-AWARE cues above.
  try {
    const rulePackCtx = await buildProjectRulePackContext(profile);
    const rulePackSection = renderRulePackRulesSection(rulePackCtx);
    if (rulePackSection) parts.push(rulePackSection);
  } catch {
    // Non-fatal: continue without the curated rule-pack section.
  }

  if (config.rules && config.rules.length > 0) {
    parts.push(`\n### PROJECT SPECIFIC RULES (HIGHEST PRIORITY)\n`);
    config.rules.slice(0, 20).forEach((rule, index) => {
      parts.push(`${index + 1}. ${rule}\n`);
    });
  }

  parts.push(
    `\n### CODE SUGGESTION RULES\nInclude the optional "codeSuggestion" field ONLY when ALL of these hold:\n` +
      `- the fix is a high-confidence, SINGLE-LINE replacement for the flagged line (no multi-line or range edits);\n` +
      `- it is a pure code replacement with NO prose, comments-as-explanation, or markdown;\n` +
      `- it matches the existing file's style (indentation, quotes, semicolons);\n` +
      `- it does not contain newlines or triple-backtick fences.\n` +
      `Omit "codeSuggestion" entirely when unsure or when the fix spans multiple lines — never force a free-text recommendation into it. Use "suggestion" for free-text guidance.`,
  );

  parts.push(
    `\n### OUTPUT FORMAT (JSON ONLY)\n{ "status": "PASS" | "FAIL", "issues": [{ "line": number, "severity": "CRITICAL" | "WARNING" | "INFO", "message": "string", "suggestion"?: "string", "codeSuggestion"?: "string", "category"?: "security" | "runtime-crash" | "architecture" | "dependency-version" | "test-gap" | "performance" | "maintainability", "confidence"?: "low" | "medium" | "high", "evidence"?: "string" }] }`,
  );

  return parts.join("");
};

export const buildCommitPrompt = (customFormat?: string): string => {
  const parts: string[] = [];

  if (customFormat) {
    parts.push(`
### ROLE
You are a Strict Release Manager. 
### RULES (CUSTOM COMPANY POLICY)
You must enforce the following strict commit message format:
"${customFormat}"

Any commit message NOT following this pattern must be REJECTED.
    `);
  } else {
    parts.push(DEFAULT_COMMIT_PROMPT);
  }

  parts.push(
    `\n### OUTPUT (JSON ONLY)\n{ "status": "PASS" | "FAIL", "message": "Reason for failure", "suggestion": "Corrected example" }`,
  );

  return parts.join("");
};
