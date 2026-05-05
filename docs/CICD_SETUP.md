# CI/CD Setup Guide - Multi-Provider Support

Complete guide for setting up MP Sentinel in your CI/CD pipeline with any AI provider.

## Quick Start

### GitHub Actions

1. **Choose your provider** (see examples below)
2. **Add API key to GitHub Secrets**
   - Go to: Repository → Settings → Secrets and variables → Actions
   - Click: "New repository secret"
   - Add your key (see provider-specific instructions)
3. **Create workflow file**: `.github/workflows/audit.yml`
4. **Commit and push**

### GitLab CI

1. **Choose your provider** (see examples below)
2. **Add API key to GitLab Variables**
   - Go to: Settings → CI/CD → Variables
   - Click: "Add variable"
   - Add your key with flags: ☑️ Protect variable, ☑️ Mask variable
3. **Create CI file**: `.gitlab-ci.yml`
4. **Commit and push**

---

## Provider-Specific Setup

### Option 0: xAI Grok (Extreme Reasoning)

**Best for:** Finding logical race conditions, exploitability analysis, and high-speed reasoning.

#### Get API Key
1. Visit: https://console.x.ai/
2. Log in with your X (Twitter) account.
3. Go to "API Keys" → "Create Key".
4. Copy your API key (starts with `xai-`).

#### GitHub Actions Setup

**Add Secret:**
- Name: `GROK_API_KEY`
- Value: Your API key

**Workflow file** (`.github/workflows/audit.yml`):
```yaml
name: MP Sentinel Code Guard
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  audit:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run build
      - name: Run Audit with Grok
        env:
          AI_PROVIDER: grok
          AI_MODEL: grok-4-1-fast-reasoning
          GROK_API_KEY: ${{ secrets.GROK_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: npx mp-sentinel --target-branch origin/${{ github.base_ref }}
```

---

## Environment Variables

All AI providers require an API key as an environment variable. Set it via your CI/CD platform's secrets manager.

When using `ANTHROPIC_BASE_URL` (e.g., with DeepSeek), set `AI_PROVIDER=anthropic`, the DeepSeek API key as `ANTHROPIC_API_KEY`, and `ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic`. The custom base URL bypasses the Anthropic model whitelist so you can use any model the endpoint supports.

---

### Option 1: Google Gemini (Free Tier)

**Best for:** Getting started, high-volume reviews, cost-conscious teams

#### Get API Key
1. Visit: https://aistudio.google.com/
2. Click "Get API key"
3. Create or select a project
4. Copy your API key

#### GitHub Actions Setup

**Add Secret:**
- Name: `GEMINI_API_KEY`
- Value: Your API key

**Workflow file** (`.github/workflows/audit.yml`):
```yaml
name: MP Sentinel Code Guard
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  audit:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - name: Run Audit
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TARGET_BRANCH: origin/${{ github.base_ref }}
        run: npx mp-sentinel --target-branch $TARGET_BRANCH
```

#### GitLab CI Setup

**Add Variable:**
- Key: `GEMINI_API_KEY`
- Value: Your API key
- Flags: ☑️ Protect, ☑️ Mask

**CI file** (`.gitlab-ci.yml`):
```yaml
image: node:24

stages:
  - audit

code_audit:
  stage: audit
  before_script:
    - npm ci
    - git fetch origin ${CI_MERGE_REQUEST_TARGET_BRANCH_NAME:-main}
  script:
    - npm run build
    - export TARGET_BRANCH="origin/${CI_MERGE_REQUEST_TARGET_BRANCH_NAME:-main}"
    - npx mp-sentinel --target-branch $TARGET_BRANCH
  variables:
    GEMINI_API_KEY: $GEMINI_API_KEY
  rules:
    - if: $CI_PIPELINE_SOURCE == 'merge_request_event'
```

---

### Option 2: OpenAI GPT-5 (Best Accuracy)

**Best for:** Critical code reviews, complex refactoring, enterprise teams

#### Get API Key
1. Visit: https://platform.openai.com/api-keys
2. Click "Create new secret key"
3. Name it (e.g., "MP Sentinel")
4. Copy your API key (starts with `sk-`)

