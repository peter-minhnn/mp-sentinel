# 🛡️ MP Sentinel: The AI-Powered Code Guardian

> **Your 24/7 Virtual Technical Lead.**  
> High-performance CLI tool to automate code reviews, enforce architectural patterns, and maintain clean code at scale using Generative AI.

[![NPM Version](https://img.shields.io/badge/npm-v2.0.0-blue?style=flat-square)](https://www.npmjs.com/package/mp-sentinel)
[![Build Status](https://img.shields.io/badge/build-passing-green?style=flat-square)](https://github.com/peter-minhnn/mp-sentinel)
[![Powered By](https://img.shields.io/badge/AI-Multi--Provider-purple?style=flat-square)](https://github.com/peter-minhnn/mp-sentinel)
[![License](https://img.shields.io/badge/license-MIT-gray?style=flat-square)]()

---

## 🚀 Why MP Sentinel?

Traditional tools like **ESLint** or **Prettier** are great for syntax and formatting, but they miss the bigger picture. They can't tell you if your logic is flawed or if you're breaking the project's architecture.

**MP Sentinel fills that gap.** It introduces agentic parser diagnostics, chunked parser recovery with full observability, and AI-powered code reviews — all 100% offline and secure.

- 🤖 **Multi-Provider AI:** Choose between Gemini, GPT-4o, Claude, Grok, or OpenRouter for code review
- ❌ **No Architectural Violations:** (e.g., calling Database directly from a Controller).
- ❌ **No Anti-Patterns:** (e.g., using `useEffect` for data fetching instead of `useQuery`).
- ✅ **Clean Code Enforcement:** Checks for readability, SOLID principles, and proper code splitting.
- ⚡ **High Performance:** Concurrent file auditing and ESM-native architecture.
- 🔒 **3-Layer Security:** Smart filtering + secret scrubbing + dry-run transparency.

---

## 📦 Installation

```bash
# Run once without installing
npx mp-sentinel

# Or install globally
npm install -g mp-sentinel

# Or add as dev dependency (recommended)
npm install -D mp-sentinel
# pnpm add -D mp-sentinel
# yarn add -D mp-sentinel
```

> 💡 **Installation Issues?** If you encounter errors like timeouts or connection issues during `npm install`, or if you need to downgrade/upgrade to a specific version, please refer to our **[Version Guide & Installation Troubleshooting](./VERSION_GUIDE.md)**.

## 🛠️ CLI Usage

### Stable Review Command

```bash
# Default target: <target-branch>...HEAD
mp-sentinel

# Staged changes (AI defaults OFF unless --ai or MP_SENTINEL_AI=1)
mp-sentinel --staged

# Single commit or commit range
mp-sentinel --commit 9f31a4c
mp-sentinel --range origin/main..HEAD

# Explicit files (power-user mode)
mp-sentinel --files src/index.ts src/utils/git.ts

# Output formats
mp-sentinel --format console
mp-sentinel --format json
mp-sentinel --format markdown

# Dry-run / View token estimations
mp-sentinel --dry-run
mp-sentinel --verbose-dry-run 
```

### Shortcut

```bash
# Running without any flags is equivalent to default review mode:
mp-sentinel
```

### Options Reference

| Option             | Shorthand | Description                                            | Default         |
| ------------------ | --------- | ------------------------------------------------------ | --------------- |
| `--help`           | `-h`      | Show help message                                      | -               |
| `--version`        | `-v`      | Show version number                                    | -               |
| `--staged`         | -         | Review staged changes (`git diff --cached`)            | `false`         |
| `--commit`         | -         | Review one commit (`git show <sha>`)                   | -               |
| `--range`          | -         | Review commit range (`git diff base..head`)            | -               |
| `--files`          | -         | Review explicit files                                  | `[]`            |
| `--format`         | -         | Output format (`console`, `json`, `markdown`)          | `console`       |
| `--ai`             | -         | Force-enable AI review (mainly for staged mode)        | target-dependent |
| `--target-branch`  | `-b`      | Target branch for default range mode                   | `origin/main`   |
| `--concurrency`    | `-c`      | Max concurrent AI provider calls (chunk audits share the same pool) | `5`             |
| `--verbose`        | -         | Enable verbose logging                                 | `false`         |
| `--dry-run`        | -         | Security scan & token estimation (no AI calls)         | `false`         |
| `--verbose-dry-run`| -         | Thorough per-file breakdown for tokens                 | `false`         |
| `--explain-context`| -         | Show context building details without AI calls         | `false`         |
| `--token-limit`    | -         | Override provider context-window token limit           | —               |
| `--no-skills-fetch`| -         | Disable local skills loading (air-gapped mode)         | `false`         |
| `--local`          | `-l`      | Legacy local-review mode (still supported)             | `false`         |
| `--interactive`    | `-i`      | Interactive UI picker for local commits                | `false`         |
| `--include-uncommitted`| -     | Mixed uncommitted mode (include WIP changes)           | `false`         |
| `--fetch`          | -         | Auto-fetch tracking branch before detecting base       | `false`         |
| `--commits`        | `-n`      | Legacy: number of commits in local mode                | `1`             |
| `--branch-diff`    | `-d`      | Legacy: review all commits since branching             | `false`         |
| `--compare-branch` | -         | Legacy: comparison branch for local mode               | `origin/main`   |

### Exit Codes

Review commands run in the foreground and exit immediately after the report is printed — no lingering background handles or daemon processes.

- `0`: no blocking issues
- `1`: review findings detected
- `2`: runtime/system/provider error

---

## ⚙️ Configuration (`.mp-sentinelrc.json`)

Create a `.mp-sentinelrc.json` file in your project root to customize rules and performance.

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
  "ruleFiles": [
    "docs/FLOW.md"
  ],
  "bypassKeyword": "skip:",
  "maxConcurrency": 5,
  "ai": {
    "maxFiles": 15,
    "maxDiffLines": 1200,
    "maxCharsPerFile": 12000,
    "promptVersion": "2026-05-04"
  }
}
```

`ruleFiles` lets you include existing project docs (e.g., `docs/FLOW.md`) as review rules. Each file path must be relative to the project root. Content is appended after inline `rules`, formatted as `From <path>:\n<content>`. Up to 10 files, each capped at 12,000 characters. Absolute paths and path traversal (`../`) are rejected. The existing `.sentinel/skills/` directory still works for custom skill prompts; `ruleFiles` is for explicit project-root files.

### AI Guardrails

| Option            | Type    | Description                                 | Default       |
| ----------------- | ------- | ------------------------------------------- | ------------- |
| `maxFiles`        | number  | Maximum files sent to AI per run            | `15`          |
| `maxDiffLines`    | number  | Maximum changed diff lines sent to AI       | `1200`        |
| `maxCharsPerFile` | number  | Max patch chars per file before auto-chunking (chunked audits preserve line mapping) | `12000`      |
| `promptVersion`   | string  | Prompt version used for caching and tracing | `2026-05-04`  |
| `modelTier`       | string  | Model tier: `premium` / `balanced` / `budget`. Only applies when `AI_MODEL` is not set. | provider default |

### MCP External Context (optional, disabled by default)

MP Sentinel can pull external review context from MCP (Model Context Protocol) servers before AI code review. The context is capped, cached, labeled "EXTERNAL MCP CONTEXT (optional, untrusted)" in the AI prompt, and never blocks the review on failure.

> **Safety note:** MCP is **disabled by default** (`mcp.enabled: false`). Only `stdio` transport is supported. Mutating tools (create*, update*, delete*, merge*, etc.) are rejected at config validation. Environment variables are never implicitly forwarded — only names explicitly listed in `env` are copied. All MCP failures degrade gracefully (warn + continue).

```json
{
  "mcp": {
    "enabled": true,
    "timeoutMs": 5000,
    "maxContextChars": 6000,
    "cacheEnabled": true,
    "cacheTtlMs": 3600000,
    "servers": [
      {
        "id": "github",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "env": {
          "GITHUB_TOKEN": "GH_TOKEN"
        },
        "calls": [
          { "tool": "get_file_contents", "input": { "path": "README.md" } },
          { "tool": "search_code", "input": { "query": "TODO ${pr.number}" } }
        ]
      },
      {
        "id": "docs",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-fetch"],
        "calls": [
          { "tool": "fetch", "input": { "url": "https://docs.example.com/api/${base.ref}" } }
        ]
      }
    ]
  }
}
```

#### Template Variables

Template variables in `input` string values are resolved at call time using CI/CD metadata. Unknown variables are left as-is.

| Variable | Source | Example |
|----------|--------|---------|
| `${repo.owner}` | Repository owner | `acme` |
| `${repo.name}` | Repository name | `widgets` |
| `${repo.fullName}` | owner/name | `acme/widgets` |
| `${pr.number}` | PR/MR number | `42` |
| `${head.sha}` | Head commit SHA | `abc123def` |
| `${base.ref}` | Base branch ref | `main` |
| `${changedFiles.csv}` | Comma-separated changed files | `src/a.ts,src/b.ts` |
| `${cwd}` | Working directory path | `/home/runner/work/repo` |

#### MCP Presets (shorthand shortcuts)

Presets expand into full `MCPServer` definitions before cache/gather. Use them to avoid repeating common server configurations.

```json
{
  "mcp": {
    "enabled": true,
    "presets": [
      {
        "preset": "github",
        "calls": [
          { "tool": "get_file_contents", "input": { "path": "README.md" } }
        ]
      },
      {
        "preset": "fetch",
        "urls": [
          "https://docs.example.com/api/guide",
          "https://api.example.com/ref/${base.ref}"
        ]
      }
    ]
  }
}
```

**Supported presets:**

| Preset | Command | Description |
|--------|---------|-------------|
| `github` | `npx -y @modelcontextprotocol/server-github` | GitHub API context. Requires explicit `calls`. |
| `fetch` | `uvx mcp-server-fetch` | URL fetching. Accepts `calls` and/or `urls[]` — each URL expands to a `fetch` tool call. |

Preset IDs (`github`, `fetch`) must not collide with explicit `servers` IDs — duplicates are config errors.

#### MCP Diagnostics (`--explain-context`)

When MCP is configured, `--explain-context` includes read-only MCP diagnostics (no server spawns). The JSON output includes an `mcp` field with per-server status: `ready`, `missing_env`, or `missing_command`. Console output displays a summary table.

#### MCP Configuration Options

| Option | Type | Description | Default |
|--------|------|-------------|---------|
| `enabled` | boolean | Enable MCP context gathering | `false` |
| `timeoutMs` | number | Timeout for server connect + tool calls (ms) | `3000` |
| `maxContextChars` | number | Max total chars injected into the AI prompt | `6000` |
| `cacheEnabled` | boolean | Cache MCP results to avoid re-fetching | `true` |
| `cacheTtlMs` | number | TTL for MCP cache entries (ms) | `3600000` |
| `servers` | array | MCP server definitions (stdio only) | `[]` |
| `presets` | array | Preset shortcuts expanded into server definitions | `[]` |

#### Server Options

| Option | Type | Description |
|--------|------|-------------|
| `id` | string | Unique server identifier |
| `transport` | `"stdio"` | Transport type (only stdio supported) |
| `command` | string | Command to spawn |
| `args` | string[] | Arguments passed to command |
| `env` | object | Env var mapping: `{ "CHILD_NAME": "PROCESS_ENV_NAME" }` |
| `calls` | array | Ordered tool calls to make (≥1 required) |

#### Call Options

| Option | Type | Description | Default |
|--------|------|-------------|---------|
| `tool` | string | Tool name to invoke | (required) |
| `input` | object | JSON input (string values support template vars) | (required) |
| `maxChars` | number | Per-call char limit override | `mcp.maxContextChars` |

### Inbound MCP Server

mp-sentinel can also run as a **read-only stdio MCP server** (`mp-sentinel mcp-server`) for project introspection by MCP-aware clients. See the [Commands Cheat Sheet](./COMMANDS_CHEAT_SHEET.md#-4-mcp-server-inbound) for available tools and usage.

### Legacy Local Review Configuration

```json
{
  "techStack": "React 19, Next.js",
  "rules": ["CRITICAL: No direct API calls in components."],
  "bypassKeyword": "skip:",
  "localReview": {
    "enabled": true,
    "branchDiffMode": true,
    "compareBranch": "origin/main",
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
      }
    ],
    "filterByPattern": true,
    "patternMatchMode": "any",
    "verbosePatternMatching": false,
    "skipPatterns": ["skip:", "wip:", "draft:"],
    "includeMergeCommits": false
  }
}
```

#### Legacy Local Review Options

| Option                   | Type    | Description                           | Default       |
| ------------------------ | ------- | ------------------------------------- | ------------- |
| `enabled`                | boolean | Enable local review by default        | `false`       |
| `branchDiffMode`         | boolean | Scan all commits since branching      | `false`       |
| `compareBranch`          | string  | Branch to compare against             | `origin/main` |
| `commitCount`            | number  | Default number of commits to review   | `1`           |
| `commitPatterns`         | array   | Valid commit message patterns         | `[]`          |
| `filterByPattern`        | boolean | Only review commits matching patterns | `false`       |
| `patternMatchMode`       | string  | Match mode (`any` or `all`)           | `any`         |
| `verbosePatternMatching` | boolean | Show detailed pattern matching info   | `false`       |
| `skipPatterns`           | array   | Skip commits with these prefixes      | `[]`          |
| `includeMergeCommits`    | boolean | Include merge commits                 | `false`       |

#### High-Performance Local Options
- `--interactive (-i)`: Spawns a checkbox UI list, allowing precision selection of which commits to review.
- `--fetch`: When using branch-diff mode, Sentinel will securely origin sync (`git fetch`) in the background so you are comparing against the most up-to-date architecture.
- `--include-uncommitted`: Mixed mode that brings standard local branch diff PLUS uncommitted changes (both Staged + Unstaged workspace files) in a single massive super-audit report. Perfect for reviewing code right before a commit.

### 🔑 Environment Variables

#### AI Provider Configuration

MP Sentinel now supports multiple AI providers! Choose the one that fits your needs:

```bash
# Choose your AI provider (default: gemini)
AI_PROVIDER=gemini  # or openai, anthropic, grok, openrouter

# Optional: Specify model (uses provider default if not set)
AI_MODEL=gemini-2.5-flash

# Set API key for your chosen provider
GEMINI_API_KEY=your_key_here           # For Gemini
# OPENAI_API_KEY=your_key_here         # For OpenAI
# ANTHROPIC_API_KEY=your_key_here      # For Anthropic (preferred)
# ANTHROPIC_AUTH_TOKEN=your_key_here   # Anthropic fallback alias
# ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic  # Custom Anthropic-compatible endpoint
# GROK_API_KEY=your_key_here           # For Grok (preferred)
# XAI_API_KEY=your_key_here            # For Grok (fallback alias)
# OPENROUTER_API_KEY=your_key_here     # For OpenRouter

# Optional: Fine-tune AI behavior
AI_TEMPERATURE=0.2
AI_MAX_TOKENS=2048
AI_TIMEOUT_MS=30000  # Applies to all providers

# Model tier selection (when AI_MODEL is not explicitly set)
# AI_MODEL_TIER=premium   # Best models — use for security/architecture/crash reviews
# AI_MODEL_TIER=balanced  # Default — stable models for everyday CI (same as leaving unset)
# AI_MODEL_TIER=budget    # Cheap/fast — use for bulk or low-criticality review passes

# Optional: OpenRouter attribution
OPENROUTER_SITE_URL=https://example.com
OPENROUTER_APP_NAME=MyProject

# Optional: AI behavior policy for CLI
MP_SENTINEL_AI=1
MP_SENTINEL_FORMAT=console|json|markdown
MP_SENTINEL_CONCURRENCY=5

# Optional: Set default target branch
TARGET_BRANCH=origin/main
```
#### Supported AI Providers

| Provider             | Default Model                       | Models by Tier / Recommended Priority              | API Key Env Vars                                   |
| -------------------- | ----------------------------------- | --------------------------------------------------- | -------------------------------------------------- |
| **Google Gemini**    | `gemini-2.5-flash`                  | **Premium:** `gemini-3.1-pro-preview`, `gemini-3-flash-preview`, `gemini-2.5-pro` — **Balanced:** `gemini-2.5-flash` — **Budget:** `gemini-3.1-flash-lite-preview`, `gemini-2.5-flash-lite` | `GEMINI_API_KEY`                                   |
| **OpenAI GPT**       | `gpt-5.2`                           | **Premium:** `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano` — **Balanced:** `gpt-5.2`, `gpt-5.2-pro` — **Budget:** `gpt-5-mini` | `OPENAI_API_KEY`                                   |
| **Anthropic Claude** | `claude-sonnet-4-6`                 | **Premium:** `claude-opus-4-7`, `claude-opus-4-6` — **Balanced:** `claude-sonnet-4-6` — **Budget:** `claude-haiku-4-5` | `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`      |
| **xAI Grok**         | `grok-4-1-fast-reasoning`           | **Premium:** `grok-4.3`, `grok-4` — **Balanced:** `grok-4-1-fast-reasoning` — **Budget:** `grok-code-fast-1` | `GROK_API_KEY` or `XAI_API_KEY`                    |
| **OpenRouter**       | `openai/gpt-5.2`                    | **Premium:** `openai/gpt-5.5`, `anthropic/claude-opus-4-7`, `google/gemini-3.1-pro-preview`, `x-ai/grok-4.3` — **Balanced:** `openai/gpt-5.2` — **Budget:** `google/gemini-2.5-flash` | `OPENROUTER_API_KEY`                               |

Model availability and performance varies by provider. Check provider documentation for current model lists.

**OpenRouter** also accepts `OPENROUTER_SITE_URL` and `OPENROUTER_APP_NAME` for dashboard attribution (optional).
OpenRouter model IDs use `provider/model` form with optional variant suffix like `:free` (e.g., `openai/gpt-5.2`, `meta-llama/llama-3.2-3b-instruct:free`).

If `AI_PROVIDER`, `AI_MODEL`, or the resolved API key is unsupported or missing, review prints a warning, disables AI for that run, and continues with deterministic non-AI review (secret redaction + risk analyzer; not a full AI substitute). The exit code still follows findings: `0` pass, `1` findings, `2` runtime/system errors.

---

## 📚 Programmatic API

MP Sentinel can be used as a library in your own Node.js scripts.

```typescript
import { auditFilesWithConcurrency, loadProjectConfig } from "mp-sentinel";

const config = await loadProjectConfig();
const results = await auditFilesWithConcurrency(
  [{ path: "src/index.ts", content: "..." }],
  config,
);
```

---

## 🤖 CI/CD Integration

MP Sentinel supports multiple AI providers in CI/CD pipelines. Choose the provider that fits your needs.

### Quick Setup

**GitHub Actions:** Add API key to repository secrets, create workflow file
**GitLab CI:** Add API key to CI/CD variables, create `.gitlab-ci.yml`

📖 **[Complete CI/CD Setup Guide](./CICD_SETUP.md)** - Detailed instructions for all providers

### GitHub Actions Examples

<details>
<summary><b>Option 1: Google Gemini (Free Tier)</b></summary>

**Setup:**

1. Get API key: https://aistudio.google.com/
2. Add to Secrets: `GEMINI_API_KEY`
3. Create `.github/workflows/audit.yml`:

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
          node-version: "24"
          cache: "npm"
      - run: npm ci
      - run: npm run build
      - name: Run MP Sentinel
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TARGET_BRANCH: origin/${{ github.base_ref }}
        run: npx mp-sentinel --target-branch $TARGET_BRANCH
```

</details>

<details>
<summary><b>Option 2: OpenAI GPT-4o (Best Accuracy)</b></summary>

**Setup:**

1. Get API key: https://platform.openai.com/api-keys
2. Add to Secrets: `OPENAI_API_KEY`
3. Create `.github/workflows/audit.yml`:

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
          node-version: "24"
          cache: "npm"
      - run: npm ci
      - run: npm run build
      - name: Run MP Sentinel
        env:
          AI_PROVIDER: openai
          AI_MODEL: gpt-5.2
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TARGET_BRANCH: origin/${{ github.base_ref }}
        run: npx mp-sentinel --target-branch $TARGET_BRANCH
```

</details>

<details>
<summary><b>Option 3: Anthropic Claude (Best for Agents)</b></summary>

**Setup:**

1. Get API key: https://console.anthropic.com/
2. Add to Secrets: `ANTHROPIC_API_KEY`
3. Create `.github/workflows/audit.yml`:

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
          node-version: "24"
          cache: "npm"
      - run: npm ci
      - run: npm run build
      - name: Run MP Sentinel
        env:
          AI_PROVIDER: anthropic
          AI_MODEL: claude-sonnet-4-6 # or claude-opus-4-6
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TARGET_BRANCH: origin/${{ github.base_ref }}
        run: npx mp-sentinel --target-branch $TARGET_BRANCH
```

</details>

<details>
<summary><b>Option 4: xAI Grok (Extreme Reasoning)</b></summary>

**Setup:**

1. Get API key: https://console.x.ai/
2. Add to Secrets: `GROK_API_KEY`
3. Create `.github/workflows/audit.yml`:

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
          node-version: "24"
          cache: "npm"
      - run: npm ci
      - run: npm run build
      - name: Run MP Sentinel
        env:
          AI_PROVIDER: grok
          AI_MODEL: grok-4-1-fast-reasoning
          GROK_API_KEY: ${{ secrets.GROK_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TARGET_BRANCH: origin/${{ github.base_ref }}
        run: npx mp-sentinel --target-branch $TARGET_BRANCH
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

</details>

<details>
<summary><b>Option 2: OpenAI GPT-4o (Best Accuracy)</b></summary>

**Setup:**

1. Get API key: https://platform.openai.com/api-keys
2. Add to Variables: `OPENAI_API_KEY` (Protected, Masked)
3. Create `.gitlab-ci.yml`:

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

</details>

<details>
<summary><b>Option 3: Anthropic Claude (Best for Agents)</b></summary>

**Setup:**

1. Get API key: https://console.anthropic.com/
2. Add to Variables: `ANTHROPIC_API_KEY` (Protected, Masked)
3. Create `.gitlab-ci.yml`:

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

</details>

### Example Files

Example workflow files are shipped in the [`examples/workflows/`](../examples/workflows/) directory. See the [CI/CD Setup Guide](./CICD_SETUP.md) for the complete list and usage instructions.

---

## 🎯 Agent Skills Integration

MP Sentinel integrates with the open agent skills ecosystem (e.g. `npx skills`) to automatically enhance code review prompts with specialized best practices and knowledge bases found locally in your project repository.

### How It Works

1. **Parse TechStack**: Extracts technologies from your `.mp-sentinelrc.json`
2. **Scan Directories**: Automatically scans local folders like `.skills`, `.agent/skills`, `.cursor/rules`, or `.sentinel/skills`.
3. **Smart Relevance**: Boosts priority of Markdown files (`.md` or `.mdc`) whose names match your parsed tech stack.
4. **Enhance Prompts**: Concatenates and injects the top rules directly into the AI context window.

### Configuration

```json
{
  "techStack": "TypeScript 5.7, Node.js 24, React 18, PostgreSQL 15"
}
```

### Features

- ✅ **Automatic Technology Detection**: Parses techStack string intelligently
- ✅ **100% Offline & Secure**: No third-party API dependencies (skills.sh API is defunct)
- ✅ **Community Support**: Simply `npx skills add <skill>` and Sentinel will pick it up
- ✅ **Extreme Customization**: Organizations can throw `.md` rules into `.sentinel/skills` and all future reviews adhere to them.

### Example Output

```markdown
### LOCAL/CUSTOM SKILLS & BEST PRACTICES

#### Skill: vercel-react-best-practices (from .agent/skills)
# React Best Practices
- **Type Safety**: Always use explicit types, avoid 'any'
- **Data Fetching**: Use Server Components where possible

#### Skill: my-backend-rules (from .sentinel/skills)
- **Error Handling**: Use try-catch for async operations
```

For detailed documentation, see [Skills Integration Guide](./SKILLS_INTEGRATION.md).

---

## 🛡️ Security & Data Privacy

Security is the top priority in MP Sentinel. We implement 3 layers of protection to ensure your sensitive data never leaves your machine.

### Layer 1: Smart File Filtering (The Ignore Layer)

- **Git Compatibility**: Automatically respects `.gitignore`.
- **Custom Rules**: Support for `.archignore` (tool-specific ignore rules).
- **Extension Allowlist**: Only processes source code (`.ts`, `.py`, `.go`, etc.).
- **Hard Blocklist**: Automatically blocks `.env`, `id_rsa`, `*.pem`, `package-lock.json`, and other sensitive manifests.

### Layer 2: Secret Scrubbing (The Redaction Layer)

Before any code is sent to the AI provider, it is scanned for:

- AWS / GCP / Azure Keys
- Database Connection Strings (Postgres, MongoDB, Redis, etc.)
- Bearer Tokens & Private Key blocks (`-----BEGIN RSA...`)
- JWTs and Generic Secrets

All detected secrets are replaced with `<REDACTED_SECRET>`.

### Layer 3: Transparency & Dry-Run (The Control Layer)

Use `--dry-run` (or inspect via `SecurityService`) to see exactly what will be sent:

- Detailed file list with character counts.
- Token usage estimation.
- Warnings for "suspicious" keywords (e.g., `password`, `secret`) found in comments or variables.

---

## 🤖 CI/CD Integration

1. **Smart Diff**: Detects only relevant code changes against your target branch.
2. **Concurrent Audit**: Files and chunks are scheduled through a shared concurrency limiter for maximum speed without overwhelming the AI provider.
3. **AI Reasoning**: Your code + project rules are analyzed by your configured AI provider (Gemini, Claude, GPT, etc.).
4. **Actionable Reports**: Styled console output with line-specific suggestions.
5. **Exit Codes**: Returns `1` on CRITICAL issues to block bad PRs.

---

## 🛡️ License

Copyright © 2026 Nguyen Nhat Minh. All rights reserved.  
Distributed under the MIT License.
