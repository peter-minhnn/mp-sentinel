# What's New in v1.0.16

## Zero-Warning Skill Generation & Index Fidelity

### Content codebase-awareness

Generated skill content now references real project signals from the source index rather than generic placeholders:

- **Real entrypoints**: CLI entry files and command files from `index.insights.fileRoles` appear in the Overview section.
- **Real scripts**: `package.json` scripts are used directly in the Commands section instead of template placeholders.
- **Real modules**: Module count and entrypoint count reflect actual index data.
- **Instruction files**: Agent Workflow section shows detected instruction files (`AGENTS.md`, `CLAUDE.md`, `.clinerules`, etc.) instead of generic fallback list.

### Agent Workflow Contract (quality gate)

New `agent-workflow-contract` quality check (error severity) enforces that the Required Agent Workflow section:

1. Instructs agents to read the skill file or agent rules before writing code.
2. Directs agents to use indexing diagnostics (`--explain-index`, `--stats`, `--explain-context`) before broad repo scans.

These are mandatory instructions — missing either causes the quality gate to fail.

### Index Fidelity Signals

`computeIndexHash()` now includes **instruction file presence** in its deterministic hash. If instruction files (`AGENTS.md`, `CLAUDE.md`, `.cursor/rules`, `.clinerules`, `.agents/rules`, `.windsurf/rules`, `.codex/rules`, `.antigravity/rules`) are added or removed after skill generation, `--check` correctly detects the mismatch.

### Regression Harness

New fixture-based tests for all 4 project profiles: `cli-tooling`, `library`, `node-service`, `react-next`. Each fixture:

- Builds a real source index with multiple source files, test files, and scripts
- Generates skills for Claude and single-file adapters
- Asserts zero quality errors on generated output
- Asserts that content mentions real project signals (scripts, source directories)

Additional tests cover:
- Adapter output determinism (byte-identical for same index)
- `--check` regression (exit codes correctly reflect quality errors vs. warnings)

---

# What's New in v1.0.15

## Skill Quality Gate v2 — Reduced False Positives & Codebase Fidelity

### Unknown-path allowlist

The quality gate no longer flags valid non-source paths as unknown. Paths like `package.json`, `tsconfig.json`, `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.cursor/`, `.clinerules/`, `.mp-sentinel-cache/source-index.json`, and others are recognized as valid references. Directory references (e.g. `` `src/` ``) and ESM `.js` extensions (which map to `.ts` source files) are also correctly resolved.

### Codebase fidelity checks

New `missing-real-signal` warnings when generated content lacks references to real project signals present in the index:
- CLI entrypoints and command files
- package.json scripts
- Top-level source directories

These warnings are informational — they guide adapter improvements without blocking generation. Reference files are excluded from these checks (only the main skill file is validated).

### Named content caps

All inline `.slice(0, N)` caps in `content.ts` are now named constants: `MAX_TEST_ASSOC_ENTRIES`, `MAX_TEST_GAP_ENTRIES`, `MAX_DEP_TABLE_ENTRIES`, `MAX_DEP_DETAIL_ENTRIES`, `MAX_DEP_FILE_LIST`, `MAX_RISK_ENTRIES`, `MAX_SCRIPT_ENTRIES`, `MAX_IMPORT_FROM_LIST`. Each cap is independently testable and documented.

### Exit code documentation

`docs/CREATE_SKILLS.md` exit code table now explicitly mentions that quality errors cause `--check` to exit `1`.

---

# What's New in v1.0.14

## Skill Quality Gate — Deterministic Content Validation

`create-skills` now runs a deterministic quality gate on all generated skill content before writing files. The gate catches structural issues in generated skills:

- **Max file size**: SKILL.md ≤ 3000 chars, reference files ≤ 6000 chars, single-file adapters ≤ 20000 chars
- **Required sections**: Every file must contain its expected H2 sections (e.g., SKILL.md needs "Required Agent Workflow", "Overview", "References")
- **Required references**: Claude SKILL.md must link exactly 7 `./references/*.md` files
- **No duplicate sections**: Same H2 heading must not appear twice in one file
- **No empty sections**: H2 headings with no body content are flagged as warnings
- **Real path validation**: Backtick-enclosed file paths in generated content are checked against the source index

