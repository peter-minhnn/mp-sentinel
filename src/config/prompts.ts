/**
 * Prompt templates for AI-powered code auditing
 */

import type { ProjectConfig, TechProfile } from "../types/index.js";
import { fetchSkillsForTechStack, buildSkillsPromptSection } from "../services/skills-fetcher.js";
import { detectTechProfile, getReviewCues } from "../services/tech-profile.js";
import { buildDependencyContext } from "../services/dependency-context.js";

export const DEFAULT_PROMPT_VERSION = "2026-05-04";

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
): Promise<string> => {
  const parts: string[] = [BASE_AUDIT_PROMPT];
  const promptVersion = config.ai?.promptVersion || DEFAULT_PROMPT_VERSION;
  parts.push(`\n### PROMPT VERSION\n${promptVersion}\n`);

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

  if (config.rules && config.rules.length > 0) {
    parts.push(`\n### PROJECT SPECIFIC RULES (HIGHEST PRIORITY)\n`);
    config.rules.slice(0, 20).forEach((rule, index) => {
      parts.push(`${index + 1}. ${rule}\n`);
    });
  }

  parts.push(
    `\n### OUTPUT FORMAT (JSON ONLY)\n{ "status": "PASS" | "FAIL", "issues": [{ "line": number, "severity": "CRITICAL" | "WARNING" | "INFO", "message": "string", "suggestion"?: "string", "category"?: "security" | "runtime-crash" | "architecture" | "dependency-version" | "test-gap" | "performance" | "maintainability", "confidence"?: "low" | "medium" | "high", "evidence"?: "string" }] }`,
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
