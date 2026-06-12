# AI Provider Comparison Guide

## Overview

This guide helps you choose the best AI provider for your code review needs with the latest model, pricing, and benchmark data (as of June 2026).

> **⚠️ Pricing & benchmarks change frequently.** All figures below are approximate. Verify current rates on provider websites before committing to production usage.

## Quick Comparison

| Feature | Google Gemini | OpenAI GPT | Anthropic Claude | xAI Grok | OpenRouter |
|---------|--------------|------------|------------------|----------|------------|
| **Best For** | Fast, cost-effective | High accuracy coding | Autonomous agents | Low-cost reasoning | Multi-model routing |
| **Free Tier** | ✅ Limited | ❌ No | ❌ No | ❌ No | ❌ No |
| **Context Window** | Up to 2M tokens | Up to 1.1M tokens | Up to 1M tokens | Up to 2M tokens | Varies by model |
| **Latest Flagship** | Gemini 3.1 Pro | GPT-5.5 | Claude Opus 4.8 | Grok 4.3 | 300+ models |
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

**Latest models / tier catalog (June 2026):**

| Tier | Model | Input / 1M tokens | Output / 1M tokens | Context |
|------|-------|-------------------|--------------------|---------|
| **Premium** | `gemini-3.1-pro` | $2.00 | $12.00 | 2M |
| **Premium** | `gemini-3.5-flash` | $1.50 | $9.00 | 1M |
| **Premium** | `gemini-3-flash` | $0.50 | $3.00 | 1M |
| **Balanced** | `gemini-2.5-flash` | $0.30 | $2.50 | 1M |
| **Budget** | `gemini-3.1-flash-lite` | $0.25 | $1.50 | 1M |
| **Budget** | `gemini-2.5-flash-lite` | $0.10 | $0.40 | 1M |

**Key features:**
- Gemini 3.5 Flash (May 2026): purpose-built for fast coding and agent workflows — beats 3.1 Pro on coding benchmarks at lower cost
- Gemini 3.1 Pro: 2M context window (largest in class), 64K max output, hybrid reasoning
- Generous free tier historically, though Pro models moved to paid (Apr 2026)
- Batch API: 50% off standard rates
- Good multilingual support
- Hybrid reasoning with controllable thinking budget (0–24,576 tokens)

**API key:** `GEMINI_API_KEY`

**Benchmarks:**
- SWE-Bench Pro (Gemini 3.1 Pro): ~54.2%
- Terminal-Bench 2.0 (Gemini 3.1 Pro): ~68.5%
- Gemini 3.5 Flash outperforms 3.1 Pro on agentic coding tasks

---

### OpenAI GPT

**Latest models / tier catalog (June 2026):**

| Tier | Model | Input / 1M tokens | Output / 1M tokens | Context |
|------|-------|-------------------|--------------------|---------|
| **Premium** | `gpt-5.5` | $5.00 | $30.00 | 1.1M |
| **Premium** | `gpt-5.5-pro` | $30.00 | $180.00 | 1.1M |
| **Balanced** | `gpt-5.4` **(default)** | $2.50 | $15.00 | 1.1M |
| **Balanced** | `gpt-5.4-mini` | $0.75 | $4.50 | 1.1M |
| **Budget** | `gpt-5.4-nano` | $0.20 | $1.25 | 1.1M |
| **Budget** | `gpt-5.2` | $1.75 | $14.00 | 400K |

Additional models: `gpt-5.2-codex` ($1.75/$14), `gpt-5.1` ($1.25/$10), `o3` ($2/$8), `o4-mini` ($1.10/$4.40).

> **Note:** GPT-4.5 retiring June 27, 2026. o3 retiring August 26, 2026. Migrate to GPT-5.x series.

**Key features:**
- Broadest model selection — general, reasoning (o-series), codex variants
- GPT-5.5 (April 2026): smartest model, 52.5% fewer hallucinations in high-risk domains
- Batch/Flex pricing: 50% off standard rates
- Strong ecosystem and documentation
- Cached input: 90% discount (e.g. $2.50 → $0.25 for GPT-5.4)
- Priority tier available (2–2.5× standard pricing, 99.9% uptime SLA)
- Available on AWS Bedrock, Azure, and direct API

**API key:** `OPENAI_API_KEY`

**Benchmarks:**