### How it works

- **Errors** (size limits, missing sections, missing references, duplicate sections) cause `--check` to fail with exit code 1
- **Warnings** (empty sections, unknown paths) are informational only — they appear in console/log output but do not block
- In normal generate mode: quality issues are logged but files are still written
- In JSON mode: quality reports appear in all three output modes (`results[].quality`, `dryRun[].quality`, `check[].quality`)

### Deterministic sorting & line caps

- All list sorts now use stable tie-breakers (path/name as secondary key) for reproducible output
- Hub file detail entries capped at 15 lines; risk detail entries capped at 3 lines
- Dependency versions now display cleaned: `^2.4.2` renders as `2.4.2 (range ^2.4.2)`

### New types

- `QualityCheck`: type, severity (`error` | `warning`), file, message
- `QualityReport`: passed, checks[], errors count, warnings count

---

# What's New in v1.0.13

## Generated Skills Quality v2 — Codebase-Aware Skills

### 1. SkillKnowledgeBase — Structured Codebase Knowledge

`create-skills` now builds a `SkillKnowledgeBase` from the source index — a deterministic, structured view of the codebase that drives all generated content:

- **Module Ownership**: Per-directory breakdown with dominant role, key files, key symbols, and import/export relationships
- **Entrypoints**: CLI entry, commands, public API, and config files surfaced explicitly
- **Testing Map**: Test-to-source associations, test gaps (source files without test coverage), and most-tested modules
- **Dependency Map**: Top 20 external dependencies with actual versions from `package.json` and file-level usage tracking
- **Risk Surface**: Default exports, re-exports, dynamic imports, type-only imports, and hub files (high blast-radius files imported by many others)

All derived deterministically from `SourceIndex` — no AI calls in the knowledge base layer. When `index.insights` is absent, returns a minimal KB with empty arrays (graceful degradation).

### 2. New Reference Files (Claude Adapter)

The Claude adapter now produces **8 files** (was 4):

| File | Content |
|------|---------|
| `SKILL.md` | Frontmatter + updated workflow + overview + 7 references |
| `references/architecture.md` | Architecture + hub files (kept) |
| `references/modules.md` | Module map (kept) |
| `references/commands.md` | Commands + conventions (kept) |
| **`references/codebase-map.md`** | Module ownership + entrypoints tables |
| **`references/testing-map.md`** | Test associations, test gaps, most-tested modules |
| **`references/dependencies.md`** | Top dependencies with versions (always present; AI enrichment appended when active) |
| **`references/public-api.md`** | Entry points + risk surface table |

`dependencies.md` is now **always present** (was conditional on AI enrichment). When AI enrichment is active, version-aware rules are appended to it.

### 3. Enhanced Agent Workflow

The SKILL.md workflow now enforces a progressive-disclosure pattern:

1. Read the skill file itself
2. Read `AGENTS.md` / local rules
3. Use `indexing --explain-index <file>` for touched files
4. Read appropriate references (codebase-map, testing-map, dependencies, public-api)

This ensures agents load only the context relevant to their current task.

### 4. Single-File Adapters Embed Knowledge Base

All 6 single-file adapters (`cursor`, `codex`, `cline`, `windsurf`, `antigravity`, `generic`) now embed condensed versions of the 4 new knowledge base sections (codebase map, testing map, dependencies, public API) directly in their output files. No separate reference files are created — the knowledge is inline.

### 5. Version-Aware AI Enrichment

When `createSkills.ai.enabled` is true, AI enrichment now receives:

- `topDependenciesWithVersions` — actual versions from `package.json`
- `testGapCount`, `defaultExportCount`, `dynamicImportCount`, `hubFileCount` — for richer, codebase-specific recommendations

The enrichment prompt instructs the model to base all recommendations on actual dependency versions, not generic advice.

