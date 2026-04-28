# `create-skills` — Generate Agent/IDE Skill Files

`mp-sentinel create-skills` generates structured best-practices files from your source index for AI agents and IDEs. Each supported agent gets its own adapter that places files exactly where that agent reads them.

---

## Quick Start

```sh
# Interactive picker (auto-detects existing agent folders)
npx mp-sentinel create-skills

# Generate for specific agents
npx mp-sentinel create-skills --agent claude,cursor

# Generate for all supported agents
npx mp-sentinel create-skills --all-agents

# Overwrite existing files
npx mp-sentinel create-skills --agent claude --force

# JSON output for automation (requires --agent or --all-agents)
npx mp-sentinel create-skills --agent claude --format json
```

---

## Supported Agents

| ID | Label | Detection | Default output path |
|----|-------|-----------|---------------------|
| `claude` | Claude Code | `.claude/` exists | `.claude/skills/<project>-best-practices/SKILL.md` + `references/*.md` |
| `cursor` | Cursor | `.cursor/` exists | `.cursor/rules/<project>-best-practices.mdc` |
| `codex` | Codex / OpenAI | `.codex/` or `.agents/` exists | `.agents/skills/<project>-codex-best-practices/SKILL.md` |
| `windsurf` | Windsurf | `.windsurf/` exists | `.windsurf/rules/<project>-best-practices.md` |
| `antigravity` | Google Antigravity | `.antigravity/` or `.agent/` exists | `.agents/skills/<project>-antigravity-best-practices/SKILL.md` |
| `cline` | Cline | `.clinerules/` exists | `.clinerules/<project>-best-practices.md` |
| `generic` | Generic (fallback) | never auto-detected | `.agents/rules/<project>-best-practices.md` |

### Official Adapter Layouts (v1.0.17+)

Each adapter declares an `AdapterSpec` with the official layout verified against the target agent/IDE documentation:

