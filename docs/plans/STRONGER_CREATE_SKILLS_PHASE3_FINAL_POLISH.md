# Phase 3 — `create-skills` Stronger Skills: Final Polish

> Phase 2 closed the three critical gaps (security scrubber, dead-code AI v2, adapter parity). Verified in code. But four Phase 2 deliverables are still open, and one new issue (the GENERATOR_VERSION migration) surfaces now that v2.0.0 is set. This phase finishes the job in five focused commits.

---

## 1. Phase 2 verification — what's confirmed working

Spot-checked against the actual files (not the summary):

* **G1 / C1 closed.** `src/services/skills-generator/code-samples.ts:153` instantiates `SecurityService` and runs `sanitizeFiles()` before returning. `ai-enrichment.ts:188-200` throws `"Code samples must be scrubbed before reaching the AI prompt..."` if any sample lacks the `__scrubbed: true` brand. ✓
* **G2 / C2 closed.** `src/commands/create-skills.ts:1264` imports and calls `loadAndScrubCodeSamples(...)`. The `--no-code-samples` flag is in `args.ts`. ✓
* **G3 / C3 closed.** `claude`, `codex`, `antigravity` write the three new reference files. `cursor`, `windsurf`, `cline`, `generic` are single-file rule adapters and correctly embed `languageRules`, `cleanCodePolicy`, `fileSizePolicy` inline. ✓
* **G5 / C5 closed.** New tests live under `src/__tests__/` (`code-samples-scrub.test.ts`, `svelte-skill-e2e.test.ts`, `svelte-vue-extractors.test.ts`, etc.). ✓
* **G6 / C6 closed.** `src/__tests__/fixtures/svelte-project/` exists with `src/lib/Bad.svelte` (the file with imports outside `<script>`, exactly the user's original symptom). ✓
* **G8 / C7 partial.** `GENERATOR_VERSION = "2.0.0"` constant exists in `metadata.ts:21`. ✓ Migration handling is missing — see G11 below.
* **WHATS_NEW.md and `docs/CHANGELOG.md`** mention the v2.0.0 generator and `--no-code-samples`. ✓

## 2. Gaps still open after Phase 2

| # | Severity | Gap | Evidence |
|---|---|---|---|
| **G7-residual** | **Plan deviation** | `docs/CREATE_SKILLS.md` is still the v1 document — no mention of `codeSamples`, `languageMix`, `policies`, `--no-code-samples`, `GENERATOR_VERSION`, `Language & Framework Rules`, `Clean Code Policy`, `File Size Policy`, or the three new reference files. This is the canonical user-facing doc for the command. | `Grep "codeSamples\|languageMix\|policies\|GENERATOR_VERSION\|--no-code-samples" docs/CREATE_SKILLS.md` → 0 hits. The file's Quick Start section still shows only the v1 flag set. |
| **G7b** | **AGENTS.md §7 violation** | `docs/COMMANDS_CHEAT_SHEET.md` does not exist anywhere in the repo. AGENTS.md §7 names it as required-update-in-same-commit alongside `WHATS_NEW.md` and `docs/CHANGELOG.md`. Either it must be created, or AGENTS.md §7 must be updated to remove the reference. | `Glob "**/COMMANDS_CHEAT_SHEET.md"` returns nothing under `docs/`. |
| **G4-residual / C4** | **Plan deliverable missed** | Phase 2 §C4 explicitly required producing `docs/plans/PHASE2_TEST_TRIAGE.md` classifying every original-38 failure as `pre-existing` / `regression` / `new-required`. The summary says "5 pre-existing release-check version mismatches" but no triage document was written. | `Glob "**/PHASE2_TEST_TRIAGE.md"` returns nothing. |
| **G10-residual** | **5 unfixed test failures** | "1611/1616 pass" means **5 are still red**. The summary classifies them as "pre-existing release-check version mismatches" — but Phase 2 changed `WHATS_NEW.md` and `docs/CHANGELOG.md` (both inputs to `scripts/release-check.mjs`), so at least some of these may be regressions caused by Phase 2 itself, not pre-existing. Without the C4 triage doc this is unverifiable. | `package.json` version is `2.3.0`. WHATS_NEW.md top section is `## Upcoming` with sub-heading `### Stronger Skills — ... (v2.0.0 generator)`. `release-check.mjs` reads several `version` fields and fails on mismatch — at least one of those fields likely now disagrees. |
| **G11 (NEW)** | **Migration UX hole** | Bumping `GENERATOR_VERSION` to `2.0.0` means every existing user's first `mp-sentinel create-skills --check` after upgrade reports their generated SKILL.md as `stale` *with no explanation why*. The CI gate goes red for them with no migration note. | `metadata.ts:21` sets `GENERATOR_VERSION = "2.0.0"` but no LEGACY_VERSION_DEFS-style mapping or `migration-note.md` reference. The legacy-detection logic at `LEGACY_PATH_DEFS` only covers path moves, not version bumps. |
| **G9-residual** | **PR 5 v2 schema test still missing** | Phase 2 §C8 noted: *"Add the missing PR-5 tests in `src/__tests__/ai-enrichment.test.ts`: mock provider returning the v2 shape (rulesByLanguage, antiPatterns, etc.) and assert SKILL.md contains the per-language block."* Not in the summary. | The summary lists test counts for C1 (6), C5 (53 relocated), C6 (8) but no test count for the AI v2 schema in C8. |

---

## 3. Phase 3 plan — five commits

### D1 — Triage the 5 remaining failures (closes G4-residual / G10-residual)

**Procedure:**

```sh
npm test -- --json --outputFile=/tmp/jest-phase3.json 2>&1 | tail -50
node -e "const j=require('/tmp/jest-phase3.json'); j.testResults.filter(r=>r.numFailingTests>0).forEach(r=>{ console.log(r.testFilePath); r.testResults.filter(t=>t.status==='failed').forEach(t=>console.log('  -',t.fullName)); })"
```

Then write `docs/plans/PHASE2_TEST_TRIAGE.md` (back-fill) listing:

* Each of the 5 failures by file + test name.
* Classification (`pre-existing` / `phase1-regression` / `phase2-regression`).
* Root cause (e.g. "WHATS_NEW.md heading 'Upcoming' replaced versioned heading; `release-check.mjs` reads heading version; failure introduced by Phase 2 commit C7's WHATS_NEW.md edit, not pre-existing").
* Resolution: either fix the test/code to match new behaviour, or — if genuinely pre-existing and out-of-scope — open a tracking issue link and document the skip.

**Acceptance:** `npm test` exits 0 with no failing tests.

### D2 — Update `docs/CREATE_SKILLS.md` for Phase 1 + Phase 2 (closes G7-residual)

**Sections to add or rewrite in `docs/CREATE_SKILLS.md`:**

* `## What's generated` — list of SKILL.md sections, including the four new ones (`Language & Framework Rules`, `Clean Code Policy`, `File Size Policy`, `Code Style Policy`).
* `## Reference files` — table of every reference file an adapter writes, with a row for `code-style.md`, `language-patterns.md`, `clean-code-checklist.md`.
* `## Configuration — createSkills.policies` — document the new config block with all keys (`maxFileLines`, `warnFileLines`, `maxFunctionLines`, `maxParams`, `maxCyclomaticHint`, `forbidDefaultExports`) and defaults.
* `## CLI flags` — add `--no-code-samples` with rationale (data-residency / privacy escape hatch).
* `## AI enrichment v2` — explain that AI enrichment now ships scrubbed code samples, expects per-language output, and the prompt version is `2026-05-08`. Link to the AI enrichment cache spec.
* `## Generator version & --check` — explain `GENERATOR_VERSION = "2.0.0"`, what `--check` does after a generator bump, and the upgrade path (run `create-skills` once after upgrade to refresh).
* `## Rule packs` — short table of which built-in rule packs ship and what triggers each (Svelte / Vue / React / Next / TypeScript-strict / Python / Go / Rust).

Cross-link from `docs/CODE_STYLE.md` to the generated `references/code-style.md` description.

**Acceptance:** `Grep "codeSamples\|--no-code-samples\|createSkills.policies\|GENERATOR_VERSION\|Language & Framework Rules" docs/CREATE_SKILLS.md` returns hits for every term.

### D3 — Decide `docs/COMMANDS_CHEAT_SHEET.md` fate (closes G7b)

Pick **one** of the two options and execute it cleanly:

**Option A — create the file** (simpler, restores AGENTS.md §7 invariant):

* `docs/COMMANDS_CHEAT_SHEET.md` with one section per CLI verb (`review`, `indexing`, `create-skills`, `doctor`, etc.). For each verb: required flags, optional flags, exit codes. Include `--no-code-samples` and the new policies.

**Option B — remove the reference** from `AGENTS.md §7` and `CLAUDE.md`:

* If the team's actual practice is to keep flag docs only in `docs/CREATE_SKILLS.md` etc., update AGENTS.md to drop `docs/COMMANDS_CHEAT_SHEET.md` from the same-commit list.

Recommended: **Option A** — a cheat sheet is genuinely useful for downstream agents reading the rules. Even a 100-line cheat sheet is better than a dead reference.

**Acceptance:** Either the file exists with the new flag/section coverage, or AGENTS.md / CLAUDE.md no longer reference it.

### D4 — Migration path for the GENERATOR_VERSION bump (closes G11)

**Files:**

* `src/services/skills-generator/legacy-detection.ts` — extend the existing legacy-path detection with a sibling concept: legacy-generator-version detection. If a generated file's `generatorVersion` parses to a value < 2.0.0, surface an advisory in `--check` JSON output: `{ status: "stale", reason: "generatorVersionUpgrade", from: "1.x.y", to: "2.0.0", note: "Run mp-sentinel create-skills to regenerate with the v2 layout." }`.
* `docs/plans/MIGRATION_2.0_GENERATOR.md` (new, short) — single page explaining: what changed, what regenerates, what the user must do (`npx mp-sentinel create-skills` once), how to opt out of code samples (`--no-code-samples`).
* `WHATS_NEW.md` — add a one-paragraph "Upgrading from generator v1.x.y" callout linking to the migration doc.

**Acceptance:** Running `mp-sentinel create-skills --check` against a SKILL.md that has `generatorVersion=1.0.17` reports the upgrade reason, not just `stale`.

### D5 — Add the missing AI v2 schema tests + final dogfood (closes G9-residual)

**Files:**

* `src/__tests__/ai-enrichment-v2.test.ts` — mock provider returning JSON with the v2 fields (`rulesByLanguage`, `antiPatterns`, `cleanCodeRules`, `styleEnforcement`). Assert:
  * Zod validation passes.
  * The Svelte-specific `rulesByLanguage.svelte` entry survives serialization.
  * `antiPatterns[].files` cite the same paths that were in the `codeSamples` input.
  * If a mock provider returns the v2 shape **without** `rulesByLanguage` for the dominant language while `codeSamples` was non-empty, validation rejects the response.
* Run, in order:
  ```sh
  npm run agent:skills:refresh
  npm run format:check
  npm run typecheck
  npm run typecheck:tests
  npm test                 # MUST be 1616/1616
  npm run build
  npm run dogfood
  npm run release:check    # MUST exit 0 — fix any version-pointer mismatches in D1
  ```
* Open `.claude/skills/mp-sentinel-best-practices/SKILL.md` and confirm:
  * `## Language & Framework Rules` contains the TypeScript-strict pack output.
  * `## Clean Code Policy` shows the configured limits.
  * `## File Size Policy` lists any current offenders.
  * `references/code-style.md`, `references/language-patterns.md`, `references/clean-code-checklist.md` exist with content.

**Acceptance:** Every command exits 0; SKILL.md visually matches the new shape; the v2 schema tests pass.

---

## 4. Acceptance criteria — Phase 3 done

1. `npm test` exits 0 — **zero** failing tests, including the previously-deferred 5.
2. `docs/plans/PHASE2_TEST_TRIAGE.md` exists with a row per original failure.
3. `docs/CREATE_SKILLS.md` documents every Phase 1 + Phase 2 change (greppable terms above).
4. `docs/COMMANDS_CHEAT_SHEET.md` either exists with the new flag coverage **or** the AGENTS.md / CLAUDE.md references to it are removed.
5. Running `--check` against a SKILL.md with `generatorVersion < 2.0.0` reports `generatorVersionUpgrade` in JSON output, not just `stale`.
6. `WHATS_NEW.md` carries an upgrade callout linking to `docs/plans/MIGRATION_2.0_GENERATOR.md`.
7. `npm run dogfood` exits 0 and the regenerated mp-sentinel SKILL.md contains the four new sections.
8. `npm run release:check` exits 0.
9. New `ai-enrichment-v2.test.ts` covers the v2 schema, including the dominant-language enforcement.

---

## 5. Copy-paste agent prompt — Phase 3

> Drop into your AI agent inside the mp-sentinel repo. Self-contained.

```
ROLE
You are an experienced TypeScript / Node CLI engineer working inside the
mp-sentinel repository. Phase 1 (STRONGER_CREATE_SKILLS_PLAN.md) and Phase 2
(STRONGER_CREATE_SKILLS_PHASE2_GAP_CLOSURE.md) shipped, but four deliverables
are still open and one new migration issue surfaced. Your job is to close
them in five focused commits.

READ FIRST (in this exact order)
1. AGENTS.md — pay particular attention to §7 (docs consistency, especially
   the same-commit update rule for WHATS_NEW.md, docs/CHANGELOG.md,
   docs/COMMANDS_CHEAT_SHEET.md, docs/CREATE_SKILLS.md) and §8.
2. CLAUDE.md
3. docs/plans/STRONGER_CREATE_SKILLS_PLAN.md (Phase 1 plan)
4. docs/plans/STRONGER_CREATE_SKILLS_PHASE2_GAP_CLOSURE.md (Phase 2 plan)
5. docs/plans/STRONGER_CREATE_SKILLS_PHASE3_FINAL_POLISH.md (this plan)
6. The current state of:
   - docs/CREATE_SKILLS.md (still v1; needs full rewrite per D2)
   - WHATS_NEW.md (top entry already mentions v2.0.0 generator)
   - docs/CHANGELOG.md
   - scripts/release-check.mjs (read it; understand exactly which fields it
     compares so you can fix the 5 failures)
   - src/services/skills-generator/legacy-detection.ts
   - src/services/skills-generator/metadata.ts (GENERATOR_VERSION = "2.0.0")
7. Run `npm test -- --json --outputFile=/tmp/jest-phase3.json 2>&1` and
   inspect the 5 failures before editing anything.

GOAL
Take Phase 2's "1611/1616 pass" to "1616/1616 pass with all docs and
migration handling in place." Specifically: triage the 5 failures, finish
the docs, add migration handling for the v2.0.0 generator bump, and add
the missing AI-v2 schema test.

CONSTRAINTS (same as before, plus)
- Do not bump package.json version unless release-check.mjs explicitly
  requires it. Bumping the package version is a separate release decision —
  do not bundle it into Phase 3. If the 5 failures stem from
  `release-check.mjs` reading WHATS_NEW.md / CHANGELOG.md headings against
  package.json version 2.3.0, prefer fixing the heading format over a
  package version bump. If a package bump is genuinely required, surface
  it as a TODO at the end of your summary, not a silent commit.
- GENERATOR_VERSION must remain "2.0.0".
- Do not regress any of the closed gaps from Phase 1 or Phase 2.

PLAN OF WORK (five commits, in order)

Commit D1 — Test triage
- Run `npm test -- --json --outputFile=/tmp/jest-phase3.json 2>&1`.
- Write docs/plans/PHASE2_TEST_TRIAGE.md (back-filled) with one row per
  failure: file, test name, classification, root cause, resolution.
- Fix all 5. Acceptance: `npm test` exits 0.

Commit D2 — docs/CREATE_SKILLS.md rewrite
- Add the seven sections listed in PHASE3 §D2.
- Cross-link from docs/CODE_STYLE.md.
- Acceptance: greppable for `codeSamples`, `--no-code-samples`,
  `createSkills.policies`, `GENERATOR_VERSION`, `Language & Framework Rules`.

Commit D3 — docs/COMMANDS_CHEAT_SHEET.md decision
- Choose Option A (create the file with full flag coverage) unless the
  team practice clearly favours Option B. Default to A.
- Acceptance: AGENTS.md §7's same-commit list is satisfiable.

Commit D4 — GENERATOR_VERSION migration UX
- Extend src/services/skills-generator/legacy-detection.ts with a
  generator-version check that surfaces a `generatorVersionUpgrade` reason
  in --check output when an existing file's version parses to < 2.0.0.
- Add docs/plans/MIGRATION_2.0_GENERATOR.md (short, single page).
- Add the upgrade callout to WHATS_NEW.md linking to it.
- Test: src/__tests__/legacy-generator-version.test.ts covering both old
  (1.x) and new (2.0.0) generated files.

Commit D5 — AI v2 schema test + final verification
- Add src/__tests__/ai-enrichment-v2.test.ts covering rulesByLanguage,
  antiPatterns, styleEnforcement, dominant-language enforcement.
- Run, in order:
    npm run agent:skills:refresh
    npm run format:check
    npm run typecheck
    npm run typecheck:tests
    npm test
    npm run build
    npm run dogfood
    npm run release:check
- Open .claude/skills/mp-sentinel-best-practices/SKILL.md and visually
  confirm the four new sections render.

ACCEPTANCE CHECKS
- `npm test` exits 0; the report shows 1616/1616 pass.
- docs/plans/PHASE2_TEST_TRIAGE.md exists with classification rows.
- `Grep "codeSamples\\|--no-code-samples\\|createSkills.policies\\|GENERATOR_VERSION\\|Language & Framework Rules" docs/CREATE_SKILLS.md`
  returns hits for every term.
- `docs/COMMANDS_CHEAT_SHEET.md` either exists with new flag coverage or
  is no longer referenced from AGENTS.md / CLAUDE.md.
- `mp-sentinel create-skills --check --format json` against a SKILL.md
  whose metadata says `generatorVersion=1.0.17` reports
  `generatorVersionUpgrade` in the JSON output.
- `npm run release:check` exits 0.
- `npm run dogfood` exits 0 and the regenerated SKILL.md contains the
  four new sections.

DELIVERABLES
- Five commits matching this plan.
- A short summary listing: which 5 tests were red and how each was
  resolved, the package-version decision (bumped or not + why), and the
  final test count.
```

---

*Phase 3 is the polish pass — no new feature work, just closing the contract Phase 1 and Phase 2 promised. After Phase 3 lands cleanly, the Stronger Skills upgrade is shippable.*
