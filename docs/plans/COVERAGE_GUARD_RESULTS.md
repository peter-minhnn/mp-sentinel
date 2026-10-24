# Coverage guard: final validation and release decision

## Frozen rule

The benchmark-only guard compares supported original anchors across the actual
post-packing file sets. If the proposal loses any anchor supported by a direct,
positive baseline hit, it returns the **unchanged baseline capsule**. If baseline
coverage is unmeasurable it also falls back. Unsupported, zero-score and
graph-only contributions cannot fabricate coverage. This is lexical coverage,
not semantic intent detection or evidence-quality proof.

Generic fixtures were written first, then six source-grounded tasks on the six
existing repos were label-validated and locked before ranking runs. The previous
12-task cohort is now explicitly regression data, not held-out data. Private
corpora/reports remain local; this report publishes only aggregate measurements.

## Full-chain results

The task capsule is computed in isolated benchmark bundles, then both arms make
real CLI agent-context calls on the chosen files. Anchored and plain retained
named-evidence counts agree here. Budgets stay at 800 task tokens, 1,200 per file,
three opened files and a 4,400-token chain ceiling. Counts exclude user prompts,
conversation, model reasoning and protocol overhead.

| Cohort | Tasks | Labels | Current kept | Guard kept | Regressed tasks | Fallbacks |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Observed regression tasks | 82 | 170 | 136 | 142 | 0 | 2 |
| Newly locked task probe | 6 | 12 | 10 | 10 | 0 | 0 |

No retained evidence is lost at packing in these runs. Maximum experimental
chain output is 4,398 tokens on the regression cohort and 4,364 on the new probe.
The old PDF-upload regression is avoided by falling back, but the new probe has
**no measured evidence gain**. One new alignment task remains a retrieval/ranking
miss in both arms. Six queries are too small to establish generalization.

## Paired prototype timing

Two warmups precede nine alternating baseline/guard pairs on the first locked
query in each repo. Index bytes are frozen. These are warm in-process prototype
times, not production CLI latency: disk loading, compilation, process startup,
model calls and protocol are excluded. The prototype includes the guard's
baseline trace pass and rarity-selection work; it has not been optimized into
a production path.

| Profile | Current p50 ms | Guard p50 ms | Ratio |
| --- | ---: | ---: | ---: |
| Angular | 25.72 | 56.07 | 2.18x |
| Nest | 30.07 | 72.92 | 2.43x |
| Strapi | 33.99 | 88.03 | 2.59x |
| React | 6.60 | 14.85 | 2.25x |
| mp-sentinel | 20.17 | 54.36 | 2.70x |
| mp-listening | 34.44 | 84.70 | 2.46x |

Reports retain all samples, p95, corpus/index hashes and source/bundle/policy
hashes. No latency threshold was selected from these observations. The added
cost is a further reason not to enable this prototype by default; it is not a
prediction of an optimized implementation.

## 3.2.7 decision

**Do not promote the guard or earlier rarity/coherent-seed policies to runtime.**
Ship the stable compact search, hard-budget task/agent context, CommonJS coverage
and sidecar integrity changes. The user explicitly selected this release scope.
The existing runtime task-selection policy is unchanged by these experiments.
Generic diagnostic fixtures run through `npm test`; private labels do not ship
in Git or npm. A diagnostic harness exiting 0 means measurement completed, not
that a candidate passed the separate evidence-regression decision.

See [the previous evidence experiment](IDENTIFIER_EVIDENCE_RESULTS.md) and
[the retrieval protocol](RETRIEVAL_BASELINE.md). No further rule tuning was done
after reading the new probe.