#### GitHub Actions Setup

**Add Secret:**
- Name: `OPENAI_API_KEY`
- Value: Your API key (sk-...)

**Workflow file** (`.github/workflows/audit.yml`):
```yaml
name: MP Sentinel Code Guard
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  audit:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - name: Run Audit with GPT-5
        env:
          AI_PROVIDER: openai
          AI_MODEL: gpt-5.2  # or gpt-5.2 for best coding
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TARGET_BRANCH: origin/${{ github.base_ref }}
        run: npx mp-sentinel --target-branch $TARGET_BRANCH
```

#### GitLab CI Setup

**Add Variable:**
- Key: `OPENAI_API_KEY`
- Value: Your API key (sk-...)
- Flags: ☑️ Protect, ☑️ Mask

**CI file** (`.gitlab-ci.yml`):
```yaml
image: node:24

stages:
  - audit

code_audit:
  stage: audit
  before_script:
    - npm ci
    - git fetch origin ${CI_MERGE_REQUEST_TARGET_BRANCH_NAME:-main}
  script:
    - npm run build
    - export TARGET_BRANCH="origin/${CI_MERGE_REQUEST_TARGET_BRANCH_NAME:-main}"
    - npx mp-sentinel --target-branch $TARGET_BRANCH
  variables:
    AI_PROVIDER: openai
    AI_MODEL: gpt-5.2
    OPENAI_API_KEY: $OPENAI_API_KEY
  rules:
    - if: $CI_PIPELINE_SOURCE == 'merge_request_event'
```

---

### Option 3: Anthropic Claude (Best for Agents)

**Best for:** Autonomous reviews, long-running tasks, detailed analysis

#### Get API Key
1. Visit: https://console.anthropic.com/
2. Click "API Keys" → "Create Key"
3. Name it (e.g., "MP Sentinel")
4. Copy your API key (starts with `sk-ant-`)

#### GitHub Actions Setup

**Add Secret:**
- Name: `ANTHROPIC_API_KEY`
- Value: Your API key (sk-ant-...)

**Workflow file** (`.github/workflows/audit.yml`):
```yaml
name: MP Sentinel Code Guard
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  audit:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - name: Run Audit with Claude
        env:
          AI_PROVIDER: anthropic
          AI_MODEL: claude-sonnet-4-6  # or claude-opus-4-6
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TARGET_BRANCH: origin/${{ github.base_ref }}
        run: npx mp-sentinel --target-branch $TARGET_BRANCH
```

#### GitLab CI Setup

**Add Variable:**
- Key: `ANTHROPIC_API_KEY`
- Value: Your API key (sk-ant-...)
- Flags: ☑️ Protect, ☑️ Mask

**CI file** (`.gitlab-ci.yml`):
```yaml
image: node:24

stages:
  - audit

code_audit:
  stage: audit
  before_script:
    - npm ci
    - git fetch origin ${CI_MERGE_REQUEST_TARGET_BRANCH_NAME:-main}
  script:
    - npm run build
    - export TARGET_BRANCH="origin/${CI_MERGE_REQUEST_TARGET_BRANCH_NAME:-main}"
    - npx mp-sentinel --target-branch $TARGET_BRANCH
  variables:
    AI_PROVIDER: anthropic
    AI_MODEL: claude-sonnet-4-6
    ANTHROPIC_API_KEY: $ANTHROPIC_API_KEY
  rules:
    - if: $CI_PIPELINE_SOURCE == 'merge_request_event'
```

---

### Option 4: OpenRouter (Multi-Model Gateway)

**Best for:** Accessing any model through a single API, flexible model selection, cost optimization across providers

#### Get API Key
1. Visit: https://openrouter.ai/keys
2. Sign up or log in
3. Click "Create Key"
4. Copy your API key (starts with `sk-or-`)

#### GitHub Actions Setup

**Add Secret:**
- Name: `OPENROUTER_API_KEY`
- Value: Your API key (sk-or-...)

