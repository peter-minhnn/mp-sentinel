# 🚀 MP Sentinel Commands Cheat Sheet

A quick reference guide for all **MP Sentinel** CLI commands, organized by common workflows. This document is continuously updated to reflect the latest features and improvements.

---

## 💻 1. Local Development Workflow (Local Review)
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

## 🛡 2. CI/CD & Security Scan Workflow

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

---

## 🎯 3. Advanced Power-User Workflow

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
