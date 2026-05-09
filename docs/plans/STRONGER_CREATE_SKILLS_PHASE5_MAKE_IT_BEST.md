# Phase 5 — `create-skills` Stronger Skills: Make It Best

> Phases 1–4 took the feature from broken-on-Svelte to shippable. They were corrective. Phase 5 is strategic. The question is no longer *"what's missing from the plan?"* but *"if we want this to be the best agent-skills generator on the market, what's next?"* This plan picks the five highest-leverage upgrades and orders them by impact.

---

## 1. Phase 4 verification — confirmed shippable

Spot-checked against the actual files:

* `parseGeneratorMajor()` exists at `src/services/skills-generator/metadata.ts:28`. ✓
* `src/__tests__/legacy-generator-version.test.ts` exists. ✓
* `docs/plans/PHASE4_FINAL_TRIAGE.md` exists. ✓
* `docs/CREATE_SKILLS.md` mentions `codeSamples`. ✓
* `WHATS_NEW.md` links to `docs/plans/MIGRATION_2.0_GENERATOR.md`. ✓
* `generatorVersionUpgrade` detection wired into `create-skills.ts` (3 files reference it). ✓
* Test suite reported 1642/1642 green; `release:check`, `dogfood`, `build` all green.

**Verdict:** Ship Phase 4 as v2.0.0 and start Phase 5 from a green baseline.

---

## 2. What "best" means for an agent-skills generator

There is a hierarchy of value:

```
   Generated rules exist                        ← Phase 1 baseline
   Generated rules are language-aware           ← Phase 1 rule packs
   Generated rules are codebase-specific        ← Phase 2 code samples
   Generated rules are accurate                 ← Phase 3+4 polish
   Generated rules are ENFORCED                 ← Phase 5A
   Generated rules are EXTENSIBLE               ← Phase 5B
   Generated rules are VERIFIED to change agent behaviour ← Phase 5C
   Generated rules are STABLE across releases   ← Phase 5D
   Generated rules cover 90% of real codebases  ← Phase 5E
```

Phase 5 climbs the last five rungs.

---

## 3. The five highest-leverage upgrades, ordered by impact

### 5A — Close the loop: rule violations become `mp-sentinel review` findings (HIGHEST IMPACT)

**Why this is first.** Today, rule packs *advise* the agent through SKILL.md. They don't *enforce*. If the agent (or a human) writes a `.svelte` file with imports outside `<script>`, nothing in `mp-sentinel review` catches it — even though the same rule lives in the SKILL.md the agent just read. That's the biggest disconnect in the whole system. Closing it doubles the perceived value of every rule pack, because each rule now lands in PR comments instead of just sitting in a markdown file.

**What ships:**

* New module `src/services/review/rule-pack-evaluator.ts`. For each changed file, select the active rule packs (same `selectActiveRulePacks(...)` already used by `create-skills`), run each pack's predicates against the actual file content, emit findings in the same shape as the AI review findings.
* Each `RulePack` gains an optional `evaluators: FileEvaluator[]` field where a `FileEvaluator` is a deterministic check that takes `{ filePath, content, ast?, sourceIndex }` and returns `{ passed, message, line, column }[]`. Packs can ship both advisory rules (text-only, for SKILL.md) and enforcement rules (with evaluators, for review). A single rule can be both.
* Wire findings into the existing review pipeline at the same point AI findings merge in. Threshold and exit-code semantics (0/1/2) unchanged.
* Net-new lines per pack:
  * Svelte: regex check that imports live inside `<script>`; that no top-level statements appear outside `<script>` / `<style>` / template; runes vs stores consistency for Svelte 5 projects.
  * React: detect `useEffect` with empty deps array but external references (Rules of Hooks lint); detect `<img>` use in Next.js projects (recommend `next/image`).
  * TypeScript-strict: detect bare `any` introduced by a diff line; detect new `// @ts-ignore` without a tracking comment.
  * Clean code: detect functions over the configured `maxFunctionLines`; files over `maxFileLines`.
* Configurable severity per rule via `.mp-sentinelrc.json`:
  ```jsonc
  "review": {
    "rulePackSeverity": {
      "svelte/imports-inside-script": "error",
      "clean-code/file-too-long": "warn"
    }
  }
  ```

