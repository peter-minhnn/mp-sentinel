# CommonJS coverage and focus validation

This is a validation replay, not a new allocation-selection experiment. The
previously selected three-file, 1,200-token allocation and 800-token task budget
remain frozen. Original reports are preserved. Private labels and reports remain
in ignored local benchmark directories; only anonymized aggregates appear here.

## Changes tested

- Static CommonJS dependencies and exports contribute to symbols and graph edges.
  Shadowed globals, dynamic requires and unsupported computed names are excluded.
- Compact focus ranks direct callable-name evidence before broad parent/type
  matches and enforces the existing four-call focus-stage cap.
- Fusion gives one vote per anchor/kind/file. Repeated matching declarations or
  imports in a barrel cannot manufacture additional votes or consume the entire
  distinct-file candidate window.
- An optional extractor-version stamp triggers a full reparse of older caches.
  Existing cache reads remain compatible; refresh before consuming through MCP.

The initial CommonJS replay exposed a regression (44/64 retained labels).
Deduplicating file votes addressed that failure without retuning allocation or
the frozen exact-match coefficient.

## Cross-repository results

All four Lotte repositories completed. Counts below are named evidence retained
by the anchored chain, not task-completion rates.

| Repository profile | Before | Final | Labels |
| --- | ---: | ---: | ---: |
| Angular | 14 | 14 | 16 |
| Nest | 9 | 10 | 16 |
| Strapi/CommonJS | 10 | 11 | 16 |
| React | 16 | 15 | 16 |
| Total | 49 | 50 | 64 |

The plain arm remains 50/64 overall. Final packing loses zero of the labels that
reach opened files; 14 labels are lost to ranking. Individual queries regress,
including a React evidence file moving below the opening window. This is not a
uniform ranking improvement.

On Strapi, among 1,978 indexed files, files containing imports increase from
27 to 1,221, files containing symbols from 722 to 1,550, and graph edges from
30 to 2,311. These measure extraction coverage, not graph precision or complete
runtime dependency discovery. Dynamic framework service references remain out
of scope.

An additional 12-query/24-label cohort retains 20/24 in both arms. It was observed
before the final fusion change and is therefore validation, not held-out data.
A later four-query/six-label probe retains 5/6 (micro 0.8333, macro 0.75), too
small to support strong generalization claims. Neither cohort changes allocation.

On mp-listening, the frozen eight-query/16-label transfer corpus now retains
16/16 in both arms (previously anchored 7/16, plain 8/16), with zero measured
ranking or packing loss. The anchored chain averages 4,024 output tokens and
four calls per task. This is a replay of observed tasks, not independent held-out
evaluation.

## This-repository checks

- Task Recall@5: 0.8519 -> 0.9074; MRR: 0.6343 -> 0.7935.
- Exact Recall@5: 1.0000. Current exact MRR is 0.9020 for both unified and old
  finders, versus historical 0.9412 on the earlier index. Historical MRR is not
  unchanged; the current paired no-regression gate passes.
- Chain evidence: 53/66 (0.8030), down from historical 55/66. All 53 labels
  reaching packing are retained; 13 are outside the opening window. This
  regression must remain visible alongside the retrieval improvements.
- Compact agent-context evidence retention: 0.973; emitted payload reduction
  42.87% against legacy. Identity and parser health are retained.
- Chain averages: four calls, 4,018 anchored output tokens per task, below the
  4,400 ceiling. This excludes model reasoning, conversation and task execution.

Source refactoring produces four reported stale line references in the root
chain corpus; named evidence still validates. Frozen labels are not rewritten
just to remove line drift.

## Verification and next decision

### Seed-preservation experiment: not promoted

`node scripts/fusion-ablation.mjs REPO CORPUS.json --seed-preserve` freezes a
conservative composition before measurement: inspect only the baseline top
three, preserve directly supported symbol hits scoring >=90, file hits >=95,
or import hits >=90, excluding graph-only candidates. Keep protected records
in baseline order, then fill from the previously frozen rarity-selection list;
deduplicate files and use the existing 800-token/top-3 packer. Baseline candidates
are appended for completeness, not promoted because of labels. Fusion scores
are not rewritten to pretend this selection policy is RRF ranking.

Across 70 existing task queries (four Lotte repos, this repo, mp-listening), all
29 protected file instances survive packing. Capsules remain <=800 emitted
tokens with exact accounting. Compared with rarity-selection alone, the policy
changes one opened-file set and seven file orders, but no row's label-coverage
count. Reports distinguish fusion trace from final selection rank and include
hashes of benchmark policy sources as well as compiled bundles and index bytes.

