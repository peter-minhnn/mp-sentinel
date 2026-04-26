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
| `codex` | Codex / OpenAI | `.codex/` or `.agents/` exists | `.agents/rules/<project>-best-practices.md` |
| `windsurf` | Windsurf | `.windsurf/` exists | `.windsurf/rules/<project>-best-practices.md` |
| `antigravity` | Google Antigravity | `.antigravity/` or `.agent/` exists | `.antigravity/rules/<project>-best-practices.md` |
| `cline` | Cline | `.clinerules/` exists | `.clinerules/<project>-best-practices.md` |
| `generic` | Generic (fallback) | never auto-detected | `.agents/rules/<project>-best-practices.md` |

> **`--all-agents`** generates for the 6 primary adapters: `claude`, `cursor`, `codex`, `windsurf`, `antigravity`, `cline`. The `generic` adapter is excluded because it writes to the same path as `codex` (`.agents/rules/`) — use `--agent generic` to target it explicitly.

---

## Auto-Detection

When you run `create-skills` without `--agent` or `--all-agents`, the command:

1. Scans the project root for known agent folders (`.claude/`, `.cursor/`, `.windsurf/`, `.codex/`, `.agents/`, `.antigravity/`, `.agent/`, `.clinerules/`).
2. Pre-selects detected agents in the interactive picker.
3. If no known folder is found and the terminal is interactive, shows all options with `claude` pre-selected.
4. If no TTY is available (non-interactive), falls back to detected agents or `claude` + `generic`.

---

## Auto-Index Behavior

`create-skills` always ensures a valid source index exists before generating:

- **Default:** builds or refreshes the index using `buildSourceIndex()` (same as `mp-sentinel indexing`).
- **`--skip-index-refresh`:** uses the existing cache only. Fails with exit code `2` if no cache is present.

The generated content is richer when a schema `1.1` index is available (includes dependency graph, hub files, and import edges).

`create-skills` auto-refreshes the index when manifest inputs (`package.json`, `tsconfig*.json`, lockfile identity) change, even if source files are unchanged. This ensures profile skills always reflect the current scripts, `bin`, dependencies, and framework signals.

---

## Output Content

Every adapter generates content derived from the source index:

| Section | Description |
|---------|-------------|
| **Overview** | Project name, version, frameworks, package manager, file count |
| **Architecture** | Top-level directories with file counts; graph stats (schema 1.1) |
| **Hub Files** | Files imported by the most other files (schema 1.1 only) |
| **Module Map** | Per-directory breakdown with key exported symbols |
| **Profile Rules** | Project-specific rules derived from manifest: real scripts, `bin`, dependencies, framework signals, import conventions, and profile-specific review pitfalls |

### Claude output structure

```
.claude/skills/<project>-best-practices/
  SKILL.md                    ← frontmatter + overview + references
  references/
    architecture.md           ← Architecture + Hub Files sections
    modules.md                ← Module Map section
    commands.md               ← Commands + Conventions sections
```

### Cline output structure

```
.clinerules/<project>-best-practices.md   ← single markdown file
```

### Other adapters (Cursor, Codex, Windsurf, Antigravity, Generic)

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

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success — all selected adapters generated successfully (or all files up-to-date in `--check` mode) |
| `1` | **Generate mode:** all outputs were skipped (files exist, `--force` not set). **Check mode:** any file is stale, missing, or wrong-agent |
| `2` | Runtime error (bad agent id, missing cache with `--skip-index-refresh`, etc.) |

---

## Adding a New Adapter

1. Create `src/services/skills-generator/adapters/<name>.adapter.ts` implementing `AgentAdapter`.
2. Register it in `src/services/skills-generator/registry.ts` (add to `ADAPTER_REGISTRY`).
3. Add to the `AgentAdapterId` union in `src/types/index.ts`.
4. Write detection + output path tests in `src/__tests__/create-skills.test.ts`.
5. Update this document and `docs/COMMANDS_CHEAT_SHEET.md`.
