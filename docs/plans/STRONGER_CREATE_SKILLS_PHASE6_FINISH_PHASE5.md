# Phase 6 — `create-skills` Stronger Skills: Finish Phase 5

> Phase 5 shipped four of the five blocks. The fifth (5C — compliance harness) was skipped despite the summary's *"All five Phase 5 blocks are complete"* claim, and the `npm test` baseline regressed from green (1642/1642 in Phase 4) to four-failing (1668/1672 in Phase 5). One additional block (5A) shipped without dedicated tests. Phase 6 closes those three issues. Small, finite, then truly done.

---

## 1. Phase 5 verification — what's confirmed and what's missing

### Confirmed shipped (verified against the file system)

* **5A — Review pipeline integration.** All rule-pack files exist under `src/services/skills-generator/rule-packs/` including `evaluator.ts`, `builtin.ts`, `evaluators/svelte-evaluators.ts`, `evaluators/clean-code-evaluators.ts`. `rulePackSeverity` and `RulePackEvaluator` are referenced from `src/cli/review.ts` and `src/cli/deterministic-review.ts`. ✓
* **5B — User-supplied rule packs.** `loader.ts`, `src/__tests__/rule-pack-loader.test.ts`, `src/__tests__/fixtures/custom-rule-pack/team-rules.json` all exist. ✓
* **5D — Snapshot tests.** `src/__tests__/snapshot-generator.test.ts` and `src/__tests__/__snapshots__/snapshot-generator.test.ts.snap` exist. ✓
* **5E — Tier-1 language packs.** `astro.ts`, `solid.ts`, `angular.ts` exist; `src/__tests__/rule-packs-5e.test.ts` exists. ✓

### Skipped or incomplete

| # | Severity | Issue | Evidence |
|---|---|---|---|
| **I1** | **Block skipped** | Phase 5 plan listed five blocks: 5A, 5B, 5C, 5D, 5E. The Phase 5 summary table only contains rows for 5A, 5B, 5D, 5E. Block 5C (compliance harness) was silently dropped. The summary still claims *"All five Phase 5 blocks are complete."* | `Glob "scripts/compliance-harness.mjs"` → not found. `Glob "docs/COMPLIANCE_REPORT.md"` → not found. `Grep "compliance"` in `package.json` → 0 hits (no `npm run compliance` script). 5C was the block that produces the actual upgrade value-proposition number — *"agents follow rules X% of the time with v2 vs Y% with v1"* — and is missing entirely. |
| **I2** | **Acceptance regression** | Phase 4 ended green at 1642/1642. Phase 5 ends at 1668/1672 — four tests now fail. The summary classifies them as *"4 pre-existing release-check only"* but Phase 4 explicitly fixed those (E1 acceptance). The four failures are almost certainly Phase 5 regressions, not pre-existing. The Phase 5 plan acceptance was *"npm test MUST stay green."* | Phase 4 summary: *"1642/1642 pass, 0 failures."* Phase 5 summary: *"1668/1672 pass (4 pre-existing release-check only)."* If Phase 4 truly fixed them, they cannot also be pre-existing now. |
| **I3** | **Test gap on highest-impact block** | Phase 5's biggest functional addition (5A — making rule violations show up as review findings) shipped with **+0 dedicated tests** per the summary. `rule-pack-loader.test.ts` tests 5B; `snapshot-generator.test.ts` tests 5D; `rule-packs-5e.test.ts` tests 5E. There is no `evaluator.test.ts` or `rule-pack-review-integration.test.ts`. The system could silently stop enforcing rules and nobody would notice. | `Glob "src/__tests__/evaluator*"` and similar return nothing. The summary itself records *"5A +0 (integrated)"* in the test-delta column. |
| **I4** | **Plumbing gap** | The Phase 5 summary claims `scripts/perf-budget.mjs` exists with *"P95: 0.27s"*, but `package.json` `scripts` block has no `perf-budget` entry. So either the script exists but is unwired (no `npm run perf-budget`), or the P95 number was measured manually and not committed as a budget gate. | `Grep "perf-budget"` in `package.json` → 0 hits. Without a wired script + CI gate, the budget cannot be enforced on subsequent commits. |

**Net assessment.** Phases 1–4 plus 5A, 5B, 5D, 5E land a meaningful upgrade. But the *measurement* and *guard rails* that 5C was supposed to provide are missing, the 5A integration is untested, and the test suite regressed. Phase 6 closes those.

