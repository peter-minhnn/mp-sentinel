# Fixed-budget allocation results — 2026-10-23

The experiment selected **baseline: open 3 files at 1,200 tokens each**, with an 800-token task capsule. Production defaults were not changed. Uniformly opening more files within the same 4,400-token ceiling reduced named-evidence retention on the tuning slice.

## Tuning result

Chain corpus v4 (`a83af946a864`), 18 tuning queries / 38 labels. These are anchored-arm results; selection required aggregate improvement with no per-query loss versus baseline, with calls and tokens breaking quality ties.

| Policy | File limit / tokens per file | Labels kept | Lost before opening | Lost after opening | Tokens/task | Calls/task |
|---|---|---:|---:|---:|---:|---:|
| Baseline | 3 / 1,200 | 29/38 (76.3%) | 9 | 0 | 4,062 | 4.00 |
| A | 4 / 900 | 26/38 (68.4%) | 5 | 7 | 4,158 | 5.00 |
| B | 5 / 720 | 27/38 (71.1%) | 4 | 7 | 4,244 | 6.00 |
| C | 6 / 600 | 20/38 (52.6%) | 4 | 14 | 4,281 | 7.00 |
| D | 10 / 360 | 11/38 (28.9%) | 3 | 24 | 4,302 | 10.89 |

Every alternative also regressed individual queries. Opening more files recovered some labels previously lost to ranking, but smaller per-file capsules lost more named evidence. No configuration qualified to replace baseline. The actual file count can be below the requested limit when the task capsule budget cuts the list. The largest measured chain, in either arm, was 4,399 tokens.

The task capsule uses the tested limit, including `--limit 3` for baseline; the older `chain:bench` requests the task capsule's default limit of 5 and opens only its first 3 files. Their task-capsule token overhead therefore differs.

## Frozen selection evaluation

The tuning report was written before running either remaining slice or the external corpus. Since baseline won, evaluation measures that policy only; no alternative was selected using these outcomes.

| Slice | Queries / labels | Anchored labels kept | Plain labels kept |
|---|---|---:|---:|
| Sentinel validation | 6 / 14 | 14/14 | 14/14 |
| Sentinel held-out | 6 / 14 | 12/14 | 12/14 |
| Listening transfer | 8 / 16 | 7/16 | 8/16 |

Listening transfer used the `mvp-listening` checkout (`13a635778cd1b560475e131a7da5b26ba4c7c9e4`, clean source), a refreshed 1,564-file index, and separately frozen corpus v1 (`e06b1db9e329`). It averaged 4 calls and 4,328 anchored tool-output tokens per task (plain: 4,322.5). The maximum chain was 4,389 tokens. Named labels were validated against the core before querying.

Eight listening labels were lost before opening: their four files ranked 4, 8, 15 and 16. One additional label was lost after opening in the anchored arm. For `Whisper alignment retry candidate windows and per section alignment quality`, task-context generated focus `[Whisper, alignment, retry, candidate]` for `src/lib/audio/align-retry.ts`. At 1,200 tokens the anchored capsule kept `alignSentencesToWhisperWithRetry` but omitted `shouldRetry`; the plain capsule kept both. A separate replay confirmed this case. Anchored substring retention was still 55/55, compared with plain 54/55: substring retention does not establish named-evidence retention.

Transfer exit 0 means measurement and budget checks passed; it does not mean a cross-repo quality threshold was met. This small corpus was not used to tune weights or choose the allocation. It exposes a real limitation: the strong same-repo evidence result does not establish comparable quality on another repo. If these cases are used to improve the implementation, they become validation cases for that later change.

## Traceability and verification

Tool revision: `cce776f81640241be1ef63d1ceff7d96b2810a6e`, with local source changes. CLI SHA-256: `5865b1604d23ccbe7ba195c08dec13393b6fa101933bd8aef9d0a90cef65566b`. Experiment SHA-256: `576f5adb835065b9cca84a4d7cf1cff497bfd8f28536c4ad770a72dd0ec741c1`. Sentinel core SHA-256: `c7041e64a4e523b07764bd309cfedfb06296d9045124ceafe323b6a30eaac205`. Listening core SHA-256: `2d8cbce9539276c8e9659bf269a95d59b568518fabb720d9a6af3224ea55587b`. Fingerprints stayed unchanged within each measurement.

Full local reports (generated artifacts, ignored by Git): `.mp-sentinel-cache/benchmarks/allocation-tuning.json`, `allocation-evaluation.json`, and `allocation-listening.json` in that same directory. The [protocol](RETRIEVAL_BASELINE.md#fixed-budget-allocation-experiment) records commands, selection rules and token scope.

Verification: 2,759 root tests, 6 allocation tests, format checks, both typechecks, build, corpus locks and release check passed. Existing retrieval and per-file benchmarks passed: task Recall@5/MRR 0.8519/0.6343, exact Recall@5/MRR 1.0000/0.9412, compact per-file retention 0.973 and heavy-payload reduction 42.68%. The listening task domains' existing 136 behavioral tests also passed. Those tests establish unchanged source behavior; no agent-generated solution was evaluated.

## Next quality work

Keep the current budget and defaults. Turn the observed focus packing loss into a synthetic regression fixture, and inspect ranking for the four missing listening files before changing weights. Any later fix should be selected on development cases and assessed on fresh tasks that were not used to choose it. Whole-session token savings and task-completion quality still require controlled agent runs with total input/output usage, retries, additional reads and acceptance tests recorded; this experiment measures emitted tool bodies only.
