# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.29.1] - 2026-04-30

### Fixed
- **WHATS_NEW.md stale references**: Removed treeHasMissing and collectErrorRows helper references from v1.29.0 section that were removed from source before release.

## [1.29.0] - 2026-04-30

### Added
- **Chunk warning classification** (`src/services/source-index/parser.ts`): `chunkBoundaryWarningCount` and `chunkActionableWarningCount` computed from parse results. All chunk parse warnings are boundary artifacts (chunked parsing breaks multi-line constructs); only no-tree and throw conditions count as actionable.
- **Agent workflow-command contract docs** (`docs/CREATE_SKILLS.md`): New `## Agent Workflow-Command Contract` section documenting enforced indexing diagnostic commands and workflow rules.

### Changed
- **Docs accuracy** (`README.md`, `docs/ARCHITECTURE.md`, `docs/SKILLS_INTEGRATION.md`): Removed stale v1.0.x version references from current-version documentation.
- **Dogfood stale-docs gate** (`scripts/dogfood.mjs`): Feature-introduced marker lines (`(v1.0.x+)`, `pre-v1.0.x`) are excluded from stale-docs detection.

## [1.28.0] - 2026-04-30

### Added
- **Generated skills parser diagnostics** (`src/services/skills-generator/content.ts`): Required Agent Workflow now steps agents through `--health`, `--recovered`, and `--parse-errors` with `--index-format json` before file-level diagnostics.
- **Quality gate agent workflow contract** (`src/services/skills-generator/quality-gate.ts`): `INDEX_COMMANDS` now validates `--health`, `--recovered`, and `--parse-errors`. Missing commands are hard errors.
- **Doctor chunk aggregate telemetry** (`src/types/index.ts`, `src/commands/create-skills.ts`): `DoctorIndexInfo` gains optional `chunkedFiles`, `totalChunks`, `totalChunkWarnings`, `chunkSize` fields. Populated when chunked files exist. Console output shows compact chunk line.

### Changed
- **AGENTS.md** (`AGENTS.md`): Health-first workflow documented with `chunked-tree-sitter` in recovery drilldown.
- **Dogfood extended** (`scripts/dogfood.mjs`): Doctor step validates chunk aggregate field presence/absence based on `parserModeBreakdown["chunked-tree-sitter"]`.

## [1.27.0] - 2026-04-30

### Added
- **Shared parser telemetry serializer** (`src/services/source-index/query.ts`): `getParserTelemetry(file, options?)` unifies all parser diagnostic fields in one call. `getChunkFields(file)` convenience wrapper for chunk-only call sites. `FileInfo` interface extended with `parseErrorMessages`, `chunkCount`, `chunkSize`, `chunkWarningCount`.
- **Aggregate chunk stats** (`src/types/index.ts`, `src/commands/indexing.ts`): `IndexHealthOutput` gains `chunkedFiles`, `totalChunks`, `totalChunkWarnings`, `chunkSize` optional fields. New `getChunkTelemetry()` helper. Surfaced in `--health` and `--stats` JSON and console output.

### Changed
- **Consistent telemetry propagation** (`src/commands/indexing.ts`): `--explain-index` and `--agent-context` now include chunk telemetry for `chunked-tree-sitter` files. `handleDrilldown()`, `handleExplain()`, `handleAgentContext()` all use `getParserTelemetry()`.
- **Dogfood extended** (`scripts/dogfood.mjs`): Health step validates aggregate chunk fields. Index queries step checks chunk fields in `agent-context` and `explain-index` per parser mode.
- **`queryAgentContext()`** (`src/services/source-index/query.ts`): Emits `parseErrors` as count with `parseErrorMessages` array in agent-context mode.

## [1.26.1] - 2026-04-30

### Fixed
- **Dedup chunk fields** (`src/commands/indexing.ts`): Removed duplicate `chunkCount`/`chunkSize`/`chunkWarningCount` spreads in `handleDrilldown()` output construction.
- **Stale comments** (`src/commands/indexing.ts`, `src/types/index.ts`): `getParserModeBreakdown()` no longer references pre-1.3 caches. `DoctorIndexInfo.recoveredFiles` JSDoc now includes `chunked-tree-sitter`.

## [1.26.0] - 2026-04-30

### Added
- **Chunk telemetry fields** (`src/types/index.ts`, `src/services/source-index/parser.ts`, `src/commands/indexing.ts`): `chunkCount`, `chunkSize`, `chunkWarningCount` added to `SourceIndexFile`. Surfaced in `--recovered` drilldown entries for `chunked-tree-sitter` files.

### Changed
- **Dogfood lexical-fallback guard** (`scripts/dogfood.mjs`): Health check asserts `parserModeBreakdown["lexical-fallback"] === 0` after fresh index build. Non-zero = silent parser regression.
- **Dogfood chunk validation** (`scripts/dogfood.mjs`): Parser drilldown validates `chunkCount` >= 2, `chunkSize` > 0, `chunkWarningCount` is numeric, `parseWarnings` includes chunked indicator, and non-zero content counts for every `chunked-tree-sitter` recovered file.

## [1.25.0] - 2026-04-30

### Added
- **Chunked Tree-sitter parser recovery** (`src/services/source-index/parser.ts`): New `chunkedParse()` fallback that splits large content on line boundaries (MAX_CHUNK_SIZE=30000), parses each chunk independently via Tree-sitter, and merges results with correct line offsets. Positioned between full-file Tree-sitter and ASCII normalization in the recovery chain. Imports/exports are deduplicated across chunks.
- **New parser mode** (`src/types/index.ts`): `chunked-tree-sitter` added to the `ParserMode` union.