| Cohort | Current | Seed-preserving | Labels |
| --- | ---: | ---: | ---: |
| Angular | 14 | 14 | 16 |
| Nest | 10 | 10 | 16 |
| Strapi | 11 | 15 | 16 |
| React | 15 | 15 | 16 |
| This repository | 53 | 53 | 66 |
| mp-listening | 16 | 16 | 16 |

The Nest menu-permission row still regresses from one label to zero. None of
its original top-three files meets the protection rule: their strongest symbol
matches score 70 (prefix), rather than exact/case-insensitive name equality.
Preserving high-confidence exact seeds is therefore insufficient to protect
useful partial-name evidence. Do not lower the threshold on the same observed
query and call that validation. The experiment remains benchmark-only and is
not promoted despite the Strapi gains.

The next quality milestone needs independently authored tasks and a documented
definition of strong *partial* evidence before further ranking changes. Existing
corpora remain regression tests, not fresh validation. File-selection coverage
here still does not establish full-chain evidence quality or task completion.

### Anchor specificity experiment: not promoted

`node scripts/fusion-ablation.mjs REPO CORPUS.json --specificity` compares four
isolated variants. Production remains unchanged. Rules were implemented before
reading these outcomes, with no per-query or per-repository parameters:

- `current`: existing six-anchor selection and fusion.
- `anchor-select`: consider up to 48 existing normalized candidates, preserve
  structured tokens first (paths/flags/packages/camelCase/underscore/hyphen),
  prefer supported anchors over unsupported ones, then fewer matching files;
  ties preserve original order. Keep six.
- `anchor-weight`: keep current anchors, multiply each anchor's contributions
  by normalized IDF: `log((N+1)/(df+1))/log(N+1)`. Count distinct matching files
  across symbol/import/path search before candidate caps; no label input.
- `anchor-both`: apply both rules, without further tuning.

| Cohort | Current | Select | Weight | Both | Labels |
| --- | ---: | ---: | ---: | ---: | ---: |
| Angular | 14 | 14 | 14 | 14 | 16 |
| Nest | 10 | 10 | 13 | 13 | 16 |
| Strapi | 11 | 15 | 13 | 15 | 16 |
| React | 15 | 15 | 15 | 15 | 16 |
| This repository | 53 | 53 | 56 | 56 | 66 |
| mp-listening | 16 | 16 | 16 | 16 | 16 |

These are labels whose files are opened, not retained named evidence or task
completion. Same-index snapshots and existing locked corpora are validation,
not independent held-out tasks. Every experimental capsule is checked against
800 emitted tokens, exact token accounting and at most three opened files.

**None qualifies for promotion under the per-query no-regression criterion.**
All three experimental variants regress a Nest menu-permission query from one
label to zero. IDF and the combined variant also regress the root compact-search
query from two labels to one. Aggregate gains do not cancel these failures.
mp-listening and the Angular/React cohorts show no per-query evidence-coverage
regressions in this experiment, but do not establish generalization.

Do not tune IDF floors or stopword exceptions to rescue these observed queries.
The next design should distinguish weak substring evidence from direct
identifier/path evidence before applying rarity, and preserve an existing
high-confidence seed rather than replacing it solely because a rarer anchor
exists. Predeclare that rule and its safety tests before evaluating a fresh
task cohort. Runtime cost and full-chain retention would also need measurement
before any production adoption.

### Same-index fusion ablation

#### Per-anchor diagnostic trace

The benchmark bundles also append a trace function, without changing the
production API. Each candidate reports its raw RRF, effective score (including
the exact multiplier), graph-only origin, and per-anchor/kind contributions
with original hit ranks/scores. Contributions are obtained from the actual
fusion function, not an independently copied scoring formula. The harness
checks contribution sums and candidate-order equality with normal ranking.

Across the inspected regressed queries, both missing files and their top-3
competitors have direct hits. Graph-only candidates do appear elsewhere, but
are not the immediate cause in these examples. Concrete observations:

- A Nest domain file obtains most of its score from the singular generic role
  anchor; the missing service matches four anchors but remains fifth.
- A React component/route cluster benefits from basename matches; a utility
  matching three anchors is fifth despite covering the requested behavior.
- The regressed Strapi prompt drops the short word `pin` from its six selected
  anchors. This happens in all three fusion variants, so dedup cannot repair
  that upstream omission on its own.
