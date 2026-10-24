# MP Sentinel — Commands Cheat Sheet

## `create-skills` — Generate agent/IDE skill files

| Flag | Description | Default |
|------|-------------|---------|
| `--agent <ids>` | Comma-separated: claude,cursor,codex,windsurf,antigravity,cline,aider,continue,roo,copilot,zed,jetbrains,generic | Auto-detect |
| `--all-agents` | Generate for all 12 registered non-generic adapters | false |
| `--force` | Overwrite existing files | false |
| `--skip-index-refresh` | Use existing index cache; fail if absent | false |
| `--dry-run` | Preview output without writing | false |
| `--check` | Verify files are up-to-date (exit 0/1) | false |
| `--no-ai-enrich` | Disable AI enrichment | false |
| `--no-code-samples` | Skip code sample loading in AI enrichment | false |
| `--format <fmt>` | Output: `console` or `json` | console |
| `--explain-agents` | Diagnostic: show detected agents | false |
| `--doctor` | Diagnostic: comprehensive health check | false |

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success (or all up-to-date in --check mode) |
| 1 | Skipped (--force not set) / stale (--check) |
| 2 | Runtime error |

## `indexing` — Build source index

Developer measurement: `npm run allocation:bench -- --output <report.json>` selects a fixed-budget policy on tuning rows. Evaluation and external-repo commands are in [the allocation protocol](plans/RETRIEVAL_BASELINE.md#fixed-budget-allocation-experiment).

Same-index diagnostics: `node scripts/fusion-ablation.mjs <repo> <locked-corpus.json> --specificity` compares benchmark-only anchor-selection/IDF variants. It does not change production policy; see [results and promotion limits](plans/COMMONJS_FOCUS_RESULTS.md#anchor-specificity-experiment-not-promoted).

Seed-preservation experiment: use `--seed-preserve` instead of `--specificity` to compare the current policy, rarity selection and direct baseline seed protection. This remains benchmark-only; [results](plans/COMMONJS_FOCUS_RESULTS.md#seed-preservation-experiment-not-promoted).

Partial-identifier experiment: `node scripts/fusion-ablation.mjs <repo> <locked-corpus.json> --identifier-evidence --chain` adds coherent callable evidence and measures real per-file agent-context outputs under unchanged budgets. See [definition, new cohort and decision](plans/IDENTIFIER_EVIDENCE_RESULTS.md).

Final guard diagnostics: use `--coverage-guard --chain` instead; `node scripts/coverage-latency.mjs <private-manifest.json>` measures warm paired prototype timing. Neither enables a runtime policy. See [release decision and timing scope](plans/COVERAGE_GUARD_RESULTS.md).

Multi-repo transfer: `npm run repos:bench -- --manifest <private-manifest.json> --freeze`, then repeat without `--freeze` and with `--output <private-results-dir>`. Manifest and failure semantics are documented in the same protocol.

After implementation changes, allocation `--phase replay` or multi-repo `--replay` reuses the previously chosen allocation explicitly. Keep old reports and use a new output path; observed cases now serve as validation. A changed `extractorVersion` causes CLI indexing/query to rebuild once; refresh the index before using an existing MCP session to measure the new extraction.

| Flag | Description | Default |
|------|-------------|---------|
| `--force` | Rebuild from scratch | false |
| `--health` | Index health diagnostics | false |
| `--recovered` | List files parsed via fallback | false |
| `--parse-errors` | List files with hard parse errors | false |
| `--agent-context <file>` | Per-file diagnostics (legacy payload; add `--token-budget` for the compact capsule) | - |
| `--explain-index <file>` | Full parser diagnostics | - |
| `--search <query>` | Compact unified search (symbol + file + import). Add `--kind code` for snippets | - |
| `--find-file <query>` | Locate indexed files by path or basename | - |
| `--task-context <prompt>` | Ranked file capsule from a natural-language prompt (no snippets, no prompt echo) | - |
| `--token-budget <n>` | Token budget for `--task-context` JSON, or opt into the compact `--agent-context` capsule (min 100, max 4000) | 800 / off |
| `--focus <anchor>` | Task anchor ranked first in the compact `--agent-context` capsule (repeatable, max 6; requires `--token-budget`) | - |
| `--explain-ranking` | With `--task-context`: list the ranked candidates before packing (why a file did or did not make the capsule) | off |
| `--find-symbol <name>` | Locate symbol in index | - |
| `--find-import <pkg>` | Find files importing a package | - |
| `--find-code <query>` | Search indexed code snippets | - |
| `--limit <n>` | Max hits (default 10 for `--search`/`--find-file`, 20 otherwise; max 50) | 10 / 20 |
| `--kind <kinds>` | `--search` kinds: `symbol,file,import,code` | symbol,file,import |
| `--pretty` | Pretty-print JSON (default: pretty on TTY) | TTY |
| `--compact` | Force compact JSON (no whitespace) | off |
| `--stats` | Aggregate index statistics | false |
| `--index-format <fmt>` | Output: `console` or `json` | console |
| `--full-index` | JSON export: hydrate sidecar payloads (codeSearch, calls) instead of printing the compact core | off |

## `review` — Review changes

| Flag | Description | Default |
|------|-------------|---------|
| `--files <paths>` | Explicit file paths to review | auto |
| `--staged` | Review staged changes (`git diff --cached`) | false |
| `--commit <sha>` | Review a specific commit | - |
| `--range <range>` | Review a commit range (e.g., `main..HEAD`) | - |
| `--local` | Review local commits (branch-based) | false |
| `--interactive` | Interactive commit picker UI | false |
| `--branch-diff` | Legacy: review all commits since branching | false |
| `--include-uncommitted` | Mixed mode: include WIP changes | false |
| `--format <fmt>` | Output: `console`, `json`, `markdown`, `sarif` | console |
| `--ai` | Force-enable AI review | auto |
| `--no-ai` | Force-disable AI review | false |
| `--target-branch <br>` | Target branch for diff (default: `origin/main`) | origin/main |
| `--concurrency <n>` | Max concurrent AI provider calls | 5 |
| `--bypass-keyword <kw>` | Staging bypass keyword | skip: |
| `--severity-threshold <lvl>` | FAIL threshold: `CRITICAL`, `WARNING`, `INFO` | WARNING |
| `--no-cache` | Bypass the AI response cache for this run | cache on |
| `--output <path>` | Also write a clean markdown report to a file | off |
| `--verbose` | Enable verbose output and detailed skip reasons | false |
| `--dry-run` | Security scan & token estimation (no AI calls) | false |
| `--verbose-dry-run` | Dry-run with per-file token breakdown | false |
| `--token-limit <n>` | Override provider context-window token limit | — |
| `--explain-context` | Review context diagnostics (no AI calls) | false |
| `--no-skills-fetch` | Disable local skills loading (air-gapped mode) | false |
| `--fetch` | Auto-fetch tracking branch before detecting base | false |
| `--compare-branch <br>` | Legacy: comparison branch for local mode | origin/main |
| `--commits <n>` | Legacy: number of commits in local mode | 1 |
| `--quiet` | Suppress non-error output | false |

> Local mode (`--local` / `--branch-diff`) supports `--format json`: it prints a
> `ReviewReport` to stdout (JSON-only; logs go to stderr), including a valid empty
> report when nothing differs. `markdown`/`sarif` fall back to the console report;
> use `--output <path>` for a markdown file. Other formats are unchanged.

## Root CLI

| Flag | Description |
|------|-------------|
| `--explain-context` | Review context diagnostics |
| `--format json` | JSON output for all modes |
| `--quiet` | Suppress non-JSON output |
| `--verbose` | Detailed logging |

## `check-ai` — AI connectivity probe

`mp-sentinel check-ai` builds the provider from the environment (`AI_PROVIDER`, `AI_MODEL`, `ANTHROPIC_BASE_URL`, credential vars), makes one minimal request, and prints `{ "status": "ok"|"error", "provider", "model", "error"? }` as JSON. Exit `0` reachable, `2` misconfigured/unreachable. Use it to catch a 403, bad base URL, or unknown model before a large review.

## `init` — Scaffold .mp-sentinelrc.json

| Flag | Description |
|------|-------------|
| `--force` | Overwrite an existing config |
| `--non-interactive` | Skip prompts; use proposed defaults |
| `--format json` | Machine-readable summary |

Detects tech stack via `detectTechProfile`, picks a provider from env vars (`ANTHROPIC_API_KEY`/`GEMINI_API_KEY`/`OPENAI_API_KEY`), enables the GitHub MCP preset if `GITHUB_TOKEN` is set, and writes a config that passes `ProjectConfigSchema`. Refuses to overwrite without `--force` (exit 1).

## Config (.mp-sentinelrc.json)

### createSkills.policies

```json
{
  "createSkills": {
    "policies": {
      "maxFileLines": 500,
      "warnFileLines": 350,
      "maxFunctionLines": 80,
      "maxComponentLines": 150,
      "maxParams": 5,
      "maxCyclomaticHint": 12,
      "forbidDefaultExports": false
    }
  }
}
```

### createSkills.overlayFile

```json
{
  "createSkills": {
    "overlayFile": ".mp-sentinel/skill-overlay.md"
  }
}
```

Markdown copied verbatim into every generated skill and rule file, for every
agent, as `## Project Overlay (authoritative)`. Optional — the default path is
used automatically when the file exists. See
[CREATE_SKILLS.md](./CREATE_SKILLS.md#configuration--createskillsoverlayfile-project-overlay).

### createSkills.ai

```json
{
  "createSkills": {
    "ai": {
      "enabled": true,
      "provider": "openai",
      "model": "gpt-5.2",
      "temperature": 0.2,
      "maxTokens": 4096
    }
  }
}
```
