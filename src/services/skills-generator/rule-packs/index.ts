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
  /**
   * Stable identifier for this rule (Phase 4.3). Format: `<packId>/<rule-id>`.
   * Optional for backward compatibility with rule packs that haven't been
   * migrated yet -- rules without an id can't be selectively disabled.
   */
  id?: string;
}

/**
 * Filter out rules whose id appears in the user's `disableRules` list
 * (Phase 4.3). Rules without an `id` field are always kept -- they can't
 * be targeted by the opt-out mechanism.
 */
export const applyDisabledRules = (
  rules: readonly RulePackRule[],
  disableRules: readonly string[] | undefined,
): RulePackRule[] => {
  if (!disableRules || disableRules.length === 0) return [...rules];
  const disabled = new Set(disableRules);
  return rules.filter((r) => !r.id || !disabled.has(r.id));
};

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
  /** Rule ids removed via `createSkills.disableRules` (Phase 4.3). */
  disabledRuleIds: string[];
}

/**
 * Select active rule packs based on the codebase context.
 * Returns both the selected packs and the flattened rule list, with
 * `createSkills.disableRules` honored (Phase 4.3) when provided.
 */
export function selectActiveRulePacks(
  ctx: RulePackContext,
  disableRules?: readonly string[],
): RulePackSelection {
  const packs = ALL_PACKS.filter((p) => p.when(ctx));
  const rawRules = packs.flatMap((p) => p.rules);
  const allRules = applyDisabledRules(rawRules, disableRules);
  const allowedIds = new Set(allRules.map((r) => r.id).filter((id): id is string => !!id));
  const disabledRuleIds = (disableRules ?? []).filter((id) =>
    rawRules.some((r) => r.id === id && !allowedIds.has(id)),
  );
  return { packs, allRules, disabledRuleIds };
}