### Changed
- **Recovery chain order**: `Invalid argument` → chunked Tree-sitter → ASCII normalization → lexical fallback (was: ASCII normalization → lexical fallback).
- **Telemetry** (`src/commands/indexing.ts`, `src/commands/create-skills.ts`): `getRecoveredFileCount`, `getParserModeBreakdown`, drilldown recovered filter, and doctor recovered count all include `chunked-tree-sitter`. Console breakdown displays include `chunked-tree-sitter`.
- **Dogfood** (`scripts/dogfood.mjs`): Required modes assertion relaxed — validates breakdown shape rather than specific mode names.

### Tests
- 2 new parser unit tests: large file symbol line number preservation, imports/exports across chunk boundaries.
- Updated recovered drilldown test filter to accept all recovery modes.

## [1.24.0] - 2026-04-30

### Added
- **Drilldown `suggestedCommands`** (`src/commands/indexing.ts`): Each file entry in `--recovered` and `--parse-errors` JSON output now includes `suggestedCommands` with `mp-sentinel indexing --explain-index "<path>" --index-format json` and `mp-sentinel indexing --agent-context "<path>" --index-format json`. Paths use forward-slash normalization and double-quoting via `quoteCliArg`.

### Changed
- **Dogfood** (`scripts/dogfood.mjs`): Parser drilldown step validates first recovered file has `suggestedCommands` when files are present.
- **Docs** (`docs/COMMANDS_CHEAT_SHEET.md`): Health → drilldown workflow updated with per-file `suggestedCommands` documentation.

### Tests
- 5 new tests for drilldown `suggestedCommands`: recovered entries, parse-error entries, path normalization, determinism, empty drilldown.

## [1.23.0] - 2026-04-30

### Changed
- **Doctor `recommendedCommands` policy** (`src/commands/create-skills.ts`): Recovered-only parser state is advisory — it appears under `index.suggestedCommands` but is excluded from top-level `recommendedCommands`. Only hard parse error drilldowns (`--parse-errors`) appear in both locations.

### Tests
- Health JSON `suggestedCommands`: 3 new tests (recovered, hard parse errors, clean index).
- Doctor drilldown policy: 2 updated tests for `recommendedCommands` vs `index.suggestedCommands` placement.

## [1.22.0] - 2026-04-30

### Added
- **Parser recovery drilldown** (`src/commands/indexing.ts`, `src/cli/args.ts`): Two new read-only indexing flags `--recovered` and `--parse-errors` for inspecting parser recovery state. `--recovered` lists files recovered via fallback parser. `--parse-errors` lists files with hard parse errors. Both output JSON to stdout, cap at 50 files sorted by path, exit `0` on success, exit `1` when cache is missing/unreadable. The two flags are mutually exclusive.
- **Doctor drilldown recommendations** (`src/commands/create-skills.ts`): Recovered file warnings now recommend `mp-sentinel indexing --recovered --index-format json`. Hard parse error failures now recommend `mp-sentinel indexing --parse-errors --index-format json`.
- **Dogfood parser drilldown step** (`scripts/dogfood.mjs`): New step 12 validates `--recovered` and `--parse-errors` JSON output shape. `TOTAL_STEPS` bumped 11 → 12.

### Changed
- **Agent preferred commands** (`AGENTS.md`): Added `--recovered` and `--parse-errors` to preferred source index commands list.
- **Cheat sheet** (`docs/COMMANDS_CHEAT_SHEET.md`): Added both drilldown commands with usage examples and explanation.

## [1.21.0] - 2026-04-30

### Added
- **Doctor parser recovery summary** (`src/commands/create-skills.ts`, `src/types/index.ts`): `DoctorIndexInfo` now includes `parseErrorRate`, `recoveredFiles`, `parserModeBreakdown`, `parseErrorCount`, and `hardParseErrorFilesSample`. Hard parse errors are reported as `[fail] Action Required` (exit 1) with actionable commands. Recovered files (fallback-parsed, no hard errors) are reported as `[warn] Advisory`. Console output shows per-mode parser breakdown under `[ok] Healthy`.
- **Generated skills parser recovery note** (`src/services/skills-generator/content.ts`): New `### Parser Recovery` subsection under `## Architecture` in generated skill files. Renders only when recovered files or hard parse errors exist, showing one-line ASCII breakdown and up to 3 sample error paths.

### Tests
- 9 new doctor parser telemetry tests: computation, categorization, console output, JSON output, and edge cases.

## [1.20.0] - 2026-04-29

### Fixed
- **Parser ASCII fallback** (`src/services/source-index/parser.ts`): Tree-sitter `Invalid argument` errors on Windows (caused by Unicode box-drawing, em dashes, smart quotes in source comments) are now caught and retried with in-memory ASCII normalization. Symbols, imports, and exports are preserved. Errors are annotated with `"Invalid argument; parsed with ASCII fallback"`.
- **Dist freshness guard** (`scripts/dogfood.mjs`, `scripts/release-check.mjs`): Dogfood step 2 smoke-tests `dist/index.js indexing --health --index-format json`. Release-check validates `dist/index.js --version` matches `package.json` and `indexing --help` contains required flags.
- **Health type cleanup** (`src/types/index.ts`, `src/commands/indexing.ts`): Local `HealthOutput` interface moved to shared types as `IndexHealthStatus` and `IndexHealthOutput`. Health sample cap reduced from 10 to 5.
- **Test fixture ASCII hardening**: All test source files with literal risky Unicode converted to `\u` escapes so source remains ASCII. Box-drawing comment separators replaced with ASCII dashes.

