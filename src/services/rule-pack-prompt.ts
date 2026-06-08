/**
 * Bridge between the curated rule packs and the AI review prompt.
 *
 * The rule packs (`src/services/skills-generator/rule-packs`) carry detailed,
 * version-aware, per-language and per-framework guidance that previously fed
 * only skill generation and the deterministic evaluators. This module renders
 * the *active* packs for a project into a compact prompt section so the AI
 * review benefits from the same curated rules — improving accuracy and, for
 * non-JS stacks, stack-specific coverage the small `TECHNOLOGY_CUES` map lacks.
 */

import type { LanguageProfile, TechProfile } from "../types/index.js";
import { readPackageManifest } from "./source-index/manifest.js";
import { selectActiveRulePacks } from "./skills-generator/rule-packs/index.js";
import type { RulePackContext } from "./skills-generator/rule-packs/index.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Hard cap on rendered rules to keep the prompt focused and within budget. */
const MAX_RENDERED_RULES = 40;

/**
 * Map a technology keyword (substring) to a language-distribution key used by
 * the language-gated rule packs (`typescript-strict`, `python`, `go`, …).
 */
const LANGUAGE_KEYWORDS: ReadonlyArray<readonly [string, string]> = [
  ["typescript", "typescript"],
  ["tsx", "typescript"],
  ["javascript", "javascript"],
  ["jsx", "javascript"],
  ["python", "python"],
  ["django", "python"],
  ["flask", "python"],
  ["fastapi", "python"],
  ["golang", "go"],
  ["rust", "rust"],
  ["php", "php"],
  ["laravel", "php"],
  ["ruby", "ruby"],
  ["rails", "ruby"],
  ["svelte", "svelte"],
];

/**
 * Derive a coarse {@link LanguageProfile} from a tech profile's technology
 * keywords. Language packs only gate on which languages are present, so an
 * exact file-by-file distribution is unnecessary here.
 */
function deriveLanguageProfile(technologies: readonly string[]): LanguageProfile {
  const distribution: Record<string, number> = {};
  for (const tech of technologies) {
    const lower = tech.toLowerCase();
    for (const [keyword, lang] of LANGUAGE_KEYWORDS) {
      if (lower.includes(keyword)) distribution[lang] = (distribution[lang] ?? 0) + 1;
    }
  }
  // Standalone "go" is too short to substring-match safely; check word-equality.
  if (technologies.some((t) => t.toLowerCase() === "go")) {
    distribution["go"] = (distribution["go"] ?? 0) + 1;
  }

  const dominant = Object.entries(distribution).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";

  return {
    dominant,
    secondary: [],
    distribution,
    indexableShare: 1,
    nonIndexableHotspots: [],
  };
}

/** Best-effort read of the project's tsconfig compiler options. */
function readTsConfig(
  cwd: string,
): { compilerOptions: Record<string, unknown>; extends?: string } | undefined {
  try {
    const raw = readFileSync(join(cwd, "tsconfig.json"), "utf8");
    // Strip // and /* */ comments (tsconfig allows JSONC) before parsing.
    const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const parsed = JSON.parse(stripped) as {
      compilerOptions?: Record<string, unknown>;
      extends?: string;
    };
    return {
      compilerOptions: parsed.compilerOptions ?? {},
      ...(parsed.extends ? { extends: parsed.extends } : {}),
    };
  } catch {
    return undefined;
  }
}

/**
 * Build a {@link RulePackContext} for a project from its tech profile plus
 * on-disk manifest and tsconfig. Framework packs gate on `deps`; language
 * packs gate on the derived language profile.
 */
export async function buildProjectRulePackContext(
  techProfile: TechProfile,
  cwd: string = process.cwd(),
): Promise<RulePackContext> {
  let deps: Record<string, string> = {};
  try {
    const manifest = await readPackageManifest(cwd);
    deps = { ...manifest.dependencies, ...manifest.devDependencies };
  } catch {
    deps = {};
  }

  const tsConfig = readTsConfig(cwd);

  return {
    langProfile: deriveLanguageProfile(techProfile.technologies),
    frameworks: [],
    deps,
    ...(tsConfig ? { tsConfig } : {}),
  };
}

/**
 * Render the active rule packs for the given context into a compact prompt
 * section, or `null` when no packs are active. Rules are capped at
 * {@link MAX_RENDERED_RULES} to keep the prompt focused.
 */
export function renderRulePackRulesSection(ctx: RulePackContext): string | null {
  const { packs } = selectActiveRulePacks(ctx);
  if (packs.length === 0) return null;

  const lines: string[] = [
    "\n### FRAMEWORK & LANGUAGE BEST-PRACTICE RULES (curated, version-aware)",
    "Apply these stack-specific rules in addition to the rubric above. When changed code violates one, raise a finding with the matching category (usually architecture or maintainability) and cite the rule.",
  ];

  let rendered = 0;
  for (const pack of packs) {
    if (rendered >= MAX_RENDERED_RULES) break;
    if (pack.rules.length === 0) continue;

    lines.push(`\n**${pack.label}**`);
    for (const rule of pack.rules) {
      if (rendered >= MAX_RENDERED_RULES) break;
      const tag = rule.kind === "must" ? "MUST" : rule.kind === "should" ? "SHOULD" : "AVOID";
      lines.push(`- ${tag}: ${rule.text}`);
      rendered++;
    }
  }

  if (rendered === 0) return null;
  return `${lines.join("\n")}\n`;
}
