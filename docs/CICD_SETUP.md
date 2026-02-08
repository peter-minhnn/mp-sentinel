# CI/CD Setup Guide - Multi-Provider Support

Complete guide for setting up ArchitectAI in your CI/CD pipeline with any AI provider.

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
name: ArchitectAI Code Guard
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
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - name: Run Audit
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TARGET_BRANCH: origin/${{ github.base_ref }}
        run: npx architect-ai --target-branch $TARGET_BRANCH
```

#### GitLab CI Setup

**Add Variable:**
- Key: `GEMINI_API_KEY`
- Value: Your API key
- Flags: ☑️ Protect, ☑️ Mask

**CI file** (`.gitlab-ci.yml`):
```yaml
image: node:20

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
    - npx architect-ai --target-branch $TARGET_BRANCH
  variables:
    GEMINI_API_KEY: $GEMINI_API_KEY
  rules:
    - if: $CI_PIPELINE_SOURCE == 'merge_request_event'
```

---

### Option 2: OpenAI GPT-4 (Best Accuracy)

**Best for:** Critical code reviews, complex refactoring, enterprise teams

#### Get API Key
1. Visit: https://platform.openai.com/api-keys
2. Click "Create new secret key"
3. Name it (e.g., "ArchitectAI")
4. Copy your API key (starts with `sk-`)

#### GitHub Actions Setup

**Add Secret:**
- Name: `OPENAI_API_KEY`
- Value: Your API key (sk-...)

**Workflow file** (`.github/workflows/audit.yml`):
```yaml
name: ArchitectAI Code Guard
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
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - name: Run Audit with GPT-4
        env:
          AI_PROVIDER: openai
          AI_MODEL: gpt-4o  # or gpt-4.1 for best coding
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TARGET_BRANCH: origin/${{ github.base_ref }}
        run: npx architect-ai --target-branch $TARGET_BRANCH
```

#### GitLab CI Setup

**Add Variable:**
- Key: `OPENAI_API_KEY`
- Value: Your API key (sk-...)
- Flags: ☑️ Protect, ☑️ Mask

**CI file** (`.gitlab-ci.yml`):
```yaml
image: node:20

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
    - npx architect-ai --target-branch $TARGET_BRANCH
  variables:
    AI_PROVIDER: openai
    AI_MODEL: gpt-4o
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
3. Name it (e.g., "ArchitectAI")
4. Copy your API key (starts with `sk-ant-`)

#### GitHub Actions Setup

**Add Secret:**
- Name: `ANTHROPIC_API_KEY`
- Value: Your API key (sk-ant-...)

**Workflow file** (`.github/workflows/audit.yml`):
```yaml
name: ArchitectAI Code Guard
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
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - name: Run Audit with Claude
        env:
          AI_PROVIDER: anthropic
          AI_MODEL: claude-sonnet-4.5  # or claude-opus-4
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TARGET_BRANCH: origin/${{ github.base_ref }}
        run: npx architect-ai --target-branch $TARGET_BRANCH
```

#### GitLab CI Setup

**Add Variable:**
- Key: `ANTHROPIC_API_KEY`
- Value: Your API key (sk-ant-...)
- Flags: ☑️ Protect, ☑️ Mask

**CI file** (`.gitlab-ci.yml`):
```yaml
image: node:20

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
    - npx architect-ai --target-branch $TARGET_BRANCH
  variables:
    AI_PROVIDER: anthropic
    AI_MODEL: claude-sonnet-4.5
    ANTHROPIC_API_KEY: $ANTHROPIC_API_KEY
  rules:
    - if: $CI_PIPELINE_SOURCE == 'merge_request_event'
```

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
run: npx architect-ai --target-branch $TARGET_BRANCH --concurrency 10
```

### Multiple Providers (Hybrid Approach)

Use different providers for different scenarios:

```yaml
jobs:
  quick-audit:
    # Fast review with Gemini
    env:
      GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
    run: npx architect-ai
  
  deep-audit:
    # Detailed review with GPT-4.1 (only on main branch)
    if: github.base_ref == 'main'
    env:
      AI_PROVIDER: openai
      AI_MODEL: gpt-4.1
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    run: npx architect-ai
```

---

## Cost Optimization

### GitHub Actions

**Free tier:** 2,000 minutes/month for private repos

**Optimization tips:**
1. Use caching (already included in examples)
2. Use Gemini for routine reviews
3. Use GPT-4 only for critical branches
4. Set `allow_failure: true` to not block PRs

### GitLab CI

**Free tier:** 400 minutes/month for private repos

**Optimization tips:**
1. Use caching (already included in examples)
2. Use `rules` to limit when audits run
3. Consider `allow_failure: true`

### AI Provider Costs

| Provider | Cost per 1M tokens | Free Tier |
|----------|-------------------|-----------|
| Gemini | $0.075 | ✅ 60 RPM |
| OpenAI | $2.50 | ❌ No |
| Claude | $3.00 | ❌ No |

**Example monthly costs** (1000 files/month, 500 tokens each):
- Gemini: $0.04
- OpenAI: $1.25
- Claude: $1.50

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
run: npx architect-ai --concurrency 3
```

### "Model not found"

**Solution:** Check model name spelling
```yaml
# Correct model names:
AI_MODEL: gemini-2.5-flash  # Gemini
AI_MODEL: gpt-4o            # OpenAI
AI_MODEL: claude-sonnet-4.5 # Claude
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

We provide ready-to-use example files:

### GitHub Actions
- `.github/workflows/audit.yml` - Default (Gemini)
- `.github/workflows/audit-openai.yml.example` - OpenAI
- `.github/workflows/audit-claude.yml.example` - Claude

### GitLab CI
- `.gitlab-ci.yml` - Default (Gemini)
- `.gitlab-ci-openai.yml.example` - OpenAI
- `.gitlab-ci-claude.yml.example` - Claude

**To use an example:**
1. Copy the example file
2. Remove `.example` extension
3. Update API key secret/variable
4. Commit and push

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
- 🐛 [Report Issues](https://github.com/peter-minhnn/architect-ai/issues)
