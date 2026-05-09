# Phase 4 — `create-skills` Stronger Skills: Release Readiness

> Phase 3 closed most contracts. What's left is release plumbing plus one deferred-and-watered-down deliverable from Phase 3 §D4. This phase is short and sharp — four focused commits, then ship.

---

## 1. Phase 3 verification — confirmed and contradicted

Spot-checked against the actual files (not the summary):

### Confirmed working

* `docs/plans/PHASE2_TEST_TRIAGE.md` exists with a 36-failure classification table. ✓
* `docs/plans/MIGRATION_2.0_GENERATOR.md` exists. ✓
* `docs/COMMANDS_CHEAT_SHEET.md` exists with a `create-skills` section. ✓
* `src/__tests__/ai-enrichment-v2.test.ts` exists with 16 occurrences of `rulesByLanguage` (the 10-test claim is plausible). ✓
* `docs/CREATE_SKILLS.md` mentions `--no-code-samples` (3 hits), `createSkills.policies` (1), `GENERATOR_VERSION` (1), `Language & Framework Rules` (3). ✓

### Contradicted by spot-check

| # | Severity | Issue | Evidence |
|---|---|---|---|
| **H1** | **Plan deviation** | Phase 3 §D4 was significantly watered down. The plan required extending `legacy-detection.ts` with a `generatorVersionUpgrade` reason in `--check` JSON output and a regression test. The summary just says "--check inherently detects stale files from the hash comparison; migration path documented." | `Grep "generatorVersionUpgrade\|GENERATOR_VERSION" src/services/skills-generator/legacy-detection.ts` → 0 hits. The user-facing UX hole (G11) is unfixed: a user upgrading from v1.x.y still sees a generic `stale` with no hint that running `create-skills` once will fix it. |
| **H2** | **Plan deliverable missed** | Phase 3 §D4 also required adding a one-paragraph "Upgrading from generator v1.x.y" callout in `WHATS_NEW.md` linking to `docs/plans/MIGRATION_2.0_GENERATOR.md`. The migration doc is orphaned — nothing links to it from the changelog or release notes. | `Grep "MIGRATION_2.0_GENERATOR\|migration.*generator\|upgrade.*generator" WHATS_NEW.md` → 0 hits. |
| **H3** | **Acceptance criterion failed** | Phase 3 §D5 acceptance was *"`npm test` exits 0; the report shows 1616/1616 pass."* Phase 3 ended at 1629/1634 — five tests still red. They were re-classified as "pre-existing release-check version mismatches" and deferred. The triage doc itself says these failures *"require a formal package release process (version bump, dist rebuild, lockfile update) to resolve."* — i.e. Phase 4. | Summary line: *"Total tests passing 1629/1634; Pre-existing failures 5."* |
| **H4** | **Triage doc inaccuracy** | The triage doc classifies rows 1–3 as *"Badge in README.md shows `npm-v1.2.4`, expected `2.3.0`."* But the live README at line 26 already shows `npm-v2.3.0`. Either the test fixtures use stale content, or the triage doc misidentified the root cause. The 5 remaining failures must be re-investigated against actual file content before committing to a release-process fix. | `README.md:26 → npm-v2.3.0` matches `package.json:3 → "version": "2.3.0"`. The triage doc's row-1 root cause is therefore wrong. |
| **H5** | **Minor doc gap** | Phase 3 §D2 acceptance check listed `codeSamples` as a required greppable term in `docs/CREATE_SKILLS.md`. The current doc uses *"code samples"* (with a space) instead, missing the camelCase identifier. | `Grep "codeSamples" docs/CREATE_SKILLS.md` → 0 hits, while `--no-code-samples` and `code samples` (free text) both appear. |

**Net assessment.** Functionally, the upgrade is shippable — every behavioural promise from Phase 1's plan (language-aware rule packs, scrubbed code samples, AI v2, file-size policy, Svelte fixture E2E) holds in code. The remaining work is release plumbing: re-investigate the 5 failures with real evidence, finish the deferred migration UX, and link the migration doc.

---

## 2. Phase 4 plan — four commits

### E1 — Re-investigate the 5 remaining failures with real evidence (closes H3, H4)

The triage doc's stated root cause for rows 1–3 contradicts the actual `README.md`. Don't trust it — investigate from scratch.

**Procedure:**

