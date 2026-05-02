# Quick Reference — MP Sentinel

## Core Command

```bash
mp-sentinel review [target] [options]
```

Shortcut:

```bash
mp-sentinel
```

## Targets

```bash
--staged
--commit <sha>
--range <base>..<head>
--files <path...>
```

Default target if omitted:

```bash
<target-branch>...HEAD
```

## Useful Commands

```bash
mp-sentinel review --staged
mp-sentinel review --staged --ai
mp-sentinel review --range origin/main..HEAD --format markdown
mp-sentinel review --format json
```

## Output Formats

```bash
--format console
--format json
--format markdown
```

## Env Vars

```bash
AI_PROVIDER=gemini|openai|anthropic|grok|openrouter
AI_MODEL=model_name
GEMINI_API_KEY=...
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
ANTHROPIC_AUTH_TOKEN=...  # optional Anthropic fallback alias
GROK_API_KEY=...
OPENROUTER_API_KEY=...
AI_TEMPERATURE=0.2
AI_MAX_TOKENS=2048
AI_TIMEOUT_MS=30000
TARGET_BRANCH=origin/main
MP_SENTINEL_AI=1
MP_SENTINEL_FORMAT=console|json|markdown
MP_SENTINEL_CONCURRENCY=5
```

Invalid `AI_PROVIDER`, unsupported `AI_MODEL`, or missing key disables AI for that review run and falls back to deterministic source review.

## Config Guardrails

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

## Exit Codes

- `0` pass
- `1` findings
- `2` runtime/system/provider error

## Legacy Mode

```bash
mp-sentinel --local
mp-sentinel -l -n 5
mp-sentinel -l -d
```
