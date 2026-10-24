# Model-level retrieval evaluation

Status: protocol, not a measured Grok quality/cost improvement. No model API calls
are made by the implementation or verification of the bootstrap fixes.

## Freeze before running

- Pin the actual model ID, agent/harness version, repository commit, task labels,
  tests, tool permissions and starting workspace. Keep independent worktrees per run.
- Include small known-file edits, exact discovery, natural-language discovery,
  mixed-language prompts and multi-file changes. Label required files and named
  evidence before seeing outputs. Keep validation and held-out cohorts distinct.
- Approve a total spend and per-run timeout before calling a paid model. Record
  interrupted, failed and budget-exhausted runs instead of dropping them.

## Arms

1. Baseline: normal source discovery, without sentinel-generated skills or tools.
2. Sentinel: adaptive workflow with installed skills, compact retrieval and source
   reads as needed. Include all generated-skill loading overhead in usage.

Keep authored project constraints identical in both arms. Alternate paired run order;
use several independent runs per task because agent execution is stochastic. Freeze
ranking/budgets during evaluation. Do not tune against held-out results.

## Record and judge

- Capture provider-reported input/output/cache/reasoning usage, actual model calls,
  wall time, tool calls, repair iterations and final patch. Retain raw provider field
  names; do not assume cache/reasoning fields are additive or infer USD from unknown
  billing units. If billed cost is unavailable, report it as unavailable.
- Separately count cl100k_base retrieval output and bootstrap text as diagnostic
  proxies. These are not provider usage or total cost.
- Run the same tests and blind patch review in both arms. Count wrong edits and
  remaining correctness/security findings, not just whether code was produced.
- Report per-task deltas plus paired aggregates, quality regressions and failures.
  More tokens may be worthwhile for better correctness; lower retrieval tokens alone
  do not establish either lower total usage or better code.

## Available local evidence

A local Grok session contains the retrieval query `shadowing catalog session gate
and practice back link`. Its saved output ranks an unrelated vocabulary practice
session first and the shadowing session helper fourth. This is an observed failure
case for diagnosis, not a fresh held-out task. A reported credits-file case has not
yet been located in that trace and must not be treated as reproduced.

Session usage for `grok-4.7-build` is available locally, but there is no matched
baseline arm. Session transcripts, raw usage and private repository corpora remain
outside Git and npm artifacts. Do not publish them or convert their opaque cost
ticks into a claimed invoice amount.

## Bootstrap patch measurement

Using the same cached mvp-listening index and authored overlay for committed source
versus the development patch: one Codex SKILL.md entrypoint goes from 19,237 to 15,283 UTF-8 bytes and
4,725 to 3,696 cl100k_base tokens (21.8% fewer bootstrap tokens). The emitted overlay
is byte-identical; reference links resolve. Runner evidence identifies 287 node:test
and 10 Playwright files rather than calling all 297 Playwright. This measurement is
not the earlier three-file context comparison and is not Grok billing. It does not
measure the later references/source loaded by an agent. These counts are snapshot
observations, not stable corpus labels or performance gates.

## Local 3.2.8 candidate replay (2026-10-24)

Installed the actual 3.2.8 tarball into an isolated environment and generated/checked
Claude, Codex and Copilot skills against a copied current-source snapshot. The live
mvp-listening package, skills and cache were not changed by this trial. The generated
Codex entrypoint was 15,413 bytes / 3,730 cl100k_base tokens on that newer snapshot;
do not compare this directly with the earlier frozen-snapshot size observation.

For ranking, both release-3.2.7 and candidate-3.2.8 source bundles consumed the exact
same frozen cached core bytes (sha256
`694c5ec2c95cb9a28dc9dd75bf59567dd48494916fa682b7c0aaf24ed617b9e7`).
Both emitted the same five files and 787 tokens, from 331 pre-pack candidates:

| Observed file | 3.2.7 rank | 3.2.8 rank |
| --- | --- | --- |
| Vocabulary practice session | 1 | 1 |
| Shadowing session helper | 4 | 4 |
| Shadowing practice page | 5 | 5 |
| Shadowing catalog | 9 | 9 |
| Former shadowing catalog route | 107 | 107 |

This reproduces the selection weakness, not a ranking improvement. The route now
participates in ongoing application changes, so its rank is diagnostic rather than
a frozen relevance label. The English query's anchors do not change under the
Unicode fix. Keep domain/ranking experiments separate from the bootstrap patch;
do not promote experimental guards or globally boost actions files from this case.

The actual tarball integration trial and the internal same-index replay are two
different checks: neither is a paid-model A/B nor an exact historical-index replay.
Private frozen core bytes and local reports remain gitignored.
