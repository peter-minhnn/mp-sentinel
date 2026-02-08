# 🛡️ ArchitectAI: The AI-Powered Code Guardian

> **Your 24/7 Virtual Technical Lead.**  
> High-performance CLI tool to automate code reviews, enforce architectural patterns, and maintain clean code at scale using Generative AI.

[![NPM Version](https://img.shields.io/badge/npm-v1.0.0-blue?style=flat-square)](https://www.npmjs.com/package/architect-ai)
[![Build Status](https://img.shields.io/badge/build-passing-green?style=flat-square)](https://github.com/peter-minhnn/architect-ai)
[![Powered By](https://img.shields.io/badge/AI-Multi--Provider-purple?style=flat-square)](https://github.com/peter-minhnn/architect-ai)
[![License](https://img.shields.io/badge/license-MIT-gray?style=flat-square)]()

---

## 🚀 Why ArchitectAI?

Traditional tools like **ESLint** or **Prettier** are great for syntax and formatting, but they miss the bigger picture. They can't tell you if your logic is flawed or if you're breaking the project's architecture.

**ArchitectAI fills that gap.** v1.0.0 introduces multi-provider AI support with high-performance concurrent auditing.

- 🤖 **Multi-Provider AI:** Choose between Gemini, GPT-4, or Claude for code review
- ❌ **No Architectural Violations:** (e.g., calling Database directly from a Controller).
- ❌ **No Anti-Patterns:** (e.g., using `useEffect` for data fetching instead of `useQuery`).
- ✅ **Clean Code Enforcement:** Checks for readability, SOLID principles, and proper code splitting.
- ⚡ **High Performance:** Concurrent file auditing and ESM-native architecture.

---

## 📦 Installation

```bash
# Run once without installing
npx architect-ai

# Or install globally
npm install -g architect-ai

# Or add as dev dependency (recommended)
npm install -D architect-ai
# pnpm add -D architect-ai
# yarn add -D architect-ai
```

## 🛠️ CLI Usage

### CI/CD Mode (Default)

```bash
# Default: Audit commit message + changed files
architect-ai

# Audit only changed files (skip commit check)
architect-ai --skip-commit

# Audit specific files
architect-ai src/main.ts src/utils.ts

# Set max concurrency (default: 5)
architect-ai --concurrency 10

# Diff against a specific branch
architect-ai --target-branch develop
```

### 🔄 Local Review Mode

Run code reviews directly on your current branch without GitHub Actions or GitLab CI/CD:

```bash
# Review last commit on current branch
npx architect-ai --local

# Review last 5 commits
npx architect-ai --local --commits 5
# Or short form
npx architect-ai -l -n 5

# Verbose local review
npx architect-ai --local --verbose

# Skip commit message validation, only audit files
npx architect-ai --local --skip-commit
```

### Options Reference

| Option            | Shorthand | Description                              | Default       |
| ----------------- | --------- | ---------------------------------------- | ------------- |
| `--help`          | `-h`      | Show help message                        | -             |
| `--version`       | `-v`      | Show version number                      | -             |
| `--skip-commit`   | -         | Skip commit message validation           | `false`       |
| `--skip-files`    | -         | Skip file auditing                       | `false`       |
| `--target-branch` | `-b`      | Target branch for git diff               | `origin/main` |
| `--concurrency`   | `-c`      | Max concurrent file audits               | `5`           |
| `--verbose`       | -         | Enable verbose logging                   | `false`       |
| `--local`         | `-l`      | Enable local review mode                 | `false`       |
| `--commits`       | `-n`      | Number of commits to review (local mode) | `1`           |

---

## ⚙️ Configuration (`.architectrc.json`)

Create a `.architectrc.json` in your project root to customize rules and performance.

### Basic Configuration

```json
{
  "techStack": "React 19, Next.js (App Router), TanStack Query v5",
  "rules": [
    "CRITICAL: Never use 'useEffect' for data fetching. Suggest 'useQuery'.",
    "STYLE: All components must use Arrow Functions.",
    "PERFORMANCE: Split components exceeding 200 lines.",
    "ARCHITECTURE: Business logic must stay in Services, not Controllers."
  ],
  "bypassKeyword": "skip:",
  "maxConcurrency": 5
}
```

### Local Review Configuration

```json
{
  "techStack": "React 19, Next.js",
  "rules": ["CRITICAL: No direct API calls in components."],
  "bypassKeyword": "skip:",
  "localReview": {
    "enabled": true,
    "commitCount": 3,
    "commitPatterns": [
      {
        "type": "feat",
        "pattern": "^feat(\\(.+\\))?:",
        "description": "Feature commits"
      },
      {
        "type": "fix",
        "pattern": "^fix(\\(.+\\))?:",
        "description": "Bug fix commits"
      },
      {
        "type": "refactor",
        "pattern": "^refactor(\\(.+\\))?:",
        "description": "Refactoring"
      }
    ],
    "filterByPattern": false,
    "skipPatterns": ["skip:", "wip:", "draft:"],
    "includeMergeCommits": false
  }
}
```

#### Local Review Options

| Option                | Type    | Description                           | Default |
| --------------------- | ------- | ------------------------------------- | ------- |
| `enabled`             | boolean | Enable local review by default        | `false` |
| `commitCount`         | number  | Default number of commits to review   | `1`     |
| `commitPatterns`      | array   | Valid commit message patterns         | `[]`    |
| `filterByPattern`     | boolean | Only review commits matching patterns | `false` |
| `skipPatterns`        | array   | Skip commits with these prefixes      | `[]`    |
| `includeMergeCommits` | boolean | Include merge commits                 | `false` |

### 🔑 Environment Variables

#### AI Provider Configuration

ArchitectAI now supports multiple AI providers! Choose the one that fits your needs:

```bash
# Choose your AI provider (default: gemini)
AI_PROVIDER=gemini  # or openai, anthropic

# Optional: Specify model (uses provider default if not set)
AI_MODEL=gemini-2.5-flash

# Set API key for your chosen provider
GEMINI_API_KEY=your_key_here      # For Gemini
# OPENAI_API_KEY=your_key_here    # For OpenAI
# ANTHROPIC_API_KEY=your_key_here # For Anthropic

# Optional: Fine-tune AI behavior
AI_TEMPERATURE=0.2
AI_MAX_TOKENS=8192

# Optional: Set default target branch
TARGET_BRANCH=origin/main
```

#### Supported AI Models

| Provider             | Best Models for Code Review                                            | Get API Key                                     |
| -------------------- | ---------------------------------------------------------------------- | ----------------------------------------------- |
| **Google Gemini**    | `gemini-2.5-flash` (default), `gemini-2.0-flash-exp`, `gemini-1.5-pro` | [Get Key](https://aistudio.google.com/)         |
| **OpenAI GPT**       | `gpt-4.1` (best coding), `gpt-4o` (default), `gpt-4-turbo`             | [Get Key](https://platform.openai.com/api-keys) |
| **Anthropic Claude** | `claude-sonnet-4.5` (default), `claude-opus-4`, `claude-3-5-sonnet`    | [Get Key](https://console.anthropic.com/)       |

**Model Selection Guide:**

- **Fast & Cost-Effective**: `gemini-2.5-flash`
- **Best Coding Performance**: `gpt-4.1` (54.6% SWE-bench score)
- **Autonomous Tasks**: `claude-opus-4`
- **Balanced**: `claude-sonnet-4.5`

---

## 📚 Programmatic API

ArchitectAI can be used as a library in your own Node.js scripts.

```typescript
import { auditFilesWithConcurrency, loadProjectConfig } from "architect-ai";

const config = await loadProjectConfig();
const results = await auditFilesWithConcurrency(
  [{ path: "src/index.ts", content: "..." }],
  config,
);
```

---

## 🤖 CI/CD Integration

ArchitectAI v1.0.0 supports multiple AI providers in CI/CD pipelines. Choose the provider that fits your needs.

### Quick Setup

**GitHub Actions:** Add API key to repository secrets, create workflow file
**GitLab CI:** Add API key to CI/CD variables, create `.gitlab-ci.yml`

📖 **[Complete CI/CD Setup Guide](./docs/CICD_SETUP.md)** - Detailed instructions for all providers

### GitHub Actions Examples

<details>
<summary><b>Option 1: Google Gemini (Free Tier)</b></summary>

**Setup:**

1. Get API key: https://aistudio.google.com/
2. Add to Secrets: `GEMINI_API_KEY`
3. Create `.github/workflows/audit.yml`:

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
          node-version: "20"
          cache: "npm"
      - run: npm ci
      - run: npm run build
      - name: Run ArchitectAI
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TARGET_BRANCH: origin/${{ github.base_ref }}
        run: npx architect-ai --target-branch $TARGET_BRANCH
```

</details>

<details>
<summary><b>Option 2: OpenAI GPT-4 (Best Accuracy)</b></summary>

**Setup:**

1. Get API key: https://platform.openai.com/api-keys
2. Add to Secrets: `OPENAI_API_KEY`
3. Create `.github/workflows/audit.yml`:

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
          node-version: "20"
          cache: "npm"
      - run: npm ci
      - run: npm run build
      - name: Run ArchitectAI
        env:
          AI_PROVIDER: openai
          AI_MODEL: gpt-4o # or gpt-4.1 for best coding
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TARGET_BRANCH: origin/${{ github.base_ref }}
        run: npx architect-ai --target-branch $TARGET_BRANCH
```

</details>

<details>
<summary><b>Option 3: Anthropic Claude (Best for Agents)</b></summary>

**Setup:**

1. Get API key: https://console.anthropic.com/
2. Add to Secrets: `ANTHROPIC_API_KEY`
3. Create `.github/workflows/audit.yml`:

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
          node-version: "20"
          cache: "npm"
      - run: npm ci
      - run: npm run build
      - name: Run ArchitectAI
        env:
          AI_PROVIDER: anthropic
          AI_MODEL: claude-sonnet-4.5 # or claude-opus-4
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TARGET_BRANCH: origin/${{ github.base_ref }}
        run: npx architect-ai --target-branch $TARGET_BRANCH
```

</details>

### GitLab CI Examples

<details>
<summary><b>Option 1: Google Gemini (Free Tier)</b></summary>

**Setup:**

1. Get API key: https://aistudio.google.com/
2. Add to Variables: `GEMINI_API_KEY` (Protected, Masked)
3. Create `.gitlab-ci.yml`:

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

</details>

<details>
<summary><b>Option 2: OpenAI GPT-4 (Best Accuracy)</b></summary>

**Setup:**

1. Get API key: https://platform.openai.com/api-keys
2. Add to Variables: `OPENAI_API_KEY` (Protected, Masked)
3. Create `.gitlab-ci.yml`:

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

</details>

<details>
<summary><b>Option 3: Anthropic Claude (Best for Agents)</b></summary>

**Setup:**

1. Get API key: https://console.anthropic.com/
2. Add to Variables: `ANTHROPIC_API_KEY` (Protected, Masked)
3. Create `.gitlab-ci.yml`:

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

</details>

### Example Files Included

We provide ready-to-use example files for all providers:

- `.github/workflows/audit-openai.yml.example`
- `.github/workflows/audit-claude.yml.example`
- `.gitlab-ci-openai.yml.example`
- `.gitlab-ci-claude.yml.example`

Simply copy, rename (remove `.example`), and configure your API key!

---

## 💡 How it Works

1. **Smart Diff**: Detects only relevant code changes against your target branch.
2. **Concurrent Audit**: Files are processed in parallel batches for maximum speed.
3. **AI Reasoning**: Your code + project rules are analyzed by Gemini 1.5 Pro.
4. **Actionable Reports**: Styled console output with line-specific suggestions.
5. **Exit Codes**: Returns `1` on CRITICAL issues to block bad PRs.

---

## 🛡️ License

Copyright © 2026 Nguyen Nhat Minh. All rights reserved.  
Distributed under the MIT License.