### Tests
- 1 new `--health` CLI arg parse test.
- 4 new parser ASCII fallback tests.
- 3 new release-check dist freshness tests.

## [1.19.0] - 2026-04-29

### Added
- **Source index health CLI** (`src/commands/indexing.ts`): New `--health` flag on `mp-sentinel indexing` for read-only cache diagnostic. Reports JSON with `status` (`ok`, `missing`, `unreadable`, `stale`), `schemaVersion`, `totalFiles`, `parseErrorRate`, `manifestHash` vs `currentManifestHash`, `staleReasons`, and samples of changed/missing files. No build, no cache writes, no AI calls. Exit codes: `0` = healthy, `1` = missing/stale/unreadable, `2` = error.

- **Generated skill contract guard** (`src/services/skills-generator/quality-gate.ts`): `checkAgentWorkflowContract()` now enforces strict per-command validation. Each of 5 index commands (`--agent-context`, `--explain-index`, `--find-symbol`, `--find-import`, `--stats`) must be individually present with `--index-format json` on the same line. `--explain-context` must be present with `--format json` on the same line. Replaces the previous fuzzy check that accepted any one of seven patterns.
- **AI enrichment readiness in doctor** (`src/commands/create-skills.ts`, `src/types/index.ts`): `--doctor` now reports AI enrichment readiness without any network calls. New `DoctorAIEnrichmentReadinessInfo` type with status (`disabled`, `ready`, `action-required`). Validates provider against known list (gemini, openai, anthropic, grok) and checks for the corresponding API key env var. `action-required` status triggers exit 1; `disabled` is informational only.

### Tests
- 7 new `--health` tests: missing cache, corrupt cache, manifest changed, source file changed, deleted indexed file, healthy index, JSON stdout isolation.
- 10 new contract guard tests: valid workflow, 6 individual missing-command tests, 2 missing-format-flag tests, 1 regression test for partial compliance.
- 6 new AI readiness doctor tests: disabled, missing API key, ready, invalid provider, JSON output schema, no-network-call assertion.

## [1.18.0] - 2026-04-29

### Added
- **Positive explain-context dogfood** (`scripts/dogfood.mjs`): New `stepPositiveExplainContext()` validates `--explain-context` with indexing enabled via a temp fixture project. Asserts `status=available`, `indexUsed=true`, non-empty `includedFiles` + `suggestedCommands`. Total dogfood steps 9→10.
- **Doctor manifest freshness** (`src/commands/create-skills.ts`): `runDoctor` now compares current manifest hash against cached `index.manifestHash`. Reports `stale` when hashes differ (changed manifest inputs) or when no `manifestHash` exists (legacy index).
- **Safe suggested command formatter** (`src/services/source-index/query.ts`): New `quoteCliArg()` normalizes backslashes, escapes embedded double quotes, and wraps values in double quotes. Used by all suggested command builders in `query.ts` and `context-builder.ts`.

### Tests
- 3 new doctor manifest freshness tests (`--doctor` legacy index, changed manifest, matching hash).
- 8 new `quoteCliArg` + suggestedCommands tests (quoting, normalization, escaping, dedup, determinism).
- Dogfood step count updated 9→10.

## [1.17.0] - 2026-04-29

### Added
- **Source query path robustness** (`src/services/source-index/query.ts`): New `normalizePath()` helper for cross-platform path handling (backslash→forward-slash, project root stripping, leading slash stripping). `queryAgentContext()` now accepts optional `projectRoot` for absolute path resolution.
- **Reference routing quality gate** (`src/services/skills-generator/quality-gate.ts`): `checkReferenceRouting()` validates routing tables for file-pattern-as-directory bugs, unknown reference names, missing fallback rows, and malformed markup.
- **Explain context action hints** (`src/services/source-index/context-builder.ts`): `buildReviewContext()` generates capped, deduplicated suggested follow-up commands (`--agent-context`, `--find-import`, `--find-symbol`) from context files and dependency signals. Surfaced in `--explain-context` JSON and console output.

### Fixed
- Reference routing quality gate: separator row (`|---|---|`) no longer parsed as a data row.

### Tests
- 8 path robustness tests for `queryAgentContext()` (backslash, absolute, Windows-style, missing file, outside project).
- 9 reference routing quality gate tests (well-formed table, file-as-directory, unknown refs, missing fallback, malformed markup, row cap warning).
- 4 explain context tests (JSON includes suggestedCommands, absent when unavailable, console output, ASCII-safe).

## [1.16.1] - 2026-04-29

### Fixed
- **Reference Routing path rendering**: `buildReferenceRouting()` no longer renders individual source files (`src/lib.ts`, `src/index.ts`) as directory patterns with trailing slashes. File names are now distinguished from directory names during candidate extraction. Regression test added to verify no `file.ext/` patterns appear in generated routing output.

## [1.16.0] - 2026-04-29

