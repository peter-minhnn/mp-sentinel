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

By default, generated skills are deterministic and use only the source index. If you enable `createSkills.ai`, `create-skills` asks the configured AI provider to add version-aware dependency rules based on `package.json` versions, the indexed codebase, and project `rules` from `.mp-sentinelrc.json`.

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

Supported providers: `gemini`, `openai`, `anthropic`, `grok`, `openrouter`. Provider, model, and API key readiness are checked before any provider call. If AI is unavailable or unsupported, `create-skills` prints a warning, skips enrichment, and still generates deterministic index-only skills. `create-skills --doctor` reports that state as `aiEnrichment.status = "action-required"` without making network calls.

Anthropic uses `ANTHROPIC_API_KEY` first and also accepts `ANTHROPIC_AUTH_TOKEN` as a fallback alias. For custom Anthropic-compatible endpoints (e.g., DeepSeek), set `ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic` with `AI_MODEL=deepseek-v4-pro`.

Use `--no-ai-enrich` to temporarily generate deterministic index-only skills even when config enables AI:

```sh
npx mp-sentinel create-skills --agent claude --no-ai-enrich
```

`--check` compares enrichment metadata too, so skills become stale if AI enrichment is enabled/disabled or if provider, model, prompt version, input hash, or output hash changes.

### AI Enrichment v2 (generator v2.0.0+)

When AI enrichment is enabled, the prompt is enriched with:

- **`codeSamples`:** Up to 5 source files are selected deterministically (largest non-test file, hub file, test file, component file if present), read from disk, run through the SecurityService secret scrubber, and included in the AI prompt. The `__scrubbed: true` brand on each sample ensures a runtime assertion blocks un-scrubbed content.
- **Language mix:** The LanguageProfile (dominant language, secondary languages, distribution) is passed to the AI provider.
- **Code style profile:** Indent style, quote preference, semicolons, formatter configs, file-size distribution.
- **Clean-code policies:** The configured policy limits (maxFileLines, maxFunctionLines, etc.).

The AI is instructed to return per-language rules (`rulesByLanguage`) and file-cited anti-patterns (`antiPatterns`), not generic advice.

#### --no-code-samples flag

To skip code sample loading (v1-style prompt, less context, useful for data-residency-sensitive environments):

```sh
npx mp-sentinel create-skills --agent claude --no-code-samples
```

When `--no-code-samples` is set, the AI enrichment prompt still receives dependency versions, language mix, and code style profile, but no actual file content.

---

## Output Content

Every adapter generates content derived from the source index and `SkillKnowledgeBase`:

| Section | Description |
|---------|-------------|
| **Overview** | Project name, version, frameworks, package manager, file count, **language distribution** |
| **Architecture** | Top-level directories with file counts; graph stats (schema 1.2) |
| **Hub Files** | Files imported by the most other files (schema 1.2) |
| **Module Map** | Per-directory breakdown with key exported symbols |
| **Codebase Map** | Module ownership (dominant role, key files, key symbols, import/export dirs) + entrypoints (CLI, commands, public API, config) |
| **Testing Map** | Test-to-source associations, test gaps (source files without test coverage), most-tested modules |
| **Dependencies** | Top 20 external dependencies with versions from `package.json` + optional AI-enriched rules |
| **Public API** | Entry points + risk surface (default exports, re-exports, dynamic imports, type-only imports, hub files) |
| **Profile Rules** | Project-specific rules derived from manifest: real scripts, `bin`, dependencies, framework signals, import conventions, and profile-specific review pitfalls |
| **Language & Framework Rules** | Deterministic per-language rules from built-in rule packs (Svelte, Vue, React, Next.js, TypeScript, Python, Go, Rust) |
| **Clean Code Policy** | Configurable limits (maxFileLines, maxFunctionLines, maxParams, maxCyclomaticHint, forbidDefaultExports) |
| **File Size Policy** | Hard limit with current codebase percentiles and observed offender reporting |
| **AI Enrichment** | Optional version-aware dependency rules from the configured AI provider |

### Claude output structure

```
.claude/skills/<project>-best-practices/
  SKILL.md                    ← frontmatter + overview + new sections + 10 references
  references/
    architecture.md           ← Architecture + Hub Files sections
    modules.md                ← Module Map section
    commands.md               ← Commands + Conventions sections
    codebase-map.md           ← Module Ownership + Entrypoints tables
    testing-map.md            ← Test Associations + Test Gaps + Most Tested Modules
    dependencies.md           ← Top Dependencies (always present; AI enrichment appended when active)
    public-api.md             ← Entry Points + Risk Surface tables
    code-style.md             ← Detected code style (indent, quotes, semicolons, formatter configs) — NEW
    language-patterns.md      ← Language distribution + per-language framework rules — NEW
    clean-code-checklist.md   ← Code quality checklist with limits + observed offenders — NEW
```

### Codex / Antigravity output structure

```
.agents/skills/<project>-codex-best-practices/
  SKILL.md                    ← YAML frontmatter (name, description) + all sections inline
  references/
    code-style.md             ← Detected code style
    language-patterns.md      ← Language distribution + framework rules
    clean-code-checklist.md   ← Code quality checklist

.agents/skills/<project>-antigravity-best-practices/
  SKILL.md                    ← YAML frontmatter (name, description) + all sections inline
  references/
    code-style.md             ← Detected code style
    language-patterns.md      ← Language distribution + framework rules
    clean-code-checklist.md   ← Code quality checklist
```

