# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.33.1] - 2026-05-02

### Added
- **Stack-aware review cues** (`src/services/tech-profile.ts`, `src/config/prompts.ts`, `src/__tests__/tech-profile.test.ts`): Review prompts now include capped, technology-specific checks derived from `techStack` or `package.json`, with generic fallback behavior when neither source is available.
- **Local Husky review workflow docs** (`docs/CONTRIBUTING.md`, `package.json`): Added `npm run review:staged` and documented a Husky pre-commit setup that blocks commits when staged review fails.

### Changed
- **Review process termination** (`src/index.ts`): Review commands now flush output streams and exit immediately after printing the report, preventing lingering event-loop handles after AI work is complete.
- **CI/CD provider documentation** (`docs/CICD_SETUP.md`, `docs/README.md`, `docs/CODE_STYLE.md`, `examples/workflows/gitlab/`): OpenRouter setup, GitHub/GitLab runtime notes, example paths, and GitLab model examples are aligned with current provider behavior.
- **Explain-context profile fallback** (`src/cli/review.ts`): Diagnostic output now reports the detected review profile even when source indexing is unavailable.

---

## [1.33.0] - 2026-05-01

### Added
- **OpenRouter provider** (`src/services/ai/providers/openrouter.provider.ts`, `src/__tests__/openrouter.provider.test.ts`): REST provider targeting `https://openrouter.ai/api/v1/chat/completions` with canonical `X-OpenRouter-Title` attribution and model-gated `response_format: { type: "json_object" }` for model families known to support structured output. `HTTP-Referer` sent only when `OPENROUTER_SITE_URL` is configured.
- **Provider integration** (`src/services/ai/types.ts`, `src/services/ai/factory.ts`, `src/services/ai/config.ts`, `src/services/ai/index.ts`, `src/utils/tokens.ts`): `openrouter` added to `AIProvider` union type, factory routing, fallback chain parsing, token-limits (200K cap), and API key resolution.
- **AI environment readiness probe** (`src/services/ai/config.ts`): Shared provider/model/key validation for review, local review, and create-skills. Anthropic also accepts `ANTHROPIC_AUTH_TOKEN` as a fallback alias after `ANTHROPIC_API_KEY`.
- **AI enrichment coverage** (`src/services/skills-generator/ai-enrichment.ts`, `src/commands/create-skills.ts`): OpenRouter validated as `createSkills.ai.provider` and doctor readiness provider.
- **CLI regression test** (`src/__tests__/create-skills.test.ts`): Tests for `--no-ai-enrich` default (false) and explicit flag behavior.

### Fixed
- **`--no-ai-enrich` default inversion** (`src/cli/args.ts`): Flag default changed from `true` to `false` so AI enrichment is enabled when config specifies it, unless explicitly disabled.

### Changed
- **Header canonicalization** (`src/services/ai/providers/openrouter.provider.ts`): `X-Title` changed to canonical `X-OpenRouter-Title`. Default `OPENROUTER_SITE_URL` removed — `HTTP-Referer` only sent when explicitly configured.
- **Model-gated structured output** (`src/services/ai/providers/openrouter.provider.ts`): `response_format: { type: "json_object" }` is now sent only for model families known to support it (`openai/gpt-*`). Non-OpenAI models (e.g., `moonshotai/kimi-*`) omit the parameter and rely on the parser's markdown-JSON extraction.
- **Non-AI fallback on bad AI env** (`src/cli/review.ts`, `src/cli/local-review.ts`, `src/commands/create-skills.ts`): Unsupported `AI_PROVIDER`, unsupported `AI_MODEL`, or missing API key now warns and disables AI for the run. Review continues with deterministic security-only source review; create-skills skips AI enrichment and still emits deterministic skills.
- **Docs** (`docs/README.md`, `docs/CICD_SETUP.md`, `docs/PROVIDER_COMPARISON.md`, `docs/QUICK_REFERENCE.md`, `docs/CREATE_SKILLS.md`, `docs/AI_ENRICHMENT_CACHE_SPEC.md`, `docs/CONTRIBUTING.md`): OpenRouter added throughout provider documentation.

---

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
