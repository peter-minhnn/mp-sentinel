# Quick Start Guide - Multi-Provider AI

## 🚀 5-Minute Setup

### Step 1: Install

```bash
npm install -g mp-sentinel
# or
npm install -D mp-sentinel
```

### Step 2: Choose Your AI Provider

#### Option A: Google Gemini (Free Tier Available)

```bash
# Get key: https://aistudio.google.com/
echo "GEMINI_API_KEY=your_key_here" > .env
```

#### Option B: OpenAI GPT-4

```bash
# Get key: https://platform.openai.com/api-keys
echo "AI_PROVIDER=openai" > .env
echo "OPENAI_API_KEY=sk-..." >> .env
```

#### Option C: Anthropic Claude

```bash
# Get key: https://console.anthropic.com/
echo "AI_PROVIDER=anthropic" > .env
echo "ANTHROPIC_API_KEY=sk-ant-..." >> .env
```

### Step 3: Run

```bash
mp-sentinel
```

## 🎯 Common Use Cases

### Local Development

```bash
# Review last commit
mp-sentinel --local

# Review last 5 commits
mp-sentinel -l -n 5

# Branch diff mode (Analyze all commits since branching)
mp-sentinel -l -d
mp-sentinel -l -d --compare-branch origin/develop
```

### CI/CD Pipeline

```yaml
# .github/workflows/audit.yml
- name: Code Review
  env:
    GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
  run: npx mp-sentinel
```

### Custom Rules

```json
// .sentinelrc.json
{
  "techStack": "React 19, TypeScript",
  "rules": [
    "CRITICAL: No 'any' types allowed",
    "STYLE: Use arrow functions for components"
  ]
}
```

## 🔧 Configuration Cheat Sheet

### Environment Variables

| Variable         | Values                    | Default          |
| ---------------- | ------------------------- | ---------------- |
| `AI_PROVIDER`    | gemini, openai, anthropic | gemini           |
| `AI_MODEL`       | See model list below      | Provider default |
| `AI_TEMPERATURE` | 0.0 - 1.0                 | 0.2              |
| `AI_MAX_TOKENS`  | Number                    | 8192             |

### Recommended Models by Use Case

| Use Case      | Provider  | Model               |
| ------------- | --------- | ------------------- |
| Fast & Cheap  | Gemini    | `gemini-2.5-flash`  |
| Best Accuracy | OpenAI    | `gpt-4.1`           |
| Long Tasks    | Anthropic | `claude-opus-4`     |
| Balanced      | Anthropic | `claude-sonnet-4.5` |

### CLI Flags

```bash
mp-sentinel [options] [files...]

Options:
  -l, --local              Local review mode
  -n, --commits <number>   Number of commits to review
  -d, --branch-diff        Enable branch diff mode
  --compare-branch <br>    Branch to compare against
  -b, --target-branch      Target branch for diff in CI/CD mode
  -c, --concurrency        Max concurrent audits
  --skip-commit            Skip commit validation
  --verbose                Detailed logging
```

## 💡 Pro Tips

1. **Start with Gemini**: Free tier is generous, great for testing
2. **Use GPT-4.1 for complex refactoring**: Best coding benchmark scores
3. **Use Claude Opus for autonomous tasks**: Can work for hours independently
4. **Set concurrency based on API limits**:
   - Gemini: 5-10
   - OpenAI: 3-5
   - Claude: 3-5

5. **Security First**: MP Sentinel uses a 3-layer security system. Source code is filtered, secrets are redacted locally, and a dry-run summary is available to verify the payload before sending.

## 🐛 Troubleshooting

### "API key not found"

```bash
# Check your .env file
cat .env

# Make sure it's loaded
export $(cat .env | xargs)
```

### "Rate limit exceeded"

```bash
# Reduce concurrency
mp-sentinel --concurrency 3
```

### "Model not found"

```bash
# Check available models
AI_PROVIDER=openai mp-sentinel --help

- [Full Documentation](./README.md)
- [Architecture Overview](./ARCHITECTURE.md)
- [Security Guide](./README.md#🛡️-security--data-privacy)
- [Changelog](./CHANGELOG.md)
```
