# 🚀 MP Sentinel Commands Cheat Sheet

A quick reference guide for all **MP Sentinel** CLI commands, organized by common workflows. This document is continuously updated to reflect the latest features and improvements.

---

## 🔍 1. Local Development Workflow (Local Review)
Audit your code directly on your machine before pushing to a remote branch.

### Interactive Mode (Picker) - ⭐️ Recommended
Renders a high-performance interactive checkbox UI in your terminal, allowing you to hand-pick specific commits for review.
```bash
npx mp-sentinel review --local --interactive
# Shorthand:
npx mp-sentinel -l -i
```

### Mixed Uncommitted Mode
Combines **uncommitted changes** (Working tree: both Staged & Unstaged files) and **recent commits** into a single audit report. Ideal for getting instant AI feedback while you are still coding.
```bash
npx mp-sentinel review --local --include-uncommitted
```

### Branch-Diff with Auto-Fetch (Sync Base)
Compares your current feature branch against the base branch (e.g., `main`). The `--fetch` flag silently synchronizes (`git fetch`) the remote base to ensure your comparison is always accurate.
```bash
npx mp-sentinel review --local --branch-diff --fetch

# Use a different base branch (default is origin/main):
npx mp-sentinel review --local --branch-diff --fetch --compare-branch origin/develop
```

### Audit Specific Number of Recent Commits
```bash
npx mp-sentinel review --local --commits 3  # Audits the last 3 commits
```

---

## 📚 2. Source Indexing Workflow
Build and manage source index cache for enhanced AI context and faster reviews.

### Build Index Cache
Create or update the source index cache for your project. The index parses JS/TS files to extract symbols, imports, and exports for better AI understanding.
```bash
npx mp-sentinel indexing

# Force rebuild even if cache is up-to-date:
npx mp-sentinel indexing --force

# Output results as JSON (for automation/CI):
npx mp-sentinel indexing --index-format json

# Show index statistics (builds or updates index first):
npx mp-sentinel indexing --stats

# Show symbol and dependency info for a specific file:
npx mp-sentinel indexing --explain src/utils/git.ts
```

### Automation-Friendly Usage
For CI/CD or scripts that need to parse output, use `--index-format json` and call the CLI directly (not via `npm run`) to avoid npm banners:
```bash
# Direct CLI call (recommended for automation)
node dist/index.js indexing --index-format json --force

# Alternative: npm run with --silent flag
npm run --silent indexing -- --index-format json --force
```

**Note:** Avoid `npm run indexing` for automation as npm prints banners that interfere with JSON parsing.

### Configure Indexing in `.mp-sentinelrc.json`
```json
{
  "indexing": {
    "enabled": true,
    "languages": ["typescript", "tsx", "javascript", "jsx"],
    "cachePath": ".mp-sentinel-cache/source-index.json",
    "maxFileSize": 512000
  }
}
```

**Important:** The `indexing.enabled` flag only controls whether the `review` command uses the cached index for enhanced AI context. The `indexing` command itself always builds the cache when invoked directly, regardless of this setting. This means you can safely set `"enabled": false` to disable indexing during reviews without affecting your ability to generate or update the cache.

---

## 🤖 3. Create Skills Workflow
Generate agent/IDE skill files from the source index so AI agents (Claude, Cursor, Codex, Windsurf, etc.) load project context automatically.

### Interactive Agent Picker
Auto-detects existing agent folders and shows a multi-select UI.
```bash
npx mp-sentinel create-skills
```

### Generate for Specific Agents
```bash
npx mp-sentinel create-skills --agent claude
npx mp-sentinel create-skills --agent claude,cursor
```

### Generate for All Agents
```bash
npx mp-sentinel create-skills --all-agents
```
> `--all-agents` generates for the 6 primary adapters: `claude`, `cursor`, `codex`, `windsurf`, `antigravity`, `cline`. `generic` is excluded — use `--agent generic` to target it explicitly. From v1.0.17, `codex` and `antigravity` write to suffixed directories under `.agents/skills/` and no longer collide.

### Overwrite Existing Files
By default, `create-skills` refuses to overwrite. Use `--force` to allow it.
```bash
npx mp-sentinel create-skills --agent claude --force
```

### Preview Without Writing (Dry Run)
```bash
npx mp-sentinel create-skills --all-agents --dry-run
npx mp-sentinel create-skills --all-agents --dry-run --format json
```
Actions: `create` | `skip` | `overwrite` | `conflict` (path already claimed by another adapter in the batch).

### CI Staleness Check
```bash
npx mp-sentinel create-skills --agent claude --check
npx mp-sentinel create-skills --all-agents --check --format json
# exits 0 = up-to-date, 1 = stale/missing/quality-error, 2 = runtime error
```
Statuses: `up-to-date` | `stale` | `missing` | `wrong-agent`.