| Eval | GPT-5.5 | GPT-5.4 | Claude Opus 4.8 |
|------|---------|---------|-----------------|
| **SWE-bench** | **88.7%** | ~74% | — |
| **Terminal-Bench 2.0** | **82.7%** | 75.1% | — |
| **SWE-Bench Pro** | 58.6% | 57.7% | **69.2%** |
| **OSWorld-Verified** | **78.7%** | 75.0% | 83.4% |
| **FrontierMath Tier 4** | **35.4%** | — | — |
| **ARC-AGI-2** | 85.0% | 73.3% | — |
| **Humanity's Last Exam** | 41.4% | — | — |

---

### Anthropic Claude

**Latest models / tier catalog (June 2026):**

| Tier | Model | Input / 1M tokens | Output / 1M tokens | Context | Max Output |
|------|-------|-------------------|--------------------|---------|-----------|
| **Premium** | `claude-fable-5` | $10.00 | $50.00 | 1M | 128K |
| **Premium** | `claude-opus-4-8` | $5.00 | $25.00 | 1M | 128K |
| **Balanced** | `claude-sonnet-4-6` **(default)** | $3.00 | $15.00 | 1M | 64K |
| **Budget** | `claude-haiku-4-5` | $1.00 | $5.00 | 200K | 64K |

**Key features:**
- Opus 4.8 (May 2026): ~4× less likely to approve flawed code vs Opus 4.7; Dynamic Workflows in Claude Code
- Fable 5: top-tier model for hardest reasoning tasks ($10/$50 per MTok)
- Sonnet 4.6 (Feb 2026): best price-performance, recommended default for production
- Best at autonomous agent tasks and long-running workflows
- Batch API: 50% off standard rates
- Prompt caching: cache reads at $0.30–$0.50/1M (90% off); writes at 1.25×–2×
- Adaptive thinking with effort levels (low → max)
- Fast mode on Opus 4.8: 2.5× speed at $10/$50

**API key:** `ANTHROPIC_API_KEY` (preferred) or `ANTHROPIC_AUTH_TOKEN` (fallback)

**Benchmarks:**

| Eval | Claude Opus 4.8 | GPT-5.5 |
|------|----------------|---------|
| **SWE-Bench Pro** | **69.2%** | 58.6% |
| **Terminal-Bench 2.0** | — | **82.7%** |
| **OSWorld-Verified** | **83.4%** | 78.7% |
| **Humanity's Last Exam** | — | 41.4% |

*Sources: Anthropic Opus 4.8 launch (May 28, 2026), third-party evaluations.*

---

### xAI Grok

**Latest models / tier catalog (June 2026):**

| Tier | Model | Input / 1M tokens | Output / 1M tokens | Context |
|------|-------|-------------------|--------------------|---------|
| **Premium** | `grok-4.3` | $1.25 | $2.50 | 1M |
| **Premium** | `grok-4` | $3.00 | $15.00 | 256K |
| **Balanced** | `grok-4-1-fast-reasoning` | $0.20 | $0.50 | 2M |
| **Budget** | `grok-code-fast-1` | $1.00 | $2.00 | 256K |

Additional models: `grok-4-1-fast-non-reasoning` ($0.20/$0.50).

**Key features:**
- Grok 4.3 (May 2026): "most intelligent and fastest model" per xAI — $1.25/$2.50 is aggressively low
- Fastest output speed: ~207 tokens/sec (Grok 4.3)
- Grok 4.1 Fast: 2M context window, ~3× reduction in hallucinations vs Grok 4
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
| **Premium** | `openai/gpt-5.5`, `anthropic/claude-opus-4-8`, `google/gemini-3.5-flash`, `x-ai/grok-4.3` |
| **Balanced** | `openai/gpt-5.4` **(default)** |
| **Budget** | `google/gemini-2.5-flash`, `openai/gpt-5.4-nano` |

Any valid OpenRouter model ID in `provider/model` form, with optional variant suffix such as `:free`, is accepted at runtime — the tier list above shows recommended starting points.

**Pricing:** Varies by underlying model (typically ~0–10% above direct provider rates)

**API key:** `OPENROUTER_API_KEY`

**Optional env vars:** `OPENROUTER_SITE_URL`, `OPENROUTER_APP_NAME` (dashboard attribution)

---

## Benchmark Reference

### Agentic Coding & Computer Use

