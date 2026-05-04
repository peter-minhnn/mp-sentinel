# AI Service - Multi-Provider Support

This service provides a unified interface for multi-provider code review.

## Supported Providers

- Gemini
- OpenAI
- Anthropic
- Grok
- OpenRouter

## Environment Variables

```bash
AI_PROVIDER=gemini|openai|anthropic|grok|openrouter
AI_MODEL=model_name
AI_MODEL_TIER=premium|balanced|budget   # selects model from provider tier catalog (when AI_MODEL is unset)
GEMINI_API_KEY=...
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...       # preferred Anthropic key name
ANTHROPIC_AUTH_TOKEN=...    # accepted Anthropic fallback alias
GROK_API_KEY=...
OPENROUTER_API_KEY=...

AI_TEMPERATURE=0.2
AI_MAX_TOKENS=2048
AI_TIMEOUT_MS=30000
```

## Runtime Behavior

- Uses a singleton provider instance for connection reuse.
- Accepts diff-hunk payloads from the review runner (not full file by default).
- Preflights provider/model/key readiness before review commands call a provider.
- Invalid `AI_PROVIDER`, unsupported `AI_MODEL`, or missing API key disables AI for the run and falls back to deterministic security-only source review.
- Supports persistent on-disk caching via `.mp-sentinel-cache/`.
- Cache key includes provider, model, prompt version, tool version, file path, prompt, and payload hash.

### Concurrency Model

- **`maxConcurrency`** limits the total number of concurrent AI provider calls (both whole-file and chunked audits share the same pool).
- Files exceeding `maxCharsPerFile` are auto-chunked with line-offset metadata so issue reports map back to original file positions.
- Chunk enqueues yield to the microtask queue (`await 0`) so chunked files interleave fairly — a single large file cannot monopolise the limiter queue.
- Progress updates are emitted live as each file promise settles, not batched after all files complete.
- Results are always returned in input file order (guaranteed by `Promise.allSettled`).

### Edge-Case Safety

- `maxConcurrency` values of `NaN`, `Infinity`, `-Infinity`, or `<= 0` are normalised to `1`.
- Float values (e.g. `2.9`) are floored to the nearest integer (e.g. `2`).
- The internal limiter uses a slot-reservation protocol: the finishing task reserves its slot for the next queued task before waking it, preventing queue bypass by external callers.

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