**Acceptance:** A diff that adds `import { onMount } from 'svelte'` outside `<script>` in a `.svelte` file produces a review finding at the offending line. The same agent guidance in SKILL.md links to the same rule ID.

**Risk:** Evaluators that read full file content cost tokens / IO. Mitigation: evaluators run **before** the AI call, fully deterministically, and produce findings without any AI usage. They're free in the AI-cost sense.

### 5B — User-supplied rule packs: enterprise-ready extensibility

**Why this is second.** Every team has org-specific rules ("don't import from `internal/`", "service files must end in `.service.ts`", "all React components must be default export"). Built-in packs can't capture these. Without extensibility the upgrade caps out at popular OSS conventions.

**What ships:**

* New config block:
  ```jsonc
  "createSkills": {
    "rulePacks": {
      "include": ["./rules/*.rule-pack.ts", "./rules/team.rule-pack.json"],
      "exclude": ["python"],
      "extends": [
        { "from": "typescript-strict", "override": [
          { "id": "typescript-strict/no-any", "severity": "warn" }
        ] }
      ]
    }
  }
  ```
* Loader in `src/services/skills-generator/rule-packs/loader.ts`:
  * `.json` packs: validated by Zod against the same `RulePack` shape.
  * `.ts` packs: dynamic `import()` (treat the directory as trusted; document the security implications).
* Composition: `extends.from` references a built-in pack ID; `override` patches individual rules; `disable` removes them.
* Rule IDs become globally unique: `<packId>/<ruleId>` (e.g. `typescript-strict/no-any`). Packs and rules can be referenced by ID across the config.
* Generate a `references/custom-rules.md` showing which user packs are active, the rules they contribute, and where they came from. Keeps the SKILL.md auditable.

**Acceptance:** A team can drop `team.rule-pack.json` next to `.mp-sentinelrc.json` with rules like *"All React components must be default export"* and `create-skills` picks them up, lists them in `references/custom-rules.md`, and (with 5A wired) enforces them in `review`.

### 5C — Compliance harness: prove the rules actually change agent behaviour

**Why this matters.** The whole purpose of the upgrade is to make agents follow language-specific rules. We've assumed that handing them a richer SKILL.md works. We haven't measured. A compliance harness produces a score: *"With Stronger Skills v2.0.0, Claude Sonnet fixes the imports-outside-script error in 96% of trials versus 31% with the v1 SKILL.md."* That number is the upgrade's actual value proposition.

**What ships:**

