# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.32.1] - 2026-05-01

### Added
- **Release finalization** (`package.json`, `README.md`, `WHATS_NEW.md`, `docs/CHANGELOG.md`, `.claude/skills/`, `.cursor/rules/`, `.agents/skills/`, `.windsurf/rules/`, `.clinerules/`): Version bump to 1.32.1 confirming v1.32.0 hardening. No runtime changes. All agent skills regenerated and verified.

---

## [1.32.0] - 2026-05-01

### Fixed
- **Serial isolation** (`jest.setup.cjs`, `src/services/source-index/parser.ts`): Tree-sitter parser pool preloaded in root CJS context and shared across Jest VM contexts, preventing per-suite native addon loads that caused Windows EPERM errors in concurrent VM contexts. `getParser()` cycles through pooled parsers; `clearParserCache()` resets pools and caches between suites.
- **Stale cache cleanup** (`src/services/source-index/storage.ts`, `src/commands/indexing.ts`): `validateCache()` detects indexed files removed from the current file set and marks them as missing so rebuilts drop stale entries. Index graph is now rebuilt when the file set shrinks even if all remaining files are cached.

### Changed
- **Chunk boundary accuracy** (`src/services/source-index/parser.ts`): `netBraceChange()` skips braces inside comments, string literals, and template literal bodies (counting only braces inside `${}` expressions). Prevents boundary-detection skew from comment and string content.

### Added
- **Serial isolation canary** (`scripts/serial-isolation-check.cjs`): Runs historically fragile tree-sitter suites with `--runInBand` in one Jest process as a regression guard.

---

## [1.31.0] - 2026-04-30

### Changed
- **Safe-boundary chunking** (`src/services/source-index/parser.ts`): `chunkedParse` prefers split points where brace depth returns to the chunk's starting depth and the line ends at a likely statement/module boundary (`;`, `}`, or blank). Falls back to max-size line split when no safe boundary exists within the search window. Reduces boundary-warning noise in large files without changing the public telemetry contract.

### Tests
- 4 new safe-boundary chunking tests: top-level safe-boundary splits, import/export preservation, fallback for deeply-nested content, and warning-count invariants.

---

## [1.30.0] - 2026-04-30

### Added
- **Release-check symbol hygiene gate** (`scripts/release-check.mjs`): New symbol hygiene check validates that backtick-quoted function references in the latest WHATS_NEW.md section exist in `src/**/*.ts`. Missing references cause a hard release-check failure.

### Fixed
- **Symbol scan path** (`scripts/release-check.mjs`): Fixed recursive `readdirSync` path construction to use `entry.parentPath` for correct nested-file resolution.
- **Unused import** (`scripts/release-check.mjs`): Removed unused `statSync` import.

### Tests
- 1 new release-check test: symbol hygiene with nested `src/` paths.

---

## [1.29.1] - 2026-04-30

### Fixed
- **WHATS_NEW.md stale references**: Removed treeHasMissing and collectErrorRows helper references from v1.29.0 section that were removed from source before release.

---

## [1.29.0] - 2026-04-30

### Added
- **Chunk warning classification** (`src/services/source-index/parser.ts`): `chunkBoundaryWarningCount` and `chunkActionableWarningCount` computed from parse results. All chunk parse warnings are boundary artifacts (chunked parsing breaks multi-line constructs); only no-tree and throw conditions count as actionable.
- **Agent workflow-command contract docs** (`docs/CREATE_SKILLS.md`): New `## Agent Workflow-Command Contract` section documenting enforced indexing diagnostic commands and workflow rules.

### Changed
- **Docs accuracy** (`README.md`, `docs/ARCHITECTURE.md`, `docs/SKILLS_INTEGRATION.md`): Removed stale v1.0.x version references from current-version documentation.
- **Dogfood stale-docs gate** (`scripts/dogfood.mjs`): Feature-introduced marker lines (`(v1.0.x+)`, `pre-v1.0.x`) are excluded from stale-docs detection.

---

## [1.28.0] - 2026-04-30

### Added
- **Generated skills parser diagnostics** (`src/services/skills-generator/content.ts`): Required Agent Workflow now steps agents through `--health`, `--recovered`, and `--parse-errors` with `--index-format json` before file-level diagnostics.
- **Quality gate agent workflow contract** (`src/services/skills-generator/quality-gate.ts`): `INDEX_COMMANDS` now validates `--health`, `--recovered`, and `--parse-errors`. Missing commands are hard errors.
- **Doctor chunk aggregate telemetry** (`src/types/index.ts`, `src/commands/create-skills.ts`): `DoctorIndexInfo` gains optional `chunkedFiles`, `totalChunks`, `totalChunkWarnings`, `chunkSize` fields. Populated when chunked files exist. Console output shows compact chunk line.

