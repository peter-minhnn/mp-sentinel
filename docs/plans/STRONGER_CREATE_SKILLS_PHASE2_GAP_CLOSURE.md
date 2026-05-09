# Phase 2 — `create-skills` Stronger Skills: Gap Closure

> Phase 1 (the eight PRs in `STRONGER_CREATE_SKILLS_PLAN.md`) shipped the bulk of the upgrade, but a spot-check of the actual files against the plan's contracts found three correctness/security gaps and several missed deliverables. This plan closes them.

---

## 1. Review of the Phase 1 ship

### What landed correctly

* `LanguageProfile` and `CodeStyleProfile` modules exist with passing unit tests.
* Eight rule packs exist under `src/services/skills-generator/rule-packs/`.
* `ENRICHMENT_PROMPT_VERSION` was bumped to `2026-05-08`. ✓
* `AIEnrichmentInput` extended with `codeSamples`, `languageMix`, `codeStyleProfile`, `policies`, `observedAntiPatterns`. ✓
* `AIEnrichmentOutput` extended additively with `rulesByLanguage`, `cleanCodeRules`, `antiPatterns`, `styleEnforcement`. ✓
* `claude.adapter.ts` writes the three new reference files (`code-style.md`, `language-patterns.md`, `clean-code-checklist.md`) and adds the new SKILL.md sections (`languageRules`, `cleanCodePolicy`, `fileSizePolicy`). ✓
* `cursor.adapter.ts` embeds the three new sections inline (correct for the single-file `.mdc` shape). ✓
* Svelte / Vue lexical extractors exist with tests.

### Gaps found by spot-check

| # | Severity | Gap | Evidence |
|---|---|---|---|
| **G1** | **Security regression** | The AI prompt advertises "code samples (scrubbed)" but no scrubber is wired. Code samples flow from disk straight into the LLM prompt. | `ai-enrichment.ts:267` has the comment `// v2: Code samples (scrubbed)` — the *only* match for `scrub` / `redact` / `secret` in the whole `skills-generator/` directory. `src/services/security/` is never imported by the enrichment path. |
| **G2** | **Dead code** | `create-skills` never populates `codeSamples`, so AI Enrichment v2 cannot run. The whole AI quality jump is wired internally but unreachable from the CLI. | `Grep` for `codeSamples` in `src/commands/create-skills.ts` → 0 hits. The plumbing exists in `ai-enrichment.ts` but the command never builds `AIEnrichmentConfig.codeSamples`. |
| **G3** | **Plan deviation** | Only the Claude adapter writes the three new reference files. The plan said *"every adapter that produces a skill folder"* must surface them. `codex`, `antigravity`, `cline`, `generic` adapters do not. | `Grep` for `references.codeStyle\|references.languagePatterns\|references.cleanCodeChecklist` across adapters returned only `claude.adapter.ts`. |
| **G4** | **Test failure under-counted** | The summary says "1574/1610 pass (36 pre-existing failures)" but PR 7 was contractually obliged to update `src/__tests__/quality-gate.test.ts` and `src/__tests__/create-skills.test.ts` to know about the new files/sections. New file-count assertions, new SKILL.md sections, and additional output paths almost certainly fail those existing tests. The 36 "pre-existing" failures need to be triaged — some are likely regressions introduced by Phase 1. | The plan's PR 7 explicitly listed these tests; the summary did not list any update to them. |
| **G5** | **Convention violation** | New tests live next to source (e.g. `src/services/skills-generator/language-profile.test.ts`) but the project's test convention is `src/__tests__/*.test.ts` (Jest config + `tsconfig.tests.json`). Whether the new co-located tests are picked up by Jest needs verification. | `Glob` shows the new `*.test.ts` files in service directories, none under `src/__tests__/`. |
| **G6** | **Plan deliverable missed** | No Svelte fixture project, no end-to-end test asserting the user's original failure mode (Svelte agent missing `<script>` import rule). The user's stated acceptance criterion is unverified. | No `src/__tests__/fixtures/svelte-project/` in the file list. |
| **G7** | **`AGENTS.md §7` violation** | New config key `createSkills.policies` and the schema bumps require updates to `WHATS_NEW.md`, `docs/CHANGELOG.md`, `docs/COMMANDS_CHEAT_SHEET.md`, `docs/CREATE_SKILLS.md`. Not mentioned in the summary. | Summary lists no docs commits. |
| **G8** | **Cache invalidation only half-done** | `ENRICHMENT_PROMPT_VERSION` bumped (good), but `generatorVersion` (which `--check` uses) was not. After upgrade, existing generated SKILL.md files will not be flagged stale, even though their content shape changed. | Summary mentions only the prompt-version bump; `metadata.ts` `generatorVersion` source still pulls from package.json. |
| **G9** | **AI Enrichment v2 lacks tests** | Plan PR 5 said "update `src/__tests__/ai-enrichment.test.ts` with mocked provider returning the new shape." Summary lists no test count for PR 5. | Summary lists test counts for PRs 1, 2, 3, 4, 6 (14, 9, 12, 6, 12) but not PR 5. |
| **G10** | **`dogfood` not run** | The whole point of dogfooding was to render mp-sentinel's *own* SKILL.md and visually confirm the new sections show up. Skipped. | Summary lists no `npm run dogfood` invocation. |

