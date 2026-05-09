# Compliance Report

Generated: 2026-05-09T14:31:36.845Z
Provider: dry-run
Model: none
Trials per fixture: 1
Mode: DRY RUN (no LLM calls)

## Summary

| Fixture | Rule | v1 Compliance | v2 Compliance | Delta | Trials |
|---|---|---|---|---|---|
| svelte-imports | svelte/imports-inside-script | 0% | 100% | +1 | 1 |
| **Overall** | | **0%** | **100%** | **+1** | 1 |

## Methodology

1. For each fixture, generate a v2 SKILL.md with enriched rules.
2. Send the edit task plus SKILL.md as context to dry-run/none.
3. Evaluate the model's output using the same rule-pack evaluators.
4. Repeat for v1 baseline (v2 SKILL.md with new sections stripped).
5. 1 trials per (fixture, version) pair.

## Fixtures

### svelte-imports
- Bad file: `src/routes/Bad.svelte`
- Edit task: Move the `import { onMount }` statement inside the `<script lang="ts">` block in `src/routes/Bad.svelte`.
- Evaluator rule: `svelte/imports-inside-script`

---

> **Dry run.** No LLM calls were made. Set COMPLIANCE_PROVIDER and
> COMPLIANCE_MODEL with a valid API key for real measurements.
