/**
 * Prompt templates for AI-powered code auditing
 */

import type { ProjectConfig } from '../types/index.js';
import { fetchSkillsForTechStack, buildSkillsPromptSection } from '../services/skills-fetcher.js';

export const DEFAULT_PROMPT_VERSION = "2026-02-16";

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
### GLOBAL STANDARDS
1. **Clean Code:** Variable/Function names must be semantic. No magic numbers.
2. **Split Code:** Suggest splitting complex functions/components.
3. **Performance:** Identify obvious bottlenecks.
4. **Error Handling:** Ensure proper boundary checks.
5. **Signal Quality:** Do not report style-only noise unless high-impact.
`;

/**
 * Build system prompt with optional skills.sh integration
 * CRITICAL: This function is async now to support skills fetching
 * If skills fetch fails, it continues with default prompts (no retry)
 */
export const buildSystemPrompt = async (config: ProjectConfig): Promise<string> => {
  const parts: string[] = [BASE_AUDIT_PROMPT];
  const promptVersion = config.ai?.promptVersion || DEFAULT_PROMPT_VERSION;
  parts.push(`\n### PROMPT VERSION\n${promptVersion}\n`);

  if (config.techStack) {
    parts.push(`\n### TECH STACK CONTEXT\nThe code is written in: ${config.techStack}\n`);
    
    // Fetch skills from skills.sh if enabled (fail-fast, no retry)
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

  if (config.rules && config.rules.length > 0) {
    parts.push(`\n### PROJECT SPECIFIC RULES (HIGHEST PRIORITY)\n`);
    config.rules.slice(0, 20).forEach((rule, index) => {
      parts.push(`${index + 1}. ${rule}\n`);
    });
  }

  parts.push(`\n### OUTPUT FORMAT (JSON ONLY)\n{ "status": "PASS" | "FAIL", "issues": [{ "line": number, "severity": "CRITICAL" | "WARNING" | "INFO", "message": "string", "suggestion": "string" }] }`);
  
  return parts.join('');
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
  
  parts.push(`\n### OUTPUT (JSON ONLY)\n{ "status": "PASS" | "FAIL", "message": "Reason for failure", "suggestion": "Corrected example" }`);
  
  return parts.join('');
};