| Eval | GPT-5.5 | GPT-5.4 | Claude Opus 4.8 | Gemini 3.1 Pro | Grok 4.3 |
|------|---------|---------|-----------------|-----------------|----------|
| **SWE-bench** | **88.7%** | ~74% | — | — | ~73% |
| **SWE-Bench Pro** | 58.6% | 57.7% | **69.2%** | 54.2% | — |
| **Terminal-Bench 2.0** | **82.7%** | 75.1% | — | 68.5% | — |
| **OSWorld-Verified** | 78.7% | 75.0% | **83.4%** | — | — |

### Knowledge & Reasoning

| Eval | GPT-5.5 | Claude Opus 4.8 | Gemini 3.1 Pro |
|------|---------|-----------------|-----------------|
| **FrontierMath Tier 4** | **35.4%** | — | 16.7% |
| **ARC-AGI-2** | **85.0%** | — | — |
| **Humanity's Last Exam** | 41.4% | — | 44.4% |

> **Note:** Benchmarks are provider-reported or from third-party evaluations. Actual results vary by task, prompt, and configuration. Benchmark scores are a directional guide, not a guarantee of real-world performance.

---

## Pricing Summary (Standard API, per 1M tokens)

| Provider | Model Range | Input Range | Output Range |
|----------|------------|-------------|--------------|
| Google Gemini | Flash-Lite → 3.1 Pro | $0.10 – $2.00 | $0.40 – $12.00 |
| OpenAI GPT | Nano → 5.5 Pro | $0.20 – $30.00 | $1.25 – $180.00 |
| Anthropic Claude | Haiku → Fable 5 | $1.00 – $10.00 | $5.00 – $50.00 |
| xAI Grok | Fast → Grok 4 | $0.20 – $3.00 | $0.50 – $15.00 |

Batch/Flex pricing offers ~50% discount across most providers. Prompt caching can further reduce effective costs by up to 90% on input tokens.

---

## Decision Guide

- **Review type → Tier**:
  - Security / architecture / crash-path reviews → start with **Premium**
  - Everyday CI reviews → **Balanced** (also the runtime default)
  - Bulk / low-criticality review passes → **Budget**
- **Budget-conscious / high volume**: Gemini 2.5 Flash / Flash-Lite, or Grok 4.1 Fast
- **Highest coding accuracy**: GPT-5.5 for SWE-bench leader; Claude Opus 4.8 for SWE-Bench Pro leader
- **Autonomous agent tasks**: Claude Opus 4.8 or Sonnet 4.6
- **Best price-performance coding**: Gemini 3.5 Flash (beats 3.1 Pro on coding at lower cost)
- **Reasoning-heavy security audits**: Grok 4.3 (low-cost) or GPT-5.5 (high-accuracy)
- **Multi-model flexibility**: OpenRouter (single key, 300+ models)
- **Start small, scale up**: Gemini 2.5 Flash (budget) → GPT-5.4 (balanced) → Claude Opus 4.8 (premium)

## Configuration Examples

### Gemini
```bash
AI_PROVIDER=gemini
AI_MODEL=gemini-3.5-flash
GEMINI_API_KEY=your_key
```

### OpenAI
```bash
AI_PROVIDER=openai
AI_MODEL=gpt-5.4
OPENAI_API_KEY=your_key
```

### Anthropic Claude
```bash
AI_PROVIDER=anthropic
AI_MODEL=claude-sonnet-4-6
ANTHROPIC_API_KEY=your_key
# ANTHROPIC_AUTH_TOKEN=your_key  # fallback alias

# Custom Anthropic-compatible endpoint (e.g., DeepSeek)
# ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
# AI_MODEL=deepseek-v4-pro
```

### Grok
```bash
AI_PROVIDER=grok
AI_MODEL=grok-4.3
GROK_API_KEY=your_key
# XAI_API_KEY=your_key  # fallback alias
```

### OpenRouter
```bash
AI_PROVIDER=openrouter
AI_MODEL=openai/gpt-5.4
OPENROUTER_API_KEY=your_key

# Optional: attribution headers
OPENROUTER_SITE_URL=https://example.com
OPENROUTER_APP_NAME=MyProject
```

If a configured provider/model/key cannot be resolved, mp-sentinel warns and falls back to deterministic non-AI review (secret redaction + risk analyzer; not a full AI substitute).