**Workflow file** (`.github/workflows/audit.yml`):
```yaml
name: MP Sentinel Code Guard
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  audit:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - name: Run Audit with OpenRouter
        env:
          AI_PROVIDER: openrouter
          AI_MODEL: openai/gpt-5.2  # Slash-form: provider/model
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TARGET_BRANCH: origin/${{ github.base_ref }}
          # Optional: attribution headers
          OPENROUTER_SITE_URL: https://github.com/${{ github.repository }}
          OPENROUTER_APP_NAME: MP Sentinel
        run: npx mp-sentinel --target-branch $TARGET_BRANCH
```

#### GitLab CI Setup

**Add Variable:**
- Key: `OPENROUTER_API_KEY`
- Value: Your API key (sk-or-...)
- Flags: ☑️ Protect, ☑️ Mask

**CI file** (`.gitlab-ci.yml`):
```yaml
image: node:24

stages:
  - audit

code_audit:
  stage: audit
  before_script:
    - npm ci
    - git fetch origin ${CI_MERGE_REQUEST_TARGET_BRANCH_NAME:-main}
  script:
    - npm run build
    - export TARGET_BRANCH="origin/${CI_MERGE_REQUEST_TARGET_BRANCH_NAME:-main}"
    - npx mp-sentinel --target-branch $TARGET_BRANCH
  variables:
    AI_PROVIDER: openrouter
    AI_MODEL: openai/gpt-5.2
    OPENROUTER_API_KEY: $OPENROUTER_API_KEY
    # Optional: attribution headers
    OPENROUTER_SITE_URL: $CI_PROJECT_URL
    OPENROUTER_APP_NAME: MP Sentinel
  rules:
    - if: $CI_PIPELINE_SOURCE == 'merge_request_event'
```

**Supported models include:**
- `openai/gpt-5.2` — OpenAI GPT-5.2
- `openai/gpt-5.2` — OpenAI GPT-5.3 Codex
- `anthropic/claude-sonnet-4-6` — Claude Sonnet 4.6
- `anthropic/claude-opus-4-6` — Claude Opus 4.6
- `google/gemini-2.5-flash` — Gemini 2.5 Flash (free tier via OpenRouter)

> **Note:** OpenRouter also supports optional `OPENROUTER_SITE_URL` and `OPENROUTER_APP_NAME` env vars for attribution on the OpenRouter dashboard. These are recommended but not required.

---

## PR/MR Comment Posting: Runtime vs Config

The runtime source of truth for PR/MR comment posting is **CI environment variables**, not `.mp-sentinelrc.json`.

| Behavior | Runtime source (authoritative) | Config field (informational only) |
|----------|-------------------------------|-----------------------------------|
| GitHub PR comments | `GITHUB_ACTIONS` env + `GITHUB_TOKEN` env | `gitProvider: "github"` |
| GitLab MR comments | `GITLAB_CI` env + `CI_JOB_TOKEN` or `GITLAB_TOKEN` env | `gitProvider: "gitlab"`, `projectId` |
| Repository URL | `GITHUB_REPOSITORY` or `CI_PROJECT_URL` env | `repoUrl` |

The fields `gitProvider`, `repoUrl`, and `projectId` in `.mp-sentinelrc.json` are **documentation hints** — they record intent but are not consumed at runtime. The CLI detects the platform from standard CI environment variables and uses CI-provided tokens for authentication. Do not rely on config alone to enable PR/MR comments; ensure the required CI env vars are set.

---

## Advanced Configuration

### Fine-Tuning AI Behavior

Add these environment variables to customize AI responses:

```yaml
env:
  AI_TEMPERATURE: 0.2  # Lower = more focused (0.0-1.0)
  AI_MAX_TOKENS: 8192  # Maximum response length
```

### Custom Concurrency

Control how many files are audited in parallel:

```yaml
run: npx mp-sentinel --target-branch $TARGET_BRANCH --concurrency 10
```

### Multiple Providers (Hybrid Approach)

Use different providers for different scenarios:

```yaml
jobs:
  quick-audit:
    # Fast review with Gemini
    env:
      GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
    run: npx mp-sentinel
  
  deep-audit:
    # Detailed review with GPT-5.2 (only on main branch)
    if: github.base_ref == 'main'
    env:
      AI_PROVIDER: openai
      AI_MODEL: gpt-5.2
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    run: npx mp-sentinel
```

