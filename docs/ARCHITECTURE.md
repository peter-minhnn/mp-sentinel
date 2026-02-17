# Architecture Overview

## System Design

MP Sentinel v1.1.0 centers on a stable `review` command contract with diff-first auditing:

- `review --staged`
- `review --commit <sha>`
- `review --range <base>..<head>`
- `review --files <path...>`

The runtime is optimized for quality and cost control:

- diff-hunk payloads instead of full-file payloads
- guardrails (`maxFiles`, `maxDiffLines`, `maxCharsPerFile`)
- secret scrubbing before model calls
- persistent cache in `.mp-sentinel-cache`

## High-Level Flow

```text
CLI (src/index.ts)
  -> parse args / resolve target / resolve format
  -> list git files for target
  -> FileHandler filters (allowlist + .gitignore/.archignore + sensitive blocklist)
  -> collect diff hunks with guardrails
  -> SecurityService redacts secrets
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

## Key Patterns

- Factory: provider creation by `AIProviderFactory`.
- Strategy: provider interface (`IAIProvider`) for Gemini/OpenAI/Anthropic.
- Singleton: provider lifecycle reuse inside `src/services/ai/index.ts`.

## Guardrails

Configured in `.mp-sentinelrc.json` / `.sentinelrc.json`:

```json
{
  "ai": {
    "maxFiles": 15,
    "maxDiffLines": 1200,
    "maxCharsPerFile": 12000,
    "promptVersion": "2026-02-16"
  }
}
```

## Exit Semantics

- `0`: no blocking findings
- `1`: findings detected
- `2`: runtime/system/provider failure
