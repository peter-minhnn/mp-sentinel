# 🚀 MP Sentinel Commands Cheat Sheet

A quick reference guide for all **MP Sentinel** CLI commands, organized by common workflows. This document is continuously updated to reflect the latest features and improvements.

---

## 🔍 1. Local Development Workflow (Local Review)
Audit your code directly on your machine before pushing to a remote branch.

### Interactive Mode (Picker) - ⭐️ Recommended
Renders a high-performance interactive checkbox UI in your terminal, allowing you to hand-pick specific commits for review.
```bash
npx mp-sentinel --local --interactive
# Shorthand:
npx mp-sentinel -l -i
```

### Mixed Uncommitted Mode
Combines **uncommitted changes** (Working tree: both Staged & Unstaged files) and **recent commits** into a single audit report. Ideal for getting instant AI feedback while you are still coding.
```bash
npx mp-sentinel --local --include-uncommitted
```

### Branch-Diff with Auto-Fetch (Sync Base)
Compares your current feature branch against the base branch (e.g., `main`). The `--fetch` flag silently synchronizes (`git fetch`) the remote base to ensure your comparison is always accurate.
```bash
npx mp-sentinel --local --branch-diff --fetch

# Use a different base branch (default is origin/main):
npx mp-sentinel --local --branch-diff --fetch --compare-branch origin/develop
```

### Audit Specific Number of Recent Commits
```bash
npx mp-sentinel --local --commits 3  # Audits the last 3 commits
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

# Show per-file symbols, imports, and dependency edges:
npx mp-sentinel indexing --explain-index src/utils/git.ts

# Search index for symbols (functions, classes, interfaces, etc.):
npx mp-sentinel indexing --find-symbol buildSourceIndex --index-format json

# Search index for files importing a package or path:
npx mp-sentinel indexing --find-import zod --index-format json

# AI-agent context pack: symbols, imports, dependents, hub files, suggested commands (v1.15.0+):
npx mp-sentinel indexing --agent-context src/commands/indexing.ts --index-format json

# Index health check — read-only diagnostic (v1.19.0+):
npx mp-sentinel indexing --health --index-format json

# Parser recovery drilldown — list files recovered via chunked-tree-sitter, ascii-fallback, or lexical-fallback (v1.22.0+):
npx mp-sentinel indexing --recovered --index-format json

# Hard parse error drilldown — list files with hard parse errors (v1.22.0+):
npx mp-sentinel indexing --parse-errors --index-format json

# JSON output with import classification (v1.11.0+):
npx mp-sentinel indexing --explain-index src/commands/indexing.ts --index-format json
```
Imports are classified as `internal` (resolved to another source file in the index), `local` (unresolved but with a local-looking path), or `external` (package/remote). The `--explain` alias is preserved for backward compatibility.

`--health` is a read-only diagnostic that examines cache integrity without building or calling AI. It reports cache status (`ok`, `missing`, `unreadable`, `stale`), schema version, file count, parse error rate, manifest hash comparison, and samples of changed or missing files. Exit codes: `0` = healthy, `1` = missing/stale/unreadable, `2` = error. JSON mode emits the health payload to stdout; all logs go to stderr.

`--recovered` and `--parse-errors` are read-only parser drilldown commands (v1.22.0+). `--recovered` lists files recovered via fallback parser (`chunked-tree-sitter`, `ascii-fallback`, or `lexical-fallback`), with per-file parser mode, symbol/import/export counts, optional role, and `suggestedCommands` (v1.24.0+). `--parse-errors` lists files with hard parse errors, with per-file error messages, symbol/import/export counts, optional role, and `suggestedCommands` (v1.24.0+). Both output JSON to stdout (all logs to stderr), cap files at 50 sorted by path, exit `0` on success, and exit `1` when cache is missing or unreadable. The two flags cannot be used together.

### Health → Drilldown Workflow (v1.23.0+)
Start with a health check to see if parser issues exist, then drill into specifics.
```bash
# Step 1: Check health — look for recoveredFiles > 0 or parseErrorCount > 0
npx mp-sentinel indexing --health --index-format json

# Step 2: If recoveredFiles > 0, list recovered files
npx mp-sentinel indexing --recovered --index-format json

# Step 2 (alternative): If parseErrorCount > 0, list files with hard parse errors
npx mp-sentinel indexing --parse-errors --index-format json
```
The health JSON output includes `suggestedCommands` with drilldown command recommendations when `recoveredFiles > 0` or `parseErrorCount > 0`. The doctor diagnostic surfaces drilldown commands in `index.suggestedCommands` when parser issues exist (advisory for recovered-only, action-required for hard parse errors). Only hard parse error drilldowns (`--parse-errors`) appear in top-level `recommendedCommands`.

Each file entry in drilldown output includes `suggestedCommands` (v1.24.0+) with `--explain-index` and `--agent-context` commands pointing to that file, enabling agents to get per-file dependency and symbol diagnostics directly.

`--find-symbol`, `--find-import`, and `--agent-context` are read-only queries that use the existing source index cache (building/updating it only if absent). `--find-symbol` searches for functions, classes, interfaces, types, enums, variables, methods, and arrow functions by exact or partial name. `--find-import` searches for files that import a given package or local path. Both return results capped at 20 entries, sorted by match score (exact > case-insensitive > starts-with > contains).