### 6. Indexing Stats Expansion

`indexing --stats` now shows additional insight counts: default exports, re-exports, type-only imports, dynamic imports, and hub files (files with `importedBy > 1`).

## Documentation

- [Changelog](./docs/CHANGELOG.md) — detailed technical changes per version
- [Create Skills Guide](./docs/CREATE_SKILLS.md) — updated with new Claude output structure (8 files)

## Migration

No breaking changes. All improvements are additive. Existing skill files remain valid; re-run `create-skills` to get the enhanced output. Single-file adapters produce larger files (4 new sections embedded inline), but the CLI interface and exit codes are unchanged.

## Summary

- **Version**: 1.0.13
- **Release Date**: 2026-04-28
- **Builds on**: v1.0.12 diagnostics & CLI hardening

---

# What's New in v1.0.12

## Diagnostics & CLI Hardening

### 1. `--explain-context` Diagnostic Mode

The `review` command now supports a diagnostic-only mode that shows context building details without making any AI calls:

```bash
mp-sentinel --explain-context
mp-sentinel --explain-context --format json --files src/cli/review.ts
```

- Displays index availability, profile detection, related files, and relation types
- Pure diagnostic — never calls any AI provider
- JSON output is valid parseable JSON
- Console output uses ASCII only (no emoji — avoids mojibake on Windows)
- Exit code `0` in all non-error cases (even if no index available)

### 2. CLI Parser Hardening

- **Robust help/version exit detection**: Commander 14 uses `commander.helpDisplayed` / `commander.versionDisplayed` codes. The parser now also handles older `commander.help` / `commander.version` codes defensively, ensuring all help/version related exits return code `0`.
- **Root command action**: Added empty `.action()` handler to prevent Commander 14 from auto-showing help when subcommands are registered but none is provided.

### 3. Version Consistency

All runtime version references now use `process.env.npm_package_version` first, then the installed `mp-sentinel` package metadata, with a consistent `"0.0.0-dev"` final fallback:
- `src/cli/args.ts` — Commander version string
- `src/cli/help.ts` — `showVersion()` output
- `src/services/ai/index.ts` — cache key derivation
- `src/commands/create-skills.ts` — generated file metadata header

This ensures `node dist/index.js --version` matches `package.json` version in production builds and direct local dist smoke tests.

### 4. Backward-Compatible `--explain` Alias

`indexing --explain <file>` continues to work as an alias for `indexing --explain-index <file>`. Both flags map to the same `explainIndex` internal value. The `--explain` alias is preserved for script compatibility (not removed as a breaking change).

### 5. Windows Path Normalization

File paths returned by `FileHandler.filterPaths()` are now normalized to forward-slash format on Windows, preventing double-backslash issues in reported file paths.

## Smaller Fixes

- Tightened `runIndexingCommand()` parameter type from `CLIValues` to a focused intersection type, preventing accidental use of unrelated CLI fields.
- Test coverage for `--explain-context` parsing, render behavior, exit codes, and JSON output shape.
- Non-ASCII characters verified clean in all source and test files.
- `create-skills` can optionally enrich generated skills with AI-generated, version-aware dependency rules from the configured provider/model.
- Source index schema `1.2` adds codebase insights used by generated skills and stale-check hashing.

## Documentation

- [Changelog](./docs/CHANGELOG.md) — detailed technical changes per version
- [Commands Cheat Sheet](./docs/COMMANDS_CHEAT_SHEET.md) — `--explain-context` flag added

## Migration

No breaking changes. All improvements are additive.

## Summary

- **Version**: 1.0.12
- **Release Date**: 2026-04-28
- **Builds on**: v1.0.11 repository-aware review context

---

# What's New in v1.0.11

## Major Features

### 1. Repository-Aware Review Context (v2)

The `review` command now uses an impact-aware context builder that enriches AI prompts with smarter dependency graph insights:

