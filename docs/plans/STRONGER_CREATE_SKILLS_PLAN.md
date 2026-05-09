# Plan — Make `create-skills` Generate Stronger, Language-Aware Best-Practices Skills

> **Goal:** Today `create-skills` produces a generic, mostly-deterministic SKILL.md tied to the source index. When agents work on Svelte/Vue/Python/etc. they miss language-specific structural rules (e.g. *imports must live inside the `<script>` tag in `.svelte` files*), and the skill carries no enforced clean-code policy (max file length, max function length, code-style derived from the actual codebase). This plan upgrades `create-skills` so the generated skill is opinionated, language-aware, codebase-specific, and enforces clean-code policies — both deterministically and via richer AI enrichment.

---

## 1. Diagnosis — what's missing today

Mapped against `src/services/skills-generator/` and `src/commands/create-skills.ts`:

| Gap | Where it shows up today | Effect on agents (e.g. Svelte case) |
|---|---|---|
| **Indexer only parses TS/TSX/JS/JSX** (`IndexableLanguage` in `src/types/index.ts:461`) | `.svelte` / `.vue` / `.py` / `.go` files are filtered into the codebase but never produce symbols/imports. | Agent has zero language structure info for Svelte → ignores `<script>` rules. |
| **`buildConventions()` is hard-coded for TS/ESM** (`content.ts:684`) | Only emits rules when `hasTs` is true. | Pure-Svelte / pure-Python projects get an almost-empty conventions section. |
| **AI enrichment prompt sees only counts + manifest** (`ai-enrichment.ts:185`) | No actual code samples are sent to the model. | Model can't say "in *your* `.svelte` files imports must be inside `<script>`" — it doesn't know what your code looks like. |
| **No file-size / function-size / clean-code policy** | Nowhere in `content.ts` | The 500-line / clean-code expectation never lands in the agent's context. |
| **No per-language rule pack** | `profile.ts` only categorises into `cli-tooling` / `node-service` / `react-next` / `library` | Svelte project → falls into `library` profile and the SvelteKit / Svelte 5 runes / `<script>` rules are absent. |
| **No code-style detection** (indent / quotes / semicolons / formatter config) | Not collected anywhere | The skill cannot tell the agent "this repo uses 2-space indent, single quotes, no semicolons" so the agent guesses. |
| **`languageRules` capped at 5 generic strings** (`ai-enrichment.ts:47`) | Schema | Even when AI is enabled the output is too thin to enforce structural rules per language. |

These gaps explain the Svelte symptom: the agent has no deterministic rules about `.svelte` structure, no AI-supplied rules grounded in real samples, and no clean-code policy.

---

## 2. Target architecture

Layer the upgrade in 4 additive stages — none break the existing metadata contract or `--check` semantics.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ create-skills (command)                                                  │
└──────────┬───────────────────────────────────────────────────────────────┘
           │
   ┌───────▼─────────┐    ┌───────────────────┐    ┌───────────────────┐
   │ SourceIndex     │ +  │ LanguageProfile   │ +  │ CodeStyleProfile  │   ← NEW
   │ (existing)      │    │ (NEW)             │    │ (NEW)             │
   └───────┬─────────┘    └─────────┬─────────┘    └─────────┬─────────┘
           │                        │                        │
           └────────────┬───────────┴────────────┬───────────┘
                        │                        │
                ┌───────▼──────────────┐ ┌───────▼─────────────────┐
                │ RulePack catalog     │ │ AI Enrichment v2        │
                │ (deterministic, NEW) │ │ (samples + per-lang)    │
                └───────┬──────────────┘ └───────┬─────────────────┘
                        │                        │
                        └────────────┬───────────┘
                                     ▼
                        ┌────────────────────────────┐
                        │ generateContent() v2       │
                        │ + new sections:            │
                        │   - Language Rules         │
                        │   - Code Style Policy      │
                        │   - Clean Code Checklist   │
                        │   - File Size Policy       │
                        └────────────┬───────────────┘
                                     ▼
                        ┌────────────────────────────┐
                        │ Adapters write SKILL.md +  │
                        │ references/code-style.md   │
                        │ references/language-       │
                        │   patterns.md              │
                        └────────────────────────────┘