`--agent-context` produces an AI-agent-friendly context pack for a file: symbols (capped 30), imports/exports (capped 20), direct imports and dependents (capped 10 each), top hub files among related (capped 5), and suggested diagnostic follow-up commands. Output is capped aggressively — no file contents are included.

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
When `createSkills.ai.enabled` is set in config, generated skills include version-aware dependency rules from the configured provider/model and project `rules` in `.mp-sentinelrc.json`. If provider/model/key readiness fails, enrichment is skipped and deterministic skills are still generated. Use `--no-ai-enrich` to force deterministic index-only output for one run.
```bash
npx mp-sentinel create-skills --agent claude --no-ai-enrich
```

### Diagnostic: Explain Agent Detection (v1.6.0+)
Show which agents/IDEs are detected, why, and what output paths they resolve to — without writing files or building the index.
```bash
# Console output
npx mp-sentinel create-skills --explain-agents

# JSON output (no --agent / --all-agents required)
npx mp-sentinel create-skills --explain-agents --format json
```

**Supported agents:** `claude` | `cursor` | `codex` | `windsurf` | `antigravity` | `cline` | `generic`

`create-skills` automatically refreshes the index when manifest inputs (`package.json`, `tsconfig*.json`, lockfile identity) change, even if source files are unchanged. This ensures generated profile rules always reflect the current scripts, `bin`, dependencies, and framework signals.

### Diagnostic: Doctor Health Check (v1.7.0+)
Read-only health check covering agent detection, source index cache, skill freshness, quality gate, legacy files, and npm scripts. No file writes, no AI calls, no auto-indexing.
```bash
# Console output grouped by severity: [fail] / [warn] / [ok]
npx mp-sentinel create-skills --doctor

# JSON output for CI health checks (v1.8.0+ adds recommendedCommands)
npx mp-sentinel create-skills --doctor --format json

# Scope to specific agents
npx mp-sentinel create-skills --doctor --agent claude,cursor
```
**Exit codes:** `0` = healthy, `1` = action required, `2` = error (corrupt index).
**JSON output** includes `recommendedActions` (human-readable) and `recommendedCommands` (machine-runnable, ordered, deduplicated).

See [docs/CREATE_SKILLS.md](CREATE_SKILLS.md) for full documentation.

---

## 🛡 4. CI/CD & Security Scan Workflow

### Target Branch Comparison (PR Default)
Automatically detects relevant code changes between your branch and the target branch. This is the default mode used in GitHub Actions and GitLab CI.
```bash
npx mp-sentinel

# Explicitly set the target branch (e.g., for release branches):
npx mp-sentinel --target-branch origin/release
```

### Machine-Readable Output (JSON / Markdown)
Perfect for CI pipelines that need to parse data or automatically comment findings back to a Pull Request.
```bash
npx mp-sentinel --format json --quiet
npx mp-sentinel --format markdown
```

### Dry-run & Token Estimation (Cost Guard)
Verify character counts and estimate token usage **without making actual AI calls**. Helps prevent quota depletion and ensures files aren't being truncated by guardrails.
```bash
# General summary
npx mp-sentinel --dry-run

# Detailed per-file token breakdown
npx mp-sentinel --verbose-dry-run

# Combine with local review
npx mp-sentinel --local -i --verbose-dry-run
```

### Explain Context Mode (Diagnostics)
Show context building details without making any AI calls — useful for debugging what the review context contains:
```bash
npx mp-sentinel --explain-context
npx mp-sentinel --explain-context --format json
npx mp-sentinel --explain-context --format json --files src/cli/review.ts
```

Displays index availability, profile detection, related files, relation types (`changed`, `import`, `dependent`, `hub`, `public-api`, `test-gap`, `dependency`, `risk`), intelligence signals (both `includedSignals` and structured `intelligenceSignals` with `type`, `file`, `reason`, `evidence`, `confidence`), and a preview of the generated context. Pure diagnostic — no AI calls are made.

---

## 🎯 5. Advanced Power-User Workflow

### Target Specific Groups of Files
```bash
# Audit ONLY staged files (files added with 'git add')
npx mp-sentinel --staged

# Audit a single specific commit hash
npx mp-sentinel --commit 9f31a4c

# Explicitly audit a list of file paths
npx mp-sentinel --files src/index.ts src/utils/git.ts
```

### Guardrails, Fetching, and Caching Control
Caching is enabled by default based on `hash(systemPrompt + payload)`. Use these flags to override behavior:
```bash
# Disable local skills loading (air-gapped/offline environments)
npx mp-sentinel --no-skills-fetch

# Override Token Window limit (Manual control for model upgrades)
npx mp-sentinel --token-limit 256000

# Increase concurrency for ultra-fast multi-file scanning (Default is 5)
npx mp-sentinel --concurrency 10

# Select model tier via env (when AI_MODEL is not set)
AI_MODEL_TIER=premium npx mp-sentinel   # best models for security/architecture reviews
AI_MODEL_TIER=budget npx mp-sentinel    # cheap models for bulk passes
```

---

*✨ Pro-tip: Add these as scripts in your `package.json` for shorter commands (e.g., `npm run audit` instead of the full npx command).*