### Added
- **Source index query service** (`src/services/source-index/query.ts`): Extracted `querySymbols()`, `queryImports()`, and `queryAgentContext()` pure functions from the indexing command layer. Multi-tier scoring (exact=100, case-insensitive=90, starts-with=70, contains=50). `indexing.ts` command handlers now delegate to the query service for data; console/JSON rendering stays in the command layer.
- **Skill reference routing** (`src/services/skills-generator/content.ts`): New `buildReferenceRouting(index, kb)` generates a data-driven "Reference Routing" section in generated agent skills. Routes cover source index references (symbols, imports, hub files) with concrete file paths. Added to all 7 adapters. Quality gate max sizes raised (SKILL_MD 3000→3600, SINGLE_FILE 20000→21000).
- **Dogfood query guard**: New `stepIndexQuery` (step 4 in `dogfood.mjs`) smoke-tests `--agent-context`, `--find-symbol`, and `--find-import` diagnostics. Validates JSON shape and non-empty results. Total steps 8→9.

### Tests
- 22 new unit tests for source index query service (null/empty index, scoring accuracy, sort order, result capping, missing target errors, agent context shape).
- 12 new tests for skill reference routing (7 routing content + 4 quality gate integration + 1 quality gate section fixture).
- Dogfood-related tests updated for new step count (8→9).

## [1.15.1] - 2026-04-29

### Fixed
- **Agent skill `--index-format json` consistency**: All indexing diagnostic commands in generated agent skills now include `--index-format json` (`--agent-context`, `--find-symbol`, `--find-import`). Quick-start search examples also include the JSON format flag. Previously inconsistent with `--explain-index` and `--stats` which already had it.
- **Windows console ASCII safety**: Replaced em dashes (U+2014) with ASCII hyphens in `--explain-context` console evidence lines, review context intelligence signal lines, and profile-specific review pitfalls. Conforms to the existing "ASCII only, no emoji" console output contract.

### Tests
- Updated `create-skills.test.ts` agent workflow assertions to verify `--index-format json` on all diagnostic commands.
- New ASCII safety test in `explain-context.test.ts` verifying console output with intelligence signals contains no risky Unicode.

## [1.15.0] - 2026-04-29

### Added
- **Agent context pack CLI**: `indexing --agent-context <file>` flag outputs a capped JSON context pack with file symbols (30), imports/exports (20), direct imports/dependents (10), hub files (5), and suggested follow-up commands. Read-only (uses existing cache). Console output is ASCII-only; JSON output writes only valid JSON to stdout.
- **Skills search workflow upgrade**: Generated agent skills now include `--agent-context`, `--find-symbol`, and `--find-import` in the Required Agent Workflow. New `buildSearchExamples()` function generates codebase-specific examples from real index data (top hub file, top dependency, representative symbol). Quality gate `checkAgentWorkflowContract()` expanded to recognize all three diagnostics.
- **Review context evidence tightening**: New `EvidenceSummary` type (`{ sourceFile, signalType, evidence }`) added to `ReviewContextMetadata` and `ExplainContextOutput`. `buildReviewContext()` derives compact `evidenceSummary` from deduplicated `intelligenceSignals`. `renderExplainContext` surfaces it in JSON and console output. Backward compatible — no budget or context-string changes.

### Tests
- **Agent context CLI**: 9 new tests in `indexing.test.ts` covering JSON shape, missing file, imports/dependents, hub files, suggested commands, log-free stdout, ASCII-safe console, and empty query validation.
- **Skills search workflow**: Updated assertions in `create-skills.test.ts` for new diagnostics; tests for codebase-specific search examples.
- **Review evidence**: 18 new tests in `review-intelligence-fixtures.test.ts` + 6 new tests in `src/tests/explain-context.test.ts` covering all signal types, graceful degradation, and backward compat.

## [1.14.1] - 2026-04-29

### Fixed
- **ASCII-only test comments**: Replaced box-drawing characters (U+2500) and em dashes (U+2014) with ASCII hyphens in `src/tests/script-workflows.test.ts` comment separators and prose. No runtime or production code changes.

## [1.14.0] - 2026-04-29

### Added
- **Source index query CLI**: `indexing --find-symbol <query>` and `indexing --find-import <query>` flags for cache-based codebase search. `--find-symbol` searches all indexed symbols (functions, classes, interfaces, types, enums, variables, methods, arrow functions) with multi-tier scoring (exact 100 > case-insensitive 90 > starts-with 70 > contains 50). `--find-import` searches import statements (exact source 100 > case-insensitive source 90 > source contains 70 > imported name match 60). Both read-only (use existing cache, never force-rebuild), cap results at 20, sort by score desc then file path. JSON output writes only valid JSON to stdout; console output is ASCII-only.
- **Adapter spec contract guard**: `validateAdapterSpec()` and `validateAllAdapterSpecs()` functions in `quality-gate.ts` validate adapter spec completeness (`officialDocsUrl`, `outputKind`, `workspacePath`, `requiredFiles`, `frontmatterRules`, `sizeLimit`). Generic adapter is skipped. Exported from `src/services/skills-generator/index.ts`.
- **Script workflow regression harness**: 14 new tests in `src/tests/script-workflows.test.ts` covering `release-check.mjs` (8 tests), `dogfood.mjs` (2 tests), `agent-skills-check.mjs` (2 tests), and Unicode safety (2 tests). Zero production code changes — test-only.

