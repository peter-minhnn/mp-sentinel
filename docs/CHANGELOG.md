# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.9] - Unreleased

### Added
- **`create-skills` command**: generates agent/IDE skill files from the source index
  - 6 adapters: `claude`, `cursor`, `codex`, `windsurf`, `antigravity`, `generic`
  - Auto-detection of installed agent folders (`.claude/`, `.cursor/`, `.windsurf/`, `.codex/`, `.agents/`, `.antigravity/`, `.agent/`)
  - Interactive multi-select picker (TTY) or non-interactive via `--agent <ids>` / `--all-agents`
  - `--format json` for automation; requires `--agent` or `--all-agents` to preserve parseable stdout
  - `--force` to overwrite existing skill files; without it, conflicts return exit code `1`
  - `--skip-index-refresh` to use existing cache only; fails exit code `2` if cache absent or corrupt
  - Auto-builds source index before generating (same as `mp-sentinel indexing`)
  - Content: overview, architecture, hub files (schema 1.1), module map, commands, code conventions
  - Claude output: `SKILL.md` + `references/architecture.md`, `references/modules.md`, `references/commands.md`
- **`create-skills` adapter types**: `AgentAdapterId`, `AgentAdapter`, `SkillsGenerationContext`, `GeneratedSkillFile`, `SkillsGenerationResult` added to `src/types/index.ts`
- **`AGENTS.md` §3**: new behavioral contract section for `create-skills` and adapter development rules

- **`create-skills --dry-run`**: preview files that would be created, skipped, or overwritten without writing anything
  - Actions: `create` (file absent), `skip` (file exists, no `--force`), `overwrite` (file exists with `--force`)
  - `--dry-run --format json` outputs `{ "dryRun": [...] }` suitable for scripting
- **`create-skills --check`**: CI mode — verify generated skill files are up-to-date with the current source index
  - Exit `0`: all files present and hash matches current index
  - Exit `1`: any file is missing or stale (hash mismatch)
  - Exit `2`: runtime error (invalid config, corrupt cache, etc.)
  - `--check --format json` outputs `{ "check": [...], "status": "ok" | "stale" }`
- **Generated file metadata header**: every skill file now begins with an HTML comment embedding `generatorVersion`, `sourceIndexSchema`, `sourceIndexHash`, `agent`, and `projectName`
  - Hash is a 16-char sha256 of stable index content — deterministic, no timestamps
  - `--check` uses this hash to detect staleness without re-reading full content
- **New types in `src/types/index.ts`**: `SkillsMetadata`, `DryRunFileAction`, `SkillsDryRunFile`, `SkillsDryRunResult`, `CheckFileStatus`, `SkillsCheckFile`, `SkillsCheckResult`
- **New module `src/services/skills-generator/metadata.ts`**: `computeIndexHash`, `renderMetadataHeader`, `parseMetadataFromContent`

### Changed
- **`src/cli/args.ts`**: `create-skills` subcommand now declares `--format` directly so it appears in `create-skills --help`
- **`AGENTS.md`**: section renumbering (§3 create-skills inserted; §4–§9 shifted accordingly)
- **`CLAUDE.md`**: updated section reference (§6 → §7) and added create-skills contract to reading list
- **`create-skills` output objects**: normal run emits `{ "results": [...] }`; `--dry-run` emits `{ "dryRun": [...] }`; `--check` emits `{ "check": [...], "status": "ok" | "stale" }`; errors always emit `{ "status": "ERROR", "error": "..." }`

### Fixed
- **Null index guard**: `create-skills` now fails with exit code `2` if `buildSourceIndex` returns `null` or the cache is corrupt, instead of silently generating files under the generic `"project"` name
- **Missing package name guard**: fails with exit code `2` if `package.json` has no `"name"` field
- **Format validation before index build**: invalid `--format` value now returns exit `2` immediately, before the potentially slow index-build step

## [1.0.8] - 2026-04-26