| Adapter | Kind | Workspace | Source |
|---------|------|-----------|--------|
| `claude` | skill | `.claude/skills/{projectName}-best-practices/` | [Claude Code Skills](https://docs.anthropic.com/en/docs/claude-code/skills) |
| `codex` | skill | `.agents/skills/{projectName}-codex-best-practices/` | [Codex Skills](https://codex.openai.com/docs/skills) |
| `antigravity` | skill | `.agents/skills/{projectName}-antigravity-best-practices/` | [Antigravity Skills](https://antigravity.google/docs/skills) |
| `cursor` | rule | `.cursor/rules/{projectName}-best-practices.mdc` | [Cursor Rules](https://docs.cursor.com/context/rules-for-ai) |
| `windsurf` | rule | `.windsurf/rules/{projectName}-best-practices.md` | [Windsurf Rules](https://docs.windsurf.com/rules) |
| `cline` | rule | `.clinerules/{projectName}-best-practices.md` | [Cline Rules](https://docs.cline.bot/rules) |
| `generic` | rule | `.agents/rules/{projectName}-best-practices.md` | — (fallback) |

> **`--all-agents`** generates for the 6 primary adapters: `claude`, `cursor`, `codex`, `windsurf`, `antigravity`, `cline`. The `generic` adapter is excluded from `--all-agents` — use `--agent generic` to target it explicitly.

### Migration Notes (v1.0.17)

- **Antigravity**: Output moved from `.antigravity/rules/<project>-best-practices.md` to `.agents/skills/<project>-antigravity-best-practices/SKILL.md`. Old files are not deleted automatically.
- **Codex**: Output moved from `.agents/rules/<project>-best-practices.md` to `.agents/skills/<project>-codex-best-practices/SKILL.md`. Old files are not deleted automatically.
- Folder names are suffixed (`-codex-best-practices`, `-antigravity-best-practices`) to prevent collisions under `.agents/skills/`.

### Legacy File Detection (v1.0.18+)

`create-skills` automatically detects legacy generated files left over from pre-v1.0.17 paths:

- **Detected**: `.agents/rules/<project>-best-practices.md` with `@mp-sentinel-generated` metadata → advisory for `codex`.
- **Detected**: `.antigravity/rules/<project>-best-practices.md` with `@mp-sentinel-generated` metadata → advisory for `antigravity`.
- **Ignored**: Files at those paths without mp-sentinel metadata (user-authored files are never flagged).
- **Never deleted**: Legacy files are advisory-only. Delete them manually after confirming new official skills exist.

Legacy advisories appear in all output modes (console warns, JSON includes `legacyFiles` field) but do **not** cause `--check` to fail. See `--format json` for structured legacy file information.

**v1.9.1+:** Legacy advisories are grouped by agent in `recommendedActions` and console output. The full per-file list is preserved in the JSON `legacyFiles` field. `agent:skills:check` also groups legacy advisories instead of repeating per-file messages.

---

## Auto-Detection

When you run `create-skills` without `--agent` or `--all-agents`, the command:

1. Scans the project root for known agent folders (`.claude/`, `.cursor/`, `.windsurf/`, `.codex/`, `.agents/`, `.antigravity/`, `.agent/`, `.clinerules/`).
2. Pre-selects detected agents in the interactive picker.
3. If no known folder is found and the terminal is interactive, shows all options with `claude` pre-selected.
4. If no TTY is available (non-interactive), falls back to detected agents or `claude` + `generic`.

### Detection Contract (v1.6.0+)

| Signal | Detects |
|--------|---------|
| `.claude/` exists | Claude Code |
| `.cursor/` exists | Cursor |
| `.codex/` or `.agents/` exists | Codex / OpenAI |
| `.windsurf/` exists | Windsurf |
| `.antigravity/` or `.agent/` exists | Google Antigravity |
| `.clinerules/` exists | Cline |

- Root `CLAUDE.md` alone does **not** detect Claude.
- Root `AGENTS.md` alone does **not** detect Codex.
- Generic is never auto-detected — only selected explicitly via `--agent generic`.

### Diagnostic: Explain Agent Detection (v1.6.0+)

Use `--explain-agents` to see exactly which agents are detected, why, and what output paths they resolve to — without writing any files, building the source index, or calling AI.

```sh
# Human-readable console output
npx mp-sentinel create-skills --explain-agents

# JSON output (no --agent / --all-agents required)
npx mp-sentinel create-skills --explain-agents --format json
```

JSON shape:

```json
{
  "projectName": "my-project",
  "defaultSelection": ["claude", "cline"],
  "agents": [
    {
      "id": "claude",
      "label": "Claude Code (.claude/skills/)",
      "detected": true,
      "selected": true,
      "detectionSignals": [".claude/ exists"],
      "outputKind": "skill",
      "workspacePath": ".claude/skills/{projectName}-best-practices/",
      "resolvedOutput": ".claude/skills/my-project-best-practices/SKILL.md",
      "officialDocsUrl": "https://docs.anthropic.com/en/docs/claude-code/skills"
    }
  ]
}
```

`--explain-agents` is a pure diagnostic — it never writes files, never builds the index, and never calls AI. JSON mode is allowed without `--agent` or `--all-agents`.

---

## Auto-Index Behavior

`create-skills` always ensures a valid source index exists before generating:

- **Default:** builds or refreshes the index using `buildSourceIndex()` (same as `mp-sentinel indexing`).
- **`--skip-index-refresh`:** uses the existing cache only. Fails with exit code `2` if no cache is present.

The generated content is richest when a schema `1.2` index is available (dependency graph, hub files, import/export metadata, and codebase insights).

`create-skills` auto-refreshes the index when manifest inputs (`package.json`, `tsconfig*.json`, lockfile identity) change, even if source files are unchanged. This ensures profile skills always reflect the current scripts, `bin`, dependencies, and framework signals.

---

## AI Enrichment

By default, generated skills are deterministic and use only the source index. If you enable `createSkills.ai`, `create-skills` asks the configured AI provider to add version-aware dependency rules based on `package.json` versions and the indexed codebase.

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

Supported providers: `gemini`, `openai`, `anthropic`, `grok`. Invalid provider names fail with exit code `2`; they are never silently ignored.

Use `--no-ai-enrich` to temporarily generate deterministic index-only skills even when config enables AI:

```sh
npx mp-sentinel create-skills --agent claude --no-ai-enrich
```

`--check` compares enrichment metadata too, so skills become stale if AI enrichment is enabled/disabled or if provider, model, prompt version, input hash, or output hash changes.

---

## Output Content

Every adapter generates content derived from the source index and `SkillKnowledgeBase`:

| Section | Description |
|---------|-------------|
| **Overview** | Project name, version, frameworks, package manager, file count |
| **Architecture** | Top-level directories with file counts; graph stats (schema 1.2) |
| **Hub Files** | Files imported by the most other files (schema 1.2) |
| **Module Map** | Per-directory breakdown with key exported symbols |
| **Codebase Map** | Module ownership (dominant role, key files, key symbols, import/export dirs) + entrypoints (CLI, commands, public API, config) |
| **Testing Map** | Test-to-source associations, test gaps (source files without test coverage), most-tested modules |
| **Dependencies** | Top 20 external dependencies with versions from `package.json` + optional AI-enriched rules |
| **Public API** | Entry points + risk surface (default exports, re-exports, dynamic imports, type-only imports, hub files) |
| **Profile Rules** | Project-specific rules derived from manifest: real scripts, `bin`, dependencies, framework signals, import conventions, and profile-specific review pitfalls |
| **AI Enrichment** | Optional version-aware dependency rules from the configured AI provider |

### Claude output structure

```
.claude/skills/<project>-best-practices/
  SKILL.md                    ← frontmatter + overview + 7 references
  references/
    architecture.md           ← Architecture + Hub Files sections
    modules.md                ← Module Map section
    commands.md               ← Commands + Conventions sections
    codebase-map.md           ← Module Ownership + Entrypoints tables
    testing-map.md            ← Test Associations + Test Gaps + Most Tested Modules
    dependencies.md           ← Top Dependencies (always present; AI enrichment appended when active)
    public-api.md             ← Entry Points + Risk Surface tables
```

### Cline output structure

```
.clinerules/<project>-best-practices.md   ← single markdown file
```

### Codex / Antigravity output structure

```
.agents/skills/<project>-codex-best-practices/
  SKILL.md                    ← YAML frontmatter (name, description) + all sections inline

.agents/skills/<project>-antigravity-best-practices/
  SKILL.md                    ← YAML frontmatter (name, description) + all sections inline
```

### Other adapters (Cursor, Windsurf, Cline, Generic)

Single markdown (`.md` / `.mdc`) file containing all sections.

---

## Overwrite Protection

By default, `create-skills` refuses to overwrite existing output files and returns exit code `1`.
Pass `--force` to overwrite.

```sh
npx mp-sentinel create-skills --agent claude --force
```

---

## Dry Run

`--dry-run` previews what would happen without writing any files.

```sh
npx mp-sentinel create-skills --all-agents --dry-run
npx mp-sentinel create-skills --all-agents --dry-run --format json
```

Each file entry has one of these actions:

| Action | Meaning |
|--------|---------|
| `create` | File does not exist — would be created |
| `skip` | File exists and `--force` is not set — would be skipped |
| `overwrite` | File exists and `--force` is set — would be overwritten |
| `conflict` | Another adapter in the same batch already claimed this output path |

JSON shape:
```json
{
  "dryRun": [
    {
      "agent": "claude",
      "label": "Claude Code (.claude/skills/)",
      "files": [
        { "outputPath": ".claude/skills/my-project-best-practices/SKILL.md", "action": "create" }
      ]
    }
  ]
}
```

---

## Check Mode (CI Staleness Gate)

`--check` verifies that generated skill files match the current source index without regenerating them.

```sh
npx mp-sentinel create-skills --agent claude --check
npx mp-sentinel create-skills --all-agents --check --format json
# exits 0 = all up-to-date, 1 = any stale or missing, 2 = runtime error
```

Each file entry has one of these statuses:

| Status | Meaning |
|--------|---------|
| `up-to-date` | File exists and `sourceIndexHash` matches current index |
| `stale` | File exists but hash has changed since generation |
| `missing` | File does not exist |
| `wrong-agent` | File exists with correct hash but `agent` field in the header belongs to a different adapter |

JSON shape:
```json
{
  "check": [
    {
      "agent": "claude",
      "label": "Claude Code (.claude/skills/)",
      "files": [
        { "outputPath": ".claude/skills/my-project-best-practices/SKILL.md", "status": "up-to-date" }
      ]
    }
  ],
  "status": "ok"
}
```

### Quality Gate (v1.0.14+)

Every generated file undergoes deterministic quality validation. Quality issues are reported in all modes:

- **Console mode**: Errors logged as warnings, warnings as info
- **JSON mode**: `quality` field present in all output objects
- **`--check` mode**: Quality **errors** cause exit code 1 (files are treated as stale). Warnings are informational only.

Quality checks include: max file size, required H2 sections, required references (Claude), duplicate sections, empty sections (warning), unknown paths (warning), and the **agent workflow contract** (error — requires workflow to instruct reading skill/rules and using indexing diagnostics).

### Index Fidelity (v1.0.16+)

`--check` staleness detection now includes instruction file presence (`AGENTS.md`, `CLAUDE.md`, `.cursor/rules`, `.clinerules`, etc.) in the deterministic hash. Adding or removing instruction files after skill generation causes `--check` to correctly report stale.

---

## Automation / CI

Use `--agent` (or `--all-agents`) with `--format json` for machine-readable output. JSON is written to stdout; all log messages go to stderr.

```sh
# CI-friendly JSON output
npx mp-sentinel create-skills --agent claude,cursor --format json

# Direct CLI call avoids npm banners
node dist/index.js create-skills --agent claude --format json
```

JSON shape:
```json
{
  "results": [
    {
      "agent": "claude",
      "label": "Claude Code (.claude/skills/)",
      "outputPaths": [".claude/skills/my-project-best-practices/SKILL.md", "…"],
      "skipped": false
    }
  ]
}
```

On error:
```json
{ "status": "ERROR", "error": "…message…" }
```

---

## Doctor Diagnostic (v1.7.0+)

`--doctor` performs a read-only health check covering agent detection, source index cache status, skill file freshness, quality gate results, legacy files, and npm script availability. No file writes, no AI calls, no auto-indexing.

```sh
# Console output grouped by severity
npx mp-sentinel create-skills --doctor

# JSON output for CI health checks
npx mp-sentinel create-skills --doctor --format json
```

**Exit codes:** `0` = healthy (no fail items; warn items may exist), `1` = action required (fail items exist), `2` = error (corrupt/unreadable index).

**Console sections:** `[fail] Action Required`, `[warn] Advisory`, `[ok] Healthy`. Non-detected agents are neutral and appear in `[ok]` as "not detected".

### JSON Shape (v1.8.0+)

```json
{
  "status": "action-required",
  "projectName": "mp-sentinel",
  "agents": [ { "id": "claude", "detected": true, ... } ],
  "index": { "status": "missing", "reason": "..." },
  "skills": [ { "agent": "claude", "status": "unverifiable", "files": [], ... } ],
  "legacyFiles": [],
  "scripts": [ { "name": "agent:skills:check", "status": "available", ... } ],
  "recommendedActions": [
    "Run \"mp-sentinel indexing\" to build the source index at \".mp-sentinel-cache/source-index.json\"."
  ],
  "recommendedCommands": [
    "mp-sentinel indexing"
  ]
}
```

`recommendedActions` (human-readable) and `recommendedCommands` (machine-runnable) follow this command policy:

| Condition | Command |
|-----------|---------|
| Missing index | `mp-sentinel indexing` |
| Stale index (no manifestHash) | `mp-sentinel indexing --force` |
| Stale/missing/wrong-agent skills | `npm run agent:skills:refresh` (if script exists), else `mp-sentinel create-skills --all-agents --force` |
| Quality errors | (action text only, no automated command) |
| Legacy files, missing scripts | Advisory only (warn, not fail) |

`recommendedCommands` is deduplicated and ordered (index first, then skills).

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success — all selected adapters generated successfully (or all files up-to-date in `--check` mode). **Doctor:** no fail items (warn items may exist) |
| `1` | **Generate mode:** all outputs were skipped (files exist, `--force` not set). **Check mode:** any file is stale, missing, wrong-agent, or has quality errors. **Doctor:** fail items exist |
| `2` | Runtime error (bad agent id, missing cache with `--skip-index-refresh`, etc.). **Doctor:** corrupt/unreadable index |

---

## Adding a New Adapter

1. Create `src/services/skills-generator/adapters/<name>.adapter.ts` implementing `AgentAdapter`.
2. Register it in `src/services/skills-generator/registry.ts` (add to `ADAPTER_REGISTRY`).
3. Add to the `AgentAdapterId` union in `src/types/index.ts`.
4. Write detection + output path tests in `src/__tests__/create-skills.test.ts`.
5. Update this document and `docs/COMMANDS_CHEAT_SHEET.md`.
