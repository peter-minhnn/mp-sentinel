/**
 * RulePack catalog — deterministic per-language and per-framework rule packs.
 *
 * Each pack has a `when()` predicate that checks the codebase's language profile,
 * detected frameworks, and dependency versions. Active packs are rendered into
 * the `## Language & Framework Rules` section in the generated SKILL.md.
 *
 * No AI calls — all rules are pre-written and versioned.
 */

import type { LanguageProfile } from "../../../types/index.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface RulePackContext {
  langProfile: LanguageProfile;
  frameworks: string[];
  deps: Record<string, string>;
}

export type RuleKind = "must" | "should" | "avoid";

export interface RulePackRule {
  kind: RuleKind;
  text: string;
}

/**
 * Result of a single evaluator check against a file.
 */
export interface FileEvaluatorResult {
  ruleId: string;
  passed: boolean;
  message: string;
  line: number;
  column?: number;
  severity: "CRITICAL" | "WARNING" | "INFO";
  suggestion?: string;
}

/**
 * A deterministic file-level check that takes file content and returns
 * zero or more findings. Evaluators are run BEFORE the AI call — they are
 * purely deterministic (no token cost) and produce findings in the same
 * shape as AI findings.
 */
export interface FileEvaluator {
  ruleId: string;
  evaluate: (params: {
    filePath: string;
    content: string;
    lines: string[];
    config?: Record<string, unknown>;
  }) => FileEvaluatorResult[];
}

export interface RulePack {
  id: string;
  label: string;
  when: (ctx: RulePackContext) => boolean;
  rules: RulePackRule[];
  fileGlobs: string[];
  /**
   * Optional deterministic evaluators that check file content against
   * this pack's rules. Results flow into the review pipeline as findings.
   * Each evaluator's ruleId should be unique: "<packId>/<ruleId>"
   */
  evaluators?: FileEvaluator[];
}

// ── Import all packs ────────────────────────────────────────────────────────

import { svelteRules } from "./svelte.js";
import { vueRules } from "./vue.js";
import { reactRules } from "./react.js";
import { nextRules } from "./next.js";
import { typescriptStrictRules } from "./typescript-strict.js";
import { pythonRules } from "./python.js";
import { goRules } from "./go.js";
import { rustRules } from "./rust.js";
import { astroRules } from "./astro.js";
import { solidRules } from "./solid.js";
import { angularRules } from "./angular.js";
import { nuxtRules } from "./nuxt.js";
import { dartRules } from "./dart.js";
import { flutterRules } from "./flutter.js";
import { phpRules } from "./php.js";
import { laravelRules } from "./laravel.js";
import { rubyRules } from "./ruby.js";
import { railsRules } from "./rails.js";
import { builtinRules } from "./builtin.js";

export const ALL_PACKS: RulePack[] = [
  builtinRules,
  svelteRules,
  vueRules,
  reactRules,
  nextRules,
  typescriptStrictRules,
  pythonRules,
  goRules,
  rustRules,
  astroRules,
  solidRules,
  angularRules,
  nuxtRules,
  dartRules,
  flutterRules,
  phpRules,
  laravelRules,
  rubyRules,
  railsRules,
];

// ── Selection ───────────────────────────────────────────────────────────────

export interface RulePackSelection {
  packs: RulePack[];
  allRules: RulePackRule[];
}

/**
 * Select active rule packs based on the codebase context.
 * Returns both the selected packs and the flattened rule list.
 */
export function selectActiveRulePacks(ctx: RulePackContext): RulePackSelection {
  const packs = ALL_PACKS.filter((p) => p.when(ctx));
  const allRules = packs.flatMap((p) => p.rules);
  return { packs, allRules };
}