1. Run, capturing stderr too:
   ```sh
   npm test -- --json --outputFile=/tmp/jest-phase4.json 2>&1 | tail -200
   ```
2. For each of the 5 failing tests, extract:
   * Test file + test name.
   * **Actual** assertion message (not the triage doc's paraphrase).
   * The fixture or live file the test reads from.
3. Document in a refreshed `docs/plans/PHASE4_FINAL_TRIAGE.md`. Use this template per row:
   ```
   #N — <file>::<test name>
     observed: <verbatim Jest failure message>
     reads:    <file path actually opened>
     content:  <relevant lines>
     verdict:  <pre-existing | phase-N regression | environmental>
     fix:      <one-line description>
   ```
4. Group fixes:
   * **If the failures are content-mismatch in fixtures** → update the fixtures.
   * **If they're version-pointer drift in live files** (README badge, lockfile, WHATS_NEW heading, CHANGELOG heading) → fix the pointer; do NOT touch `package.json` version unless every other approach is impossible.
   * **If they genuinely require a package version bump** → surface that as one explicit decision in the commit message: bump `package.json` from 2.3.0 to 2.4.0 (this upgrade is meaningfully feature-additive; minor bump fits semver), bump the lockfile via `npm version 2.4.0 --no-git-tag-version`, update README badge, WHATS_NEW heading, CHANGELOG heading. Do not search/replace `"version"` across the lockfile (AGENTS.md §8 forbids it).

**Acceptance:** `npm test` exits 0. `docs/plans/PHASE4_FINAL_TRIAGE.md` exists with one row per investigated failure and verbatim Jest output (so future readers can verify the classification themselves, unlike the Phase 2 triage doc).

### E2 — Close the G11 migration UX properly (closes H1)

The Phase 3 watered-down "hash-comparison-is-good-enough" position is wrong: the user upgrading from v1.x sees a CI gate go red with the message `stale` and no actionable guidance. They have no way to know that the generator output schema changed. The doc-only mitigation only helps users who already know to look at the migration doc.

**Files:**

* `src/services/skills-generator/metadata.ts` — extract `parseGeneratorMajor(versionStr): number` helper.
* `src/services/skills-generator/legacy-detection.ts` (or `src/commands/create-skills.ts`'s `--check` path — whichever is cleaner) — add a `generatorVersionUpgrade` advisory:
  * When the parsed metadata `generatorVersion` major is < the current `GENERATOR_VERSION` major, emit:
    ```ts
    {
      file,
      status: "stale",
      reason: "generatorVersionUpgrade",
      previousVersion: parsed,
      currentVersion: GENERATOR_VERSION,
      migrationDoc: "docs/plans/MIGRATION_2.0_GENERATOR.md",
      remedy: "Run `mp-sentinel create-skills` once to regenerate."
    }
    ```
  * This appears in the existing `--check --format json` output. Human-readable mode prints the remedy line.
* `src/__tests__/legacy-generator-version.test.ts` (new) — fixtures with `generatorVersion=1.0.17` and `generatorVersion=2.0.0` headers; assert `--check` reports `generatorVersionUpgrade` for the 1.x file and `up-to-date` (or `stale` for hash reasons, with `reason: "indexHashMismatch"`) for the 2.0.0 file.

**Acceptance:** `mp-sentinel create-skills --check --format json` against a SKILL.md whose metadata says `generatorVersion=1.0.17` includes `"reason": "generatorVersionUpgrade"` in the JSON output and prints the remedy line in human-readable mode.

### E3 — Link the migration doc + add the missing `codeSamples` term (closes H2, H5)

**Files:**

* `WHATS_NEW.md` — add, immediately under the `### Stronger Skills — ... (v2.0.0 generator)` heading:
  ```
  > **Upgrading from a previous version?** The generator output schema
  > changed. Run `npx mp-sentinel create-skills` once after upgrade to
  > regenerate; `--check` now flags `generatorVersionUpgrade` so CI fails
  > with an actionable message instead of a generic `stale`. See the
  > [Generator 2.0 migration guide](./docs/plans/MIGRATION_2.0_GENERATOR.md).
  ```
* `docs/CHANGELOG.md` — add the same link in the v2.0.0 entry.
* `docs/CREATE_SKILLS.md` — replace the free-text *"code samples"* with the camelCase `codeSamples` (the actual field name in `AIEnrichmentInput`) in at least one place, so a future grep matches the API.

**Acceptance:** `Grep "MIGRATION_2.0_GENERATOR" WHATS_NEW.md docs/CHANGELOG.md` returns ≥ 2 hits. `Grep "codeSamples" docs/CREATE_SKILLS.md` returns ≥ 1 hit.

### E4 — Final verification + dogfood

**Procedure:**

```sh
npm run agent:skills:refresh
npm run format:check
npm run typecheck
npm run typecheck:tests
npm test                  # MUST be 1634/1634 (or whatever the new total is) green
npm run build
npm run dogfood
npm run release:check     # MUST exit 0 — same expectation as Phase 3
```

Then open `.claude/skills/mp-sentinel-best-practices/SKILL.md` and visually confirm:

* Four new sections render: `Language & Framework Rules`, `Clean Code Policy`, `File Size Policy`, `Code Style Policy`.
* Three new reference files exist with content: `code-style.md`, `language-patterns.md`, `clean-code-checklist.md`.
* The metadata header lists `generatorVersion=2.0.0`.

Run a synthetic legacy-detection test:

```sh
# Simulate a user who has v1.x generated files
sed -i.bak 's/generatorVersion=2.0.0/generatorVersion=1.0.17/' .claude/skills/mp-sentinel-best-practices/SKILL.md
npx mp-sentinel create-skills --check --format json
# Confirm the JSON output contains "generatorVersionUpgrade".
mv .claude/skills/mp-sentinel-best-practices/SKILL.md.bak .claude/skills/mp-sentinel-best-practices/SKILL.md
```

**Acceptance:** all commands exit 0; legacy-detection synthetic check returns the new reason.

---

## 3. Acceptance criteria — Phase 4 done

1. `npm test` exits 0 with **zero** failing tests.
2. `docs/plans/PHASE4_FINAL_TRIAGE.md` exists with one row per re-investigated failure, including verbatim Jest output.
3. `mp-sentinel create-skills --check --format json` against a SKILL.md with `generatorVersion=1.0.17` returns `"reason": "generatorVersionUpgrade"`.
4. `WHATS_NEW.md` and `docs/CHANGELOG.md` both link to `docs/plans/MIGRATION_2.0_GENERATOR.md` from the v2.0.0 entry.
5. `Grep "codeSamples" docs/CREATE_SKILLS.md` returns ≥ 1 hit.
6. `npm run release:check` exits 0.
7. `npm run dogfood` exits 0 and the regenerated SKILL.md contains all four new sections plus the three new reference files.
8. If a `package.json` version bump was required to satisfy criterion 1, it is documented in the commit message and `WHATS_NEW.md` carries the new version heading.

---

## 4. Copy-paste agent prompt — Phase 4

```
ROLE
You are an experienced TypeScript / Node CLI engineer working inside the
mp-sentinel repository. Phases 1, 2, and 3 of the create-skills upgrade
shipped, but four issues block release: 5 failing tests, a deferred-and-
watered-down migration UX (G11/H1), an orphaned migration doc, and a small
docs typo. Your job is to close them in four focused commits.

READ FIRST (in this exact order)
1. AGENTS.md (§7 docs consistency, §8 verification + version-bump rules)
2. CLAUDE.md
3. docs/plans/STRONGER_CREATE_SKILLS_PLAN.md (Phase 1 plan)
4. docs/plans/STRONGER_CREATE_SKILLS_PHASE2_GAP_CLOSURE.md
5. docs/plans/STRONGER_CREATE_SKILLS_PHASE3_FINAL_POLISH.md
6. docs/plans/STRONGER_CREATE_SKILLS_PHASE4_RELEASE_READINESS.md (this plan)
7. docs/plans/PHASE2_TEST_TRIAGE.md (NB: row 1–3 root causes appear wrong;
   re-investigate, don't trust)
8. The current state of:
   - scripts/release-check.mjs (read carefully)
   - src/services/skills-generator/legacy-detection.ts
   - src/services/skills-generator/metadata.ts
   - WHATS_NEW.md, docs/CHANGELOG.md, docs/CREATE_SKILLS.md
   - README.md (badge line)
   - package.json (currently version 2.3.0)
9. Run `npm test -- --json --outputFile=/tmp/jest-phase4.json 2>&1 | tail -200`
   and inspect the 5 failures BEFORE editing anything.

GOAL
Take Phase 3's "1629/1634 pass with 5 deferred" to "1634/1634 pass with the
generator-version upgrade UX in place, the migration doc linked from
WHATS_NEW.md, and a small CREATE_SKILLS.md doc fix." After Phase 4 lands,
the Stronger Skills upgrade is shippable.

CONSTRAINTS (same as before, plus)
- Don't trust docs/plans/PHASE2_TEST_TRIAGE.md classifications without
  verifying. Specifically, the triage doc claims README.md shows
  `npm-v1.2.4`, but the live README shows `npm-v2.3.0`. Re-investigate
  every failing test from primary sources.
- Don't bump package.json version unless every other approach to fix the
  5 failures is exhausted. If a bump is genuinely required, document the
  reasoning in the commit message and write the new version everywhere
  AGENTS.md §7 lists in the same commit.
- Never search/replace `"version"` across the entire lockfile (AGENTS.md §8).
- Keep GENERATOR_VERSION = "2.0.0".

PLAN OF WORK (four commits, in order)

Commit E1 — Re-triage the 5 failures with verbatim evidence
- Run `npm test -- --json --outputFile=/tmp/jest-phase4.json 2>&1`.
- For each failure, capture: file, test name, verbatim assertion message,
  the fixture or live file the test reads, and the relevant lines.
- Write docs/plans/PHASE4_FINAL_TRIAGE.md with the template in PHASE 4 §E1.
- Fix all 5. Prefer fixture/pointer fixes over a package-version bump.
- Acceptance: `npm test` exits 0.

Commit E2 — Generator version upgrade UX
- Add `parseGeneratorMajor(version): number` helper to metadata.ts.
- Extend legacy-detection.ts (or the --check path in create-skills.ts —
  whichever is cleaner; document the choice in the commit message) to
  emit a `generatorVersionUpgrade` advisory when the parsed metadata
  generatorVersion major < current GENERATOR_VERSION major. Include
  `previousVersion`, `currentVersion`, `migrationDoc`, `remedy`.
- Test: src/__tests__/legacy-generator-version.test.ts with fixtures at
  generatorVersion=1.0.17 and 2.0.0; assert the JSON contains
  `generatorVersionUpgrade` for the 1.x case.
- Acceptance: synthetic test in §E4 reports `generatorVersionUpgrade`.

Commit E3 — Link the migration doc + fix the codeSamples term
- Add the upgrade callout described in PHASE 4 §E3 to the v2.0.0 entry of
  WHATS_NEW.md and docs/CHANGELOG.md.
- Replace at least one occurrence of free-text "code samples" in
  docs/CREATE_SKILLS.md with the camelCase `codeSamples` so future greps
  for the API field name match.

Commit E4 — Final verification + synthetic legacy-detection check
- Run, in order:
    npm run agent:skills:refresh
    npm run format:check
    npm run typecheck
    npm run typecheck:tests
    npm test
    npm run build
    npm run dogfood
    npm run release:check
- Run the synthetic legacy-detection sed-and-revert script in PHASE 4 §E4
  and confirm the JSON output contains `generatorVersionUpgrade`.

ACCEPTANCE CHECKS
- `npm test` exits 0; the report shows 1634/1634 pass (or whatever the new
  total is — zero failing tests is the bar).
- docs/plans/PHASE4_FINAL_TRIAGE.md exists with verbatim Jest output for
  every previously-failing test.
- `Grep "generatorVersionUpgrade" src/services/skills-generator/` returns
  hits; the new reason is implemented, not just doc'd.
- `Grep "MIGRATION_2.0_GENERATOR" WHATS_NEW.md docs/CHANGELOG.md` returns
  >= 2 hits.
- `Grep "codeSamples" docs/CREATE_SKILLS.md` returns >= 1 hit.
- `npm run release:check` exits 0.
- `npm run dogfood` exits 0.

DELIVERABLES
- Four commits matching this plan.
- A short summary listing: which 5 tests were red and how each was
  resolved (verbatim Jest output, not paraphrased), the package-version
  decision (bumped or not + why), and the final test count.
```

---

*After Phase 4, the upgrade is functionally and procedurally shippable. Any further work — extending rule packs to Astro / Solid / Qwik, allowing user-supplied rule packs in `.mp-sentinelrc.json`, lifting anti-pattern findings into the `mp-sentinel review` path — is genuinely Phase 5+ scope and should be tracked separately.*