### Added
- **Graph-aware dependency index** (schema `1.1`): `importsFrom` and `importedBy` edges on every `SourceIndexFile`
  - tsconfig `paths`/`baseUrl` aliases resolve correctly (e.g. `@/lib/foo`)
  - JSONC tsconfig files (with comments / trailing commas) now parse without error
  - External packages (`react`, `node:*`, `@types/*`, URLs) are never added as internal graph edges
  - Missing or unresolvable imports do not crash indexing
  - Circular imports (`a→b→a`) correctly populate both `importsFrom` and `importedBy`
- **`--stats` flag**: print index statistics after building/updating (supports `--index-format json`)
- **`--explain <file>` flag**: show per-file symbols, imports, and dependency edges (supports `--index-format json`)
- **Index Metadata**: Added `durationMs`, `cacheHitFiles`, `parsedFiles`, and `importEdges` to `SourceIndex.stats`
- **Agent development rules**: `AGENTS.md` and `CLAUDE.md` added to repo for AI coding agents

### Changed
- **Review context enrichment**: Changed files listed first, then direct imports (capped at 3), then direct dependents (capped at 3); character budget raised to 12 000
- **JSON output isolation**: `--index-format json` now suppresses informational logs so stdout is pure JSON
- **Commands Cheat Sheet**: Consolidated to a single Source Indexing section covering all flags

### Fixed
- **Resolver correctness**: Bare imports were incorrectly returned as external before tsconfig path mappings were attempted, breaking `@`-prefixed path aliases
- **Docs/runtime sync**: AGENTS.md flag corrected to `--index-format json`; `--stats` description no longer claims "without rebuilding"

## [1.0.7] - 2026-04-25

### Added
- **Source Indexing**: New `indexing` command to build an AST-based source code cache
  - Parses JS/TS files using tree-sitter for symbol, import, and export extraction
  - Incremental caching with file change detection for fast updates
  - Configurable via `.mp-sentinelrc.json` (`indexing.enabled`, `languages`, `cachePath`, `maxFileSize`)
  - AI review automatically uses index context when available
  - JSON output support for automation: `indexing --index-format json`

### Changed
- **Configuration Standardization**: Unified config merging for `indexing` section alongside `ai` and `localReview`
- **Type Safety**: Removed `any` types from configuration handling; all strict TS flags respected

### Fixed
- **Indexing Command Semantics**: `mp-sentinel indexing` now always builds the index when called directly, regardless of `indexing.enabled` setting. The `enabled` flag only controls whether the `review` command consumes the cached index.

## [1.0.6] - 2026-02-23

### Fixed
- **Local Review Specific Commit**: Fixed an issue where using `--commit <sha>` with `--local` would ignore the specified SHA and default to the latest commit.
- **Interactive Mode Improvements**: Removed hardcoded default of 1 commit for `--commits` flag, enabling the interactive picker (`-i`) to correctly default to 15 commits for a better user selection experience.
- **CLI Parsing Consistency**: Synchronized commit count parsing logic between the main entry point and local review module to ensure consistent behavior across all command variations.


## [1.0.5] - 2026-02-23

### Changed
- **Local Agent Skills Integration**: MP Sentinel now scans local project directories (like `.skills`, `.agent/skills`, `.cursor/rules`) for best practices instead of relying on the defunct `skills.sh` HTTP API.
- **Improved Performance & Security**: 100% offline rule fetching for faster startup and zero network dependency during auditing.
- **Native Ecosystem Support**: Seamlessly works with the `skills` CLI ecosystem (`npx skills add ...`).
- **Enhanced Technology Matching**: Dynamically boosts the relevance of local markdown rules based on the project's `techStack`.

### Fixed
- Fixed redundant HTTP calls and console noise when `skills.sh` API returned 404.
- Increased prompt capacity for local rules (up to 8,000 characters per file).

## [1.0.4] - 2026-02-22

