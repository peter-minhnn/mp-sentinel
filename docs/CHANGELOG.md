# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.19] - 2026-04-28

### Changed
- **Release checklist**: Added structured release checklist to `AGENTS.md` for consistent tagging and npm publishing workflow.
- **Remote tag sync**: All historical tags v1.0.11–v1.0.18 synchronized with `origin`.
- **Docs polish**: README badge, CHANGELOG, and WHATS_NEW updated for v1.0.19 consistency. No runtime code changes.

## [1.0.18] - 2026-04-28

### Added
- **Legacy generated file detection**: `detectLegacyGeneratedFiles()` scans for pre-v1.0.17 generated files at old Codex (`.agents/rules/<project>-best-practices.md`) and Antigravity (`.antigravity/rules/<project>-best-practices.md`) paths. Only files with `@mp-sentinel-generated` metadata are flagged; user-authored files are ignored.
- **`LegacyFileInfo` type**: New type with `path`, `agent`, `supersededBy`, and `suggestion` fields.
- **Advisory reporting**: Legacy files appear in console (warning) and JSON output (`legacyFiles` field) for all three modes: normal generate, `--dry-run`, and `--check`.
- **Non-blocking `--check`**: Legacy advisories do not cause `--check` to fail. Exit code remains 0 when official files are current.

### Changed
- **Output interfaces**: `RunOutput`, `DryRunOutput`, and `CheckOutput` in `create-skills.ts` now include optional `legacyFiles` field.

## [1.0.17] - 2026-04-28