**Net assessment:** Phase 1 produced solid scaffolding but did not finish the contract. G1 (no scrubbing) and G2 (codeSamples never populated) together mean the central AI quality jump promised by the plan is either off (G2) or unsafe to turn on (G1). G3 means six of seven adapters still ship the old skill shape. G4-G10 are quality/process gaps.

---

## 2. Phase 2 plan — close the gaps

Eight focused commits, ordered by severity. Each is independently testable.

### C1 — Wire the secret scrubber into `codeSamples` (closes G1)

**Files:**
* `src/services/skills-generator/code-samples.ts` (new)
* `src/services/skills-generator/ai-enrichment.ts` (consume scrubbed samples)

**Behaviour:**
* New `loadAndScrubCodeSamples(projectRoot, langProfile, codeStyleProfile, opts)`:
  * Selects up to N samples deterministically: largest non-test file in the dominant language, one hub file, one test file, one component file (`.svelte` / `.vue` / `.tsx` / `.jsx`) if present.
  * Reads each file (cap at first 40 lines) and runs the content through the existing scrubber in `src/services/security/index.ts` (same one the review pipeline uses) **before** returning.
  * Emits `{ path, content, redacted: boolean }` so the AI prompt can flag samples that had secrets.
* `ai-enrichment.ts` removes the misleading `(scrubbed)` comment and asserts at runtime that any sample passed in has been through the scrubber (cheap structural check or a `__scrubbed: true` brand on the sample type — pick one).

**Tests:** `src/__tests__/code-samples-scrub.test.ts` — fixture file containing a fake API key → assert the key is redacted before reaching the prompt.

### C2 — Have `create-skills` actually build and pass `codeSamples` (closes G2)

**Files:**
* `src/commands/create-skills.ts`
* `src/services/skills-generator/ai-enrichment.ts` (already accepts samples)

**Behaviour:**
* When AI enrichment is enabled, the command calls `loadAndScrubCodeSamples(...)` after building the `LanguageProfile` + `CodeStyleProfile` and before calling `enrichIndex(...)`.
* Pass the result through `AIEnrichmentConfig.codeSamples`.
* When `enabled === false`, skip — same fast path as today.
* Add a CLI flag `--no-code-samples` for users who want the v1 prompt (defensive).

**Tests:** `src/__tests__/create-skills-ai-v2.test.ts` — mock provider; snapshot the prompt to verify `codeSamples` is non-empty when enrichment is on, empty when `--no-code-samples` is set.

### C3 — Bring all skill-folder adapters up to parity (closes G3)