- **Priority ranking**: changed files → direct imports → direct dependents → hub files.
- **Configurable caps**: `indexing.maxRelatedFiles` (default 3) per changed file for imports/dependents.
- **Hub file detection**: Most-imported files (`importedBy ≥ 3`) added only if budget remains.
- **Profile-aware pitfalls**: Concise review guidance (3–5 bullets) based on project profile (`cli-tooling`, `node-service`, `react-next`, `library`).
- **Character budget**: `INDEX_CONTEXT_MAX_CHARS = 12000` with truncation marker.

This context is generated by the new `src/services/source-index/context-builder.ts` service, keeping CLI orchestration clean and testable.

### 2. Configurable Context Budget

New `indexing.maxRelatedFiles` option in `.mp-sentinelrc.json` controls how many related files to include per changed file:

```json
{
  "indexing": {
    "enabled": true,
    "maxRelatedFiles": 3
  }
}
```

Default remains 3 to balance context richness with token costs.

### 3. Profile Detection Reuse

The same `detectProfile()` function from `create-skills` is now used in review context to ensure consistency. Profiles:
- `cli-tooling`: exit codes, diff-first, CLI parsing separation.
- `node-service`: handler purity, error middleware, health checks.
- `react-next`: server/client boundary, `next/image` optimization.
- `library`: public API surface, type definitions, peer dependencies.

## Documentation

- [Architecture Guide](./docs/ARCHITECTURE.md) — source indexing and review context details.
- [Changelog](./docs/CHANGELOG.md) — detailed technical changes per version.

## Migration

No breaking changes. All improvements are additive. Existing `review` and `indexing` workflows are unaffected. The new context is opt-in via `indexing.enabled: true`.

## Summary

- **Version**: 1.0.11
- **Release Date**: 2026-04-27
- **Builds on**: v1.0.10 profile-aware skills

---

# What's New in v1.0.10

## Major Features

### 1. Profile-Aware Generated Skills

The `create-skills` command now generates project-specific best practices based on detected profile:

- **`cli-tooling`**: Exit codes, diff-first review, CLI parsing separation, entry file routing, script change warnings
- **`node-service`**: Handler purity, error middleware, env validation, async boundaries, health checks
- **`react-next`**: Server/client boundary, data fetching colocation, DOM mutation avoidance, image optimization, bundle vigilance
- **`library`**: Public API surface, SemVer awareness, type definitions, peer dependencies, tree-shakeability

The profile is auto-detected from manifest signals (`bin`, scripts, dependencies, frameworks) — no CLI flag required.

### 2. Manifest-Aware Cache Invalidation

Source index caching now fingerprints `package.json`, `tsconfig*.json`, and lockfile identity via a `manifestHash` field. When only manifest inputs change (scripts, dependencies, framework signals), cached parsed files are reused and only the dependency graph is rebuilt — no full reparse required. This ensures profile skills always reflect the current manifest without unnecessary reindexing.

### 3. Cline Adapter

MP Sentinel now supports **Cline** AI assistant via the `.clinerules/` directory:

```bash
npx mp-sentinel create-skills --agent cline
```

Output: `.clinerules/<project>-best-practices.md`

Cline is included in `--all-agents` and auto-detected when `.clinerules/` exists.

### 4. Claude SKILL.md Frontmatter Fix

Claude Code skills now correctly place the metadata header **after** the YAML frontmatter, preserving the frontmatter as the very first content in `SKILL.md`. This matches Claude Code's skill file expectations.

## Documentation

- [Create Skills Guide](./docs/CREATE_SKILLS.md) — full adapter reference, output paths, automation
- [Commands Cheat Sheet](./docs/COMMANDS_CHEAT_SHEET.md) — `create-skills` section
- [Changelog](./docs/CHANGELOG.md) — detailed technical changes per version

## Migration

No breaking changes. All improvements are additive.

## Summary

**Version**: 1.0.10
**Release Date**: 2026-04-26
**Builds on**: v1.0.9 create-skills MVP

---

# What's New in v1.0.9

## Major Features

### 1. `create-skills` — Generate Agent/IDE Skill Files

