# AI Provider Comparison Guide

## Overview

This guide helps you choose the best AI provider for your code review needs with the latest model, pricing, and benchmark data (as of May 2026).

> **⚠️ Pricing & benchmarks change frequently.** All figures below are approximate. Verify current rates on provider websites before committing to production usage.

## Quick Comparison

| Feature | Google Gemini | OpenAI GPT | Anthropic Claude | xAI Grok | OpenRouter |
|---------|--------------|------------|------------------|----------|------------|
| **Best For** | Fast, cost-effective | High accuracy coding | Autonomous agents | Low-cost reasoning | Multi-model routing |
| **Free Tier** | ✅ Limited (reduced Apr 2026) | ❌ No | ❌ No | ❌ No | ❌ No |
| **Context Window** | Up to 1M tokens | Up to 1M tokens | Up to 1M tokens | Up to 2M tokens | Varies by model |
| **API Key Env** | `GEMINI_API_KEY` | `OPENAI_API_KEY` | `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` | `GROK_API_KEY` / `XAI_API_KEY` | `OPENROUTER_API_KEY` |

---

## Model Tiers

Models are organized into three priority tiers:

- **Premium**: Best / newest models for hard reviews — security audits, architecture analysis, crash-path detection.
- **Balanced**: Default or stable models for everyday CI reviews. The runtime default sits here.
- **Budget**: Cheap / fast models for bulk or low-criticality review passes.

Start with premium for security/architecture/crash review, then fall back to balanced or budget for cost-sensitive passes.

## Detailed Comparison

### Google Gemini

**Latest models / tier catalog (May 2026):**

| Tier | Model | Input / 1M tokens | Output / 1M tokens | Context |
|------|-------|-------------------|--------------------|---------|
| **Premium** | `gemini-3.1-pro-preview` | $2.00 | $12.00 | 1M |
| **Premium** | `gemini-3-flash-preview` | $0.50 | $3.00 | 1M |
| **Premium** | `gemini-2.5-pro` | $1.25 | $10.00 | 1M |
| **Balanced** | `gemini-2.5-flash` **(default)** | $0.30 | $2.50 | 1M |
| **Budget** | `gemini-3.1-flash-lite-preview` | $0.25 | $1.50 | 1M |
| **Budget** | `gemini-2.5-flash-lite` | $0.10 | $0.40 | 1M |

Additional models: none — all current Gemini Flash/Pro models are in the tier table above.

**Key features:**
- Generous free tier historically, though Pro models moved to paid (Apr 2026)
- Fastest response times at the low-cost tier
- Batch API: 50% off standard rates
- Good multilingual support
- 3.1 series models are preview — rate limits and pricing may change

**API key:** `GEMINI_API_KEY`

**Benchmarks:**
- Terminal-Bench 2.0 (Gemini 3.1 Pro): ~68.5%
- SWE-Bench Pro (Gemini 3.1 Pro): ~54.2%

---

### OpenAI GPT

**Latest models / tier catalog (May 2026):**

| Tier | Model | Input / 1M tokens | Output / 1M tokens | Context |
|------|-------|-------------------|--------------------|---------|
| **Premium** | `gpt-5.5` | $5.00 | $30.00 | 1M |
| **Premium** | `gpt-5.4` | $2.50 | $15.00 | 1M |
| **Premium** | `gpt-5.4-mini` | $0.25 | $2.00 | 1M |
| **Premium** | `gpt-5.4-nano` | $0.05 | $0.40 | 400K |
| **Balanced** | `gpt-5.2` | $1.75 | $14.00 | 400K |
| **Balanced** | `gpt-5.2-pro` | — | — | — |
| **Budget** | `gpt-5-mini` | $0.25 | $2.00 | 400K |

Additional models: `gpt-5.5-pro` ($30/$180), `gpt-4.1` ($2/$8), `o3` ($2/$8), `o4-mini` ($1.10/$4.40).

**Key features:**
- Broadest model selection — general, reasoning (o-series), long-context (4.1-series)
- Batch/Flex pricing: 50% off standard rates
- Strong ecosystem and documentation
- Cached input: 50% off input price

**API key:** `OPENAI_API_KEY`

**Benchmarks:**