**Files:**
* `src/services/skills-generator/adapters/codex.adapter.ts`
* `src/services/skills-generator/adapters/antigravity.adapter.ts`
* `src/services/skills-generator/adapters/cline.adapter.ts`
* `src/services/skills-generator/adapters/generic.adapter.ts`

**Behaviour:**
* Each writes `references/code-style.md`, `references/language-patterns.md`, `references/clean-code-checklist.md`.
* Each appends the three new SKILL.md sections (`languageRules`, `cleanCodePolicy`, `fileSizePolicy`) to the body, in the same order as the Claude adapter.
* `windsurf.adapter.ts` (single-file rule) embeds the sections inline like cursor does — verify it already does and add the missing sections if not.
* Update `buildAgentWorkflow()` reference-routing in `content.ts` to surface the three new files in the routing table for every adapter, not just Claude.

**Tests:** Extend `src/__tests__/quality-gate.test.ts` with a per-adapter assertion that the three new outputs are present (or the three new sections appear inline for single-file adapters). Snapshot one full output per adapter into `__fixtures__/`.

### C4 — Triage the 36 failing tests (closes G4)

**Files:** `src/__tests__/quality-gate.test.ts`, `src/__tests__/create-skills.test.ts`, `src/__tests__/ai-enrichment.test.ts`, `src/tests/review-intelligence-fixtures.test.ts`.