### Tests
- **Source index query**: 17 new tests in `indexing.test.ts` covering CLI arg parsing (4), `--find-symbol` (6), and `--find-import` (7).
- **Adapter spec guard**: 9 new tests in `quality-gate.test.ts` + 4 new tests in `create-skills.test.ts`.
- **Script workflows**: 14 new tests in `script-workflows.test.ts`.

## [1.13.0] - 2026-04-29

### Added
- **Doctor AI enrichment cache diagnostics**: `create-skills --doctor` now reports AI enrichment cache status with entry count and total bytes. New types: `DoctorAIEnrichmentCacheStatus` (`"available" | "missing" | "unreadable"`) and `DoctorAIEnrichmentCacheInfo` (`{ status, path, entries, bytes, reason? }`). New `aiEnrichmentCache` field in `DoctorOutput`. Console output shows cache health under `[ok]` or `[warn]` sections. Cache issues are advisory-only — no impact on exit code, status, or recommended actions.
- **Dogfood agent:skills:check gate**: `scripts/dogfood.mjs` step 8 validates `npm run agent:skills:check --silent` as a release gate, ensuring generated agent skill files are verified before every release.

### Changed
- **AGENTS.md release checklist**: Dogfood step description now includes doctor and `agent:skills:check` in the documented step list.
- **Dogfood step renumbering**: Bumped `TOTAL_STEPS` from 7 to 8; all step labels updated from `[1/7]..[7/7]` to `[1/8]..[8/8]`.

### Fixed
- **`create-skills.ts`**: Missing `aiEnrichmentCache` field in doctor JSON output object — was computed but not included, causing `tsc` failure. Missing `join` import from `node:path`.

### Tests
- **AI enrichment cache hardening**: 4 new tests in `ai-enrichment.test.ts` covering schema mismatch rejection (wrong shape, missing fields), cache write failure non-blocking, and temp/partial file exclusion.
- **Doctor cache diagnostics**: 6 new tests in `create-skills.test.ts` covering JSON output shape, missing cache dir, valid cache counting, ASCII-only console output, and exit code independence.

## [1.12.1] - 2026-04-29

### Changed
- **Cache spec status**: `docs/AI_ENRICHMENT_CACHE_SPEC.md` updated from "design doc -- no runtime implementation yet" to "Implemented in v1.12.0" with an "Implemented behavior" section documenting runtime cache behavior (hit skips provider, corrupt fallback, warning isolation, atomic writes, projectRoot guard).

### Documentation
- Updated `WHATS_NEW.md` and `docs/CHANGELOG.md` (this file) for v1.12.1.
- README badge and "What's New" pointer bumped to v1.12.1.

## [1.12.0] - 2026-04-29

### Added
- **AI enrichment cache runtime**: File-based cache at `.mp-sentinel-cache/ai-enrichment/<cacheKey>.json` eliminates redundant AI provider calls when the source index hasn't changed. The cache key is a composite SHA256 hash of source index hash, provider, model, prompt version, and input hash. Cache hits skip the provider call entirely and return the cached result.
- **`computeEnrichmentCacheKey()`**: New exported function in `ai-enrichment.ts` computing the composite cache key from five components.
- **`readEnrichmentCache()` / `writeEnrichmentCache()`**: New exported helpers for cache I/O with Zod envelope validation, corrupt cache detection + deletion, and atomic writes (temp file then rename).
- **`callEnrichmentProvider()`**: Internal helper extracted from `enrichIndex()` shared by both cached and uncached paths.

### Changed
- **`enrichIndex()`**: Now accepts optional `projectRoot` in `AIEnrichmentConfig`. When provided, checks the cache before calling the provider, and writes the cache after a successful provider call. When absent, behavior is unchanged (no cache interaction).
- **`create-skills.ts`**: Passes `projectRoot` to `enrichIndex()` config, enabling cache usage.
- **Spec typo fix**: `framewords` -> `frameworks` in `docs/AI_ENRICHMENT_CACHE_SPEC.md`.

## [1.11.0] - 2026-04-29

### Added
- **Import classification in --explain-index**: The `indexing --explain-index <file>` output now classifies each import as `internal` (resolved to another source file in the index), `local` (unresolved but with a local-looking path), or `external` (package/remote). Import specifiers and resolved paths are extension-normalized so ESM `.js` → `.ts` mapping works correctly.
- **Lane E fixture regression harness**: `review-intelligence-fixtures.test.ts` now covers all 4 project profiles with 47+ tests validating signal precision (`public-api`, `risk`, `test-gap`, `dependency`), graceful degradation (null index, parse errors, empty lists), quality assertions (ordering, dedup, budget), and `--explain-context --format json` output shape.
- **AI enrichment cache spec**: `docs/AI_ENRICHMENT_CACHE_SPEC.md` defines a deterministic file-based cache for AI enrichment results. The cache key is a SHA256 composite of source index hash, provider, model, prompt version, and input hash. Spec covers cache path, read/write flow, invalidation policy, failure policy, and JSON/doctor/check interaction contracts. Design-only — no runtime implementation.

### Changed
- **ASCII-safe spec docs**: All documentation uses ASCII-safe punctuation (hyphens instead of em/en dashes, `->` instead of arrows) for terminal readability.

## [1.10.0] - 2026-04-29