* `scripts/compliance-harness.mjs` (new):
  1. Spins up the existing fixture projects under `src/__tests__/fixtures/` (Svelte, plus new ones in 5E).
  2. For each fixture, runs `create-skills` to produce a v2 SKILL.md and also serializes a synthetic v1 SKILL.md as the control.
  3. For a configurable provider (env-driven; defaults to no-op when no key is set so CI doesn't burn tokens), prompts the model with the same realistic edit task plus the SKILL.md as context. Example task: *"Add an `onMount` import to `src/lib/Bad.svelte`."*
  4. Captures the model's output, runs the same rule-pack evaluators from 5A against it, and writes a JSON result file.
  5. Aggregates across N trials per (provider, model, fixture, rule) and produces a `docs/COMPLIANCE_REPORT.md` table.
* CI nightly job (opt-in): runs the harness against the configured provider with budget caps. Posts a comparison comment on PRs that change `src/services/skills-generator/`.
* Local invocation: `npm run compliance` (off by default, requires opt-in env var so devs don't accidentally rack up tokens).

**Acceptance:** A reproducible report measures rule-compliance percentages by provider, model, and rule. New rules in 5A or 5B pick up coverage automatically.

### 5D — Snapshot tests + performance budget: lock the shape

**Why this matters.** Phases 1–4 added many sections, references, and rule packs. The output format is now load-bearing — downstream agent caches, fingerprints, and CI gates depend on it. Without snapshot tests, the next contributor will subtly drift the format and break consumers without anyone noticing. Likewise: `create-skills` now does language detection + style profiling + sample loading + scrubbing + lexical extraction + rule-pack selection. That's not free.

**What ships:**

* `src/__tests__/snapshots/` (new) — one snapshot per (adapter, fixture project) pair. Snapshots are content-addressed: filename includes a short hash of the inputs (`source-index.json` + config + `GENERATOR_VERSION`). When a snapshot mismatches, the diff is the regression.
* Snapshot runner uses Jest's `toMatchFileSnapshot` (or a hand-rolled equivalent): writes the new output beside the old, fails the test, and the dev runs `npm run test:update-snapshots` to accept.
* `scripts/perf-budget.mjs` (new): runs `create-skills --all-agents --no-ai` 10× over a representative fixture; computes wall-time P50/P95; fails if P95 exceeds the budget.
* Initial budget: P95 ≤ 3.0 s for a 200-file repo, P95 ≤ 8.0 s for a 1500-file repo (calibrate from real measurements before committing the number).
* Wire into CI as a gate; nightly trend dashboard via simple JSON history file.

**Acceptance:** Any change to a content section, adapter writer, or rule pack that affects the output produces a visible snapshot diff that has to be approved. Any change that pushes P95 above budget fails CI.

### 5E — Tier-1 language expansion: cover 90% of real codebases

**Why this matters.** The current built-in packs cover Svelte / Vue / React / Next / TS-strict / Python / Go / Rust. That's good, but a team picking up mp-sentinel today is statistically likely to be on **Astro**, **Solid**, **Angular**, **Spring/Java**, **C# / .NET**, **Ruby on Rails**, or **Laravel/PHP** and find no pack for their stack. Expanding coverage is a flywheel: more packs → more reasons to use the tool → more contributions back.

**What ships:**

* New rule packs (incremental commits, one per pack):
  * `astro.ts` — `.astro` file frontmatter, island hydration directives, `client:*` boundaries.
  * `solid.ts` — Reactive primitives (`createSignal`/`createMemo`), no destructured props.
  * `angular.ts` — Standalone components, `inject()` over constructor injection in v17+, signal usage.
  * `lit.ts` — Reactive properties, lifecycle, decorators.
  * `spring.ts` (Java) — `@Component` vs `@Service` vs `@Repository` placement, constructor injection over field, `@Transactional` boundaries.
  * `dotnet.ts` (C#) — Nullable reference types, `IDisposable` patterns, async naming.
  * `rails.ts` (Ruby) — Strong parameters, scopes vs class methods, `before_action` discipline.
  * `laravel.ts` (PHP) — Eloquent vs query builder, request validation, route model binding.
* **Promote Svelte/Vue from lexical extractor to a real tree-sitter parser** using `tree-sitter-svelte` (community grammar). Replaces the regex-based extractor with proper AST. Enables: function-level symbol extraction, accurate `<script>` boundary detection, type-only import distinction. Lexical fallback remains for grammars that aren't available.
* Each new pack ships with: built-in rules, two evaluators (so 5A enforcement applies), a fixture project under `src/__tests__/fixtures/<lang>-project/`, and a snapshot test.

**Acceptance:** `Grep "case \"" src/services/skills-generator/profile.ts` shows the new ecosystems in the profile detector. The compliance harness runs against at least one new fixture per pack and reports a non-zero baseline.

---

## 4. Cross-cutting upgrades worth considering (not headline items, but high return-on-effort)

| Idea | Effort | Payoff |
|---|---|---|
| Self-tuning policy thresholds: derive `maxFileLines` from the codebase's P95 file length instead of a static 500. Keep override. | Small | Removes one configuration step for new users; flags real outliers. |
| Per-directory rule overrides via globs (`{"globs": "tests/**", "maxFileLines": 800}`). | Small | Tests legitimately need to be longer than source; the global cap creates noise. |
| Rule pack metadata in the generated SKILL.md header (`activeRulePacks=svelte,typescript-strict`) so `--check` can detect pack-set drift. | Small | Today changing a rule pack doesn't invalidate cached SKILL.md content; this fixes that. |
| Output linting: run the SKILL.md through markdownlint as a post-step in `create-skills`. | Tiny | Catches hand-coded format bugs before they ship. |
| Anonymous opt-in telemetry: which rule packs activated, which AI provider, how often `--no-code-samples` is used. Off by default. | Medium | Makes prioritisation evidence-based instead of intuition-based. |
| `mp-sentinel rule-packs list/show/explain <id>` CLI verb for introspection. | Small | Makes the rule packs discoverable; today they're a black box. |
| Differential `--check`: when stale, output a JSON diff describing exactly what changed since last gen, so CI fixes can be precise. | Medium | Reduces "just regenerate" friction for large repos. |

Pick whichever land cleanly inside 5A–5E commits.

---

## 5. Order of execution

Each block is independently shippable:

```
5A → 5B → 5D → 5C → 5E
```

Rationale:
* **5A first** — biggest user-visible win. Rule packs go from advisory to enforced.
* **5B second** — extensibility unlocks early customer adoption while you finish the rest.
* **5D before 5C** — snapshot tests + perf budget protect every subsequent commit, including 5E's pack additions, from regressing the format or wall-time.
* **5C after 5D** — once snapshots are stable, the compliance harness has a reliable input to measure against. Doing 5C before 5D risks measuring a moving target.
* **5E last** — opportunistic; can ship pack-by-pack once the foundation is solid.

---

## 6. Acceptance criteria — Phase 5 best-in-class

1. **5A** A diff that introduces a Svelte rule violation (e.g. `import` outside `<script>`) produces a review finding with the exact rule ID; that same rule ID is referenced in the generated SKILL.md.
2. **5B** A user-supplied JSON rule pack at `./rules/team.rule-pack.json` activates without any code change to `mp-sentinel`, and its rules appear in both `references/custom-rules.md` and `mp-sentinel review` findings.
3. **5C** `npm run compliance -- --provider=anthropic --model=claude-sonnet-4-6` runs to completion (with a real key) and produces a report with non-zero violation counts. The same command exits 0 in dry-run mode without a key.
4. **5D** Any unintended change to SKILL.md output across any of the seven adapters fails a snapshot test. P95 wall time of `create-skills --all-agents --no-ai` over the calibration fixture stays under the budget.
5. **5E** At least three new ecosystem rule packs (Astro, Solid, Angular OR Spring/dotnet/Rails/Laravel) ship with rules + evaluators + fixtures + snapshots. Svelte and Vue are parsed via tree-sitter (no longer regex-only) and their lexical-fallback path is exercised only when grammars are missing.

---

## 7. Copy-paste agent prompt — Phase 5

> Phase 5 is large enough that running it as a single agent task is unlikely to fit a context window cleanly. Run each block (5A, 5B, 5D, 5C, 5E) as its own agent task using this same prompt with the chosen block's section as the focus.

```
ROLE
You are an experienced TypeScript / Node CLI engineer working inside the
mp-sentinel repository. Phases 1–4 of the create-skills upgrade shipped
cleanly (1642/1642 tests, release:check green, GENERATOR_VERSION 2.0.0).
Phase 5 is the strategic level-up: making the upgrade best-in-class. You
will execute exactly ONE of the five blocks listed in
docs/plans/STRONGER_CREATE_SKILLS_PHASE5_MAKE_IT_BEST.md (5A, 5B, 5C, 5D,
or 5E — pick the next one in the recommended order: 5A → 5B → 5D → 5C → 5E).

READ FIRST (in this exact order)
1. AGENTS.md (especially §1, §3, §4, §6, §7, §8)
2. CLAUDE.md
3. docs/plans/STRONGER_CREATE_SKILLS_PLAN.md
4. docs/plans/STRONGER_CREATE_SKILLS_PHASE2_GAP_CLOSURE.md
5. docs/plans/STRONGER_CREATE_SKILLS_PHASE3_FINAL_POLISH.md
6. docs/plans/STRONGER_CREATE_SKILLS_PHASE4_RELEASE_READINESS.md
7. docs/plans/STRONGER_CREATE_SKILLS_PHASE5_MAKE_IT_BEST.md (this plan)
8. The block you are about to execute.
9. The current state of files relevant to that block (named in the block).
10. `npm run agent:skills:check`; refresh if stale.

SCOPE DISCIPLINE
- Execute only the chosen block. Do not bundle work from other blocks.
- If you discover a gap in another block, document it as a TODO at the end
  of your summary; do not silently expand scope.
- Treat each rule pack / fixture / snapshot as a separate commit so a
  partial run can still be merged.

CONSTRAINTS (carry over from Phase 1–4)
- Never break exit-code semantics (0/1/2).
- Never modify the @mp-sentinel-generated marker string.
- Additive-only schema changes.
- Internal imports use .js extension; node:-prefix builtins; import type
  for type-only imports; no any.
- New tests live under src/__tests__/.
- Per AGENTS.md §7, every config / schema / flag change updates
  WHATS_NEW.md, docs/CHANGELOG.md, docs/COMMANDS_CHEAT_SHEET.md, and
  docs/CREATE_SKILLS.md in the same commit.
- Run the full verification chain before reporting done:
    npm run format:check
    npm run typecheck
    npm run typecheck:tests
    npm test          # MUST stay green
    npm run build
    npm run release:check

BLOCK-SPECIFIC GUIDANCE

5A — Review pipeline integration
- Add `evaluators?: FileEvaluator[]` to the RulePack type.
- Implement evaluators for at least: Svelte imports-outside-script, React
  Rules of Hooks subset, TS-strict bare-any in diff, clean-code
  maxFileLines / maxFunctionLines.
- Wire findings into the same channel as AI findings in src/cli/review.ts
  / src/cli/local-review.ts. Match severity from .mp-sentinelrc.json's
  review.rulePackSeverity.
- Findings emit a stable rule ID `<packId>/<ruleId>`. SKILL.md rendering
  must include the same ID so traceability is end-to-end.
- Do not cause new test failures. Snapshot tests added in 5D will catch
  format drift; for now, add focused unit tests covering each evaluator.

5B — User-supplied rule packs
- Add createSkills.rulePacks config block (include / exclude / extends).
- Implement loader at src/services/skills-generator/rule-packs/loader.ts;
  validate JSON packs with Zod, dynamic-import .ts packs.
- Composition: extends.from + override + disable.
- Generate references/custom-rules.md.
- Document the security implications of dynamic .ts loading in
  docs/CREATE_SKILLS.md.
- Test with a fixture custom pack at
  src/__tests__/fixtures/custom-rule-pack/.

5C — Compliance harness
- scripts/compliance-harness.mjs reads PROVIDER + MODEL from env;
  no-op when keys absent.
- Produces docs/COMPLIANCE_REPORT.md summarising rule compliance.
- Hook to run via npm run compliance.
- Add an opt-in CI workflow that posts comparison comments on PRs that
  change src/services/skills-generator/.
- Tests: dry-run path exits 0; report file is generated.

5D — Snapshot tests + performance budget
- src/__tests__/snapshots/ holds one snapshot per (adapter, fixture).
- Snapshot filename hashes the inputs so unrelated fixture additions do
  not invalidate other snapshots.
- npm run test:update-snapshots accepts new snapshots after manual review.
- scripts/perf-budget.mjs measures P50/P95; fails on regression.
- Calibrate the P95 budget from a fresh measurement; commit it after
  three clean runs.

5E — Tier-1 language expansion
- One commit per new rule pack (Astro, Solid, Angular, Spring, dotnet,
  Rails, Laravel — pick at least three to start).
- Each pack ships with: rules, evaluators (so 5A enforcement applies),
  a fixture project, and snapshot/quality-gate tests.
- Replace the lexical Svelte/Vue extractor with tree-sitter-svelte /
  tree-sitter-vue. Keep the lexical path as a fallback for environments
  where the grammars don't load.

ACCEPTANCE
- The block-specific acceptance criterion in PHASE 5 §6 holds.
- Full verification chain green.
- WHATS_NEW.md, docs/CHANGELOG.md, docs/COMMANDS_CHEAT_SHEET.md,
  docs/CREATE_SKILLS.md updated in the same commit as the user-facing
  change.

DELIVERABLES
- One block of Phase 5 fully executed and merged.
- A short summary listing: which evaluators / packs / snapshots /
  fixtures landed, the test count delta, the P95 wall time delta (if
  5D), and any TODOs surfaced for other blocks.
```

---

*After all five blocks of Phase 5 land, mp-sentinel's `create-skills` is — to my knowledge — the only OSS agent-skills generator that produces enforced, language-aware, codebase-specific rules with a measured compliance score. That is the bar for "best."*
