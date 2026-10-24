# Known test flakes

Tracked separately from feature work: a suite that fails once and passes on
re-run is not "fixed", and re-running until green hides the cause.

## `npm test` reports 1 failure with no visible failing test — IDENTIFIED, not a flake (2026-09-05)

**Symptom as first seen:** the summary line read `Tests: 1 failed, N passed`
while the captured output showed no `✕`, no `●` block, and no
`Summary of all failing tests`. Re-running usually passed. It looked random and
appeared roughly one run in six across a long session.

**Actual cause:** `src/tests/script-workflows.test.ts` →
`agent-skills-check.mjs › exits 0 when only legacy advisories exist (current
project state)` runs `npm run agent:skills:check` against the **live
checkout**. Generated skills are local-only artifacts keyed to a source hash,
so any *structural* source change (a new or renamed exported symbol, a new
file) marks all 124 of them stale and the script exits 1.

**Proof:** appending `export function __skillsStalenessProbe() { return 1; }`
to `src/utils/tokens.ts` turns `agent:skills:check` from
`up-to-date=124, stale=0 -> ok` into `up-to-date=0, stale=124 -> stale`, and
that test fails immediately. `npm run agent:skills:refresh` restores both. A
comment-only edit does not trigger it, which is why the failure looked
intermittent: it tracked structural edits, not time.

Every occurrence in the session that surfaced it followed a batch of structural
edits (new modules `emit-policy.ts`, `agent-context-pack.ts`,
`agent-context-evidence.ts`, `mcp-review-tools.ts`, `indexing-agent-context.ts`
and new exports such as `rankTaskCandidates`), and every "passed on re-run"
followed a `npm run agent:skills:refresh` or a suite that regenerated the
skills as a side effect.

**Why the failure was invisible:** the assertion was a bare
`expect(result.exitCode).toBe(0)` on a spawned script, so jest printed an exit
code with no context and the script's own `-> stale` line never reached the
report.

**Fix applied:** the test now throws with the script's stdout/stderr and the
remedy (`npm run agent:skills:refresh`) when the check fails, so the next
occurrence reads as a checkout-state problem instead of a phantom flake.

**Residual, by design:** the test still gates the live checkout, so it will
fail for anyone who edits source structurally without refreshing generated
skills. That is the documented workflow (`CLAUDE.md` → "Agent skills — always
current before coding"); the gate is intentional, only its message was bad.