MP Sentinel can now generate structured best-practices files for AI agents and IDEs directly from your source index. One command, multiple targets:

```bash
# Interactive picker — auto-detects existing agent folders
npx mp-sentinel create-skills

# Generate for specific agents
npx mp-sentinel create-skills --agent claude,cursor

# Generate for all supported agents at once
npx mp-sentinel create-skills --all-agents

# Automation-friendly JSON output
npx mp-sentinel create-skills --agent claude --format json

# Overwrite existing skill files
npx mp-sentinel create-skills --agent claude --force
```

**Supported agents:**

| Agent | Output path |
|-------|-------------|
| `claude` | `.claude/skills/<project>-best-practices/SKILL.md` + `references/` |
| `cursor` | `.cursor/rules/<project>-best-practices.mdc` |
| `codex` | `.agents/rules/<project>-best-practices.md` |
| `windsurf` | `.windsurf/rules/<project>-best-practices.md` |
| `antigravity` | `.antigravity/rules/<project>-best-practices.md` |
| `cline` | `.clinerules/<project>-best-practices.md` |
| `generic` | `.agents/rules/<project>-best-practices.md` |

> **Note:** `--all-agents` generates for the 6 primary adapters (`claude`, `cursor`, `codex`, `windsurf`, `antigravity`, `cline`). `generic` shares an output path with `codex` and is excluded from `--all-agents` to avoid conflicts — use `--agent generic` to target it explicitly.

**What's generated:**
- Project overview (name, version, frameworks, package manager)
- Architecture (top-level directories, dependency graph stats when schema 1.2)
- Hub files (most-imported files with their exported symbols — schema 1.2)
- Module map (per-directory breakdown with key exported symbols)
- Development commands (`npm test`, `npm run build`, type-check)
- Code conventions (ESM imports, TypeScript, test file count)

**Auto-index:** `create-skills` always ensures a valid source index exists before generating. If the cache is absent it builds automatically — no manual `mp-sentinel indexing` step required. The index is also automatically refreshed when manifest inputs (`package.json`, `tsconfig*.json`, or lockfile identity) change, ensuring profile skills stay in sync with the current scripts, `bin`, dependencies, and framework signals.

### 2. Preview and CI Modes

**`--dry-run`** — preview what would happen without writing files:
```bash
npx mp-sentinel create-skills --all-agents --dry-run --format json
```
Possible actions per file: `create` (new), `skip` (exists, no `--force`), `overwrite` (exists with `--force`), `conflict` (path already claimed by another adapter in the same batch).

**`--check`** — CI staleness gate:
```bash
npx mp-sentinel create-skills --agent claude --check --format json
# exits 0 = up-to-date, 1 = stale/missing, 2 = runtime error
```
Possible statuses: `up-to-date`, `stale` (hash mismatch), `missing`, `wrong-agent` (file exists but was generated by a different adapter).

### 3. Deterministic Output

Every generated file begins with a metadata header:
```
<!-- @mp-sentinel-generated generatorVersion=1.0.9 sourceIndexSchema=1.2 sourceIndexHash=<16hexchars> agent=claude projectName=my-project -->
```
The `sourceIndexHash` is a sha256 over sorted file paths, symbols, and import edges — no timestamps, no random values. Re-running `create-skills` on the same index always produces byte-identical files. `--check` uses this hash to detect staleness without re-reading file content.

### 4. Hardened CLI Contract

- `create-skills --help` now shows all options including `--format`.
- Invalid format (`--format xml`) returns exit code `2` with a clear error message.
- Unknown `--agent` id returns exit code `2` listing valid options.
- Absent or corrupt cache with `--skip-index-refresh` fails with exit code `2` instead of silently generating incomplete files.
- Missing `package.json` name field returns exit code `2` rather than generating files under the generic `"project"` name.

## Migration

No breaking changes. `create-skills` is an additive command. Existing `review` and `indexing` workflows are unaffected.

## Summary

**Version**: 1.0.9
**Release Date**: 2026-04-26
**Builds on**: v1.0.8 graph-aware source indexing
