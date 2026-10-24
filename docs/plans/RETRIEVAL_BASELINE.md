# Retrieval baseline (post-merge)

Compact `--search` is merge-ready. Before designing `mp_sentinel_task_context`, measure ranking quality so the capsule does not drop needed files while saving tokens.

## Protocol

1. **CI smoke (fixture):** `src/__tests__/retrieval-benchmark.test.ts` keeps a small golden set. Unified `--search` must match or beat dedicated finders on Recall@5 / MRR / Top-1; compact hits omit nested finder fields.
2. **This-repo corpus:** `scripts/retrieval-golden.json` (25-50 queries). Each row has `kind`, `shape` (`exact` / `ambiguous` / `fuzzy` / `task`), `query`, and a **non-empty** `relevant` path list. CI locks unique `(kind, query)` pairs, unique paths per row, and `existsSync` for every label. Task slice includes Vietnamese, paraphrase, and long-prompt queries. The bench exits 2 if a label is empty or missing from the index. Empty relevant scores 0 in both the fixture helper and the bench script (never 1 / `null`).
3. **Compare** dedicated finders (`--find-symbol` / `--find-file` / `--find-import` / `--find-code`) with unified `--search` (same `--limit 5`). Task queries use `--task-context`. Fuzzy old path unions the three structured finders.
4. **Ranking metrics:** Recall@5, MRR, Top-1, payload bytes (and bytes/4 token estimate), split by kind and by shape.
5. **Paired latency:** after a warmup, sample each kind 9 times, alternating unified/old order so cold start does not always hit one side. Report unified and old p50/p95 per kind. Per-query one-shot times are not the latency contract.

## How to run

Fixture + corpus contract (CI):

```sh
npm test -- --testPathPatterns='retrieval-benchmark|retrieval-metrics|retrieval-golden|task-context'
```

This-repo measurement (needs `dist/` and a current source index):

```sh
npm run build
npm run sentinel:index
npm run golden:lock      # corpora frozen and unchanged
npm run retrieval:bench  # ranking + latency
npm run agentctx:bench   # compact agent-context gates
npm run chain:bench      # task_context -> agent_context, end to end
```

The script prints JSON with per-query rows, `byKind` (including `latencyMs`), `byShape`, and `latencyMs.byKind`. Exit 2 if `dist/`, the source index, or the golden file is missing, or if a query fails.

## Notes

- Compact `--search` is merge-ready. The frozen baseline showed **task Recall@5 = 0** for raw `--search` on natural-language prompts.
- Compact hits omit `reason`, `language`, nested `symbol` / `importInfo` / `entry`.
- `mp_sentinel_task_context` does **not** remove tokens from the original prompt already in the conversation. It only replaces multi-tool search. Prompt/conversation compression belongs in the orchestrator, not this tool.
- `release:check` previously failed because `package.json` listed a self-dependency `"mp-sentinel": "link:"` that was not in the lockfile. That spec is removed; re-run `npm run release:check` before tagging.

## Task-context MVP

Pipeline: extract up to 6 anchors (path / identifier / flag / package) -> per-kind symbol/file/import search -> code fallback if no seed -> weighted RRF grouped by file -> pin exact seeds -> 1-hop graph from the first three seeds -> pack whole records under a token budget.

Contract: `{ prompt, maxFiles?: 5 (max 10), tokenBudget?: 800 }`.

Capsule: selected files, rank/score, short anchors, short graph, `usedTokens`, `truncated`, `omittedFiles`. No prompt echo, no snippets. Next step for the agent: `mp_sentinel_agent_context`.

Calls sidecar errors degrade with a warning; never return a partial calls graph. Packing uses `estimateTokens()` on whole JSON records.

MVP gates (enforced by `npm run retrieval:bench`, exit 1 on miss): task Recall@5 >= 0.60, task MRR >= 0.40, exact Recall@5 >= 0.99, exact MRR/Top-1 no regression vs old finders. Packed capsule `usedTokens` and the actual emitted JSON (including the MCP `{ status: "ok" }` wrapper) must be <= `tokenBudget`. `omittedFiles` is a prefix of omitted paths that still fits (`omittedCount` is the full omit cardinality). The packer shrinks omitted paths, files, warnings, then anchors until the envelope fits. If that empties the capsule, the top-ranked file is restored from richest to leanest (full record + anchors + warnings, then without warnings, then without anchors, then without `graph`, then without per-file anchors), so at least one file is kept whenever any single-file envelope fits; only a bare `{ file, rank, score }` record over budget yields zero files. `npm run retrieval:bench` fails a task query whose capsule exceeds 800 tokens. Graph expansion uses the top 3 RRF seeds, not Map insertion order. Packing lives in `task-context-pack.ts`.

