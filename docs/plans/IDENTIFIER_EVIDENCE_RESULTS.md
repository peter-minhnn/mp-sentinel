# Identifier-coherent evidence experiment

## Definition, then fixtures

The benchmark-only definition is frozen in
`scripts/lib/identifier-evidence.mjs`: at least two distinct normalized whole
components must occur in the **same callable identifier**. Supported declarations
are functions, methods and arrow functions, not interfaces, types, classes or
variables. Camel case, acronyms and separators are split; NFKC/case normalization
and a simple trailing-plural normalization are deterministic. Accessor/grammar
glue does not count. There is no translation or semantic matching.

Repeated query roots do not count twice. Matches distributed across symbols,
parents, imports or paths do not qualify. Tests precede corpus measurement and
cover composed identifiers, incidental substrings, declarations vs implementations
and Vietnamese prompts carrying identifiers without inventing translations.

## One policy change

The previously frozen seed-preserving policy keeps direct exact/name/path seeds
and fills from the frozen rarity-selection variant. This experiment makes one
change: a baseline top-three file may also be protected when it has the coherent
callable evidence defined above. Baseline order, three-file window, 800-token task
capsule and 1,200-token per-file budgets stay unchanged. Evidence labels never
choose candidates or anchors. Production ranking and output are unchanged.

Run:

```sh
node scripts/fusion-ablation.mjs REPO CORPUS.json --identifier-evidence --chain
```

The chain uses the isolated task capsule, then real CLI agent-context calls in
anchored and plain arms, with existing shared scoring and budget checks. It is
not a new production CLI workflow. Injected task timing is zero: this harness
must not be used for latency comparisons. Corpus, index, compiled bundle and
policy hashes identify each run; changes during measurement fail.

Harness completion is not a promotion gate: exit 0 means the diagnostic run
completed with valid accounting, not that the candidate beats production. The
per-query regression decision below is a separate requirement.

## New task cohort, locked before completed ranking runs

Twelve newly authored, source-grounded tasks span the six existing repositories,
with 24 named evidence labels. Definitions/fixtures passed first, then labels
were checked against source and index and each corpus received a canonical-JSON
v1 lock. This is a small new-task evaluation on known repositories, not unseen
repositories, a blind human-authored benchmark or proof of generalization.
Private tasks, labels and full reports remain in ignored local cache directories.

| Profile | Current chain kept | Experimental chain kept | Labels |
| --- | ---: | ---: | ---: |
| Angular | 4 | 4 | 4 |
| Nest | 1 | 3 | 4 |
| Strapi/CommonJS | 0 | 1 | 4 |
| React | 4 | 4 | 4 |
| mp-sentinel | 4 | 4 | 4 |
| mp-listening | 4 | 2 | 4 |
| Total | 17 | 18 | 24 |

Anchored and plain named-evidence counts are identical. Neither arm loses a
label at packing after its file is opened. All 11 experimentally protected file
instances survive. Task capsules stay <=800 tokens; maximum measured chain
output is 4,386 tokens for current and 4,384 for the experiment, below 4,400.

The experiment **fails the per-query no-regression requirement**: a new PDF
upload task loses both labels because rarity selects incidental terms and drops
the upload component from the opening window. Its baseline component callable
names do not meet the protection definition. This is a file-selection failure,
not a packing failure. The rule was not changed after observing it.

Average emitted chain output is 3,702 vs 3,483 tokens/task. The smaller experimental
output is not a quality-preserving saving: one task opens the wrong files. Counts
exclude prompt, conversation, model reasoning and protocol overhead.

## Existing regression tasks

On the 70 previously observed tasks, file-selection coverage has no per-query
regression: Angular 14/16 -> 14/16, Nest 10/16 -> 11/16, Strapi 11/16 -> 15/16,
React 15/16 -> 15/16, mp-sentinel 53/66 -> 53/66, mp-listening 16/16 -> 16/16.
These tasks are regression checks, not independent validation; their aggregate
gains cannot override the new-cohort failure.

Real per-file chain calls confirm 119/146 -> 124/146 retained labels across
these 70 tasks, with no per-query evidence regression and zero packing loss in
both arms. The experimental maximum chain output is 4,398 tokens, below 4,400.
The new-task cohort still vetoes adoption; old-regression gains are not a reason
to waive it. Existing exact lookup checks pass at Recall@5 1.0000, with current
MRR 0.9020 equal to the old finders on the same index. Those checks exercise the
unchanged production surface, not an experimental exact-lookup deployment.

The generic fixtures also run through `npm test` using
`src/__tests__/identifier-evidence.test.ts`; private corpus labels are not needed
in CI. The end-to-end fixture exercises all experimental variants on a synthetic
index so diagnostic-context wiring failures cannot silently escape unit tests.

## Decision

Do not promote this policy. Keep production unchanged and retain the experiment,
fixtures and locked local reports for reproducibility. Do not tune the glue list,
minimum components, declaration types or thresholds to repair the newly observed
PDF task in this same cohort.

The new cohort did its job: it exposed a limitation missed by the old tests.
Future work needs a predeclared way to preserve task intent when lexical rarity
replaces action/domain anchors, with fresh evaluation before adoption. See
[earlier experiments](COMMONJS_FOCUS_RESULTS.md) and the
[measurement protocol](RETRIEVAL_BASELINE.md).