---

## 2. Phase 6 plan — three commits

### F1 — Triage and fix the four new failures (closes I2)

The summary's *"pre-existing"* label is implausible. Phase 4 §E1 fixed every release-check-related failure with verbatim Jest evidence. If Phase 5 reverted those fixes or introduced four new ones, that needs to be classified honestly.

**Procedure:**

```sh
npm test -- --json --outputFile=/tmp/jest-phase6.json 2>&1 | tail -200
node -e "const j=require('/tmp/jest-phase6.json'); j.testResults.filter(r=>r.numFailingTests>0).forEach(r=>{ console.log(r.testFilePath); r.testResults.filter(t=>t.status==='failed').forEach(t=>console.log('  -',t.fullName,'\n   ',t.failureMessages?.[0]?.split('\n')[0])); })"
```

For each of the four failures, write a row in `docs/plans/PHASE6_TEST_TRIAGE.md`:

```
#N — <file>::<test name>
  observed: <verbatim Jest failure message>
  reads:    <file path actually opened>
  content:  <relevant lines>
  classification:
    [ ] truly pre-existing (failed before Phase 4 too)
    [ ] phase-5 regression (worked at end of Phase 4, broken now)
    [ ] new-required (Phase 5 should have added a fixture / pointer; missed it)
  fix: <one-line description>
```

To verify the *truly-pre-existing* classification: `git stash && git checkout <last-phase-4-commit> && npm test -- <test-pattern>` shows whether the test was red or green before Phase 5 touched anything.

**Acceptance:** `npm test` exits 0; `docs/plans/PHASE6_TEST_TRIAGE.md` exists with verifiable evidence per row.

### F2 — Backfill the missing 5A tests (closes I3)

5A is the single most impactful block in Phase 5 — it turns rule packs from advisory to enforced. Shipping it with no dedicated test file is a regression-magnet.

**Files:**

* `src/__tests__/rule-pack-evaluator.test.ts` (new) — covers the evaluator engine itself:
  * Each shipped evaluator (`svelte-evaluators.ts`, `clean-code-evaluators.ts`) given valid input → no findings.
  * Each given a known-bad input → the expected finding at the expected line/column with the expected rule ID.
  * Severity override via `.mp-sentinelrc.json review.rulePackSeverity` is honored.
  * Active-pack selection matches the same selection used by `create-skills`.
* `src/__tests__/rule-pack-review-integration.test.ts` (new) — covers the review-pipeline integration:
  * A diff that introduces an `import` outside `<script>` in a `.svelte` file produces a finding in the same channel as AI findings.
  * The exit code respects the configured severity (warn → no exit-code change; error → exit 1).
  * Findings carry the `<packId>/<ruleId>` form so they trace back to SKILL.md.
  * Disabling a pack via `createSkills.rulePacks.exclude` removes its findings from review output.
* Add at least one fixture under `src/__tests__/fixtures/svelte-project/` representing a *fix* (good code) so the evaluator's no-finding path is also covered.

**Acceptance:** Both new test files pass; coverage of `rule-packs/evaluator.ts` and `rule-packs/evaluators/*` reaches > 80% lines.

### F3 — Ship 5C (compliance harness) — the missing block (closes I1)

This is the block that produces the upgrade's actual value-proposition number. Without it, *"language-aware rule packs make agents better"* remains an assumption.

**Files:**

* `scripts/compliance-harness.mjs` (new):
  1. Reads provider + model from env (`COMPLIANCE_PROVIDER`, `COMPLIANCE_MODEL`); when unset, runs in **dry-run** mode that exercises every codepath but does not call any LLM.
  2. For each fixture under `src/__tests__/fixtures/<lang>-project/`:
     * Generates a v2 SKILL.md (`mp-sentinel create-skills --agent claude`).
     * Composes a synthetic v1 SKILL.md as the control (strip the four new sections and the references files; keep everything else).
  3. For each (fixture, version, trial-index) tuple:
     * Sends the model a realistic edit task (e.g. *"Add an `onMount` import to `src/lib/Bad.svelte` so it runs on mount."*) plus the SKILL.md as context.
     * Captures the model's output, runs the same evaluators from F2 against it.
  4. Writes a `docs/COMPLIANCE_REPORT.md` (regenerated each run) with:
     * One table per (fixture, rule) showing v1 % compliance, v2 % compliance, delta, sample count.
     * Per-provider, per-model breakdowns.
     * The exact prompt and SKILL.md inputs used (so results are reproducible).
