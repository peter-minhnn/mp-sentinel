# AI Service - Multi-Provider Support

This service provides a unified interface for multi-provider code review.

## Supported Providers

- Gemini
- OpenAI
- Anthropic

## Environment Variables

```bash
AI_PROVIDER=gemini|openai|anthropic
AI_MODEL=model_name
GEMINI_API_KEY=...
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...

AI_TEMPERATURE=0.2
AI_MAX_TOKENS=2048
AI_TIMEOUT_MS=30000
```

## Runtime Behavior

- Uses a singleton provider instance for connection reuse.
- Accepts diff-hunk payloads from the review runner (not full file by default).
- Supports persistent on-disk caching via `.mp-sentinel-cache/`.
- Cache key includes provider, model, prompt version, tool version, file path, prompt, and payload hash.

## API Surface

```typescript
import {
  auditCommit,
  auditFile,
  auditFilesWithConcurrency,
  clearProviderCache,
} from "./index.js";
```

## Provider Notes

- OpenAI and Anthropic providers use request timeout via `AbortController`.
- Provider/API transport errors are returned as `ERROR` audit status.