Quality gate (v1.0.14+): deterministic checks on all generated content. Quality errors fail `--check`; warnings are informational. JSON outputs include `quality` field. v1.0.16+ adds agent workflow contract verification (requires workflow to direct agents to read skills and use indexing diagnostics) and index fidelity signals (instruction file presence in staleness hash).

### Migration Diagnostics (v1.0.18+)
`create-skills` detects legacy generated files from pre-v1.0.17 paths (Codex at `.agents/rules/`, Antigravity at `.antigravity/rules/`) and reports them as advisories. Legacy files are never deleted automatically.
```bash
# Legacy advisories appear in console output:
npx mp-sentinel create-skills --all-agents --dry-run

# JSON output includes legacyFiles when legacy files exist:
npx mp-sentinel create-skills --all-agents --dry-run --format json
```

### Automation-Friendly Usage
`--format json` requires `--agent` or `--all-agents` to keep stdout parse-safe.
```bash
npx mp-sentinel create-skills --agent claude --format json
node dist/index.js create-skills --agent claude,cursor --format json
```

### Use Existing Index Cache Only
Skip the auto-index step. Fails if no cache is found.
```bash
npx mp-sentinel create-skills --agent claude --skip-index-refresh
```

### AI-Enriched Skills
When `createSkills.ai.enabled` is set in config, generated skills include version-aware dependency rules from the configured provider/model. Use `--no-ai-enrich` to force deterministic index-only output for one run.
```bash
npx mp-sentinel create-skills --agent claude --no-ai-enrich
```

**Supported agents:** `claude` | `cursor` | `codex` | `windsurf` | `antigravity` | `cline` | `generic`

`create-skills` automatically refreshes the index when manifest inputs (`package.json`, `tsconfig*.json`, lockfile identity) change, even if source files are unchanged. This ensures generated profile rules always reflect the current scripts, `bin`, dependencies, and framework signals.

See [docs/CREATE_SKILLS.md](CREATE_SKILLS.md) for full documentation.

---

## 🛡 4. CI/CD & Security Scan Workflow

### Target Branch Comparison (PR Default)
Automatically detects relevant code changes between your branch and the target branch. This is the default mode used in GitHub Actions and GitLab CI.
```bash
npx mp-sentinel review

# Explicitly set the target branch (e.g., for release branches):
npx mp-sentinel review --target-branch origin/release
```

### Machine-Readable Output (JSON / Markdown)
Perfect for CI pipelines that need to parse data or automatically comment findings back to a Pull Request.
```bash
npx mp-sentinel review --format json --quiet
npx mp-sentinel review --format markdown
```

### Dry-run & Token Estimation (Cost Guard)
Verify character counts and estimate token usage **without making actual AI calls**. Helps prevent quota depletion and ensures files aren't being truncated by guardrails.
```bash
# General summary
npx mp-sentinel review --dry-run

# Detailed per-file token breakdown
npx mp-sentinel review --verbose-dry-run

# Combine with local review
npx mp-sentinel review --local -i --verbose-dry-run
```

### Explain Context Mode (Diagnostics)
Show context building details without making any AI calls — useful for debugging what the review context contains:
```bash
npx mp-sentinel --explain-context
npx mp-sentinel --explain-context --format json
npx mp-sentinel --explain-context --format json --files src/cli/review.ts
```

Displays index availability, profile detection, related files, relation types (`changed`, `import`, `dependent`, `hub`, `public-api`, `test-gap`, `dependency`, `risk`), intelligence signals, and a preview of the generated context. Pure diagnostic — no AI calls are made.

---

## 🎯 5. Advanced Power-User Workflow

### Target Specific Groups of Files
```bash
# Audit ONLY staged files (files added with 'git add')
npx mp-sentinel review --staged

# Audit a single specific commit hash
npx mp-sentinel review --commit 9f31a4c

# Explicitly audit a list of file paths
npx mp-sentinel review --files src/index.ts src/utils/git.ts
```

### Guardrails, Fetching, and Caching Control
Caching is enabled by default based on `hash(systemPrompt + payload)`. Use these flags to override behavior:
```bash
# Disable skills.sh connection (For Air-Gapped/Offline environments)
npx mp-sentinel review --no-skills-fetch

# Override Token Window limit (Manual control for model upgrades)
npx mp-sentinel review --token-limit 256000

# Increase concurrency for ultra-fast multi-file scanning (Default is 5)
npx mp-sentinel review --concurrency 10
```

---

*✨ Pro-tip: Add these as scripts in your `package.json` for shorter commands (e.g., `npm run audit` instead of the full npx command).*