* `package.json` — add scripts:
  ```jsonc
  "compliance": "node scripts/compliance-harness.mjs",
  "compliance:dry": "COMPLIANCE_DRY_RUN=1 node scripts/compliance-harness.mjs"
  ```
* `src/__tests__/compliance-harness.test.ts` — `npm run compliance:dry` exits 0 and produces a non-empty `docs/COMPLIANCE_REPORT.md`. No real LLM call.
* CI — opt-in nightly job at `.github/workflows/compliance.yml` (gated on `secrets.COMPLIANCE_PROVIDER_KEY`) that runs the harness against the configured provider with budget caps and posts a comment on PRs that change `src/services/skills-generator/`.
* Wire `perf-budget.mjs` (closes I4): add `"perf-budget": "node scripts/perf-budget.mjs"` to `package.json` `scripts` and add a workflow step that runs it on every PR.

**Acceptance:** `npm run compliance:dry` exits 0 and produces `docs/COMPLIANCE_REPORT.md`. `npm run compliance` with a real provider key produces a report with non-zero violation counts for v1 SKILL.md and meaningfully lower counts for v2 SKILL.md across the Svelte fixture (the original symptom).

---

## 3. Acceptance criteria — Phase 6 done

1. `npm test` exits 0 — **zero** failing tests, with `docs/plans/PHASE6_TEST_TRIAGE.md` providing verifiable evidence for the disposition of every previously-failing test.
2. `src/__tests__/rule-pack-evaluator.test.ts` and `src/__tests__/rule-pack-review-integration.test.ts` exist and pass; coverage of `rule-packs/evaluator.ts` and `rule-packs/evaluators/*` ≥ 80% lines.
3. `npm run compliance:dry` exits 0 and produces `docs/COMPLIANCE_REPORT.md`.
4. `npm run perf-budget` is wired in `package.json` scripts and exits 0 against the calibration fixture.
5. `npm run release:check` exits 0; `npm run dogfood` exits 0; `npm run build` exits 0.
6. WHATS_NEW.md and `docs/CHANGELOG.md` document 5A, 5B, 5C, 5D, 5E (per AGENTS.md §7 — the same-commit doc rule).

---

## 4. Process note (one-time observation)

Across Phases 2, 3, 5, and now 6, a recurring pattern is that the implementation-summary message has classified failing tests as "pre-existing" without producing the verifiable evidence the plans required. Phase 4 broke this pattern — `PHASE4_FINAL_TRIAGE.md` was written with verbatim Jest output and forced the discovery that the *previous* triage doc had misclassified the root cause. Phase 5's summary slid back into the old pattern (4 failures called "pre-existing" with no triage), and additionally the *"all five blocks complete"* sentence is contradicted by the table directly underneath it (only four rows).

This is not a code issue, it is a process one. For Phase 6 specifically: the agent prompt below requires verbatim Jest output for any failure classified as pre-existing, plus a `git checkout <pre-phase> && npm test` cross-check. Two-line cost, large credibility return.

---

## 5. Copy-paste agent prompt — Phase 6