Core: `src/services/source-index/task-context.ts`. MCP: `src/services/mcp-server/task-context.ts`. Do not reuse `buildReviewContext()`.

## Compact agent context

`mp_sentinel_agent_context` is the step after `task_context`, and it was the remaining payload problem: a large file returned roughly 2,215 tokens, mostly calls / incoming calls / suggested commands.

Contract: `{ file, focus?: string[] (max 6, trimmed + deduped), tokenBudget?: number (MCP default 1200, min 100, max 4000) }`. MCP is always compact. The CLI keeps the legacy payload (fixed caps, `suggestedCommands`, no budget) and only compacts when `--token-budget` is passed; `--focus` is rejected (exit 2) without both `--agent-context` and `--token-budget`.

Focus ranks evidence **before** the per-kind caps -- exact match, then case-insensitive substring, then source order -- across symbols, exports, imports, calls, incoming calls, dependency paths and hub paths, so an anchored symbol beyond the 30-symbol cap still reaches the capsule.

Packing order: (1) file path/language/role + parser telemetry, (2) focus-matched evidence, (3) direct imports/dependents, (4) remaining symbols/exports/imports, (5) outbound/incoming calls, (6) hub files. Slots inside a stage are interleaved round-robin, and the focus stage takes at most 8 records per slot before the rest of that slot falls to its normal stage -- every call inside a focused function matches the anchor through `inSymbol`, so an unbounded focus stage spends the whole budget on call records and drops the file's own imports (measured: required-evidence retention 0.84 -> 0.97). Whole records only -- never a clipped string or a half object. An oversized record is skipped, not fatal: packing continues so a small relevant import still lands when a long symbol does not. If the file identity alone does not fit, the call fails (CLI exit 2 / MCP `isError: true`) instead of emitting an over-budget payload.

Compact output keeps the existing evidence schema, drops `suggestedCommands`, and adds `usedTokens` + `truncated`. Every `*Truncated` count covers both the legacy cap and items dropped for budget. Calls stay absent (not `[]`) on pre-1.4 caches. Calls hydration stays atomic: a missing/corrupt sidecar refuses the capsule rather than returning a partial caller graph.

Emission policy (`src/services/source-index/emit-policy.ts`) is shared with the task-context packer: `usedTokens` measures the JSON that is actually emitted -- compact, `--pretty` (indentation included), or MCP with its envelope. This closed a real bug: `--task-context --pretty --token-budget 800` reported 799 tokens for a payload of about 1,147.

Gate: `npm run agentctx:bench` over `scripts/agent-context-golden.json` (`file` + `focus` + `required` evidence). Exit 1 unless file identity and parser health are kept for every row, **every row keeps 100% of its own focus anchors**, **every row retains >= 0.6 of its required evidence** (an aggregate alone can hide a row that lost everything), weighted required-evidence retention >= 0.85, every capsule <= 1,200 tokens with `usedTokens` equal to the emitted count, and the aggregate payload of rows whose legacy output exceeds 1,200 tokens drops by >= 30%. Focus anchors are validated against the index alongside required items. Required items are validated against the index core, not the capped legacy payload -- pulling evidence past the caps is exactly what `focus` is for. `src/__tests__/agent-context-golden.test.ts` locks the corpus contract and re-runs the gates on a fixture in CI.

This-repo run (12 rows, 2026-09-05): retention 0.973 (worst row 0.667 -- an import past the 20-import cap that no anchor points at), focus anchors 100%, identity/parser health 100%, 11 rows heavy in legacy form, 22,679 -> 13,073 tokens (-42.4%).

Core: `src/services/source-index/agent-context-pack.ts`. Shared evidence + the legacy `queryAgentContext()`: `src/services/source-index/agent-context-evidence.ts` (split out of `query.ts`, which was over the 500-line limit). CLI: `src/commands/indexing-agent-context.ts` (also owns `--focus` validation and legacy/compact routing). MCP: `getAgentContext()` in `src/services/mcp-server/service.ts`; review/skills tool registrations moved to `src/commands/mcp-review-tools.ts` to bring `mcp-server.ts` back under the limit.

## Frozen corpora

Both measurement corpora are locked so a recorded number can be traced to the corpus that produced it:

| corpus | lock | rows |
|--------|------|------|
| `scripts/retrieval-golden.json` | `scripts/retrieval-golden.lock.json` | 45 |
| `scripts/agent-context-golden.json` | `scripts/agent-context-golden.lock.json` | 12 |
| `scripts/chain-golden.json` | `scripts/chain-golden.lock.json` | 30 (18 tuning + 6 validation + 6 held out) |

A lock holds `version`, `rows`, `sha256` (canonical JSON: object keys sorted, no whitespace, so reformatting is not a change) and `frozenAt`. `npm run golden:lock` verifies; `npm run golden:lock -- --write` accepts a change and bumps the version. All three benches verify before measuring and exit 2 on a mismatch, and `src/__tests__/golden-lock.test.ts` fails CI if a corpus is edited without a bump.

## Chain measurement: task_context -> agent_context

### Fixed-budget allocation experiment

Implementation follow-ups can use `npm run allocation:bench -- --phase replay --selection <original-tuning-report.json> --repo <repo> --corpus <corpus.json> --output <new-report.json>` or add `--replay` to `repos:bench`. Replay allows changed implementation/index fingerprints while checking that the frozen allocation itself is identical; it never chooses a new allocation. Both original and current tool fingerprints are recorded. Existing corpus slice labels are historical: cases used to guide the implementation are validation on replay, regardless of their original `heldOut` marker. Freeze any fresh source-grounded task set before observing its results, and do not use that result to change the candidate implementation while calling it independent.

Measured outcomes and remaining cross-repo quality limits: [2026-10-23 results](ALLOCATION_RESULTS.md).

Additional private-repo cohort: [2026-10-24 aggregate results](MULTI_REPO_RESULTS.md).