```

---

## 3. Step-by-step plan (PRs in this order — each independently testable)

### PR 1 — `LanguageProfile` detection (no AI, no breaking change)

**Files:** `src/services/skills-generator/language-profile.ts` (new), `src/types/index.ts` (extend).

* New `LanguageProfile`:
  ```ts
  interface LanguageProfile {
    dominant: string;                      // e.g. "svelte"
    secondary: string[];                   // ["typescript", "css"]
    distribution: Record<string, number>;  // by file count
    indexableShare: number;                // % of files seen by tree-sitter
    nonIndexableHotspots: string[];        // top dirs that hold .svelte/.vue/.py
  }
  ```
* Walk the same file list the index walks (use `index.files` plus the file-handler `ALLOWED_EXTENSIONS`). Group by extension → language using a small map (svelte, vue, py, go, rs, java, kt, cs, php, rb, css, scss, html, md, …). No tree-sitter required.
* Emit `index.project.languageMix` (additive — backward compatible with schemaVersion 1.2).

**Tests:** unit fixtures for ts-only, svelte-heavy, polyglot.

### PR 2 — `CodeStyleProfile` detection from real files

**Files:** `src/services/skills-generator/code-style-profile.ts` (new).

* Pure deterministic, no AI. Sample up to **20 files** chosen by:
  * Largest non-test source file in dominant language.
  * Median-size source file.
  * 1 test file.
  * Files with the most imports (likely entrypoints).
* Detect (cheap regex, no parser):
  * Indent: tab vs 2 vs 4 spaces (mode of first leading whitespace).
  * Quotes: ratio of `'` vs `"` in source.
  * Semicolons: end-of-line `;` ratio.
  * Trailing newline, line endings.
  * `import` placement (for `.svelte` / `.vue`: count how many imports appear inside `<script>` vs outside — if outside-share > 0 this is flagged as a violation seed, useful for the agent prompt).
  * P50 / P95 / max file lines.
  * Detected formatter configs: `.prettierrc*`, `.editorconfig`, `biome.json`, `eslint.config.*`, `pyproject.toml [tool.ruff]`, `rustfmt.toml`, `gofmt`, etc.
* Output `CodeStyleProfile` consumed by the content builder and the AI prompt.

**Tests:** snapshot the profile for a fixture repo with mixed indent/quote styles.

### PR 3 — Built-in `RulePack` catalog (deterministic — works without AI)

**Files:** `src/services/skills-generator/rule-packs/*.ts` (new).

* Each pack exports:
  ```ts
  interface RulePack {
    id: string;                                        // "svelte"
    when: (s: { langProfile, frameworks, deps }) => boolean;
    rules: { kind: "must" | "should" | "avoid"; text: string }[];
    fileGlobs: string[];                               // ["**/*.svelte"]
  }
  ```
* Ship initial packs:
  * `svelte.ts` — imports inside `<script>` only; runes (`$state`, `$derived`, `$effect`) preferred over stores in Svelte 5; no top-level statements outside script; reactive `$:` rules; `lang="ts"` consistency; SvelteKit `+page.server.ts` boundaries.
  * `vue.ts` — SFC structure, `<script setup>`, defineProps/defineEmits.
  * `react.ts` — Rules of Hooks, no fetch in render, key prop for lists, server vs client boundary.
  * `next.ts` — `'use server'` / `'use client'`, route segment conventions, `next/image`.
  * `typescript-strict.ts` — already partly there; consolidate.
  * `python.ts` — type hints, ruff/black, no top-level side effects.
  * `go.ts` — gofmt, error returns, no panics in libraries.
  * `rust.ts` — clippy clean, `?` propagation, no `unwrap` in libraries.
* `selectActiveRulePacks(langProfile, frameworks, deps)` returns the union of packs whose `when` predicate fires. The result feeds a new `## Language & Framework Rules` section in SKILL.md (always rendered, no AI required).

**Tests:** for each pack, fixture project + assert the rules render in SKILL.md.

### PR 4 — Clean-code policies in `.mp-sentinelrc.json`

**Files:** `src/services/config/*.ts`, `src/types/index.ts`, `content.ts`.

* New config block (defaults ship in code, configurable per repo):
  ```jsonc
  "createSkills": {
    "policies": {
      "maxFileLines": 500,
      "warnFileLines": 350,
      "maxFunctionLines": 80,
      "maxParams": 5,
      "maxCyclomaticHint": 12,
      "forbidDefaultExports": false
    }
  }
  ```
