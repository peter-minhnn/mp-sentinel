# Quick Reference Card - MP Sentinel v1.0.1

## 🚀 Installation

```bash
npm install -g mp-sentinel
```

## 🔑 Setup (Choose One)

### Gemini (Free)

```bash
export GEMINI_API_KEY=your_key
```

### OpenAI

```bash
export AI_PROVIDER=openai
export OPENAI_API_KEY=sk-...
```

### Claude

```bash
export AI_PROVIDER=anthropic
export ANTHROPIC_API_KEY=sk-ant-...
```

## 📝 Common Commands

```bash
# Basic audit
mp-sentinel

# Local review
mp-sentinel --local

# Review last 5 commits
mp-sentinel -l -n 5

# Branch diff mode
mp-sentinel -l -d
mp-sentinel -l -d --compare-branch develop

# Specific files
mp-sentinel src/file1.ts src/file2.ts

# Custom concurrency
mp-sentinel --concurrency 10

# Verbose output
mp-sentinel --verbose
```

## 🎯 Model Selection

| Need          | Provider | Model               |
| ------------- | -------- | ------------------- |
| Fast & Free   | Gemini   | `gemini-2.5-flash`  |
| Best Accuracy | OpenAI   | `gpt-4.1`           |
| Long Tasks    | Claude   | `claude-opus-4`     |
| Balanced      | Claude   | `claude-sonnet-4.5` |

## 🔧 Environment Variables

```bash
AI_PROVIDER=gemini|openai|anthropic
AI_MODEL=model_name
AI_TEMPERATURE=0.2
AI_MAX_TOKENS=8192
```

## 📊 Cost Comparison (per 1M tokens)

- Gemini: $0.075
- OpenAI: $2.50
- Claude: $3.00

## 🐛 Troubleshooting

```bash
# Check config
cat .env

# Load env vars
export $(cat .env | xargs)

# Verify provider
echo $AI_PROVIDER

# Test with verbose
mp-sentinel --verbose
```

## 📚 Documentation

- [Full README](./README.md)
- [Quick Start](./docs/QUICK_START.md)
- [Migration Guide](./MIGRATION.md)
- [Provider Comparison](./docs/PROVIDER_COMPARISON.md)
- [Architecture](./docs/ARCHITECTURE.md)

## 🔗 Get API Keys

- Gemini: https://aistudio.google.com/
- OpenAI: https://platform.openai.com/api-keys
- Claude: https://console.anthropic.com/

## 💡 Pro Tips

1. Start with Gemini's free tier
2. Use GPT-4.1 for complex refactoring
3. Use Claude Opus for autonomous tasks
4. Set concurrency based on API limits
5. Use `.sentinelrc.json` for custom rules

## 🎨 Example Config

```json
{
  "techStack": "React 19, TypeScript",
  "rules": ["CRITICAL: No 'any' types", "STYLE: Use arrow functions"],
  "maxConcurrency": 5,
  "localReview": {
    "enabled": true,
    "branchDiffMode": true,
    "compareBranch": "origin/main",
    "filterByPattern": true
  }
}
```

## 🚦 Exit Codes

- `0` - All checks passed
- `1` - Critical issues found

## 📦 Package Info

- Version: 1.0.1
- License: MIT
- Node: >=18.0.0