**Procedure:**
1. Run `npm test -- --json --outputFile=/tmp/jest.json`.
2. Categorise each failure as:
   * `pre-existing` (existed before Phase 1, file untouched in Phase 1) → leave alone, log them in `WHATS_NEW.md` as known.
   * `regression` (test broke because expected output shape changed) → update the test to match the new shape.
   * `new-required` (test was supposed to be added by Phase 1 PR 7 but wasn't) → write it.
3. Target: green test run (zero failing) before merging C1–C3.

**Output of this commit:** a triage report in `docs/plans/PHASE2_TEST_TRIAGE.md` listing each of the 36, its category, and the resolution.

### C5 — Move co-located tests under `src/__tests__/` and verify Jest picks them up (closes G5)

**Files:**
* Move:
  * `src/services/skills-generator/language-profile.test.ts` → `src/__tests__/language-profile.test.ts`
  * `src/services/skills-generator/code-style-profile.test.ts` → `src/__tests__/code-style-profile.test.ts`
  * `src/services/skills-generator/clean-code-policy.test.ts` → `src/__tests__/clean-code-policy.test.ts`
  * `src/services/skills-generator/rule-packs/rule-packs.test.ts` → `src/__tests__/rule-packs.test.ts`
  * `src/services/source-index/extractors/extractors.test.ts` → `src/__tests__/svelte-vue-extractors.test.ts`
* Verify by counting — `npm test -- --listTests | wc -l` should match the count before the move.

**Tests:** none beyond the existing ones — this is a relocation.

### C6 — Svelte fixture E2E (closes G6, validates the user's original symptom)

**Files:**
* `src/__tests__/fixtures/svelte-project/` (new) — minimal SvelteKit-style project:
  * `package.json` with `"svelte": "^5.0.0"` (or `"^4.0.0"`, parameterise)
  * `src/routes/+page.svelte` with imports inside `<script lang="ts">`
  * `src/lib/Bad.svelte` — **deliberately** has `import { onMount } from 'svelte'` *outside* `<script>` (the Svelte symptom the user reported)
  * `src/lib/store.ts`, a simple `tsconfig.json`, a `.prettierrc`
* `src/__tests__/svelte-skill-e2e.test.ts`:
  * Run `create-skills --agent claude` against the fixture.
  * Assert SKILL.md `## Language & Framework Rules` contains "Place all `import` statements inside the `<script>` block."
  * Assert SKILL.md `## File Size Policy` shows the configured limit.
  * Assert `references/language-patterns.md` lists Svelte rules.
  * With AI enrichment enabled (mock provider), assert `antiPatterns[]` cites `src/lib/Bad.svelte`.

### C7 — Bump `generatorVersion` and update docs (closes G7, G8)

**Files:**
* Bump `generatorVersion` source (currently from `package.json` → minor bump per the AGENTS.md §8 release rules), or introduce an explicit `GENERATOR_VERSION` constant in `metadata.ts` to decouple from package version. Recommended: explicit constant `GENERATOR_VERSION = "2.0.0"` (the skill output schema is meaningfully different). This forces every existing generated SKILL.md to flag stale on the first `--check` after upgrade — desired.
* Update:
  * `docs/CREATE_SKILLS.md` — add the new sections, the `policies` config block, the AI v2 prompt shape.
  * `docs/CODE_STYLE.md` — cross-link to the new generated `references/code-style.md`.
  * `docs/COMMANDS_CHEAT_SHEET.md` — document `--no-code-samples` and the new config.
  * `WHATS_NEW.md` and `docs/CHANGELOG.md` — list every change in this Phase 2 closure plus Phase 1 (Phase 1 also missed these, so this commit catches up).
* Verify with `npm run release:check` per AGENTS.md §8.

### C8 — Final verification and dogfood (closes G9, G10)

**Procedure:**
1. `npm run agent:skills:refresh` — regenerate the local generated skill against the new generator.
2. Open `.claude/skills/mp-sentinel-best-practices/SKILL.md` and visually confirm:
   * `## Language & Framework Rules` block exists with TS-strict rules.
   * `## Clean Code Policy` and `## File Size Policy` sections exist.
   * `references/code-style.md`, `references/language-patterns.md`, `references/clean-code-checklist.md` exist with content.
3. Run AI enrichment dry-run with a fake provider key (or skip with `--no-ai`) to confirm the prompt now contains scrubbed `codeSamples`.
4. Run, in order:
   ```sh
   npm run format:check
   npm run typecheck
   npm run typecheck:tests
   npm test                  # MUST be green now
   npm run build
   npm run dogfood
   npm run release:check
   ```
5. Add `src/__tests__/ai-enrichment.test.ts` updates from PR 5 if still missing — mock provider returning the v2 shape (`rulesByLanguage`, `antiPatterns`, etc.) and assert SKILL.md contains the per-language block. This was the PR-5 deliverable that has no test coverage today.

---

## 3. Acceptance criteria for Phase 2

1. `Grep "codeSamples" src/commands/create-skills.ts` returns at least one hit.
2. `Grep "scrub\|redact" src/services/skills-generator/` returns at least one hit referencing the actual scrubber from `src/services/security/`.
3. All four skill-folder adapters (claude, codex, antigravity, cline, generic) write `references/code-style.md`, `references/language-patterns.md`, `references/clean-code-checklist.md`.
4. `npm test` — **zero** failing tests.
5. The Svelte fixture E2E test passes with both AI on and AI off.
6. `mp-sentinel create-skills --check` reports `stale` for any SKILL.md generated before C7's `generatorVersion` bump.
7. `WHATS_NEW.md` and `docs/CHANGELOG.md` document every config-key, schema, and section change introduced by Phase 1 + Phase 2.
8. `npm run dogfood` exits 0 and the regenerated SKILL.md contains all four new sections.

---

## 4. Copy-paste agent prompt — Phase 2

> Drop this into your AI agent inside the `mp-sentinel` repo. It is self-contained and matches `AGENTS.md` / `CLAUDE.md`.

```
ROLE
You are an experienced TypeScript / Node CLI engineer working inside the
mp-sentinel repository. Phase 1 of the create-skills upgrade
(STRONGER_CREATE_SKILLS_PLAN.md) shipped, but spot-checks found gaps. Your job
is to close them.

READ FIRST (in this exact order — do not skip)
1. AGENTS.md (especially §1, §3, §4, §6, §7, §8)
2. CLAUDE.md
3. docs/plans/STRONGER_CREATE_SKILLS_PLAN.md (Phase 1 plan)
4. docs/plans/STRONGER_CREATE_SKILLS_PHASE2_GAP_CLOSURE.md (this plan)
5. docs/CREATE_SKILLS.md, docs/CODE_STYLE.md, WHATS_NEW.md
6. The current state of these files:
   - src/commands/create-skills.ts
   - src/services/skills-generator/ai-enrichment.ts
   - src/services/skills-generator/content.ts
   - src/services/skills-generator/adapters/*.adapter.ts
   - src/services/skills-generator/metadata.ts
   - src/services/security/index.ts (the scrubber you must reuse)
7. Run `npm run agent:skills:check`; if stale, `npm run agent:skills:refresh`
   and read .claude/skills/mp-sentinel-best-practices/SKILL.md.
8. Run `npm test -- --listTests` to confirm Jest discovers tests in
   src/__tests__/. Co-located *.test.ts in service directories may NOT be
   discovered — confirm before relying on PR 1's test counts.

GOAL
Close the ten gaps (G1–G10) listed in
docs/plans/STRONGER_CREATE_SKILLS_PHASE2_GAP_CLOSURE.md so:
  - AI enrichment actually receives scrubbed code samples (G1, G2).
  - Every skill-folder adapter writes the three new reference files (G3).
  - Every failing test is either fixed or formally classified as
    pre-existing in WHATS_NEW.md (G4).
  - All new tests live under src/__tests__/ where Jest sees them (G5).
  - A Svelte fixture E2E test proves the user's original symptom is fixed
    (G6).
  - Docs and version bumps are complete (G7, G8).
  - PR 5's missing tests are added; dogfood is run and the output is
    inspected (G9, G10).

CONSTRAINTS (same as Phase 1, plus)
- Never send raw file content to the AI provider. Every byte that enters the
  enrichment prompt must pass through the scrubber in src/services/security/
  first. Add a runtime assertion (e.g. a `__scrubbed: true` brand on the
  sample type) so future code cannot accidentally bypass it.
- Do not change the metadata marker string. Bumping `generatorVersion` is
  REQUIRED in C7.
- Do not add new co-located tests under src/services/. New tests go in
  src/__tests__/ only. Move existing co-located tests there in C5.
- Additive-only changes to AIEnrichmentInput / AIEnrichmentOutput.
- All TypeScript strict flags from AGENTS.md §3 must hold.
- AGENTS.md §7 docs-consistency rule applies — every config / schema / flag
  change in Phase 1 + Phase 2 must land in WHATS_NEW.md, docs/CHANGELOG.md,
  docs/COMMANDS_CHEAT_SHEET.md, docs/CREATE_SKILLS.md in the same commit.

PLAN OF WORK (eight commits, in order)

Commit C1 — Scrub code samples
- Add src/services/skills-generator/code-samples.ts that imports the scrubber
  from src/services/security/ and exposes
  loadAndScrubCodeSamples(projectRoot, langProfile, codeStyleProfile, opts).
- Output type: { path: string; content: string; redacted: boolean;
  __scrubbed: true }[]
- Replace the misleading "(scrubbed)" comment in ai-enrichment.ts with a real
  runtime check.
- Test: src/__tests__/code-samples-scrub.test.ts with a fake AWS key +
  assert it is redacted in the resulting prompt.

Commit C2 — Wire codeSamples into create-skills
- In src/commands/create-skills.ts, after building LanguageProfile +
  CodeStyleProfile, call loadAndScrubCodeSamples and pass the result into
  AIEnrichmentConfig.codeSamples.
- Add CLI flag --no-code-samples (default off) that bypasses sample loading.
- Test: src/__tests__/create-skills-ai-v2.test.ts — mock provider; assert
  prompt includes codeSamples by default and excludes them with the flag.

Commit C3 — All skill-folder adapters write the new reference files
- Update codex.adapter.ts, antigravity.adapter.ts, cline.adapter.ts,
  generic.adapter.ts to write references/code-style.md,
  references/language-patterns.md, references/clean-code-checklist.md and to
  append the three new SKILL.md sections.
- For single-file rule adapters (cursor, windsurf), confirm the three new
  sections are embedded inline (cursor already is per spot-check; verify
  windsurf).
- Update buildAgentWorkflow() reference-routing in content.ts to mention the
  three new files in the routing table.
- Test: extend src/__tests__/quality-gate.test.ts to assert per-adapter
  output paths or inline sections.

Commit C4 — Test triage
- Run `npm test -- --json --outputFile=/tmp/jest.json`.
- Classify every failure as pre-existing / regression / new-required and
  write docs/plans/PHASE2_TEST_TRIAGE.md.
- Fix all regressions and new-required items in this same commit.
- Acceptance: `npm test` exits 0.

Commit C5 — Relocate co-located tests
- Move the five co-located tests listed in PHASE2 §C5 into src/__tests__/.
- Run `npm test -- --listTests` and confirm the count is unchanged or
  higher.

Commit C6 — Svelte fixture E2E
- Add src/__tests__/fixtures/svelte-project/ as described in PHASE2 §C6
  (include one file with imports OUTSIDE <script> to validate antiPattern
  reporting).
- Add src/__tests__/svelte-skill-e2e.test.ts with the four assertions in
  PHASE2 §C6.

Commit C7 — Generator version bump + docs
- Introduce `GENERATOR_VERSION = "2.0.0"` constant in metadata.ts and use it
  instead of package.version. This forces existing generated files to flag
  stale on first --check after upgrade.
- Update docs/CREATE_SKILLS.md, docs/CODE_STYLE.md, docs/COMMANDS_CHEAT_SHEET.md,
  WHATS_NEW.md, docs/CHANGELOG.md with every Phase 1 + Phase 2 change.
- Run `npm run release:check`.

Commit C8 — Final verification + dogfood
- Run, in order:
    npm run format:check
    npm run typecheck
    npm run typecheck:tests
    npm test
    npm run build
    npm run dogfood
    npm run release:check
- Open the regenerated .claude/skills/mp-sentinel-best-practices/SKILL.md and
  confirm the new sections render and the new reference files exist with
  content.
- Add the missing PR-5 tests in src/__tests__/ai-enrichment.test.ts: mock
  provider returning the v2 shape (rulesByLanguage, antiPatterns, etc.) and
  assert SKILL.md contains the per-language block.

ACCEPTANCE CHECKS (run before reporting done)
- `Grep "codeSamples" src/commands/create-skills.ts` returns >0 hits.
- `Grep "scrub\\|redact" src/services/skills-generator/` returns hits that
  reference src/services/security/ (the real scrubber).
- All four skill-folder adapters (claude, codex, antigravity, cline,
  generic) write the three new reference files.
- `npm test` exits 0.
- The Svelte fixture E2E test passes with AI on and AI off.
- `mp-sentinel create-skills --check` reports `stale` for any SKILL.md
  generated before C7's generatorVersion bump.
- WHATS_NEW.md and docs/CHANGELOG.md document every Phase 1 + Phase 2
  change.
- `npm run dogfood` exits 0 and the regenerated SKILL.md contains all four
  new sections.

DELIVERABLES
- Eight commits matching this plan, all passing the verification checklist.
- A short summary message listing: bumped versions, new files, new sections,
  new config keys, the test triage outcome, and any follow-up TODOs left as
  // TODO(stronger-skills-phase3): comments.
```

---

*Phase 2 stops short of designing a Phase 3, but obvious follow-ups for later: extend rule packs to Astro / Solid / Qwik; promote the rule-pack catalog to support user-supplied packs via .mp-sentinelrc.json; allow `--no-code-samples` per AI provider in case a deployed environment has stricter data-residency rules; emit anti-pattern findings as a `mp-sentinel review` rule (not just SKILL.md context).*
