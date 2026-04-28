# Architecture Overview

## System Design

MP Sentinel v1.0.12 centers on a stable `review` command contract with diff-first auditing:

- `review --staged`
- `review --commit <sha>`
- `review --range <base>..<head>`
- `review --files <path...>`

The runtime is optimized for quality and cost control:

- diff-hunk payloads instead of full-file payloads
- guardrails (`maxFiles`, `maxDiffLines`, `maxCharsPerFile`)
- secret scrubbing before model calls
- persistent cache in `.mp-sentinel-cache`
- **repository-aware review context** from source index (v1.0.11+)

## High-Level Flow

```text
CLI (src/index.ts)
  -> parse args / resolve target / resolve format
  -> [optional] --explain-context early exit (diagnostics, no AI)
  -> list git files for target
  -> FileHandler filters (allowlist + .gitignore/.archignore + sensitive blocklist)
  -> collect diff hunks with guardrails
  -> SecurityService redacts secrets
  -> Load source index context (if indexing.enabled)
     -> buildIndexContext() reads cache
     -> context-builder service: priority ranking (changed → imports → dependents → hubs)
     -> profile-aware pitfalls (cli-tooling/node-service/react-next/library)
  -> AI service (optional by policy) with concurrency + cache
  -> formatters render console/json/markdown report
  -> exit code (0 pass / 1 findings / 2 runtime error)
```

## Main Modules

- `src/cli/review.ts`: stable review orchestration and report status mapping.
- `src/utils/git.ts`: target file listing + diff collection + guardrail truncation.
- `src/services/file-handler/index.ts`: path-level filtering and ignore-file support.
- `src/services/security/index.ts`: secret redaction and payload diagnostics.
- `src/services/ai/index.ts`: provider orchestration, caching, concurrent auditing.
- `src/formatters/report.ts`: console/json/markdown output.
- `src/services/source-index/context-builder.ts`: **impact-aware review context generation**
- `src/types/index.ts`: `ExplainContextOutput` type for `--explain-context` diagnostic mode

## Shared Repository Intelligence (v1.1.0+)

`create-skills` and `review` now share the same `SkillKnowledgeBase` derived from the source index. This avoids maintaining two separate codebase summaries and lets review catch higher-level risks: public API changes, hub-file blast radius, test gaps, and dependency-sensitive edits.

### Intelligence Signals in Review Context

When index insights are available, the context builder appends a `--- Review Intelligence ---` section with compact risk signals:

- **Public API Risk** — changed files that are part of the public API surface (re-exported from entrypoints).
- **Hub File Blast Radius** — changed files imported by many other files (high-impact changes).
- **Test Coverage Gap** — changed source files with no associated tests.
- **Key Dependencies Used** — external packages relevant to the changed files.

Each signal type is tracked in `ReviewContextMetadata.includedSignals` and surfaced in `--explain-context --format json` output.

### Graceful Isolation

- Review never auto-runs indexing; it skips intelligence signals when the index is absent, disabled, corrupt, or has excessive parse errors.
- `create-skills` independently refreshes the index and uses the same `SkillKnowledgeBase` for richer documentation.
- `indexing.enabled` in config only controls review consumption, not `create-skills` or direct `indexing` command behavior.

## Source Indexing & Review Context (v1.0.11+)

### Behavioral Contract

- `indexing.enabled` controls whether `review` **consumes** the cache. Default: `false`.
- The `indexing` command always rebuilds the cache regardless of config.
- Cache location: `.mp-sentinel-cache/source-index.json` (configurable via `indexing.cachePath`).
- Context generation respects `indexing.maxRelatedFiles` (default: 3) for imports/dependents per changed file.
- Character budget: `INDEX_CONTEXT_MAX_CHARS = 12000` (hard limit, truncates with marker).

### Priority Order & Impact Ranking

1. **Changed files** — always first, marked as `(changed)`.
2. **Direct imports** — files that the changed file depends on (cap: `maxRelatedFiles` per changed file).
3. **Direct dependents** — files that import the changed file (cap: `maxRelatedFiles` per changed file).
4. **Hub files** — most-imported files (importedBy ≥ 3), added only if budget remains, capped to 5.

Within each tier, files are sorted by:
- Parse health (files without parse errors preferred)
- Popularity (`importedBy.length` descending for hubs)
- Exported symbols availability

### Profile-Aware Pitfalls

The context includes a concise **Profile Review Pitfalls** section (3–5 bullets) based on `detectProfile()`:

- **`cli-tooling`**: exit codes contract, diff-first review, CLI parsing separation, no business logic in entry files.
- **`node-service`**: handler purity, error middleware, env validation, async boundaries, health checks.
- **`react-next`**: server/client boundary, data fetching colocation, `next/image` optimization, bundle vigilance.
- **`library`**: public API surface, type definitions, peer dependencies, tree-shakeability.
- **fallback** (no index or unknown): generic best practices.

Profile detection uses manifest signals (`bin`, `scripts`, `dependencies`, `detectedFrameworks`).

### Graceful Degradation

- Missing index → returns `null`, review continues without context.
- Corrupt index (parse errors > 50%) → returns `null`.
- Indexing disabled → returns `null`.
- Truncation → adds `[Source index context truncated to budget]` marker.

## Explain Context Mode (v1.0.12+)

The `--explain-context` flag on the `review` command provides diagnostic output showing context building details without making AI calls:

- **Entry point**: `src/index.ts` handles `--explain-context` as an early exit before any AI logic.
- **Implementation**: `renderExplainContext()` in `src/cli/review.ts` — reuses `buildReviewContext()` for consistency.
- **Output**: JSON (`ExplainContextOutput` type) or human-readable console format.
- **ASCII-only**: Console output avoids emoji to prevent mojibake on Windows terminals.
- **Exit code**: Always `0` in non-error cases (even if no index is available).

```json
{
  "status": "available",
  "profile": "library",
  "budgetChars": 12000,
  "truncated": false,
  "relatedFileCount": 5,
  "relationTypes": ["changed", "import"],
  "includedFiles": ["src/index.ts", "src/config.ts"],
  "includedSignals": ["public-api", "test-gap"],
  "contextPreview": "=== Source Index Context ===\nProject...",
  "indexUsed": true
}
```

## Key Patterns

- Factory: provider creation by `AIProviderFactory`.
- Strategy: provider interface (`IAIProvider`) for Gemini/OpenAI/Anthropic.
- Singleton: provider lifecycle reuse inside `src/services/ai/index.ts`.
- Service Layer: `context-builder.ts` isolates review context logic from CLI orchestration.

## Guardrails

Configured in `.mp-sentinelrc.json` / `.sentinelrc.json`:

```json
{
  "ai": {
    "maxFiles": 15,
    "maxDiffLines": 1200,
    "maxCharsPerFile": 12000,
    "promptVersion": "2026-02-16"
  },
  "indexing": {
    "enabled": true,
    "maxRelatedFiles": 3,
    "cachePath": ".mp-sentinel-cache/source-index.json"
  }
}
```

## Exit Semantics

- `0`: no blocking findings
- `1`: findings detected
- `2`: runtime/system/provider failure
