# AI Service - Multi-Provider Support

This service provides a unified interface for multiple AI providers to perform code review and auditing.

## Supported Providers

### 1. Google Gemini (Default)
- **Best Models for Code Review:**
  - `gemini-2.5-flash` (Default) - Latest, fastest
  - `gemini-2.0-flash-exp` - Experimental features
  - `gemini-1.5-pro` - More capable, slower
- **API Key:** `GEMINI_API_KEY`
- **Docs:** https://ai.google.dev/

### 2. OpenAI GPT
- **Best Models for Code Review:**
  - `gpt-4.1` - Best coding model (54.6% SWE-bench)
  - `gpt-4o` (Default) - Fast, multimodal
  - `gpt-4-turbo` - Balanced performance
- **API Key:** `OPENAI_API_KEY`
- **Docs:** https://platform.openai.com/docs/models

### 3. Anthropic Claude
- **Best Models for Code Review:**
  - `claude-sonnet-4.5` (Default) - Best for coding & agents
  - `claude-opus-4` - Most capable, autonomous tasks
  - `claude-3-5-sonnet` - Previous generation
- **API Key:** `ANTHROPIC_API_KEY`
- **Docs:** https://docs.anthropic.com/en/docs/about-claude/models

## Configuration

### Environment Variables

```bash
# Provider Selection (default: gemini)
AI_PROVIDER=gemini|openai|anthropic

# Model Selection (optional, uses provider default)
AI_MODEL=gemini-2.5-flash

# API Keys (set the one for your provider)
GEMINI_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
ANTHROPIC_API_KEY=your_key_here

# Optional Settings
AI_TEMPERATURE=0.2
AI_MAX_TOKENS=8192
```

### Example Configurations

**Using Gemini (Default):**
```bash
GEMINI_API_KEY=AIza...
```

**Using OpenAI GPT-4.1:**
```bash
AI_PROVIDER=openai
AI_MODEL=gpt-4.1
OPENAI_API_KEY=sk-...
```

**Using Claude Sonnet:**
```bash
AI_PROVIDER=anthropic
AI_MODEL=claude-sonnet-4.5
ANTHROPIC_API_KEY=sk-ant-...
```

## Architecture

```
src/services/ai/
├── index.ts              # Main service entry point
├── types.ts              # TypeScript interfaces
├── config.ts             # Configuration management
├── factory.ts            # Provider factory
└── providers/
    ├── gemini.provider.ts
    ├── openai.provider.ts
    └── anthropic.provider.ts
```

## Usage

```typescript
import { auditFile, auditCommit, AIConfig } from './services/ai/index.js';

// Audit a file
const result = await auditFile(filePath, content, systemPrompt);

// Audit commit message
const commitResult = await auditCommit(message, config);

// Get current configuration
const aiConfig = AIConfig.fromEnvironment();
console.log(`Using: ${aiConfig.provider} (${aiConfig.model})`);
```

## Model Selection Guide

| Use Case | Recommended Model | Reason |
|----------|------------------|---------|
| Fast code review | `gemini-2.5-flash` | Fastest, cost-effective |
| Complex refactoring | `gpt-4.1` | Best coding benchmark scores |
| Autonomous agents | `claude-opus-4` | Best for long-running tasks |
| Balanced performance | `claude-sonnet-4.5` | Great coding + speed |

## Adding New Providers

1. Create provider class in `providers/` implementing `IAIProvider`
2. Add provider type to `AIProvider` union in `types.ts`
3. Register in `AIProviderFactory.createProvider()`
4. Add default model in `AIProviderFactory.getDefaultModel()`
5. Update `AIConfig.getApiKey()` and `getApiKeyEnvName()`

## References

- [OpenAI GPT-4.1 Announcement](https://openai.com/index/gpt-4-1/)
- [Anthropic Claude Models](https://docs.anthropic.com/en/docs/about-claude/models)
- [Google Gemini API](https://ai.google.dev/gemini-api/docs)
