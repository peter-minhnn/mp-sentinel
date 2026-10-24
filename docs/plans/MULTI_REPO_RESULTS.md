# Local multi-repository transfer — 2026-10-24

Four additional repositories were measured with the previously frozen baseline: an 800-token task capsule followed by up to three 1,200-token file capsules. No ranking weights, packing policy or production defaults were changed using these results.

The cohort contains 32 English/Vietnamese task queries, 64 named-evidence labels and 9 tasks requiring more than one relevant file. Each repo contributes 8 queries / 16 labels. Labels were checked against source/index records and each corpus was locked before observing retrieval outputs. These are manually selected source-grounded cases, not a representative sample of all production tasks.

Private repository names, paths, source-derived labels and detailed outputs remain in the local ignored `.mp-sentinel-cache/benchmarks/lotte/` directory. This document uses anonymous IDs.

| Repo | Stack | Indexed files | Anchored kept | Plain kept | Anchored tokens/task |
|---|---|---:|---:|---:|---:|
| R1 | Angular / TypeScript | 262 | 14/16 (87.5%) | 14/16 (87.5%) | 3,581 |
| R2 | Nest / TypeScript | 722 | 9/16 (56.25%) | 10/16 (62.5%) | 4,181 |
| R3 | Strapi / legacy JavaScript | 1,978 | 10/16 (62.5%) | 10/16 (62.5%) | 3,438 |
| R4 | React / TypeScript | 34 | 16/16 (100%) | 16/16 (100%) | 2,885 |

All four measurements completed. Anchored retention is 49/64 (76.56%); plain is 50/64 (78.125%). Macro and micro averages happen to match because label counts are equal across repos; the runner computes both independently. For the three larger repos alone the descriptive totals are 33/48 (68.75%) anchored and 34/48 (70.83%) plain. The small React repo's perfect score should not mask the weaker large-repo results.

## Observed losses

Fourteen labels were lost before their file was opened. Every one had a known pre-packing candidate rank outside the top three (ranks 4–28); none was classified as an absent candidate, unknown, or dropped by the task-capsule budget.

One further label in R2 was lost after opening in the anchored arm. The same named authorization helper survived the plain capsule at the same 1,200-token budget; a separate replay reproduced the difference. Overall packing retained 49/50 labels reaching it for anchored and 50/50 for plain. This adds another concrete auto-focus regression case to the one observed in the listening repo; it does not establish that plain is universally better.

Every capsule's `usedTokens` matched its emitted compact JSON. All chains stayed within 4,400 output tokens, with a maximum of 4,392. Each simulated arm used four tool calls per task; ranking-explanation calls were diagnostic and recorded separately. These totals exclude requests, protocol wrappers, model reasoning/output and the existing conversation.

## Index coverage matters separately from parse errors

| Repo | Files with symbols | Files with imports | Internal graph edges | Parse-error files |
|---|---:|---:|---:|---:|
| R1 | 237 | 207 | 552 | 0 |
| R2 | 672 | 703 | 2,932 | 0 |
| R3 | 722 | 27 | 30 | 0 |
| R4 | 28 | 24 | 48 | 0 |

The legacy JavaScript repo has many CommonJS/Strapi service modules, and inspected examples use `require` / `module.exports` without imports captured in the core. Only 27 of its 1,978 indexed files expose imports to the current index. Zero parse-error files therefore does not establish good semantic coverage or a useful dependency graph. The counts are an observed limitation, not a claim that every missing symbol/import has the same cause.

Python-heavy BI and C# socket repositories were inspected for language coverage but not included in retrieval scoring: those are outside the indexer's default TypeScript/JavaScript language set. No zero scores were silently added for unsupported source languages. Source files in the four measured repos were unchanged; index caches were created locally and can appear as untracked cache directories.

## Reproduction and next work

The generic runner, manifest format, corpus locking, selection and failure semantics are documented in [the measurement protocol](RETRIEVAL_BASELINE.md#fixed-budget-allocation-experiment). The private local manifest maps anonymous IDs to repos. Full per-repo reports and the aggregate are in `.mp-sentinel-cache/benchmarks/lotte/results/`; the aggregate retains corpus/index/tool fingerprints. The measured CLI SHA-256 was `5865b1604d23ccbe7ba195c08dec13393b6fa101933bd8aef9d0a90cef65566b`, unchanged after rebuilding.

Verification passed: 2,759 root tests, 3 cohort-runner tests, formatting, both typechecks, build and release check. The cohort runner separately tests that a failed repo remains visible, later repos still run, and incomplete cohorts receive null aggregate scores. No external application test suite or agent-generated task solution was executed as part of this transfer measurement.

Priority work is now concrete: add synthetic regressions for broad auto-focus losing named evidence, cover CommonJS/anonymous export extraction, and inspect ranking on larger multi-module repos. Keep the current defaults while testing those changes. Once these cases influence an implementation choice they become validation data; use new unseen tasks to assess the resulting change. Whole-session token savings and task-completion quality still require controlled agent runs.