### Changed
- **AGENTS.md** (`AGENTS.md`): Health-first workflow documented with `chunked-tree-sitter` in recovery drilldown.
- **Dogfood extended** (`scripts/dogfood.mjs`): Doctor step validates chunk aggregate field presence/absence based on `parserModeBreakdown["chunked-tree-sitter"]`.

---

## [1.27.0] - 2026-04-30

### Added
- **Shared parser telemetry serializer** (`src/services/source-index/query.ts`): `getParserTelemetry(file, options?)` unifies all parser diagnostic fields in one call. `getChunkFields(file)` convenience wrapper for chunk-only call sites. `FileInfo` interface extended with `parseErrorMessages`, `chunkCount`, `chunkSize`, `chunkWarningCount`.
- **Aggregate chunk stats** (`src/types/index.ts`, `src/commands/indexing.ts`): `IndexHealthOutput` gains optional `chunkedFiles`, `totalChunks`, `totalChunkWarnings`, `chunkSize` fields. New `getChunkTelemetry()` helper. Surfaced in `--health` and `--stats` JSON and console output.

### Changed
- **Consistent telemetry propagation** (`src/commands/indexing.ts`): `--explain-index` and `--agent-context` now include chunk telemetry for `chunked-tree-sitter` files. `handleDrilldown()`, `handleExplain()`, `handleAgentContext()` all use `getParserTelemetry()`.
- **Dogfood extended** (`scripts/dogfood.mjs`): Health step validates aggregate chunk fields. Index queries step checks chunk fields in `agent-context` and `explain-index` per parser mode.
- **`queryAgentContext()`** (`src/services/source-index/query.ts`): Emits `parseErrors` as count with `parseErrorMessages` array in agent-context mode.

---

## [1.26.1] - 2026-04-30

### Fixed
- **Dedup chunk fields** (`src/commands/indexing.ts`): Removed duplicate `chunkCount`/`chunkSize`/`chunkWarningCount` spreads in `handleDrilldown()` output construction.
- **Stale comments** (`src/commands/indexing.ts`, `src/types/index.ts`): `getParserModeBreakdown()` no longer references pre-1.3 caches. `DoctorIndexInfo.recoveredFiles` JSDoc now includes `chunked-tree-sitter`.

---

## [1.26.0] - 2026-04-30

### Added
- **Chunk telemetry fields** (`src/types/index.ts`, `src/services/source-index/parser.ts`, `src/commands/indexing.ts`): `chunkCount`, `chunkSize`, `chunkWarningCount` added to `SourceIndexFile`. Surfaced in `--recovered` drilldown entries for `chunked-tree-sitter` files.

### Changed
- **Dogfood lexical-fallback guard** (`scripts/dogfood.mjs`): Health check asserts `parserModeBreakdown["lexical-fallback"] === 0` after fresh index build. Non-zero = silent parser regression.
- **Dogfood chunk validation** (`scripts/dogfood.mjs`): Parser drilldown validates `chunkCount` >= 2, `chunkSize` > 0, `chunkWarningCount` is numeric, `parseWarnings` includes chunked indicator, and non-zero content counts for every `chunked-tree-sitter` recovered file.

---

## [1.25.0] - 2026-04-30

### Added
- **Chunked Tree-sitter parser recovery** (`src/services/source-index/parser.ts`): New `chunkedParse()` fallback that splits large content on line boundaries (MAX_CHUNK_SIZE=30000), parses each chunk independently via Tree-sitter, and merges results with correct line offsets. Positioned between full-file Tree-sitter and ASCII normalization in the recovery chain. Imports/exports are deduplicated across chunks.
- **New parser mode** (`src/types/index.ts`): `chunked-tree-sitter` added to the `ParserMode` union.

### Changed
- **Recovery chain order**: `Invalid argument` → chunked Tree-sitter → ASCII normalization → lexical fallback (was: ASCII normalization → lexical fallback).
- **Telemetry** (`src/commands/indexing.ts`, `src/commands/create-skills.ts`): `getRecoveredFileCount`, `getParserModeBreakdown`, drilldown recovered filter, and doctor recovered count all include `chunked-tree-sitter`. Console breakdown displays include `chunked-tree-sitter`.