* Render a deterministic `## Clean Code Policy` section in SKILL.md and a hard `### File Size Policy` block. The text uses imperative voice so the agent treats it as a rule, e.g. *"Hard limit: do not let any file exceed 500 lines. Refactor before adding more."*
* Include any **observed offenders** from `CodeStyleProfile` (top 5 files exceeding the limit) so the agent sees existing technical debt and can avoid making it worse.

**Tests:** config parse + render snapshot.

### PR 5 — AI Enrichment v2 (samples + per-language output)

**Files:** `src/services/skills-generator/ai-enrichment.ts`.

* Bump `ENRICHMENT_PROMPT_VERSION` (cache invalidation built-in).
* Extend `AIEnrichmentInput` (additive):
  * `languageMix`, `codeStyleProfile`, `policies` from PRs 1, 2, 4.
  * `codeSamples`: 3–5 deterministically selected snippets, max 40 lines each, redacted via the existing secret scrubber. Selection: 1 from the dominant language's largest file, 1 hub file, 1 test file, 1 component-style file (`.svelte` / `.vue` / `.tsx` / `.jsx` if present).
  * `observedAntiPatterns`: regex hits from CodeStyleProfile (e.g. "imports outside `<script>` in 3 files").
* Extend `AIEnrichmentOutputSchema` (additive — keep old fields):
  ```ts
  rulesByLanguage: z.record(z.string(), z.array(z.string()).max(15))
  cleanCodeRules: z.array(z.string()).max(15)
  antiPatterns: z.array(z.object({
    pattern: z.string(),
    files: z.array(z.string()).max(5),
    fix: z.string(),
  })).max(10)
  styleEnforcement: z.array(z.string()).max(10)
  ```
* Update prompt to **require** the model to:
  1. Ground every rule in either `topDependenciesWithVersions` or one of the `codeSamples` it just saw.
  2. Emit per-language rule blocks under `rulesByLanguage`.
  3. Cite the file path in `antiPatterns[].files` so the agent knows where the smell lives.
* Validate, hash, cache as today (no schema break in the cache envelope — additive only).

**Tests:** mock provider returning realistic JSON; assert SKILL.md contains `### Svelte Rules` block; assert anti-pattern files render as fenced cite-blocks.

### PR 6 — Lightweight Svelte/Vue extractor for the source index

**Files:** `src/services/source-index/extractors/svelte.ts`, `vue.ts` (new). Wire into `parser.ts` as a new `lexical-fallback`-tier path.

* Goal: give `.svelte` / `.vue` files a presence in the import graph so they appear in module ownership, hub files, and `--explain-index <file>`.
* Extract from `<script lang="ts">` block (and `<script context="module">`):
  * `import` statements
  * top-level `export`s (`export let`, `export const`, runes)
* Same `parserMode: "lexical-fallback"` reporting hooks as today; `--health` shows them in the recovered-files breakdown.
* Do NOT attempt full AST parsing — keep it regex + brace-matched script-block extraction.

**Tests:** fixtures with Svelte 4 store syntax, Svelte 5 runes, multi-script files.

### PR 7 — New SKILL.md sections + reference files

**Files:** `src/services/skills-generator/content.ts`, every adapter in `src/services/skills-generator/adapters/`.

* New top-level sections in SKILL.md:
  * `## Language & Framework Rules` (PR 3)
  * `## Code Style Policy` (PR 2 + PR 4)
  * `## Clean Code Policy` (PR 4)
  * `## File Size Policy` (PR 4)