### Single-file rule adapters (Cursor, Windsurf, Cline, Generic)

Single markdown (`.md` / `.mdc`) file containing all sections inline, including the new `## Language & Framework Rules`, `## Clean Code Policy`, and `## File Size Policy` sections.

---

## Configuration — createSkills.policies

Configure clean-code limits in `.mp-sentinelrc.json`:

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

| Key | Default | Description |
|-----|---------|-------------|
| `maxFileLines` | `500` | Hard limit: no file should exceed this line count |
| `warnFileLines` | `350` | Soft warning threshold for file length |
| `maxFunctionLines` | `80` | Maximum lines per function/method body |
| `maxParams` | `5` | Maximum function parameters (use an options object for more) |
| `maxCyclomaticHint` | `12` | Cyclomatic complexity hint threshold |
| `forbidDefaultExports` | `false` | When true, the generated skill instructs agents to use named exports only |

These policies are rendered into `## Clean Code Policy` and `## File Size Policy` sections in the SKILL.md, including any current offenders (files exceeding `maxFileLines`) observed from the CodeStyleProfile.

## Rule Packs (Deterministic, No AI Required)

Eight built-in rule packs activate based on the detected language profile and dependencies. Each pack produces `must`/`should`/`avoid` rules in the `## Language & Framework Rules` SKILL.md section.

| Pack | Activation trigger | Key rules |
|------|-------------------|-----------|
| **Svelte** | `.svelte` files or `svelte` dependency | Imports inside `<script>`, Svelte 5 runes, `lang="ts"`, SvelteKit server/client boundaries |
| **Vue** | `.vue` files or `vue` dependency | `<script setup>`, `defineProps`/`defineEmits`, scoped styles |
| **React** | `react` dependency | Rules of Hooks, no fetch in render, `key` prop, function components |
| **Next.js** | `next` dependency | `'use client'`/`'use server'`, Server Components, `next/image`, route segments |
| **TypeScript (Strict)** | `.ts` or `.tsx` files | `import type`, `.js` extension, `node:` prefix, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` |
| **Python** | `.py` files | Type hints, PEP 8, no top-level side effects, `pathlib`, `async`/`await` |
| **Go** | `.go` files | `gofmt`, error handling, no panics in libraries, `context.Context` |
| **Rust** | `.rs` files | `clippy`, `?` operator over `unwrap()`, `cargo fmt`, derive traits |

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

## Generator Version & --check Staleness

Each generated SKILL.md carries a `generatorVersion` field in its metadata header (distinct from the mp-sentinel package version). The current generator version is **`2.0.0`** — bumped when the generated output schema changes meaningfully.

When `--check` runs, it compares the stored `generatorVersion` against the code's `GENERATOR_VERSION` constant. If they differ, the file is reported as stale with the reason:

```json
{
  "outputPath": ".claude/skills/my-project-best-practices/SKILL.md",
  "status": "stale",
  "reason": "generatorVersionUpgrade",
  "from": "1.0.17",
  "to": "2.0.0",
  "note": "Run mp-sentinel create-skills to regenerate with the v2 layout."
}
```

**To regenerate after a generator version bump:** run `mp-sentinel create-skills --all-agents --force` (or target specific agents with `--agent`).

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

## Agent Workflow-Command Contract

Generated skill files and the `create-skills` quality gate enforce an agent workflow contract. Agents must follow this sequence when working with mp-sentinel projects:

### Required Commands

| Command | Purpose |
|---------|---------|
| `indexing --health` | Check index health: status, version consistency, parser telemetry, suggested commands |
| `indexing --recovered` | List files parsed with recovery modes (chunked, ASCII, lexical fallback) |
| `indexing --parse-errors` | List files with hard parse errors |
| `indexing --agent-context <file>` | Per-file diagnostics: symbols, imports, dependents, parser mode, chunk telemetry |
| `indexing --explain-index <file>` | Full parser diagnostics for a single file |
| `indexing --find-symbol <name>` | Locate a symbol across the index |
| `indexing --find-import <package>` | Find files that import a given package |
| `indexing --stats` | Aggregate index statistics |
| `--explain-context` | Review context diagnostics (available on the root CLI) |

### Workflow Rules

1. **Health first.** Always start with `--health` to assess index state and parser health before touching files. If the index is missing or corrupt, build it first with `indexing` or `indexing --force`.
2. **Drill down when parser issues exist.** If `--health` reports `recoveredFiles > 0` or `parseErrorCount > 0`, inspect with `--recovered` or `--parse-errors` before making code changes. Parser recovery modes (`chunked-tree-sitter`, `ascii-fallback`, `lexical-fallback`) indicate files that may need attention.
3. **Use per-file diagnostics before editing.** Before modifying any file, check its parser state with `--explain-index <file>` or `--agent-context <file>` to understand its parse health and dependency graph.
4. **JSON mode for automation.** All indexing diagnostic commands support `--index-format json` for machine-readable output. Use it in CI and automated workflows.

The quality gate validates that generated skills include this workflow. Missing `--health`, `--recovered`, or `--parse-errors` commands in generated content are hard errors.

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