---

## Cost Optimization

### GitHub Actions

**Free tier:** 2,000 minutes/month for private repos

**Optimization tips:**
1. Use caching (already included in examples)
2. Use Gemini for routine reviews
3. Use GPT-5 only for critical branches
4. Set `allow_failure: true` to not block PRs

### GitLab CI

**Free tier:** 400 minutes/month for private repos

**Optimization tips:**
1. Use caching (already included in examples)
2. Use `rules` to limit when audits run
3. Consider `allow_failure: true`

### AI Provider Costs

Pricing changes frequently. Check each provider's pricing page for current rates. As a general guide, Google Gemini tends to be the most cost-effective, while OpenAI and Anthropic models are typically higher-priced. OpenRouter pricing varies by the underlying model selected.

---

## Troubleshooting

### "API key not found"

**GitHub Actions:**
```bash
# Check if secret is set
# Go to: Settings → Secrets → Actions
# Verify secret name matches workflow file
```

**GitLab CI:**
```bash
# Check if variable is set
# Go to: Settings → CI/CD → Variables
# Verify variable name matches .gitlab-ci.yml
```

### "Rate limit exceeded"

**Solution:** Reduce concurrency
```yaml
run: npx mp-sentinel --concurrency 3
```

### "Model not found"

**Solution:** Check model name spelling
```yaml
# Correct model names:
AI_MODEL: gemini-2.5-flash  # Gemini
AI_MODEL: grok-4-1-fast-reasoning  # xAI Grok
AI_MODEL: gpt-5.2            # OpenAI
AI_MODEL: claude-sonnet-4-6 # Claude
AI_MODEL: openai/gpt-5.2   # OpenRouter (slash-form: provider/model)
```

### Workflow not triggering

**GitHub Actions:**
- Check workflow file is in `.github/workflows/`
- Verify `on:` trigger matches your use case
- Check branch protection rules

**GitLab CI:**
- Check file is named `.gitlab-ci.yml`
- Verify `rules:` conditions
- Check CI/CD is enabled in project settings

---

## Example Files

Example workflow files are available in the [`examples/workflows/`](../examples/workflows/) directory:

### GitHub Actions
- [`examples/workflows/github/audit-openai.yml.example`](../examples/workflows/github/audit-openai.yml.example) — OpenAI
- [`examples/workflows/github/audit-claude.yml.example`](../examples/workflows/github/audit-claude.yml.example) — Claude

### GitLab CI
- [`examples/workflows/gitlab/.gitlab-ci-openai.yml.example`](../examples/workflows/gitlab/.gitlab-ci-openai.yml.example) — OpenAI
- [`examples/workflows/gitlab/.gitlab-ci-claude.yml.example`](../examples/workflows/gitlab/.gitlab-ci-claude.yml.example) — Claude

For Gemini, Grok, and OpenRouter setups, copy one of the provider examples above and swap the `AI_PROVIDER`, `AI_MODEL`, and API key env var as shown in the provider-specific sections earlier in this guide.

**To use an example:**
1. Copy the example file to the correct CI location (e.g. `.github/workflows/audit.yml` or `.gitlab-ci.yml`)
2. Update the provider, model, and API key secret/variable
3. Commit and push

---

## Security Best Practices

1. **Never commit API keys** to your repository
2. **Use secrets/variables** for all sensitive data
3. **Enable "Mask variable"** in GitLab CI
4. **Rotate keys regularly** (every 90 days)
5. **Use separate keys** for different environments
6. **Monitor API usage** in provider dashboards
7. **Set spending limits** in provider settings

---

## Next Steps

1. ✅ Choose your AI provider
2. ✅ Get API key
3. ✅ Add to CI/CD secrets/variables
4. ✅ Create workflow/CI file
5. ✅ Test with a pull request
6. ✅ Monitor results and costs
7. ✅ Optimize based on needs

## Support

- 📖 [Full Documentation](../README.md)
- 🔧 [Provider Comparison](./PROVIDER_COMPARISON.md)
- 🚀 [Quick Start](./QUICK_START.md)
- 🐛 [Report Issues](https://github.com/peter-minhnn/mp-sentinel/issues)