- On this repo, a resolver with only the `resolve` anchor and a 1.5 exact boost
  outranks provider configuration matching four anchors. Cache backends with
  two matching anchors similarly outrank the three-anchor sidecar writer.

These are mechanisms observed in particular examples, not proof that coverage
weighting or a new stopword list would generalize. Next experiments should
isolate anchor selection from score specificity. Keep dedup, budgets and corpus
fixed; predeclare a rule before measuring fresh tasks. In particular, avoid a
blanket graph boost/demotion or restoring entry-level votes based on this trace.

Run `node scripts/fusion-ablation.mjs REPO CORPUS.json` against an existing
index and adjacent corpus lock. It builds isolated benchmark bundles without
editing production sources or rebuilding the index. Three variants share the
same input bytes, anchors, weights, graph and 800-token/top-3 selection budget:

- `legacy-votes`: cap each finder at 120 entry hits, retaining repeated votes.
- `distinct-capped`: the same entry cap, but one vote per file.
- `current`: one vote per file, cap 120 distinct files after retrieval.

The outcome is **labels whose file is opened**, not evidence retained after
agent-context packing. Structured search runs without code-sidecar fallback.
Reports record corpus, index, source and compiled bundle hashes; source/index
drift during the run is an error. Private outputs remain ignored locally.

| Cohort | Legacy votes | Distinct, entry-capped | Current | Labels |
| --- | ---: | ---: | ---: | ---: |
| Angular | 14 | 14 | 14 | 16 |
| Nest | 10 | 10 | 10 | 16 |
| Strapi | 4 | 13 | 11 | 16 |
| React | 16 | 15 | 15 | 16 |
| This repository | 53 | 53 | 53 | 66 |

The current variant selects exactly the same files as the existing CLI reports
for all 32 Lotte queries. Same-index evidence narrows the earlier diagnosis:

- The regressed Nest and React queries lose one label each at the dedup step,
  not at the wider candidate-window step. Other queries compensate, so equal
  aggregate totals do not mean identical query outcomes.
- The earlier regressed Strapi controller query has no labels in opened files
  even under legacy votes on the current index. Its historical decline cannot
  be attributed to dedup alone. Historical index drift remains a confounder;
  this experiment does not isolate CommonJS extraction from every other index
  change, nor reconstruct the old index.
- A separate Strapi query loses two labels when the distinct-file window is
  widened, while dedup overall prevents the much larger repeated-vote failure.
- This-repository totals tie at 53/66, but four queries individually lose labels
  under current fusion. These include sidecar writing and provider resolution;
  aggregate equality is not a no-regression claim.

No production policy changes follow automatically from this ablation. Next,
inspect per-anchor contributions and candidate diversity for the regressed
queries, then evaluate any proposed rule on independently authored tasks. Do
not choose the capped variant solely because it scores higher on this observed
Strapi cohort.

### Per-query replay audit

`node scripts/ranking-replay-diff.mjs BEFORE.json AFTER.json [anchored|plain]`
compares single-allocation reports with the same corpus hash and query/label
counts. It preserves tool identities and explicitly reports index drift. Exit
0 means no per-query retention regression, 1 means at least one regression
(even with a positive aggregate delta), and 2 means incompatible reports.

The 32-query Lotte audit finds four improved queries, three regressed queries
and 25 unchanged queries. All comparisons have changed indexes, so they are
end-to-end replays, not isolated same-index ranking ablations. The three
regressions lose one, two and one labels respectively, whose files are still
candidates at ranks 5, 6 and 5. This rules out candidate absence and packing as
the immediate loss mechanism; it does not by itself identify which changed
ranking feature is responsible. The two lost labels at rank 6 share one file.

Do not restore repeated per-file votes to recover these examples: that would
reintroduce the independently reproduced barrel-starvation defect. Before
changing weights, isolate extraction drift from fusion effects on the same
index and inspect anchor coverage versus graph-only candidate evidence. No
weights, budgets or corpus labels were changed in this audit.

The full suite passes 2,773 tests across 134 suites. Formatting, both typechecks,
build, root benchmarks and private cohort replays pass. Synthetic tests cover
focus starvation, duplicate fusion votes, CommonJS shadowing, graph resolution,
same-line call attribution and extractor-version cache upgrades.

Next, inspect per-query ranking regressions under the same budgets, then use a
new independently authored task cohort before considering another ranking
change. Do not widen the allocation or claim conversation compression from these
output-only measurements. See [the protocol](RETRIEVAL_BASELINE.md).