### Added
- **Interactive Local Review**: Added `-i, --interactive` flag to hand-pick commits via terminal checkbox UI.
- **Mixed Uncommitted Mode**: Added `--include-uncommitted` flag to audit Staged + Unstaged + Commits in one run.
- **Auto-Fetch Syncing**: Added `--fetch` flag to automatically sync remote branches before a branch-diff review.
- **Detailed Token Breakdown**: Added `--verbose-dry-run` to see per-file token counts without calling AI.
- **Command Cheat Sheet**: New comprehensive guide `docs/COMMANDS_CHEAT_SHEET.md`.

### Improved
- **Security Guard**: File filtering and secret scrubbing are now fully integrated into Local Review mode.
- **Performance**: Improved git merge-base detection for remote-tracking branches.

## [1.0.3] - 2026-02-22

### Fixed
- Internal improvements for build process.
- Synchronized version across all files.

## [1.0.2] - 2026-02-10

### Added
- **Skills.sh Integration**: Automatic enhancement of code review prompts based on technology stack
  - Fetches relevant best practices from [skills.sh](https://skills.sh/) API
  - Smart technology parsing from `techStack` configuration
  - 1-hour in-memory caching to minimize API calls
  - Configurable timeout (default: 3 seconds)
  - Fail-fast pattern: never blocks CI/CD if skills.sh is unavailable
- **Enhanced Parallel Processing**: 
  - File reading now uses `Promise.allSettled` for true parallel processing
  - File auditing uses `Promise.allSettled` to ensure all files are processed
  - Failed files are tracked and reported at the end (don't stop the process)
- **Configuration Options**:
  - `enableSkillsFetch`: Enable/disable skills.sh integration (default: `true`)
  - `skillsFetchTimeout`: Timeout for skills.sh API calls in milliseconds (default: `3000`)
- **Documentation**:
  - New comprehensive guide: `docs/SKILLS_INTEGRATION.md`
  - Example configuration: `.sentinelrc.example.json`
  - Skills demo script: `examples/skills-demo.ts`

### Improved
- **Error Handling**: All file operations now gracefully handle errors without stopping the entire process
- **Performance**: True parallel processing for both file reading and auditing
- **Logging**: Enhanced error reporting with clear indication of which files failed and why
- **Type Safety**: Improved TypeScript types for async prompt building

### Changed
- `buildSystemPrompt()` is now async to support skills fetching
- File audit results now include detailed error information for failed files

## [1.0.1] - 2026-02-09

### Added
- **Branch Diff Mode**: Added `-d, --branch-diff` flag to review all commits that differ from a target branch.
- **Compare Branch**: Added `--compare-branch` option to specify the target branch for comparison in local review mode.
- **Pattern Match Mode**: Added `patternMatchMode` configuration (`any` or `all`) to control how commit patterns are validated.
- **Required Patterns**: Support for `required: true` in commit patterns when using `patternMatchMode: "all"`.
- **Verbose Pattern Matching**: Enhanced verbose output (`verbosePatternMatching`) to show exactly which patterns matched or failed for each commit.
- **CLI Subcommands**: Improved CLI argument parsing to handle edge cases in subcommand usage.

### Improved
- **Commit Message Validation**: Updated regex engine to provide more detailed feedback on why a commit message failed validation.
- **Performance**: Optimized git log retrieval for local review mode.
- **Documentation**: Comprehensive updates to `README.md`, `QUICK_START.md`, and `QUICK_REFERENCE.md` reflecting new features.

### Fixed
- Fixed an issue where commit message patterns with square brackets were incorrectly matched.
- Improved TypeScript type safety for pattern matching results.
- Fixed duplicate closing braces in `src/index.ts` utility functions.

## [1.0.0] - 2026-02-07

### Added
- Initial release of **MP Sentinel**.
- Multi-provider AI support (Google Gemini, OpenAI GPT, Anthropic Claude).
- CI/CD integration for GitHub Actions and GitLab CI.
- Local Review Mode for direct branch auditing.
- Concurrent file auditing for high performance.
- Configurable rules via `.sentinelrc.json`.