| Eval | GPT-5.5 | GPT-5.4 | Claude Opus 4.7 |
|------|---------|---------|-----------------|
| **SWE-bench** | **88.7%** | ~74% | — |
| **Terminal-Bench 2.0** | **82.7%** | 75.1% | 69.4% |
| **SWE-Bench Pro** | 58.6% | 57.7% | **64.3%** |
| **OSWorld-Verified** | **78.7%** | 75.0% | 78.0% |
| **FrontierMath Tier 4** | **35.4%** | — | 22.9% |
| **Humanity's Last Exam** | 41.4% | — | **46.9%** |

*Sources: OpenAI launch benchmarks, third-party evaluations.*

---

### Anthropic Claude

**Latest models / tier catalog (May 2026):**

| Tier | Model | Input / 1M tokens | Output / 1M tokens | Context | Max Output |
|------|-------|-------------------|--------------------|---------|-----------|
| **Premium** | `claude-opus-4-7` | $5.00 | $25.00 | 1M | 128K |
| **Premium** | `claude-opus-4-6` | $5.00 | $25.00 | 1M | 128K |
| **Balanced** | `claude-sonnet-4-6` **(default)** | $3.00 | $15.00 | 1M | 128K |
| **Budget** | `claude-haiku-4-5` | $1.00 | $5.00 | 200K | 64K |

**Key features:**
- Best at autonomous agent tasks and long-running workflows
- Batch API: 50% off standard rates
- Prompt caching: cache reads at $0.50/1M (90% off); writes at 1.25×–2×
- Adaptive thinking with effort levels (low → max)
- Opus 4.7 adds vision improvements (~3× resolution) and coding improvements (~13% Anthropic internal benchmark)

**API key:** `ANTHROPIC_API_KEY` (preferred) or `ANTHROPIC_AUTH_TOKEN` (fallback)

**Benchmarks:**

| Eval | Claude Opus 4.7 | GPT-5.5 |
|------|----------------|---------|
| **SWE-Bench Pro** | **64.3%** | 58.6% |
| **Terminal-Bench 2.0** | 69.4% | **82.7%** |
| **OSWorld-Verified** | 78.0% | **78.7%** |
| **Humanity's Last Exam** | **46.9%** | 41.4% |

*Sources: Appwrite GPT-5.5 analysis, Anthropic launch materials.*

---

### xAI Grok

**Latest models / tier catalog (May 2026):**

| Tier | Model | Input / 1M tokens | Output / 1M tokens | Context |
|------|-------|-------------------|--------------------|---------|
| **Premium** | `grok-4.3` | $1.25 | $2.50 | 1M |
| **Premium** | `grok-4` | $3.00 | $15.00 | 256K |
| **Balanced** | `grok-4-1-fast-reasoning` **(default)** | $0.20 | $0.50 | 2M |
| **Budget** | `grok-code-fast-1` | — | — | — |

Additional models: `grok-4-fast` ($0.20/$0.50).

**Key features:**
- Aggressively low pricing — Grok 4.3 is ~58% cheaper than prior gen on input
- Fastest output speed: ~207 tokens/sec (Grok 4.3)
- Video input support (≤5 min, ≤1080p)
- Native document generation (PDF/XLSX/PPTX)
- Batch API: 50–80% off standard rates
- SWE-bench Verified (Grok 4.3): ~73%
- OpenAI-compatible API structure

**API key:** `GROK_API_KEY` (preferred) or `XAI_API_KEY` (fallback)

---

### OpenRouter

**Key features:**
- Single API key for 300+ models across all major providers
- Pay-as-you-go — no per-provider setup needed
- Adds ~50–100ms proxy overhead
- Per-model pricing visible before sending requests

**Models accessible via OpenRouter (recommended priority):**

| Tier | Models |
|------|--------|
| **Premium** | `openai/gpt-5.5`, `anthropic/claude-opus-4-7`, `google/gemini-3.1-pro-preview`, `x-ai/grok-4.3` |
| **Balanced** | `openai/gpt-5.2` **(default)** |
| **Budget** | `google/gemini-2.5-flash` |

Any valid OpenRouter model ID in `provider/model` form, with optional variant suffix such as `:free`, is accepted at runtime — the tier list above shows recommended starting points.

**Pricing:** Varies by underlying model (typically ~0–10% above direct provider rates)

**API key:** `OPENROUTER_API_KEY`