### Added
- **`.mts`/`.cts` support**: Source indexing now parses `.mts` (ESM TypeScript) and `.cts` (CJS TypeScript) file extensions. Both are included in the default language filter alongside `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`.
- **tsconfig `extends` resolution**: `tsconfig.json` `extends` chains are now resolved and merged, ensuring path aliases (`compilerOptions.paths`, `baseUrl`) from extended configs are correctly applied during import resolution.
- **`maxFileSize` enforcement**: Files exceeding `indexing.maxFileSize` (default 512 KB) are now correctly skipped during both full and incremental indexing, preventing tree-sitter parse timeouts on large generated files. Skipped files are counted in `indexStats.skippedFiles`.
- **AI enrichment determinism tests**: Comprehensive unit tests for `ai-enrichment.ts` covering cache key stability, input/output JSON shape, error handling, and no-network graceful degradation.

### Changed
- **Review intelligence signal precision**: Signal detection for `public-api`, `risk`, `test-gap`, and `dependency` now has tighter edge-case handling and error isolation. False positives reduced when index is healthy but has sparse insights data.

### Fixed
- **Incremental indexing parse-error resilience**: `buildSourceIndex()` no longer aborts incremental re-indexing when a small batch of changed files fails to parse while a healthy cache exists. The abort decision now evaluates final index health (`totalParseErrors / allFiles.length`) instead of the incremental batch rate. Files that fail to re-parse fall back to existing cached entries when available.
- **Never overwrite a good cache**: If an incremental update would push the overall parse-error rate above 50% while the existing cache was healthy, the existing cache is preserved rather than being overwritten with a degraded index.
- **`create-skills --check` no longer blocked by incremental parse failures**: The `create-skills --check --format json` flow (used by `agent:skills:check`) now returns structured `{ check: [...] }` JSON even when incremental parse errors exist and a good cache is present.

## [1.9.2] - 2026-04-29

### Fixed
- **Incremental indexing parse-error resilience**: `buildSourceIndex()` no longer aborts incremental re-indexing when a small batch of changed files fails to parse while a healthy cache exists. The abort decision now evaluates final index health (`totalParseErrors / allFiles.length`) instead of the incremental batch rate. Files that fail to re-parse fall back to existing cached entries when available.
- **Never overwrite a good cache**: If an incremental update would push the overall parse-error rate above 50% while the existing cache was healthy, the existing cache is preserved rather than being overwritten with a degraded index.
- **`create-skills --check` no longer blocked by incremental parse failures**: The `create-skills --check --format json` flow (used by `agent:skills:check`) now returns structured `{ check: [...] }` JSON even when incremental parse errors exist and a good cache is present.

## [1.9.1] - 2026-04-29

### Changed
- **Grouped legacy advisories in doctor**: `recommendedActions` and console `[warn] Advisory` output now group legacy files by agent (one entry per agent) instead of emitting one entry per file. The full per-file list is preserved in the JSON `legacyFiles` field.
- **Grouped `agent:skills:check` legacy output**: Legacy advisories now print one grouped line per agent instead of one line per file. Exit code remains `0` when only legacy advisories exist.
- **No `recommendedCommands` for legacy cleanup**: Deletion requires user confirmation, so no automated command is generated. Legacy files remain advisory-only.

### Documentation
- Updated `docs/CREATE_SKILLS.md`, `WHATS_NEW.md`, and `docs/CHANGELOG.md` (this file) with v1.9.1 details.
- README badge and "What's New" pointer bumped to v1.9.1.

## [1.9.0] - 2026-04-29

### Added
- **`risky-unicode` quality-gate check**: New deterministic check (`checkRiskyUnicode`) flags 12 risky Unicode characters in generated skill files: em dash, en dash, right/left arrows, ellipsis, smart quotes (single/double), checkmark, ballot x. Severity: error. Surfaced in `--check`, `--dry-run`, and `--doctor` flows.

### Changed
- **ASCII-safe generated skill prose**: All em dashes (U+2014), ellipsis (U+2026), and other non-ASCII punctuation replaced with ASCII equivalents across `content.ts`, `knowledge-base.ts`, `ai-enrichment.ts`, and 7 adapter files (~80 replacements total). Generated skill files now render correctly in terminals and AI agent readers.
- **Doctor console ASCII output**: `create-skills --doctor` console rendering uses ASCII hyphens instead of em dashes in script descriptions and command sections.

### Fixed
- **Double-space artifacts**: Cleaned up `  -  ` (double-space around hyphen) artifacts from em dash replacement via normalization pass.
- **Smart-quote hygiene**: Replaced Unicode bullet (U+2022) with ASCII asterisk in AI enrichment templates.

## [1.8.0] - 2026-04-28

### Added
- **`recommendedCommands` in doctor JSON output**: Machine-runnable commands in execution order, separate from human-readable `recommendedActions`. Commands follow policy: missing index → `mp-sentinel indexing`, stale index → `mp-sentinel indexing --force`, stale/missing skills → `npm run agent:skills:refresh` (preferred when script exists) or `mp-sentinel create-skills --all-agents --force` (fallback).
- **`DoctorActionEntry` type**: New type with optional `commands` field for findings that suggest remediation commands.
- **`categorizeDoctorFindings()` helper**: Internal helper centralizes all doctor finding categorization (index, skills, legacy, scripts) into `recommendedActions`, `recommendedCommands`, `failItems`, and `warnItems`.

