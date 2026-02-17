# Network Efficiency Guidelines

This document describes the current v1.1.0 strategy for fast, low-token reviews.

## Core Principles

- Send diff hunks, not full files.
- Apply hard guardrails before any provider call.
- Reuse provider instances and cache stable results.
- Redact secrets locally before payload leaves the machine.

## Current Implementation

### 1) Diff-First Payload

`src/utils/git.ts` collects per-file unified diffs for:

- `--staged`
- `--commit <sha>`
- `--range <base>..<head>`
- `--files <path...>`

### 2) Guardrails

Configured in project config:

```json
{
  "ai": {
    "maxFiles": 15,
    "maxDiffLines": 1200,
    "maxCharsPerFile": 12000
  }
}
```

### 3) Provider Reuse + Timeouts

- Singleton provider lifecycle in `src/services/ai/index.ts`.
- OpenAI/Anthropic requests use `AbortController` timeout (`AI_TIMEOUT_MS`).

### 4) Persistent Cache

- Cache directory: `.mp-sentinel-cache/`
- Key dimensions: provider/model/promptVersion/toolVersion/filePath/prompt/payload

This avoids repeated token spend on unchanged diffs.

### 5) Security in the Hot Path

- `FileHandler` filters unsafe/unwanted files.
- `SecurityService` redacts secrets from diff content before AI calls.

## Practical Tuning

- Lower cost: reduce `maxDiffLines` and `maxCharsPerFile`.
- Faster CI: keep `maxConcurrency` near `3-8`.
- Staged hooks: prefer `mp-sentinel review --staged` without `--ai`.

## Debugging

```bash
mp-sentinel review --range origin/main..HEAD --verbose
```

## Exit Codes

- `0`: no blocking findings
- `1`: findings detected
- `2`: runtime/system/provider error
