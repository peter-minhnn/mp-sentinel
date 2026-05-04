# Quick Start Guide — MP Sentinel

## 1) Install

```bash
npm install -D mp-sentinel
# or
npm install -g mp-sentinel
```

## 2) Configure AI Provider

```bash
# .env
AI_PROVIDER=gemini
GEMINI_API_KEY=your_key_here

# optional tuning
AI_MODEL=gemini-2.5-flash
AI_TEMPERATURE=0.2
AI_MAX_TOKENS=2048
AI_TIMEOUT_MS=30000
```

## 3) Run Reviews

```bash
# Default review target: origin/main...HEAD
mp-sentinel

# Staged changes (AI defaults OFF unless --ai or MP_SENTINEL_AI=1)
mp-sentinel --staged
mp-sentinel --staged --ai

# Explicit target modes
mp-sentinel --commit 9f31a4c
mp-sentinel --range origin/main..HEAD
mp-sentinel --files src/index.ts src/utils/git.ts

# Output formats
mp-sentinel --format console
mp-sentinel --format json
mp-sentinel --format markdown
```

Shortcut:

```bash
# Running without any flags is equivalent to default review mode:
mp-sentinel
```

## 4) Guardrails (Less Tokens, Better Signal)

Create `.mp-sentinelrc.json`:

```json
{
  "maxConcurrency": 5,
  "ai": {
    "maxFiles": 15,
    "maxDiffLines": 1200,
    "maxCharsPerFile": 12000,
    "promptVersion": "2026-05-04"
  }
}
```

## 5) Useful Env Vars

```bash
TARGET_BRANCH=origin/main
MP_SENTINEL_AI=1
MP_SENTINEL_FORMAT=console
MP_SENTINEL_CONCURRENCY=5
```

## 6) Exit Codes

- `0`: no blocking issues
- `1`: findings detected
- `2`: runtime/system/provider error

## Legacy Local Mode

Legacy local review mode is still available:

```bash
mp-sentinel --local
mp-sentinel -l -n 5
mp-sentinel -l -d --compare-branch origin/develop
```