### Changed
- **Antigravity adapter**: Output moved from `.antigravity/rules/<project>-best-practices.md` to `.agents/skills/<project>-antigravity-best-practices/SKILL.md` with YAML frontmatter (`name`, `description`). Aligned with official [Antigravity Skills docs](https://antigravity.google/docs/skills).
- **Codex adapter**: Output moved from `.agents/rules/<project>-best-practices.md` to `.agents/skills/<project>-codex-best-practices/SKILL.md` with YAML frontmatter (`name`, `description`). Aligned with official Codex Skills docs.
- **Adapter labels**: Updated Antigravity label to "Google Antigravity (.agents/skills/)" and Codex label to "Codex / OpenAI (.agents/skills/)".

### Added
- **`AdapterSpec` type**: Every adapter now declares `officialDocsUrl`, `outputKind` (`"skill"` | `"rule"`), `workspacePath`, `requiredFiles`, `frontmatterRules`, and `sizeLimit`. These are validated by the quality gate.
- **`adapter-layout-contract` quality check**: Validates output paths match official workspace paths, skill-style adapters produce `SKILL.md`, required YAML frontmatter keys are present. Errors on legacy paths for skill adapters.
- **`AdapterOutputKind`** and **`AdapterFrontmatterRules`** types in `src/types/index.ts`.
- **Instruction file detection**: Added `.agents/skills/` to fidelity file detection in `metadata.ts`, `knowledge-base.ts`, and `content.ts`.
- **Migration notes** in `docs/CREATE_SKILLS.md` documenting the Antigravity and Codex path changes.
- **New tests**: Adapter layout tests for Antigravity/Codex/Claude paths, adapter-layout-contract quality gate tests (valid skill, missing SKILL.md, missing frontmatter, legacy path rejection, rule path validation), `--all-agents` no-conflict test.

### Fixed
- **Codex/Generic collision removed**: Codex no longer writes to `.agents/rules/`, so `--all-agents` has no path conflicts between any adapter pair.
- **`--agent codex,generic` conflict test** updated to verify no-conflict behavior.

## [1.0.16] - 2026-04-28

### Added
- **Agent Workflow Contract quality check**: New `checkAgentWorkflowContract()` in quality gate validates that Required Agent Workflow section (a) instructs agents to read skill/rules before coding, and (b) directs agents to use indexing diagnostics before broad scans. Error severity — missing either fails the quality gate.
- **Content codebase-awareness**: `buildAgentWorkflow`, `buildOverview`, and `buildCommands` in `content.ts` now use real project signals from the source index (CLI entrypoints, command files, scripts, module/entrypoint counts, instruction files) instead of generic template placeholders.
- **Index fidelity signals**: `computeIndexHash()` includes detected instruction file presence (`AGENTS.md`, `CLAUDE.md`, `.cursor/rules`, `.clinerules`, `.agents/rules`, `.windsurf/rules`, `.codex/rules`, `.antigravity/rules`) in its deterministic hash. Adding/removing instruction files after generation causes `--check` to correctly report stale.
- **Instruction file detection**: `buildSkillKnowledgeBase()` and `computeIndexHash()` accept optional `projectRoot` parameter for detecting agent instruction files on disk.
- **Regression fixture tests**: 4 profile fixtures (`cli-tooling`, `library`, `node-service`, `react-next`) with real source indexes, multiple source/test files, and scripts. Tests verify zero quality errors on generated content.
- **Adapter determinism tests**: Byte-identical output when same adapter generates from same index twice.
- **`--check` regression tests**: Verifies exit codes correctly reflect quality errors vs. warnings; JSON output includes quality field in check mode.

### Changed
- **`KNOWN_NON_SOURCE_PATHS`**: Added bare directory names (`.claude`, `.cursor`, `.agents`, `.clinerules`, `.windsurf`, `.antigravity`, `.agent`, `.codex`) and generated reference file paths (`references/codebase-map.md`, etc.) to eliminate unknown-path warnings for valid generated references.
- **`content.ts` line 537**: Removed backtick-wrapping from `d.ts` to prevent false unknown-path warning.
- **`SkillKnowledgeBase` type**: Added optional `instructionFiles?: string[]` field.

### Fixed
- **False `unknown-path` warnings**: Bare `d.ts` token (from library profile rules) no longer triggers unknown-path warning. Reference file paths and bare agent directory names are recognized as valid.
- **`--check` wrong-agent detection**: Fidelity signals now match between generate and check phases when agent instruction directories are present.

## [1.0.15] - 2026-04-28

### Added
- **Unknown-path allowlist**: `KNOWN_NON_SOURCE_PATHS` set in quality gate recognizes valid non-source paths (`package.json`, `tsconfig.json`, `AGENTS.md`, `CLAUDE.md`, agent dirs, cache files). Directory references (trailing `/`) and ESM `.js` paths (mapped to `.ts`/`.tsx`) are also excluded from unknown-path warnings.
- **Codebase fidelity checks**: New `missing-real-signal` warnings verify that generated skill content mentions real project signals (CLI entrypoints, command files, package.json scripts, top-level source directories) when the index has data. Reference files are excluded from these checks.
- **Named content caps**: All inline `.slice()` limits in `content.ts` converted to named constants (`MAX_TEST_ASSOC_ENTRIES`, `MAX_TEST_GAP_ENTRIES`, `MAX_DEP_TABLE_ENTRIES`, `MAX_DEP_DETAIL_ENTRIES`, `MAX_DEP_FILE_LIST`, `MAX_RISK_ENTRIES`, `MAX_SCRIPT_ENTRIES`, `MAX_IMPORT_FROM_LIST`).

### Changed
- **Quality gate exit code docs**: `docs/CREATE_SKILLS.md` exit code table now explicitly states quality errors cause `--check` to exit `1`.
- **Script mention detection**: `missing-real-signal` check uses precise regex matching for script references (backtick-wrapped, `npm run` patterns) instead of substring matching to avoid false matches.

### Fixed
- **False-positive `unknown-path` warnings**: Non-source paths, directory references, and ESM `.js` paths no longer trigger warnings. Root-level files (e.g. `index.ts`) are no longer misidentified as source directories.

## [1.0.14] - 2026-04-28

### Added
- **Skill quality gate**: New module `src/services/skills-generator/quality-gate.ts` with `validateSkillQuality()` for deterministic content validation. Checks: max file size, required H2 sections, required references (Claude), duplicate sections, empty sections (warning), unknown paths (warning).
- **Quality types**: `QualityCheck` and `QualityReport` interfaces in `src/types/index.ts`. Optional `quality` field added to `SkillsGenerationResult`, `SkillsDryRunResult`, and `SkillsCheckResult`.
- **Quality in all output modes**: JSON outputs include quality reports. `--check` fails on quality errors (exit 1). Warnings are informational only.
- **Stable sorting**: Secondary tie-breakers (path/name) added to all list sorts in `content.ts` and `knowledge-base.ts` for fully deterministic output.
- **Line caps**: Hub file detail entries ≤ 15 lines, risk detail entries ≤ 3 lines.
- **Dependency display cleanup**: `cleanDisplayVersion()` helper renders semver ranges like `^2.4.2` as `2.4.2 (range ^2.4.2)` in generated skills. Raw versions preserved in AI input and hashing.

## [1.0.13] - 2026-04-28

### Added
- **SkillKnowledgeBase**: New internal module (`src/services/skills-generator/knowledge-base.ts`) that builds structured codebase knowledge from `SourceIndex` — module ownership, entrypoints, testing map, dependency map, and risk surface. Pure deterministic derivation, no AI calls. Returns minimal KB (empty arrays) when `index.insights` is absent.
- **4 new Claude reference files**: `references/codebase-map.md` (module ownership + entrypoints), `references/testing-map.md` (test associations, gaps, most-tested modules), `references/dependencies.md` (top dependencies with versions, always present), `references/public-api.md` (entry points + risk surface). Claude adapter now produces 8 files total (was 4-5).
- **7 new types in `src/types/index.ts`**: `ModuleInfo`, `EntrypointInfo`, `TestGapEntry`, `TestingMap`, `DepMapEntry`, `RiskEntry`, `SkillKnowledgeBase`. Added `knowledgeBase` field to `SkillsGenerationContext`.
- **4 new content sections**: `codebaseMap`, `testingMap`, `dependencies`, `publicApi` in `SkillSections` with corresponding builders in `content.ts`. Single-file adapters embed condensed versions inline.
- **`AIEnrichmentInput` expansion**: 5 new fields — `testGapCount`, `topDependenciesWithVersions`, `defaultExportCount`, `dynamicImportCount`, `hubFileCount` — for richer AI recommendations.
- **Indexing stats expansion**: `handleStats()` now shows default export, re-export, type-only import, dynamic import counts, and hub file count.
- **Updated agent workflow**: SKILL.md enforces progressive disclosure — read skill → read AGENTS.md → use `--explain-index` → read appropriate references.

### Changed
- **`dependencies.md`**: Now always generated (was conditional on AI enrichment). AI enrichment is appended when active.
- **All 7 adapters updated**: Pass `context.knowledgeBase` to `generateContent()`. Claude adapter references list expanded from 4 to 7.
- **AI enrichment prompt**: Bumped `ENRICHMENT_PROMPT_VERSION` to `2026-04-28`. Prompt now uses actual dependency versions and richer project details for version-aware rules.

### Fixed
- **`resolveExportSource()` path resolution**: No longer appends `.ts` to paths that already have an extension, preventing malformed paths like `src/cli/review.js.ts`.

## [1.0.12] - 2026-04-28

### Added
- **`--explain-context` diagnostic mode**: New opt-in flag for the `review` command that shows context building details (index availability, profile detection, relation types) without making any AI calls. JSON output is valid parseable JSON; console output uses ASCII only (no emoji). Exit code `0` in all non-error cases.
- **`ExplainContextOutput` type** and `ExplainContextStatus` union type added to `src/types/index.ts` for typed diagnostic output.
- **Root command `.action()` handler**: Prevents Commander 14 from auto-showing help when subcommands are registered but no subcommand is provided.
- **Backward-compatible `--explain` alias**: `indexing --explain <file>` continues to work as an alias for `indexing --explain-index <file>`, preserving script compatibility.
- **Windows path normalization**: `FileHandler.filterPaths()` now normalizes paths to forward-slash format on Windows.
- **Optional AI enrichment for `create-skills`**: When `createSkills.ai.enabled` is true, generated skills include version-aware dependency rules from the configured provider/model. `--no-ai-enrich` forces deterministic index-only generation.
- **Source index schema `1.2` insights**: Source index now includes role, public API, test map, command map, dependency usage, default export, re-export, type-only import, and dynamic import insights for richer generated skills.

### Changed
- **Version fallback consistency**: All runtime version references (`src/cli/args.ts`, `src/cli/help.ts`, `src/services/ai/index.ts`, `src/commands/create-skills.ts`) now use `process.env.npm_package_version` first, then installed `mp-sentinel` package metadata, with `"0.0.0-dev"` as the final fallback.
- **`src/cli/args.ts`**: Hardened help/version exit detection — handles both Commander 14 codes (`commander.helpDisplayed`, `commander.versionDisplayed`) and older codes (`commander.help`, `commander.version`) defensively.
- **`runIndexingCommand()` parameter type**: Tightened from `CLIValues` to `Partial<CLIValues> & { force?; stats?; explainIndex? }` intersection type, preventing accidental use of unrelated CLI fields.
- **`src/services/file-handler/index.ts`**: `filterPaths()` normalizes Windows backslashes to forward slashes.
- **`computeIndexHash()` coverage**: Hashing now includes import/export names, type-only import/export status, default exports, re-exports, and schema `1.2` insights so `create-skills --check` catches more source-shape changes.

### Fixed
- **Version displaying as "1.0.6" or "0.0.0-dev"**: `node dist/index.js --version` now correctly shows `package.json` version instead of a stale hardcoded or env-only fallback.
- **Commander 14 auto-help on root command**: Empty `.action()` handler added to prevent `--help` from showing when no subcommand is used.
- **`--explain` flag type**: Replaced `explain` with `explainIndex` in `CLIValues` interface, driving `runIndexingCommand()` with a focused type.
- **`createSkills.ai.provider` validation**: Unsupported provider names now fail explicitly instead of being ignored and falling back to another provider.

### Documentation
- Updated `docs/COMMANDS_CHEAT_SHEET.md` with `--explain-context` flag
- Updated `docs/ARCHITECTURE.md` with explain-context diagnostic mode
- Updated `docs/CHANGELOG.md` (this file)
- Updated `WHATS_NEW.md`

## [1.0.10] - 2026-04-26

### Added
- **Profile-aware generated skills**: `create-skills` now detects project profile (`cli-tooling`, `node-service`, `react-next`, `library`) from manifest signals and generates tailored review pitfalls for each profile
- **Manifest-aware cache invalidation**: Source index now includes `manifestHash` (fingerprint of `package.json`, `tsconfig*.json`, lockfile identity). When only manifest inputs change, cached parsed files are reused and only the dependency graph is rebuilt, ensuring profile skills stay current without full reparse
- **Cline adapter**: Added support for Cline AI assistant — generates `.clinerules/<project>-best-practices.md`. Auto-detected when `.clinerules/` exists and included in `--all-agents`
- **Claude frontmatter fix**: `applyMetadataHeader()` now places metadata after YAML frontmatter closing `---`, ensuring Claude Code skill files have frontmatter as the very first content

### Changed
- **`computeIndexHash`**: Now includes `manifestHash` in the deterministic hash for accurate staleness detection
- **Generated content**: "Commands & Conventions" generic section replaced by "Profile Rules" — project-specific section with tailored review pitfalls for `cli-tooling`, `node-service`, `react-next`, and `library` profiles

## [1.0.9] - 2026-04-26

### Added
- **`create-skills` command**: generates agent/IDE skill files from the source index
  - 7 adapters: `claude`, `cursor`, `codex`, `windsurf`, `antigravity`, `cline`, `generic`
  - `--all-agents` generates for the 6 primary adapters (`claude`, `cursor`, `codex`, `windsurf`, `antigravity`, `cline`) — `generic` is excluded to avoid path collision with `codex`; use `--agent generic` to target it explicitly
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
  - Actions: `create` (file absent), `skip` (file exists, no `--force`), `overwrite` (file exists with `--force`), `conflict` (another adapter in the same batch already claimed this output path)
  - `--dry-run --format json` outputs `{ "dryRun": [...] }` suitable for scripting
- **`create-skills --check`**: CI mode — verify generated skill files are up-to-date with the current source index
  - Exit `0`: all files present and hash matches current index
  - Exit `1`: any file is missing or stale (hash mismatch)
  - Exit `2`: runtime error (invalid config, corrupt cache, etc.)
  - Statuses: `up-to-date`, `stale` (hash mismatch), `missing`, `wrong-agent` (file exists with correct hash but `agent` field differs — file belongs to another adapter)
  - `--check --format json` outputs `{ "check": [...], "status": "ok" | "stale" }`
- **Generated file metadata header**: every skill file begins with a deterministic HTML comment embedding `generatorVersion`, `sourceIndexSchema`, `sourceIndexHash` (16-char sha256 over sorted file paths, symbols, and import edges — no timestamps), `agent`, and `projectName`
  - Adapter output is fully deterministic: re-running `create-skills` with the same index always produces byte-identical files
  - `--check` uses this header to detect staleness and wrong-agent without re-reading full content
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
