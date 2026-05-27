# MP Sentinel — Commands Cheat Sheet

## `create-skills` — Generate agent/IDE skill files

| Flag | Description | Default |
|------|-------------|---------|
| `--agent <ids>` | Comma-separated: claude,cursor,codex,windsurf,antigravity,cline,generic | Auto-detect |
| `--all-agents` | Generate for all primary agents (excl. generic) | false |
| `--force` | Overwrite existing files | false |
| `--skip-index-refresh` | Use existing index cache; fail if absent | false |
| `--dry-run` | Preview output without writing | false |
| `--check` | Verify files are up-to-date (exit 0/1) | false |
| `--no-ai-enrich` | Disable AI enrichment | false |
| `--no-code-samples` | Skip code sample loading in AI enrichment | false |
| `--format <fmt>` | Output: `console` or `json` | console |
| `--explain-agents` | Diagnostic: show detected agents | false |
| `--doctor` | Diagnostic: comprehensive health check | false |

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success (or all up-to-date in --check mode) |
| 1 | Skipped (--force not set) / stale (--check) |
| 2 | Runtime error |

## `indexing` — Build source index

| Flag | Description | Default |
|------|-------------|---------|
| `--force` | Rebuild from scratch | false |
| `--health` | Index health diagnostics | false |
| `--recovered` | List files parsed via fallback | false |
| `--parse-errors` | List files with hard parse errors | false |
| `--agent-context <file>` | Per-file diagnostics | - |
| `--explain-index <file>` | Full parser diagnostics | - |
| `--find-symbol <name>` | Locate symbol in index | - |
| `--find-import <pkg>` | Find files importing a package | - |
| `--find-code <query>` | Search indexed code snippets | - |
| `--stats` | Aggregate index statistics | false |
| `--index-format <fmt>` | Output: `console` or `json` | console |

## `review` — Review changes

| Flag | Description | Default |
|------|-------------|---------|
| `--files <paths>` | Explicit file paths to review | auto |
| `--local` | Review local changes | false |
| `--interactive` | Interactive review | false |
| `--format <fmt>` | Output: `console`, `json`, `markdown`, `sarif` | console |
| `--bypass-keyword <kw>` | Staging bypass keyword | skip: |
| `--severity-threshold <lvl>` | FAIL threshold: `CRITICAL`, `WARNING`, `INFO` | WARNING |

## Root CLI

| Flag | Description |
|------|-------------|
| `--explain-context` | Review context diagnostics |
| `--format json` | JSON output for all modes |
| `--quiet` | Suppress non-JSON output |
| `--verbose` | Detailed logging |

## Config (.mp-sentinelrc.json)

### createSkills.policies

```json
{
  "createSkills": {
    "policies": {
      "maxFileLines": 500,
      "warnFileLines": 350,
      "maxFunctionLines": 80,
      "maxParams": 5,
      "maxCyclomaticHint": 12,
      "forbidDefaultExports": false
    }
  }
}
```

### createSkills.ai

```json
{
  "createSkills": {
    "ai": {
      "enabled": true,
      "provider": "openai",
      "model": "gpt-5.2",
      "temperature": 0.2,
      "maxTokens": 4096
    }
  }
}
```