* New reference files (added to every adapter's file list):
  * `references/code-style.md` — full CodeStyleProfile + formatter configs.
  * `references/language-patterns.md` — full RulePack output, grouped by language.
  * `references/clean-code-checklist.md` — policies + observed offenders.
* Update `claude.adapter.ts` `refs[]`, plus the equivalent file lists in `cursor`, `codex`, `windsurf`, `antigravity`, `cline`, `generic`. Update `buildAgentWorkflow()` reference-routing to include the new files.
* Bump `metadata.ts` `generatorVersion` so `--check` invalidates old generated files cleanly.

**Tests:** quality-gate test that asserts every adapter writes the new files; metadata-hash stability test on a frozen fixture.

### PR 8 — Docs + verification

* Update `docs/CREATE_SKILLS.md` (new sections, per-language rule packs, configurable policies).
* Update `docs/CODE_STYLE.md` to cross-link.
* Update `WHATS_NEW.md`, `docs/CHANGELOG.md`, `docs/COMMANDS_CHEAT_SHEET.md`.
* Run the full verification checklist from `AGENTS.md §8`:
  ```sh
  npm run agent:skills:refresh
  npm run format:check
  npm run typecheck
  npm run typecheck:tests
  npm test
  npm run build
  ```
* Run `npm run dogfood` and inspect the generated `.claude/skills/mp-sentinel-best-practices/SKILL.md` for the new sections.
* Add a Svelte fixture project under `src/__tests__/fixtures/svelte-project/` and an end-to-end test that runs `create-skills` against it and asserts:
  * `## Language & Framework Rules` contains "Svelte" rules.
  * `imports inside <script>` rule is present.
  * `references/code-style.md` and `references/language-patterns.md` exist.
  * If a fixture file holds an import outside `<script>`, the anti-pattern is cited.

---

## 4. Behavioural contracts to preserve

* **Exit codes** (`AGENTS.md §2`) — unchanged.
* **Metadata header** — unchanged marker string `@mp-sentinel-generated`. `sourceIndexHash` will move because new fields enter the hash input — that is correct (`--check` will report stale on the first run after upgrade, which is what we want).
* **Output paths per adapter** — unchanged.
* **`--check` / `--dry-run` / `--explain-agents`** — unchanged.
* **AI-enrichment cache** — additive schema; bumped `ENRICHMENT_PROMPT_VERSION` invalidates old cache entries cleanly.
* **`indexing.enabled`** semantics — unchanged.

---

## 5. Risks & mitigations

| Risk | Mitigation |
|---|---|
| AI returns rules that contradict the project's actual style | Force grounding via `codeSamples` + `codeStyleProfile`; reject in Zod if `rulesByLanguage` is empty for the dominant language; fall back to deterministic RulePack output. |
| Code samples leak secrets | Run them through the existing secret scrubber in `src/services/security/` **before** they go in the prompt. Reuse same allow/deny logic the review path already uses. |
| Schema bump breaks downstream consumers | Keep all new fields optional; old consumers ignoring new fields keep working. |
| Generated SKILL.md gets too long | Push detail into `references/*.md`; keep the SKILL.md top-level under ~12 KB; the existing `MAX_HUB_FILES` / `MAX_RISK_ENTRIES` etc. pattern continues. |
| Lexical extractor for Svelte misclassifies imports | Mark parserMode as `lexical-fallback` so the user sees it in `--health` and can drill down. |

---

## 6. Acceptance criteria (definition of done)

1. Running `mp-sentinel create-skills --agent claude` against a Svelte project produces a SKILL.md whose `## Language & Framework Rules` section contains at least:
   * "Place all `import` statements inside the `<script>` block."
   * A Svelte-5-vs-Svelte-4 note that matches the version in `package.json`.
2. SKILL.md has a `## File Size Policy` section showing the configured limit and any current offenders.
3. `references/code-style.md` reports the indent/quote/semicolon style detected from the real codebase, plus the formatter configs found.
4. `references/language-patterns.md` lists rules per language for every detected language with a count > 0.
5. With AI enrichment **off**, all the above still appears (rule packs are deterministic).
6. With AI enrichment **on**, `rulesByLanguage` contains a non-empty entry for the dominant language and `antiPatterns` cites at least one real file path when one exists.
7. Full verification checklist passes; `npm pack --dry-run` includes only intended runtime/docs files.

---

## 7. Copy-paste agent prompt

> Paste this into your AI agent (Claude Code, Codex, Cursor, Windsurf, Antigravity — any of them) running inside the `mp-sentinel` repo. It is fully self-contained and matches the rules in `AGENTS.md` and `CLAUDE.md`.

```
ROLE
You are an experienced TypeScript / Node CLI engineer working inside the
mp-sentinel repository. Your task is to upgrade the `create-skills` command so
the generated SKILL.md is language-aware, codebase-specific, and enforces
clean-code policies.

READ FIRST (in this exact order — do not skip)
1. AGENTS.md — authoritative development rules. Pay special attention to:
   §1 Agent Workflow, §3 TypeScript/ESM, §4 create-skills behavioural contract,
   §6 Review context enrichment, §7 Docs consistency, §8 Verification checklist.
2. CLAUDE.md — Claude-specific guardrails (do-not-touch list, version bumps).
3. docs/CREATE_SKILLS.md — current behaviour of the command.
4. docs/CODE_STYLE.md — current code-style notes.
5. docs/plans/STRONGER_CREATE_SKILLS_PLAN.md — the plan you are implementing.
6. The following source files, top to bottom:
   - src/commands/create-skills.ts
   - src/services/skills-generator/index.ts
   - src/services/skills-generator/content.ts
   - src/services/skills-generator/knowledge-base.ts
   - src/services/skills-generator/ai-enrichment.ts
   - src/services/skills-generator/profile.ts
   - src/services/skills-generator/metadata.ts
   - src/services/skills-generator/registry.ts
   - All adapters in src/services/skills-generator/adapters/
   - src/types/index.ts (focus on SourceIndex / AIEnrichmentInput /
     AIEnrichmentOutput / IndexableLanguage / SkillKnowledgeBase)
7. Run `npm run agent:skills:check`. If stale, run `npm run agent:skills:refresh`
   and read `.claude/skills/mp-sentinel-best-practices/SKILL.md`.
8. Inspect `.mp-sentinel-cache/source-index.json` to ground yourself in real
   data shape — do not guess field names.

GOAL
Make `create-skills` output a stronger, opinionated, language-aware skill that:
  (a) Knows the languages and frameworks present in the codebase (including
      .svelte / .vue / .py / .go / .rs which the indexer doesn't fully parse).
  (b) Detects the project's actual code style (indent, quotes, semicolons,
      formatter configs, file-size distribution).
  (c) Emits a per-language rule pack (deterministic — works without AI).
  (d) Emits a clean-code policy with hard limits (max 500 lines per file,
      max 80 lines per function — configurable in .mp-sentinelrc.json).
  (e) When AI enrichment is enabled, sends real (secret-scrubbed) code samples
      to the model and demands per-language, file-cited rules — not generic
      advice.
  (f) Adds two new reference files: references/code-style.md and
      references/language-patterns.md, written by every adapter.

CONSTRAINTS
- Do NOT change exit-code semantics (0/1/2).
- Do NOT change the `@mp-sentinel-generated` metadata marker string.
- Do NOT write into `.sentinel/skills/` from create-skills.
- Do NOT remove or rename existing AIEnrichmentOutput fields — additive only.
- Do NOT break --check, --dry-run, --explain-agents.
- Bump `ENRICHMENT_PROMPT_VERSION` in src/services/skills-generator/ai-enrichment.ts
  and `generatorVersion` in src/services/skills-generator/metadata.ts so old
  cache and old generated files invalidate cleanly on first run.
- Internal imports must use `.js` extension (NodeNext). Use `import type` for
  type-only imports. Use `node:` prefix for built-ins. No `any`.
- All new code must respect the strict tsconfig flags listed in AGENTS.md §3.
- Run code samples through the existing secret scrubber in
  src/services/security/ before they go to the AI prompt. Do NOT add a second
  redactor.
- Keep SKILL.md top-level concise — push detail into references/*.md.
- Generated skill files are local-only; never commit them. Do not modify the
  .gitignore rules around .claude/skills/, .agents/skills/, etc.

PLAN OF WORK (ship as separate commits in this order)

Commit 1 — LanguageProfile
- Add src/services/skills-generator/language-profile.ts
- Extend types in src/types/index.ts (additive: index.project.languageMix?)
- Add unit test src/__tests__/language-profile.test.ts

Commit 2 — CodeStyleProfile
- Add src/services/skills-generator/code-style-profile.ts
- Sample up to 20 files by deterministic seed; do NOT touch unindexed files.
- Detect indent / quotes / semicolons / file-size P50/P95/max / observed
  formatter configs (.prettierrc*, .editorconfig, biome.json, eslint.config.*,
  pyproject.toml [tool.ruff], rustfmt.toml).
- Add unit test src/__tests__/code-style-profile.test.ts

Commit 3 — Rule packs
- Add src/services/skills-generator/rule-packs/{svelte,vue,react,next,
  typescript-strict,python,go,rust}.ts
- Add src/services/skills-generator/rule-packs/index.ts exporting
  selectActiveRulePacks(langProfile, frameworks, deps).
- Wire into content.ts as a new `## Language & Framework Rules` section.
- Add unit test src/__tests__/rule-packs.test.ts (one assertion per pack).

Commit 4 — Clean-code policies
- Extend the config schema in src/services/config/ with createSkills.policies.
- Defaults: maxFileLines=500, warnFileLines=350, maxFunctionLines=80,
  maxParams=5, forbidDefaultExports=false.
- Add deterministic `## Clean Code Policy` and `## File Size Policy` sections
  to content.ts. Include observed offenders (top 5 files exceeding the limit
  from CodeStyleProfile).
- Add unit test src/__tests__/clean-code-policy.test.ts

Commit 5 — AI Enrichment v2
- Bump ENRICHMENT_PROMPT_VERSION.
- Extend AIEnrichmentInput with languageMix, codeStyleProfile, policies,
  codeSamples (post-scrub), observedAntiPatterns.
- Extend AIEnrichmentOutputSchema with rulesByLanguage, cleanCodeRules,
  antiPatterns, styleEnforcement (all additive, all optional in consumers).
- Update prompt to require grounding in samples + topDependenciesWithVersions
  and per-language output. Reject (Zod) if rulesByLanguage is missing for the
  dominant language when codeSamples is non-empty.
- Update src/__tests__/ai-enrichment.test.ts with mocked provider returning the
  new shape.

Commit 6 — Svelte / Vue lexical extractor
- Add src/services/source-index/extractors/svelte.ts and vue.ts.
- Wire into parser.ts as a `lexical-fallback`-tier path. Files report
  parserMode: "lexical-fallback" so --health shows them.
- Extract imports + top-level exports from <script> blocks only; do not parse
  the template.
- Add tests for Svelte 4 stores, Svelte 5 runes, multi-script files, and a
  `.vue` SFC.

Commit 7 — New sections + reference files in adapters
- Update src/services/skills-generator/content.ts to expose four new sections.
- Update every adapter (claude, cursor, codex, windsurf, antigravity, cline,
  generic) to write references/code-style.md, references/language-patterns.md,
  and references/clean-code-checklist.md, and to surface them in the SKILL.md
  References block.
- Update buildAgentWorkflow() reference-routing in content.ts to include the
  new files.
- Update src/__tests__/quality-gate.test.ts and src/__tests__/create-skills.test.ts
  to assert the new files exist.

Commit 8 — Docs + verification
- Update docs/CREATE_SKILLS.md, docs/CODE_STYLE.md cross-link, WHATS_NEW.md,
  docs/CHANGELOG.md, docs/COMMANDS_CHEAT_SHEET.md.
- Add a Svelte fixture under src/__tests__/fixtures/svelte-project/ and an
  end-to-end test asserting:
    * `## Language & Framework Rules` contains a Svelte rule about `<script>`
      imports.
    * `references/language-patterns.md` lists rules per detected language.
    * If a fixture file has an import outside `<script>`, the anti-pattern is
      cited with the file path.
- Run, in order:
    npm run agent:skills:refresh
    npm run format:check
    npm run typecheck
    npm run typecheck:tests
    npm test
    npm run build
    npm run dogfood
- Open the generated SKILL.md and confirm the new sections render. Iterate
  until the Svelte fixture E2E test passes.

ACCEPTANCE CHECKS (run before reporting done)
- mp-sentinel create-skills --agent claude on the Svelte fixture produces
  SKILL.md whose `## Language & Framework Rules` mentions at least:
    * Imports must be inside the `<script>` block.
    * A Svelte-version-aware note (Svelte 5 runes vs Svelte 4 stores) matching
      the fixture's package.json.
- SKILL.md contains a `## File Size Policy` section reflecting the configured
  limit (default 500).
- references/code-style.md reports the real detected style.
- With createSkills.ai.enabled=false, all the above still appears.
- With createSkills.ai.enabled=true and a mocked provider, antiPatterns cite a
  real file path.
- All commands in the verification block above exit 0.

DELIVERABLES
- Eight commits matching the plan above, all passing the verification
  checklist.
- A short summary message listing: bumped versions, new files, new sections,
  new config keys, and any follow-up TODOs left as `// TODO(stronger-skills):`.
```

---

*Plan author: implementation can be sequenced incrementally — even shipping just PRs 1–4 already gives a meaningful upgrade without touching the AI path. PRs 5–6 add the language-aware AI quality jump. PRs 7–8 finish the surface area.*