For a local multi-repository cohort, `npm run repos:bench -- --manifest <private-manifest.json> --freeze` validates source-grounded labels and writes adjacent corpus locks **before** measuring. Then run `npm run repos:bench -- --manifest <private-manifest.json> --output <private-results-directory>`; `--selection <tuning-report.json>` optionally names the frozen selection (default: the allocation experiment's local tuning report). The manifest is `{ "repos": [{ "id": "R1", "root": "/local/repo", "corpus": "corpus.json" }] }`, with paths resolved relative to the manifest. Each corpus must contain held-out rows only, using the same named-evidence shape as the chain corpus. Build indexes separately before freezing.

Keep private corpora, manifests, locks and detailed outputs under a local ignored directory such as `.mp-sentinel-cache/benchmarks/`. The runner processes repos sequentially, preserves the chosen policy, and saves individual reports plus `summary.json`. It reports per-repo results, macro retention (each repo weighted equally), and micro retention (each evidence label weighted equally). A repo that fails validation or measurement stays in the cohort as failed; the full-cohort scores become null, later repos still run, and the process exits 2. Exit 0 means complete measurement with valid budgets, not proof of a quality threshold. `npm run repos:test` covers aggregation, manifest validation and failure isolation.

`npm run allocation:bench` compares baseline (3 files x 1,200 tokens), A (4 x 900), B (5 x 720), C (6 x 600), and D (10 x 360). Each task capsule gets 800 tokens; each arm stays within 4,400 emitted tool-output tokens. It passes the actual file limit to task-context and opens only files emitted by that capsule. The production defaults are unchanged.

Selection uses tuning rows only: a candidate must improve total named-evidence retention without reducing any tuning query's retained labels. Ties prefer fewer calls, then fewer emitted tokens. Otherwise baseline wins. The selection is written before evaluating the other slices. Transfer uses the same frozen selection on another corpus/repo; it never selects a different policy there.

```sh
npm run allocation:test
npm run allocation:bench -- --output .mp-sentinel-cache/benchmarks/allocation-tuning.json
npm run allocation:bench -- --phase evaluate --selection .mp-sentinel-cache/benchmarks/allocation-tuning.json --output .mp-sentinel-cache/benchmarks/allocation-evaluation.json
npm run allocation:bench -- --phase transfer --repo ../mvp-listening --corpus scripts/listening-chain-golden.json --selection .mp-sentinel-cache/benchmarks/allocation-tuning.json --output .mp-sentinel-cache/benchmarks/allocation-listening.json
```

Build and refresh each repo's index before measuring; create the output directory first. Do not run indexing, skills refresh, or integration tests against the same cache during the experiment. Reports fingerprint corpus, core index, Git revision (including a dirty marker), CLI bundle and experiment implementation. An index/code fingerprint change invalidates the run. Errors exit 2; budget/accounting failures and empty task results exit 1. Corpus/labels are checked before querying.

Each report includes exact emitted token counts, actual calls, per-query evidence kept/lost, losses before opening versus after opening, and coverage of the top-N pre-packing candidates. Explain-ranking calls are diagnostics, counted separately from simulated agent calls. Latency p50/p95 describes one sequential CLI chain per query/arm across different tasks, excluding diagnostics; it is not a repeated latency comparison. Token totals cover compact JSON bodies, excluding requests, model reasoning/output, protocol wrappers and conversation history. These measurements do not establish whole-session token savings or task-completion accuracy.

`scripts/listening-chain-golden.json` is a separate, locked, **local-only** transfer corpus: 8 English/Vietnamese task queries and 16 named symbols, checked against `mvp-listening` source before any transfer results were observed. It is gitignored and not shipped; supply a local corpus to reproduce external-repository measurements. The lock checker skips this optional pair in a clean public checkout, but validates it strictly if either file is present. The sample covers audio upload policy, blanks, Reading page expansion, review playback, alignment retry/repair, Whisper escalation and answer scoring. It is not a representative estimate for every workflow in that repo.

`npm run chain:bench` (`scripts/agent-chain-benchmark.mjs`) walks the path an agent actually takes: one `--task-context` call, then one `--agent-context` call per opened file (top 3), over `scripts/chain-golden.json` (30 task queries, locked). Two arms open the same files: **anchored** passes the anchors `task_context` produced for that file as `--focus`, **plain** passes none.

Two different things are scored:

1. **Anchor retention.** Does the capsule still answer the anchors the task capsule emitted? Anchors are query tokens (`hydrate`, `sidecar`), matched the way the packer ranks -- exact, then case-insensitive substring. A hit proves a related string survived; it does **not** prove the right symbol or call did.
2. **Evidence retention.** Named labels (`symbol` or `import`, exact name, per file), validated against the index core before measuring. Loss splits into **ranking loss** (the file was never opened) and **packing loss** (the file was opened but the item is missing). Ranking loss is classified against the candidate list *before* packing, obtained with `indexing --task-context <prompt> --explain-ranking`: `outside-top-n` (a candidate, ranked below the opened window), `dropped-by-task-budget` (ranked inside the window but cut when packing the capsule), `not-candidate` (absent from a **complete** candidate list), `unknown` (absent from a truncated list, or no ranking data at all). Absence from a cut list is never reported as `not-candidate` -- an earlier version of this bench inferred it from a 10-file probe and was wrong about it. Symbol labels carry a `line` for human reference; drift is reported as `staleLines`, not gated. Call-edge labels are out of scope while the light cache keeps `calls` in a sidecar.

**Slices.** 18 rows are the **tuning** slice. 6 rows (14 labels) are the **validation** slice: they were written before tuning, but their result was read while choosing the exact-boost value, so they are not an independent check and are named for what they actually did. 6 further rows (14 labels) are the **held-out** slice, written after the coefficient was frozen and never used to pick anything. Only the tuning slice carries the retention thresholds; the other two are measured, reported, and gated on validity/budget alone.

Degenerate runs are failures, not perfect scores: a row where `task_context` opened no files fails the run and is listed in `unscorableRows`; zero answerable anchors or zero evidence labels report `null` retention with `valid: false` and exit 1. Scoring lives in `scripts/lib/chain-metrics.mjs`, regression-tested in `src/__tests__/chain-metrics.test.ts` (both empty-denominator cases), with the thresholds frozen in a test so loosening one shows up as a diff.

Gates (exit 1): every capsule within its budget with `usedTokens` equal to the emitted count, chain total <= `800 + 3 * 1200` per task, anchored anchor-retention >= plain and >= 0.85, anchored packing loss <= plain, tuning-slice evidence retention >= 0.7, tuning-slice ranking loss <= 0.3.

### Ranking fix (2026-09-05)

The first run said packing was fine and ranking was not: 0 of 25 opened-file labels lost to packing, 13 of 38 labels lost before packing ever saw them. Cause classification pointed at three ranking defects, all fixed in `task-context.ts`:

- **Build output outranked source.** `packages/**/dist-test/**/*.js` mirrors `src` symbol for symbol; the exact tier let a compiled copy take the top slot. `pathWeight` now demotes `dist/`, `dist-test/`, `build/`, `coverage/`, `out/`, `node_modules/` and `.d.ts` to 0.2, the test pattern also covers `.spec.` and `tests/`, and an exact hit on a demoted path no longer enters the exact tier at all.
- **`index.ts` won on the word "index".** "source index", "index-cache" and "MCP index search" all contain it, so every `index.ts` -- including a 2,000-line type barrel -- got the 2.2x exact-basename boost. Generic basenames (`index`, `main`, `types`, `utils`, `constants`, `helpers`, `common`) no longer take it, and `role: "type"` files carry a 0.5 weight.
- **The right file never reached fusion.** Per-kind search returned 40 hits ordered by score then path, so dozens of same-score hits from `extensions/` and `packages/` crowded out `src/**` before weighting happened. `PER_KIND_LIMIT` is 120.
- **The exact tier was a hard fast lane.** One exact hit on a common word ("review", "search") jumped a file past everything, regardless of how much stronger another file's fused score was. It is now a 1.5x multiplier inside the ranking instead of a separate tier.

Before/after on the same corpus and the same index. The classification column uses the corrected pre-packing probe, so the "before" causes are re-derived rather than the numbers first reported:

| metric | before | after |
|--------|--------|-------|
| evidence retention, tuning slice | 0.6579 | **0.7632** |
| evidence retention, validation slice | 0.8571 | **1.0000** |
| labeled files opened in the top 3 | 0.6667 | **0.7778** |
| labels lost to ranking (tuning) | 13 | **9** |
| labels lost to packing | 0 | **0** |
| task Recall@5 (`retrieval:bench`) | 0.7407 | **0.8519** |
| task MRR | 0.5667 | **0.6343** |
| exact Recall@5 / MRR | 1.0000 / 0.9412 | **1.0000 / 0.9412** |
| calls per task | 4 | 4 |
| tokens per task | 4,123 | 4,150 |

The exact-boost value was chosen by ablation on the same corpus and index. The tuning slice could not separate 1.2 from 1.5; the validation slice could -- which is precisely why it counts as validation and not as a held-out check:

| EXACT_BOOST | tuning | validation | task R@5 | task MRR |
|-------------|--------|------------|----------|----------|
| hard tier (before) | 0.6579 | 0.8571 | 0.7407 | 0.5667 |
| 1.0 (no signal) | 0.7368 | 0.6429 | 0.7963 | 0.6065 |
| 1.2 | 0.7632 | 0.6429 | 0.8519 | 0.6343 |
| **1.5 (chosen, frozen)** | **0.7632** | **1.0000** | **0.8519** | 0.6343 |
| 2.0 | 0.7105 | 0.8571 | 0.8519 | 0.6546 |
| 3.0 | 0.7105 | 0.8571 | 0.8519 | 0.6546 |

Thresholds were then ratcheted to the measured result (evidence retention 0.5 -> 0.7, ranking loss 0.45 -> 0.3) and frozen in a test. The coefficient is frozen at 1.5; the held-out slice below was written afterwards and is the first independent read on it.

This-repo run (2026-09-05, chain corpus v4, 30 rows / 66 labels):

| metric | value |
|--------|-------|
| calls per task | 4 (1 task_context + 3 agent_context) |
| tokens per task, anchored | 4,150 (task capsule 742 + ~1,136 per opened file) |
| tokens per task, plain | 4,140 |
| labeled files opened in the top 3 | 0.79 |
| anchor retention | anchored **191/192**, plain 185/192 |
| evidence retention, all rows | **0.833** |
| evidence retention, tuning / validation / held-out | **0.763** / **1.000** / **0.857** |
| evidence lost to ranking | 11 labels, **all `outside-top-n`** (ranks 4, 4, 4, 5, 8, 9, 10, 12) |
| evidence lost to packing | anchored 0, plain 0 |
| `not-candidate` / `dropped-by-task-budget` / `unknown` | 0 / 0 / 0 |

What this supports, stated no wider than the measurement:

- **Packing kept every label it was given: 55 of 55 labels whose file was opened, in both arms.** The other 11 never reached packing, so this says nothing about packing on files the chain did not open, or on evidence kinds the corpus does not label (call edges).
- **Every remaining loss is ordering, not recall.** With the pre-packing list in hand, `not-candidate` is zero: retrieval produced all 11 files, at ranks 4-12, and the top-3 window left them out. The earlier claim that one file was never found was an artifact of a 10-file probe.
- **The task capsule's own budget dropped nothing** (`dropped-by-task-budget` = 0), so widening the opened window -- not a bigger capsule -- is what would recover these labels.
- **Auto anchors cost almost nothing and help slightly on the weak metric.** They keep 191 of 192 substring-matched anchors versus 185 of 192 for the unfocused arm, for about 10 extra tokens per task. On named evidence the two arms are **equal**, so this is not evidence that auto-focus beats hand-picked focus -- that comparison has no hand-picked arm here. `agentctx:bench` is where hand-picked focus is measured, on a different corpus.
- The held-out slice (6 queries, 14 labels, never used to pick anything) reads **0.857**, below the validation slice's 1.000 and above the tuning slice's 0.763. Its 2 missing labels are one file at rank 8. On 14 labels this is a weak signal: it is consistent with the fix generalizing, not proof of it.

### Golden corpus upkeep (2026-09-05)

`recallAtK` is unchanged (`hits / |relevant|`). Two corpus rows were fixed instead:

- The exact `import zod` row was replaced with `import fast-glob`. `zod` has 7 real importers in this repo, so at `k = 5` the row could never score above 0.71 and every new zod importer dragged the exact slice down -- it measured the corpus, not the ranker. `fast-glob` has 2 importers, so the row is answerable at `k = 5`. **Rule for new exact rows: the label set must fit in `k`** -- enforced by `src/__tests__/retrieval-golden.test.ts`.
- `zod` stays in the corpus under a new **`multi`** shape for queries that genuinely have more correct answers than `k`. `multi` rows are scored for **no regression vs the old finders** (Recall@5 and MRR), never against the absolute exact floor. Current: unified 0.71 Recall@5 / 1.00 MRR, identical to old -- 5/7 labels is the ceiling at `k = 5`.
- The exact `import @modelcontextprotocol/sdk` row gained `src/commands/mcp-review-tools.ts`, which really does import the SDK after the `mcp-server.ts` split. An incomplete label set was scoring a correct top-1 answer as a miss.

Effect on the recorded baseline: exact Recall@5 0.99 -> **1.00**, exact MRR unchanged at **0.94** (old finders identical on both). Task Recall@5 unchanged at **0.74**; task MRR 0.58 -> **0.57**, drift from the five real modules this change added to the index, not a ranking regression.

## CommonJS and focus validation replay

The [final coverage-guard validation](COVERAGE_GUARD_RESULTS.md) records 82
regression tasks, six new probe tasks and paired prototype timing. The guard is
not enabled in the stable 3.2.7 release.

The later [identifier-coherent evidence experiment](IDENTIFIER_EVIDENCE_RESULTS.md)
freezes a partial-match definition, adds source-validated new tasks, and measures
real per-file context calls. It is not promoted because a new task regresses.

See [coverage, focus and fusion results](COMMONJS_FOCUS_RESULTS.md) for the later
cross-repository replay, including remaining per-query and chain regressions.
Historical numbers below are preserved rather than overwritten.

## This-repo runs (2026-09-02)

Smoke set (7 keyword queries) showed compact payload wins and ranking ties on exact lookups, with fuzzy MRR weaker on `--search`.

Expanded corpus (`scripts/retrieval-golden.json`, 35 queries, paired latency 9 samples/kind):

| Shape | Queries | Unified Recall@5 | Old Recall@5 | Note |
|-------|---------|------------------|--------------|------|
| exact | 17 | 0.99 | 0.99 | Compact payload smaller except path-only |
| ambiguous | 5 | 0.60 | 0.60 | `parse` / `index.ts` miss on both paths |
| fuzzy | 4 | 0.50 | 0.50 | Unified MRR 0.21 vs old 0.38; payload ~3x smaller |
| task | 9 | **0** | **0** | Natural-language prompts do not hit the needed files |

Paired latency p50 (spawn-dominated): symbol/path/import ~171ms both sides; code ~208ms both sides; fuzzy/task old ~514ms (three CLI processes) vs unified ~173ms.

After the task-context MVP + hard budget / Top-3 RRF seeds / enforced gates (44 queries, 18 task including held-out):

| Shape | Queries | Unified Recall@5 | Unified MRR | Note |
|-------|---------|------------------|-------------|------|
| exact | 17 | 0.99 | 0.94 | No regression vs old finders |
| task | 18 | **0.69** | **0.61** | `--task-context`; old finders stay at 0 |

`npm run retrieval:bench` now exits 1 if task Recall@5 < 0.60, task MRR < 0.40, or exact Recall@5 < 0.99.