### Changed
- **Console output regrouped by severity**: Doctor console now renders `[fail] Action Required`, `[warn] Advisory`, and `[ok] Healthy` sections instead of category-based `[Agents]`/`[Index]`/`[Skills]`/`[Legacy]`/`[Scripts]`/`[Recommended]` sections.
- **`[x]` marker removed**: Replaced with `[fail]` for action-required findings and `[warn]` for advisories. Non-detected agents are neutral (appear in `[ok]` section as "not detected").
- **Status policy**: Legacy files and missing scripts are advisory-only and no longer contribute to `action-required` status. Only index issues, skill issues, and quality errors trigger exit 1.
- **Dogfood doctor step**: Now validates `recommendedCommands` as array of non-empty trimmed strings.

## [1.7.1] - 2026-04-28

### Fixed
- **Dogfood step count consistency**: Step labels in `scripts/dogfood.mjs` now correctly show `[1/7]` through `[7/7]` for all seven steps. Added `TOTAL_STEPS` constant to prevent recurrence.

## [1.7.0] - 2026-04-28

### Added
- **`--doctor` diagnostic mode**: `create-skills --doctor` performs a comprehensive read-only health check covering agent detection, source index cache status, generated skill file freshness, quality gate results, legacy/unexpected files, and npm script availability. No file writes, no AI calls, no auto-indexing. JSON output is stable and additive.
- **Dogfood coverage**: New doctor validation step in `scripts/dogfood.mjs`.

## [1.6.2] - 2026-04-28

### Changed
- **ASCII-only script output**: All `scripts/*.mjs` runtime output now uses ASCII exclusively. Replaced `—` (em dash) with `-` and `→` (right arrow) with `->` across `dogfood.mjs`, `agent-skills-check.mjs`, and `agent-skills-refresh.mjs`. Prevents mojibake on Windows/CI terminals.
- **Release guard**: `release:check` now scans all `scripts/*.mjs` files for output-risky Unicode characters (`—`, `→`, `←`, `…`) and fails if any are found.

## [1.6.1] - 2026-04-28

### Changed
- **Dogfood `--explain-agents` step**: `npm run dogfood` now includes a `create-skills --explain-agents --format json` smoke test that parses the JSON output and asserts all required fields (`projectName`, `defaultSelection`, `agents`, and per-agent `id`, `detected`, `selected`, `detectionSignals`, `resolvedOutput`, `officialDocsUrl`). Dogfood step count bumped from 5/5 to 6/6.
- **Docs**: `AGENTS.md` release checklist updated to mention `explain-agents` in the dogfood summary. `README.md` version pointer bumped to v1.6.1.

## [1.6.0] - 2026-04-28

### Added
- **`create-skills --explain-agents`**: Diagnostic mode that shows which agents/IDEs are detected, why (detection signals), and what output paths they resolve to — without writing files, building the source index, or calling AI.
- **`create-skills --explain-agents --format json`**: Machine-readable JSON output with `projectName`, `defaultSelection`, and per-agent `detected`, `selected`, `detectionSignals`, `outputKind`, `workspacePath`, `resolvedOutput`, and `officialDocsUrl` fields. JSON mode is allowed without `--agent` or `--all-agents`.
- **Detection contract documented**: `.claude/` detects Claude (root `CLAUDE.md` alone does not). `.agents/` or `.codex/` detects Codex. `.antigravity/` or `.agent/` detects Antigravity. `.clinerules/` detects Cline. Generic is never auto-detected.
- **Explain agent detection function** (`explainAgentDetection()`): New exported function in the skills-generator service that collects detection signals and computes default selection.

### Changed
- No breaking changes. Pure additive diagnostic feature.

## [1.5.0] - 2026-04-28

### Added
- **`npm run agent:skills:check`**: CI-style staleness gate (`scripts/agent-skills-check.mjs`) that calls `create-skills --all-agents --check --format json --no-ai-enrich`, parses JSON, and reports missing/stale/wrong-agent/quality errors with exit codes 0/1/2.
- **`npm run agent:skills:refresh`**: Regeneration script (`scripts/agent-skills-refresh.mjs`) that calls `create-skills --all-agents --force --format json --no-ai-enrich` then verifies with the check script.
- **Expanded legacy/unexpected artifact detection**: `detectUnexpectedGeneratedFiles()` scans known agent directories (`.claude/`, `.clinerules/`, `.cursor/`, `.agents/`, `.windsurf/`, `.antigravity/`) for `@mp-sentinel-generated` files at unexpected paths. Detects misplaced artifacts (e.g., claude skill under `.clinerules/`).
- **Combined detection**: `detectAllLegacyAndUnexpected()` merges legacy path matches and unexpected artifact scans with deduplication by path.

### Changed
- **`AGENTS.md` §1**: Agent workflow now enforces `agent:skills:check` → `agent:skills:refresh` before reading generated skills. Added all 7 adapter paths. Generated skills marked as local-only (not committed).
- **`CLAUDE.md`**: Added agent skills bootstrap section. Added generated skill paths to "Do not touch" list.
- **`.gitignore`**: Added `.agents/skills/`, `.cursor/rules/*-best-practices.mdc`, `.windsurf/rules/*-best-practices.md`, `.antigravity/rules/*-best-practices.md`, `.agents/rules/*-best-practices.md`.
- **`create-skills` command**: Now uses `detectAllLegacyAndUnexpected()` instead of `detectLegacyGeneratedFiles()` for broader diagnostics.

---

## [1.4.0] - 2026-04-28