**Optional env vars:** `OPENROUTER_SITE_URL`, `OPENROUTER_APP_NAME` (dashboard attribution)

---

## Benchmark Reference

### Agentic Coding & Computer Use

| Eval | GPT-5.5 | GPT-5.4 | Claude Opus 4.7 | Gemini 3.1 Pro | Grok 4.3 |
|------|---------|---------|-----------------|-----------------|----------|
| **SWE-bench** | **88.7%** | ~74% | — | — | ~73% |
| **SWE-Bench Pro** | 58.6% | 57.7% | **64.3%** | 54.2% | — |
| **Terminal-Bench 2.0** | **82.7%** | 75.1% | 69.4% | 68.5% | — |
| **OSWorld-Verified** | **78.7%** | 75.0% | 78.0% | — | — |

### Knowledge & Reasoning

| Eval | GPT-5.5 | Claude Opus 4.7 | Gemini 3.1 Pro |
|------|---------|-----------------|-----------------|
| **FrontierMath Tier 4** | **35.4%** | 22.9% | 16.7% |
| **Humanity's Last Exam** | 41.4% | **46.9%** | 44.4% |

> **Note:** Benchmarks are provider-reported or from third-party evaluations. Actual results vary by task, prompt, and configuration. Benchmark scores are a directional guide, not a guarantee of real-world performance.

---

## Pricing Summary (Standard API, per 1M tokens)

| Provider | Model Range | Input Range | Output Range |
|----------|------------|-------------|--------------|
| Google Gemini | Flash-Lite → 3.1 Pro | $0.10 – $2.00 | $0.40 – $12.00 |
| OpenAI GPT | Nano → 5.5 Pro | $0.05 – $30.00 | $0.40 – $180.00 |
| Anthropic Claude | Haiku → Opus 4.7 | $1.00 – $5.00 | $5.00 – $25.00 |
| xAI Grok | Fast → 4.3 | $0.20 – $3.00 | $0.50 – $15.00 |

Batch/Flex pricing offers ~50% discount across most providers. Prompt caching can further reduce effective costs.

---

## Decision Guide

- **Review type → Tier**:
  - Security / architecture / crash-path reviews → start with **Premium**
  - Everyday CI reviews → **Balanced** (also the runtime default)
  - Bulk / low-criticality review passes → **Budget**
- **Budget-conscious / high volume**: Gemini 2.5 Flash / Flash-Lite, or Grok 4.1 Fast
- **Highest coding accuracy**: GPT-5.5 or GPT-5.4 for SWE-bench leader; Claude Opus 4.7 for SWE-Bench Pro
- **Autonomous agent tasks**: Claude Opus 4.7 or Sonnet 4.6
- **Reasoning-heavy security audits**: Grok 4.3 (low-cost) or GPT-5.5 (high-accuracy)
- **Multi-model flexibility**: OpenRouter (single key, 300+ models)
- **Start small, scale up**: Gemini 2.5 Flash (budget) → GPT-5.4 (balanced→premium) → Claude Opus 4.7 (premium)

## Configuration Examples

### Gemini
```bash
AI_PROVIDER=gemini
AI_MODEL=gemini-2.5-flash
GEMINI_API_KEY=your_key
```

### OpenAI
```bash
AI_PROVIDER=openai
AI_MODEL=gpt-5.2
OPENAI_API_KEY=your_key
```

### Anthropic Claude
```bash
AI_PROVIDER=anthropic
AI_MODEL=claude-sonnet-4-6
ANTHROPIC_API_KEY=your_key
# ANTHROPIC_AUTH_TOKEN=your_key  # fallback alias
```

### Grok
```bash
AI_PROVIDER=grok
AI_MODEL=grok-4-1-fast-reasoning
GROK_API_KEY=your_key
# XAI_API_KEY=your_key  # fallback alias
```

### OpenRouter
```bash
AI_PROVIDER=openrouter
AI_MODEL=openai/gpt-5.2
OPENROUTER_API_KEY=your_key

# Optional: attribution headers
OPENROUTER_SITE_URL=https://example.com
OPENROUTER_APP_NAME=MyProject
```

If a configured provider/model/key cannot be resolved, mp-sentinel warns and uses deterministic non-AI source review for that run instead of failing the review only because AI is unavailable.