```
ROLE
You are an experienced TypeScript / Node CLI engineer working inside the
mp-sentinel repository. Phases 1–4 shipped cleanly. Phase 5 shipped 4 of
its 5 blocks (5A, 5B, 5D, 5E) and regressed `npm test` from green
(1642/1642 at end of Phase 4) to four-failing (1668/1672). Block 5C
(compliance harness) was silently dropped. Your job is to close those
three issues in three focused commits.

READ FIRST (in this exact order)
1. AGENTS.md (especially §1, §7, §8)
2. CLAUDE.md
3. docs/plans/STRONGER_CREATE_SKILLS_PHASE5_MAKE_IT_BEST.md (Phase 5 plan)
4. docs/plans/STRONGER_CREATE_SKILLS_PHASE6_FINISH_PHASE5.md (this plan)
5. docs/plans/PHASE2_TEST_TRIAGE.md and docs/plans/PHASE4_FINAL_TRIAGE.md
   — read both. Phase 4's was rigorous (verbatim Jest output, forced
   discovery that Phase 2's classification was wrong). Phase 6 must
   match Phase 4's standard, not Phase 2's.
6. Current state of:
   - scripts/release-check.mjs
   - src/services/skills-generator/rule-packs/evaluator.ts (no test file
     exists; you must add one)
   - src/services/skills-generator/rule-packs/evaluators/*.ts
   - src/cli/review.ts and src/cli/deterministic-review.ts (where 5A is
     integrated)
   - package.json scripts (no `compliance` or `perf-budget` script)
7. Run `npm test -- --json --outputFile=/tmp/jest-phase6.json 2>&1`
   BEFORE editing anything.
8. Run `git log --oneline -20` to find the last green commit (end of
   Phase 4) for the cross-check in F1.

GOAL
Take Phase 5's "1668/1672 pass, 5C skipped, 5A untested" to "fully green
test suite, 5A backed by ≥80% coverage tests, and 5C shipped with a
working dry-run path." After Phase 6 lands, the entire Stronger Skills
upgrade — Phases 1 through 5 — is genuinely complete.

CONSTRAINTS (carry over)
- Never break exit-code semantics (0/1/2).
- Additive-only schema changes.
- New tests in src/__tests__/.
- AGENTS.md §7 same-commit doc rule applies.
- Internal imports use .js extension; node:-prefix builtins; import type
  for type-only imports; no any.

PROCESS DISCIPLINE FOR THIS PHASE
- Any test failure classified as "pre-existing" requires:
    (a) verbatim Jest output in PHASE6_TEST_TRIAGE.md, AND
    (b) a `git checkout <last-green-phase-4-commit> -- <test-file> &&
         npm test -- <test-pattern>` showing the same test was red on
         the green-baseline commit.
  No paraphrasing. No "this looks like" classifications. Either the
  evidence supports the label or the label is wrong.
- The summary message at the end must contain the verbatim Jest output
  for any failure that remains, not just a count.

PLAN OF WORK (three commits)

Commit F1 — Triage and fix the 4 failures
- Run npm test, capture failures.
- Write docs/plans/PHASE6_TEST_TRIAGE.md with one row per failure using
  the template in PHASE 6 §F1 (verbatim Jest output, file content read,
  cross-check against last green commit, classification, fix).
- Fix all 4. Acceptance: npm test exits 0.

Commit F2 — Backfill missing 5A tests
- Add src/__tests__/rule-pack-evaluator.test.ts covering the evaluator
  engine and each shipped evaluator.
- Add src/__tests__/rule-pack-review-integration.test.ts covering the
  review-pipeline integration (rule-id traceability, severity overrides,
  exclude-via-config).
- Add a "good code" fixture so the no-finding path is also covered.
- Acceptance: both new test files pass; coverage of evaluator code
  ≥ 80%.

Commit F3 — Ship 5C compliance harness + wire perf-budget
- scripts/compliance-harness.mjs as described in PHASE 6 §F3 with
  COMPLIANCE_PROVIDER / COMPLIANCE_MODEL env-driven configuration; dry
  run when unset.
- package.json scripts: "compliance", "compliance:dry", "perf-budget".
- src/__tests__/compliance-harness.test.ts validating the dry-run path.
- .github/workflows/compliance.yml as opt-in nightly + PR comment on
  changes to src/services/skills-generator/.
- Update WHATS_NEW.md, docs/CHANGELOG.md, docs/COMMANDS_CHEAT_SHEET.md,
  docs/CREATE_SKILLS.md to document compliance-harness, perf-budget,
  and the 5A/5B/5D/5E blocks (per AGENTS.md §7 — Phase 5 missed these).

ACCEPTANCE CHECKS
- npm test exits 0.
- npm run compliance:dry exits 0; docs/COMPLIANCE_REPORT.md exists and
  is non-empty.
- npm run perf-budget is wired in package.json and exits 0.
- npm run release:check, npm run dogfood, npm run build all exit 0.
- docs/plans/PHASE6_TEST_TRIAGE.md exists with verifiable evidence for
  every previously-failing test.
- WHATS_NEW.md and docs/CHANGELOG.md mention the compliance harness,
  perf-budget, and the four 5x blocks.

DELIVERABLES
- Three commits matching this plan.
- A summary listing: which 4 tests were red (verbatim) and how each
  was resolved, the dry-run compliance report path, the perf-budget
  P95 measured by the wired script, and the final test count.
```

---

*After Phase 6, every block from Phase 5's "make it best" plan has actually shipped, every commit is backed by tests, and the compliance harness produces the measurable evidence that the entire upgrade is worth the work.*
