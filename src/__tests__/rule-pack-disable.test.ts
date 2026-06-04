/**
 * Tests for Phase 4.3 -- `createSkills.disableRules` honored at selection
 * time. Adding `id` fields to existing rules is opt-in; rules without ids
 * are kept regardless of what's in the disable list.
 */

import { describe, expect, it } from "@jest/globals";
import {
  applyDisabledRules,
  selectActiveRulePacks,
  type RulePackRule,
} from "../services/skills-generator/rule-packs/index.js";
import type { LanguageProfile } from "../types/index.js";

const minimalCtx = (frameworks: string[] = []) => ({
  langProfile: {
    dominant: "typescript",
    secondary: [],
    distribution: { typescript: 1 },
    indexableShare: 1,
    nonIndexableHotspots: [],
  } satisfies LanguageProfile,
  frameworks,
  deps: {} as Record<string, string>,
});

describe("applyDisabledRules", () => {
  it("returns a copy when nothing is disabled", () => {
    const rules: RulePackRule[] = [
      { kind: "must", text: "rule a", id: "x/a" },
      { kind: "should", text: "rule b" },
    ];
    const out = applyDisabledRules(rules, undefined);
    expect(out).toEqual(rules);
    // Not the same reference -- caller mutating it must not affect inputs.
    expect(out).not.toBe(rules);
  });

  it("drops rules whose id is in the disable list", () => {
    const rules: RulePackRule[] = [
      { kind: "must", text: "keep", id: "x/keep" },
      { kind: "must", text: "drop", id: "x/drop" },
      { kind: "should", text: "no-id rule" },
    ];
    const out = applyDisabledRules(rules, ["x/drop"]);
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.text)).toEqual(["keep", "no-id rule"]);
  });

  it("keeps rules without an `id` even when the list is non-empty", () => {
    const rules: RulePackRule[] = [{ kind: "should", text: "no-id" }];
    expect(applyDisabledRules(rules, ["anything"])).toEqual(rules);
  });
});

describe("selectActiveRulePacks honors disableRules (Phase 4.3)", () => {
  it("returns disabledRuleIds for ids that actually matched", () => {
    // We don't know which rule ids exist today (most packs haven't been
    // migrated yet), so test the symbolic behavior: disabling an id that
    // doesn't exist should not show up in disabledRuleIds.
    const { disabledRuleIds } = selectActiveRulePacks(minimalCtx(), ["definitely/not-a-real-rule"]);
    expect(disabledRuleIds).toEqual([]);
  });

  it("filters rules in-place by id when present", () => {
    // Use the synthetic helper directly to avoid coupling to which real
    // rule ids exist today.
    const rules: RulePackRule[] = [
      { kind: "must", text: "rule a", id: "test/a" },
      { kind: "must", text: "rule b", id: "test/b" },
    ];
    const filtered = applyDisabledRules(rules, ["test/a"]);
    expect(filtered.map((r) => r.id)).toEqual(["test/b"]);
  });
});