### Added
- **Structured intelligence signal metadata** (`ReviewIntelligenceSignal`): Each review intelligence signal now carries `type`, `file`, `reason`, `evidence`, and `confidence` fields explaining why the signal was raised.
- **`intelligenceSignals` in `ReviewContextMetadata`**: `buildReviewContext()` populates `intelligenceSignals` alongside `includedSignals` (backward compatible). Signals are deduplicated by `type + file + evidence`.
- **`intelligenceSignals` in `--explain-context` JSON output**: Structured signal metadata is included alongside the existing `includedSignals` field.
- **Console explain-context summary**: Concise count-per-type summary line (`Signal details`) for quick diagnostics.

### Changed
- No breaking changes. `includedSignals` (string[]) is preserved. Indexes without `insights` gracefully fall back. No new CLI flags, no AI calls, no network calls.

## [1.3.0] - 2026-04-28

### Added
- **Review intelligence fixture harness**: `src/__tests__/helpers/fixture-builder.ts` creates 4 realistic profile fixtures (`cli-tooling`, `library`, `node-service`, `react-next`) with source files, tests, dependencies, and public API surface, each building a real source index through the pipeline.
- **`src/__tests__/review-intelligence-fixtures.test.ts`**: 47 tests covering signal precision (`public-api`, `risk`, `test-gap`, `dependency`), graceful degradation (null index, parse errors, empty lists), quality assertions (ordering, dedup, budget), and `--explain-context --format json` output shape validation across all 4 profiles.

### Changed
- No behavior or CLI contract changes. Pure test coverage for review intelligence regression protection.

## [1.2.0] - 2026-04-28

### Added
- **`npm run dogfood`**: New validation command that runs the core local workflow end-to-end without network calls. Steps: release:check → build → indexing --stats → create-skills --dry-run → explain-context. All JSON outputs are parsed programmatically. explain-context "unavailable" due to `indexing.enabled=false` is accepted as expected.
- **`scripts/dogfood.mjs`**: Zero-dependency ESM script powering the dogfood command. Published in the npm tarball.

### Changed
- **`package.json`**: Added `dogfood` script and `scripts/dogfood.mjs` to published files.

## [1.1.5] - 2026-04-28

### Added
- **Packaging self-check**: `release:check` now validates `package.json.files` includes `scripts/release-check.mjs` when the `release:check` script references it, and asserts required published entries (`dist`, `README.md`, `docs`, `WHATS_NEW.md`, `examples`) are present. Prevents packaging regressions like the v1.1.3 → v1.1.4 gap.

## [1.1.4] - 2026-04-28

### Fixed
- **Packaging**: Added `scripts/release-check.mjs` to `package.json.files` so `npm run release:check` works from installed packages, not just repo checkouts.

## [1.1.3] - 2026-04-28

### Added
- **`npm run release:check`**: Automated release consistency validation script (`scripts/release-check.mjs`) that verifies version alignment across `package.json`, `package-lock.json` (root and `packages[""]`), README badge/pointer, `WHATS_NEW.md`, and `CHANGELOG.md`.
- **Lockfile integrity guard**: Validates every `resolved` tarball URL in `package-lock.json` ends with `-<version>.tgz`, catching the class of corruption that v1.1.1 suffered from global version-string replacement.
- **9 focused tests** (`src/__tests__/release-check.test.ts`): Valid fixture passes; badge, What's New, WHATS_NEW, CHANGELOG, lockfile root, and lockfile dependency mismatches all fail correctly; git/link/file deps are skipped; missing package.json exits 2.

### Changed
- **Release checklist**: Added `npm run release:check` as the first pre-tag verification step in `AGENTS.md`. Added version bump rules requiring npm tooling or root-only edits.
- **`CLAUDE.md`**: Added release validation guidance and version bump rules.

## [1.1.2] - 2026-04-28

### Fixed
- **Lockfile integrity**: Regenerated `package-lock.json` from scratch via `npm install` to restore correct dependency version fields corrupted by global version-string replacement in prior release.

## [1.1.1] - 2026-04-28

### Fixed
- **README release metadata**: Badge and "What's New" pointer updated from `v1.0.19` to `v1.1.1`. Added Shared Repository Intelligence to feature bullets.

## [1.1.0] - 2026-04-28

### Added
- **Shared repository intelligence for review**: `buildReviewContext()` now uses `SkillKnowledgeBase` (the same structured codebase knowledge that powers `create-skills`) to add compact intelligence signals to the review context.
- **Public API risk signal**: Changed files that are part of the public API surface (re-exported from entrypoints) are flagged with a breaking-change warning.
- **Hub file blast radius signal**: Changed files imported by many other files are flagged with their import count for blast-radius awareness.
- **Test coverage gap signal**: Changed source files without associated tests are listed in the review context.
- **Dependency usage signal**: External packages relevant to the changed files are summarized for dependency-aware review.
- **`includedSignals` metadata**: `ReviewContextMetadata` and `ExplainContextOutput` now report which intelligence signals were included (`public-api`, `test-gap`, `dependency`, `risk`).
- **Extended `RelationType`**: Added `public-api`, `test-gap`, `dependency`, and `risk` relation types.

### Changed
- **Review context enrichment**: Priority order remains changed-files-first; intelligence signals are appended within budget as a `--- Review Intelligence ---` section.
- **`--explain-context --format json`**: Now includes `includedSignals` array and `indexUsed` boolean for diagnostics.
- **Disabled indexing diagnostic**: When `indexing.enabled` is `false`, explain-context now clearly reports "Indexing disabled in configuration" as expected behavior, not a failure.

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
