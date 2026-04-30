# What's New in v1.26.0

## Chunked Parser Observability & Lexical Fallback Guard

v1.26.0 adds chunk-level telemetry fields to parser output and drilldown, and hardens the dogfood health gate to catch silent parser regressions.

- **Chunk telemetry** (`src/types/index.ts`, `src/services/source-index/parser.ts`, `src/commands/indexing.ts`): `chunkCount`, `chunkSize`, and `chunkWarningCount` fields added to `SourceIndexFile` and surfaced in `--recovered` drilldown entries for files parsed via `chunked-tree-sitter`.
- **Dogfood lexical-fallback guard** (`scripts/dogfood.mjs`): Health check now asserts `parserModeBreakdown["lexical-fallback"] === 0` after a fresh dogfood index build. A non-zero count means Tree-sitter + chunked + ASCII all failed for some file, indicating a silent parser regression.
- **Dogfood chunk field validation** (`scripts/dogfood.mjs`): Parser drilldown step validates that every `chunked-tree-sitter` recovered file has `parseWarnings` with a chunked recovery indicator, plus valid `chunkCount` (>= 2), `chunkSize`, `chunkWarningCount`, and non-zero symbols/imports/exports counts.

---

# What's New in v1.25.0

## Large-File Chunked Parser Recovery

v1.25.0 adds chunked Tree-sitter parsing as a recovery strategy for large files, positioned between full-file Tree-sitter and ASCII normalization in the fallback chain.

- **Chunked Tree-sitter fallback** (`src/services/source-index/parser.ts`): When Tree-sitter throws `Invalid argument` (common for files >50KB on Windows), the parser now tries chunked Tree-sitter parsing before falling back to ASCII normalization or lexical parsing. Content is split on line boundaries at a conservative `MAX_CHUNK_SIZE` of 30000 chars, each chunk is parsed independently, and results are merged with correct line offsets. Deduplication guards against duplicate imports/exports across chunk boundaries.
- **Parser mode** (`src/types/index.ts`): New `chunked-tree-sitter` variant in the `ParserMode` union.
- **Telemetry** (`src/commands/indexing.ts`, `src/commands/create-skills.ts`): `chunked-tree-sitter` is counted as recovered (non-tree-sitter, no hard parse errors). `parserModeBreakdown`, `getRecoveredFileCount`, `--health`, `--stats`, `--recovered` drilldown, and doctor output all include the new mode.
- **Docs** (`WHATS_NEW.md`, `docs/CHANGELOG.md`): Recovery chain order documented: chunked Tree-sitter → ASCII normalization → lexical fallback.

### Recovery chain (in order)
1. Full-file Tree-sitter parse
2. **Chunked Tree-sitter** (new — handles large files)
3. ASCII normalization (handles Unicode characters)
4. Lexical regex-based fallback (last resort)

### Tests
- 2 new parser unit tests for chunked mode: large file with symbol at end, imports/exports across chunks.
- Updated recovered drilldown test filter to accept `chunked-tree-sitter`.
- Dogfood parser mode validation relaxed: no longer asserts specific mode names, only validates breakdown shape.

---

# What's New in v1.24.0

## Parser Drilldown Action Hints

v1.24.0 makes parser drilldown output directly actionable by adding per-file `suggestedCommands` so agents can move from drilldown listing to file-level diagnostics in one step.

- **Drilldown `suggestedCommands`** (`src/commands/indexing.ts`): Each file entry in `--recovered` and `--parse-errors` JSON output now includes `suggestedCommands` with `--explain-index` and `--agent-context` commands pointing to that file. Paths are forward-slash normalized and double-quoted via `quoteCliArg`. The commands are deterministic for the same index.
- **Doctor** (`src/commands/create-skills.ts`): No policy change — recovered-only remains advisory, hard parse errors remain action-required. Drilldown entries at `index.suggestedCommands` remain unchanged.
- **Dogfood** (`scripts/dogfood.mjs`): Parser drilldown step now validates the first recovered file has `suggestedCommands` when files are present.
- **Docs** (`docs/COMMANDS_CHEAT_SHEET.md`): Health → drilldown workflow updated to document per-file `suggestedCommands`.

### Tests
- 5 new tests for drilldown `suggestedCommands`: recovered entries, parse-error entries, forward-slash normalization, determinism, empty drilldown safety.

---

# What's New in v1.23.0

## Health Suggested Drilldowns Closeout

v1.23.0 finalizes the parser recovery drilldown suggestions policy introduced in v1.21.0-v1.22.0.

- **Health JSON `suggestedCommands`** (`src/commands/indexing.ts`): `indexing --health --index-format json` includes `suggestedCommands` with `--recovered` when recovered files exist and `--parse-errors` when hard parse errors exist. Clean indexes omit `suggestedCommands` entirely.
- **Doctor `recommendedCommands` policy** (`src/commands/create-skills.ts`): Recovered-only parser state is advisory and appears under `index.suggestedCommands` but is excluded from top-level `recommendedCommands`. Only `--parse-errors` (hard errors, which cause `action-required` status) appears in both `index.suggestedCommands` and top-level `recommendedCommands`.
- **Docs** (`AGENTS.md`, `README.md`): Wording updated to clarify health suggestions are machine-readable next steps; doctor `index.suggestedCommands` is advisory unless hard parse errors exist.

### Tests
- Health JSON: 3 new tests for `suggestedCommands` (recovered, hard errors, clean).
- Doctor JSON: Updated recovered test to assert `index.suggestedCommands` but not `recommendedCommands`; updated hard-errors test to assert both locations.

---

# What's New in v1.22.0

## Parser Recovery Drilldown

v1.22.0 adds two read-only indexing drilldown commands so users and agents can inspect parser recovery state without reading the full health JSON.

- **`--recovered`** (`src/commands/indexing.ts`, `src/cli/args.ts`): Lists files recovered via fallback parser (`ascii-fallback` or `lexical-fallback`). JSON output includes `status`, `totalFiles`, `recoveredFiles`, `parserModeBreakdown`, `files` (capped at 50, sorted by path), and `truncated`. Each file entry includes `path`, `parserMode`, `parseWarnings`, `symbolCount`, `importCount`, `exportCount`, and optional `role`.
- **`--parse-errors`** (`src/commands/indexing.ts`): Lists files with hard parse errors. JSON output includes `status`, `totalFiles`, `parseErrorCount`, `files` (capped at 50, sorted by path), and `truncated`. Each file entry includes `path`, `parserMode`, `parseErrors`, `symbolCount`, `importCount`, `exportCount`, and optional `role`.
- **Mutual exclusion**: Using `--recovered` and `--parse-errors` together throws a `UserError`.
- **Doctor integration** (`src/commands/create-skills.ts`): Recovered file warnings now recommend `mp-sentinel indexing --recovered --index-format json`. Hard parse error failures now recommend `mp-sentinel indexing --parse-errors --index-format json`.
- **Docs** (`docs/COMMANDS_CHEAT_SHEET.md`, `AGENTS.md`): Both commands added to cheat sheet and agent preferred source index commands.
- **Dogfood** (`scripts/dogfood.mjs`): New step 12 `parser drilldown` validates `--recovered` and `--parse-errors` JSON output shape. `TOTAL_STEPS` bumped 11 → 12.

### Tests
- CLI arg parsing tests for `--recovered`, `--parse-errors`, and mutual exclusion.
- Runtime JSON tests for recovered output (with files, empty), parse-errors output (with files, empty), missing cache, corrupt cache.
- Doctor tests for recovered warning recommending `--recovered`, hard parse error failure recommending `--parse-errors`.
- Dogfood step count test updated: 11 → 12.

---

# What's New in v1.21.0

## Doctor Parser Recovery Summary & Generated Skills Parser Recovery Note

v1.21.0 completes the parser telemetry UX by surfacing parser recovery data in doctor diagnostics and generated skill files.

- **Doctor parser recovery summary** (`src/commands/create-skills.ts`, `src/types/index.ts`): `DoctorIndexInfo` gains 5 new parser telemetry fields: `parseErrorRate`, `recoveredFiles`, `parserModeBreakdown`, `parseErrorCount`, and `hardParseErrorFilesSample`. Hard parse errors surface as `[fail] Action Required` items (exit 1) with actionable commands. Recovered files (fallback-parsed without hard errors) surface as `[warn] Advisory` items. Console output shows per-mode parser breakdown (`tree-sitter=N, ascii-fallback=N, lexical-fallback=N`), recovered count, and error rate percentage.
- **Generated skills parser recovery note** (`src/services/skills-generator/content.ts`): A new `### Parser Recovery` subsection in the Architecture section of generated skill files renders when recovered files or hard parse errors exist. Shows a one-line ASCII breakdown plus up to 3 sample error paths.
- **Regression tests & dogfood tightening** (`src/__tests__/create-skills.test.ts`, `scripts/dogfood.mjs`): New test coverage for doctor parser telemetry computation, categorization, and console output. Dogfood health step validates `recoveredFiles` and `parserModeBreakdown` shape when present.

### Tests
- 9 new tests covering doctor parser telemetry (computation, categorization, console output, JSON output, edge cases).
- All 769 tests pass.

---

# What's New in v1.20.0

## Dependency Usage Tiering, Parser Recovery Telemetry & Dogfood Health Guard

v1.20.0 integrates three parallel lanes: Lane A (dependency usage tiering for generated skills), Lane B (parser recovery telemetry), and Lane C (dogfood health guard).

- **Dependency usage tiering** (`src/services/skills-generator/knowledge-base.ts`, `src/services/skills-generator/content.ts`, `src/types/index.ts`): Generated skill files now partition dependencies into Runtime and Test/Tooling sections. `DepMapEntry` gains `sourceFileCount`, `testFileCount`, `exampleFileCount`, and `usageKind` (`"runtime" | "test" | "mixed"`) fields. The dependency map builder accepts `fileRoles` for per-file role classification. Runtime dependencies get priority in the capped detail table, preventing test-only noise (like `@jest/globals`) from dominating the top entries.
- **Parser recovery telemetry** (`src/services/source-index/parser.ts`, `src/commands/indexing.ts`, `src/services/source-index/query.ts`, `src/types/index.ts`): New `ParserMode` type (`"tree-sitter" | "ascii-fallback" | "lexical-fallback"`) tracks which parser path each file used. Fallback recoveries (ASCII or lexical) no longer inflate `parseErrorRate` — they're now tracked separately as `parseWarnings`. `IndexHealthOutput` gains `recoveredFiles` count and `parserModeBreakdown` (e.g., `tree-sitter=90, lexical-fallback=3`). `--stats`, `--health`, `--explain-index`, and `--agent-context` all surface parser mode data. Backward compatible with old caches (missing fields default to `"tree-sitter"`).
- **Dogfood health guard** (`scripts/dogfood.mjs`, `src/tests/script-workflows.test.ts`): New step 4 runs `indexing --health --index-format json` and validates status, tool version match, schema version, and parse error rate shape. Optional fields (`recoveredFiles`, `parserModeBreakdown`) validated for shape when present. Step count bumped from 10 to 11 with a `stepHeader()` helper for renumbering resilience.

### Tests
- Dogfood health guard step count test updated: 10 → 11.
- All 760 existing tests pass.

---

# What's New in v1.19.1

## Parser ASCII Fallback, Dist Freshness Guard & Health Type Cleanup

v1.19.1 is a corrective patch hardening release and dist freshness after v1.19.0.

- **Parser ASCII fallback** (`src/services/source-index/parser.ts`): Tree-sitter can throw `Invalid argument` on Windows when source files contain Unicode box-drawing, em dashes, smart quotes, or arrows in comments. The parser now catches that error, normalizes content to ASCII in memory only (never writes to disk), and retries parsing. Extracted symbols, imports, and exports are preserved. Parse errors are annotated with `"Invalid argument; parsed with ASCII fallback"` so diagnostics are not hidden. 4 new tests covering regular ASCII files, Unicode comment files with symbol extraction, import/export preservation, and error annotation.
- **Dist freshness guard** (`scripts/dogfood.mjs`, `scripts/release-check.mjs`): `dogfood` step 2 now smoke-tests `node dist/index.js indexing --health --index-format json` after build and asserts valid JSON output. `release-check` validates `node dist/index.js --version` matches `package.json` and `indexing --help` contains all required flags (`--health`, `--agent-context`, `--find-symbol`, `--find-import`). 3 new release-check tests covering passing, version mismatch, and missing flag.
- **Health type cleanup** (`src/types/index.ts`, `src/commands/indexing.ts`): Local `HealthOutput` interface moved to shared types as `IndexHealthStatus` and `IndexHealthOutput`. Health sample cap reduced from 10 to 5.
- **Test fixture ASCII hardening**: All test source files with literal risky Unicode converted to `String.fromCharCode()` / `\u` escapes so source remains ASCII. Box-drawing comment separators replaced with ASCII dashes. Runtime test behavior preserved — quality gate still receives correct Unicode strings.

### Tests
- 1 new `--health` CLI arg parse test.
- 4 new parser ASCII fallback tests (regular ASCII, Unicode comment symbol extraction, import/export preservation, error annotation).
- 3 new release-check dist freshness tests (passing, version mismatch, missing flag).

---

# What's New in v1.19.0

## Source Index Health CLI, Skill Contract Guard & AI Readiness Doctor

v1.19.0 integrates three parallel lanes: Lane A (source index health CLI), Lane B (skill contract guard), and Lane C (AI readiness doctor).

- **Source index health CLI** (`src/commands/indexing.ts`): New `--health` flag on the indexing command performs a read-only diagnostic of the source index cache. Reports status (`ok`, `missing`, `unreadable`, `stale`), schema version, file count, parse error rate, manifest hash comparison, and samples of changed/missing files. Detects staleness from manifest changes, source file SHA256 mismatches, and deleted indexed files. Exit `0` for healthy, `1` for missing/stale/unreadable, `2` for runtime error. JSON mode emits the health payload to stdout; all logs go to stderr. 7 new tests covering missing cache, corrupt cache, manifest change, source file change, deleted file, healthy index, and JSON stdout isolation.
- **Generated skill contract guard** (`src/services/skills-generator/quality-gate.ts`): `checkAgentWorkflowContract()` now enforces strict per-command validation. Each of 5 index commands must be individually present with `--index-format json` on the same line. Replaces the previous fuzzy check.
- **AI enrichment readiness in doctor** (`src/commands/create-skills.ts`, `src/types/index.ts`): `--doctor` now reports AI enrichment readiness without any network calls. New `DoctorAIEnrichmentReadinessInfo` type with status (`disabled`, `ready`, `action-required`).

### Tests
- 7 new `--health` tests.
- 10 new contract guard tests.
- 6 new AI readiness doctor tests.

---

# What's New in v1.18.0

## Positive Explain-Context Dogfood, Doctor Manifest Freshness & Safe Suggested Commands

v1.18.0 integrates three parallel lanes: Lane A (positive explain-context dogfood), Lane B (doctor manifest freshness), and Lane C (safe suggested command formatter).

- **Positive explain-context dogfood** (`scripts/dogfood.mjs`): New `stepPositiveExplainContext()` creates a temp fixture project with `indexing.enabled: true`, builds the index, runs `--explain-context`, and asserts `status=available`, `indexUsed=true`, and non-empty `includedFiles` + `suggestedCommands`. Total dogfood steps 9→10.
- **Doctor manifest freshness** (`src/commands/create-skills.ts`): `runDoctor` now computes the current manifest hash from disk and compares it against the cached `index.manifestHash`. Reports `status: "stale"` when hashes differ (changed manifest inputs) or when no `manifestHash` exists in cache (legacy index). Status remains `"ok"` only when hashes match.
- **Safe suggested command formatter** (`src/services/source-index/query.ts`): New `quoteCliArg()` helper normalizes backslashes to forward slashes, escapes embedded double quotes, and wraps values in double quotes. All suggested command builders in `query.ts` and `context-builder.ts` use it for consistent, safe argument quoting.

---

# What's New in v1.17.0

## Source Query Path Robustness, Reference Routing Quality Gate & Explain Context Action Hints

v1.17.0 integrates three parallel lanes: Lane A (source query path robustness), Lane B (reference routing quality gate), and Lane C (explain context action hints).

- **Source query path robustness** (`src/services/source-index/query.ts`): New `normalizePath()` helper handles backslash-to-forward-slash conversion, strips project root prefixes from absolute paths (Unix and Windows), and strips leading slashes. `queryAgentContext()` now accepts optional `projectRoot` for absolute path resolution. 8 new tests covering forward/backslash paths, absolute paths, Windows-style paths, and error cases.
- **Reference routing quality gate** (`src/services/skills-generator/quality-gate.ts`): `checkReferenceRouting()` now validates routing tables, flags file-looking patterns with trailing slashes, unknown reference names, missing fallback rows, and malformed table markup. Fixed separator row parsing bug. 9 new quality gate tests.
- **Explain context action hints** (`src/services/source-index/context-builder.ts`): `buildReviewContext()` now generates capped, deduplicated suggested commands (`--agent-context`, `--find-import`, `--find-symbol`) from actual context files and dependency signals. Commands use `--index-format json` and double-quoted arguments. Rendered in JSON and console output by `--explain-context`. 4 new tests.

---

# What's New in v1.16.1

## Reference Routing Path Patch

v1.16.1 fixes a path rendering bug in the generated Reference Routing section where individual source files were incorrectly displayed with trailing slashes (e.g., `src/lib.ts/` looked like a directory).

- **File path rendering fix**: `buildReferenceRouting()` now distinguishes file names from directory names when extracting candidates from the source index. Files directly in `src/` (e.g., `src/lib.ts`, `src/index.ts`) no longer appear as directory patterns with trailing slashes.
- **Regression guard**: New test verifies the generated routing output contains no `file.ext/` patterns (`.ts/`, `.js/`, `.tsx/`, `.mjs/`, `.cjs/`, `.json/`).

---

# What's New in v1.16.0

## Source Index Query Service, Skill Reference Router & Dogfood Query Guard

v1.16.0 integrates three parallel post-1.15.0 lanes: Lane A (source index query service refactor), Lane B (skill reference routing), and Lane C (dogfood query guard).

- **Source index query service** (`src/services/source-index/query.ts`): Extracted three pure query functions -- `querySymbols(index, query)`, `queryImports(index, query)`, `queryAgentContext(index, filePath)` -- from the indexing command layer. Multi-tier scoring (exact 100 > case-insensitive 90 > starts-with 70 > contains 50) for both symbol and import search. Command handlers in `indexing.ts` delegate to the query service for data; console/JSON rendering stays in the command layer. 22 new unit tests covering null/empty index, scoring accuracy, sort order, result capping, missing target errors, and agent context shape validation.
- **Skill reference routing** (`src/services/skills-generator/content.ts`): New `buildReferenceRouting(index, kb)` generates a data-driven "Reference Routing" section in generated agent skills. Routes cover source index references (symbols, imports, hub files) with concrete file paths and line counts. Added to all 7 adapters (Claude, Cursor, Windsurf, Cline, Codex, Antigravity, Generic). Quality gate max sizes raised (SKILL_MD 3000→3600, SINGLE_FILE 20000→21000); new "Reference Routing" H2 required for Claude + single-file adapters. 12 new tests (7 routing content + 4 quality gate integration).
- **Dogfood query guard**: New `stepIndexQuery` (step 4 of 9 in `dogfood.mjs`) smoke-tests all three v1.15+ indexing diagnostics: `--agent-context <file>`, `--find-symbol <query>`, `--find-import <query>`. Validates JSON shape and non-empty results. AGENTS.md checklist updated.

---

# What's New in v1.15.1

## Agent Consistency & Windows Console ASCII Patch

v1.15.1 is a consistency patch for agent automation and Windows console safety — no behavioral changes.

- **Agent skill `--index-format json` consistency**: Generated agent skills now include `--index-format json` on all indexing diagnostic commands (`--agent-context`, `--find-symbol`, `--find-import`). Previously only `--explain-index` and `--stats` had the JSON format flag; the three new Lane A/B diagnostics were missing it. Quick-start search examples in generated skills also now include `--index-format json`. Deterministic output preserved.
- **Windows console ASCII safety**: Removed em dashes (U+2014) from console output lines: `--explain-context` evidence summary (`[signalType] sourceFile - evidence`), review context intelligence signal lines (Public API Risk, Hub File Blast Radius), and profile-specific review pitfalls. All replaced with ASCII hyphens per the existing "ASCII only, no emoji" console contract.
- **Test hardening**: New `--index-format json` assertions in `create-skills.test.ts` agent workflow tests; new ASCII safety test in `explain-context.test.ts` covering console output with intelligence signals.

---

# What's New in v1.15.0

## Agent Context Pack CLI, Skills Search Workflow & Review Evidence Tightening

v1.15.0 integrates three parallel lanes: Lane A (agent context pack CLI), Lane B (skills search workflow upgrade), and Lane C (review context evidence tightening).

- **Agent context pack CLI**: `indexing --agent-context <file>` outputs a capped, read-only JSON context pack for AI agents containing symbols (cap 30), imports/exports (cap 20), direct imports/dependents (cap 10), hub files (cap 5), and suggested follow-up commands. No file contents — index metadata only. 9 new tests covering JSON shape, error handling, and log-free JSON stdout.
- **Skills search workflow upgrade**: Generated agent skills now teach three indexing diagnostics (`--agent-context`, `--find-symbol`, `--find-import`) in the Required Agent Workflow. New `buildSearchExamples()` generates codebase-specific examples from real index data (top hub file, top dependency, representative symbol). Quality gate expanded to recognize all three diagnostics. Deterministic output preserved.
- **Review context evidence tightening**: New `EvidenceSummary` type adds structured `sourceFile`, `signalType`, and `evidence` fields to review context metadata and `--explain-context` output. 24 new tests (18 fixture + 6 explain-context) covering all signal types, legacy graceful degradation, and JSON round-trip. Backward compatible — no budget or string-context changes.

---

# What's New in v1.14.1

## Encoding Consistency Patch

v1.14.1 is a test-only encoding hygiene patch -- no runtime or production code changes.

- **ASCII-only test comments**: `src/tests/script-workflows.test.ts` comment separators and prose now use ASCII hyphens instead of box-drawing characters (U+2500) and em dashes (U+2014). Prevents mojibake rendering on Windows/CI terminals.

---

# What's New in v1.14.0

## Source Index Query CLI, Adapter Spec Guard & Script Workflow Harness

v1.14.0 integrates three parallel lanes: Lane A (source index query CLI), Lane B (adapter spec contract guard), and Lane C (script workflow regression harness).

- **Source index query CLI**: `indexing --find-symbol <query>` searches all indexed symbols (functions, classes, interfaces, types, enums, variables, methods, arrow functions) with scoring: exact (100) > case-insensitive (90) > starts-with (70) > contains (50). `indexing --find-import <query>` searches import statements with scoring: exact source (100) > case-insensitive source (90) > source contains (70) > imported name match (60). Both are read-only (never force-rebuild), cap at 20 results, sort by score desc then file path. JSON output writes only valid JSON to stdout; console output is ASCII-only. 17 new tests covering CLI arg parsing, search matching, and edge cases.
- **Adapter spec contract guard**: New `validateAdapterSpec()` and `validateAllAdapterSpecs()` quality gate functions validate adapter spec completeness: `officialDocsUrl` (https), `outputKind` (skill/rule), `workspacePath` (`{projectName}` placeholder, trailing `/` for skill, extension for rule), `requiredFiles` (includes `SKILL.md` for skill), `frontmatterRules.required` (array), `sizeLimit` (>=0). Generic adapter is skipped. 9 new quality-gate tests + 4 new create-skills tests validating all primary adapters. Exported from the skills-generator service for external consumers.
- **Script workflow regression harness**: 14 new tests in `src/tests/script-workflows.test.ts` covering `release-check.mjs` (8 tests for valid fixture, version mismatches, missing scripts, missing entries, missing package.json), `dogfood.mjs` (2 tests for TOTAL_STEPS and step function name declarations), `agent-skills-check.mjs` (2 tests for exit 0/1 behavior), and Unicode safety (2 tests for all 4 scripts/*.mjs). Zero production code changes — test-only harness.

---

# What's New in v1.13.0

## Doctor AI Enrichment Cache, Cache Hardening & Dogfood Agent Guard

v1.13.0 integrates three parallel lanes: Lane A (doctor cache diagnostics), Lane B (cache hardening), and Lane C (dogfood agent skills guard).

- **Doctor AI enrichment cache diagnostics**: `create-skills --doctor` now reports AI enrichment cache status (`available`, `missing`, or `unreadable`) with entry count and total bytes in both JSON (`aiEnrichmentCache` field) and console output. Cache issues are advisory-only — they do not affect doctor exit code or recommended actions.
- **Cache hardening tests**: Comprehensive tests for schema mismatch rejection (wrong JSON shape, missing envelope fields), cache write failure non-blocking behavior (mkdir blocked by file), and temp/partial file exclusion. All 4 new tests pass; no production bugs found.
- **Dogfood agent:skills:check gate**: `npm run dogfood` now includes `agent:skills:check` as step 8, ensuring generated agent skill files are verified before release. `AGENTS.md` release checklist updated accordingly.
- **create-skills bug fixes**: Fixed missing `aiEnrichmentCache` field in doctor JSON output and missing `join` import from `node:path` — both were pre-existing issues caught by `tsc`.

---

# What's New in v1.12.1

## Docs Consistency & Local Skill Freshness

v1.12.1 is a patch release syncing docs and local generated skills after the v1.12.0 runtime cache ship.

- **Cache spec status updated**: `docs/AI_ENRICHMENT_CACHE_SPEC.md` now reflects implemented status (was still marked "design doc -- no runtime implementation yet"). Added "Implemented behavior" section documenting cache hit, corrupt fallback, warning isolation, and atomic write behavior.
- **Local skill freshness**: `npm run agent:skills:refresh` regenerated all stale local skill files. `npm run agent:skills:check` passes clean.

---

# What's New in v1.12.0

## AI Enrichment Cache Runtime

v1.12.0 implements the AI enrichment cache spec from v1.11.0, eliminating redundant provider API calls when the source index hasn't changed.

- **File-based cache**: Enrichment results are cached at `.mp-sentinel-cache/ai-enrichment/<cacheKey>.json` using a composite SHA256 key of source index hash, provider, model, prompt version, and input hash. Cache hits skip the provider entirely.
- **Transparent to callers**: `create-skills.ts` passes `projectRoot` to `enrichIndex()`. No new CLI flags, no config changes, no adapter output changes.
- **Cache failure is non-blocking**: Corrupt cache files, key mismatches, and write failures log warnings and fall back to the provider — enrichment never fails because of cache issues.
- **`--no-ai-enrich` unchanged**: When `--no-ai-enrich` is active, `enrichIndex()` is never called, so the cache is never read or written.
- **Atomic writes**: Cache files are written to a temp file then renamed, preventing corruption on crash mid-write.

---

# What's New in v1.11.0

## Phase 2 Closeout — Diagnostics, Fixtures & Cache Spec

v1.11.0 closes out Phase 2 with import classification diagnostics (Lane D), fixture regression coverage (Lane E), and the AI enrichment cache design spec (Lane F).

- **Import classification in --explain-index**: The `indexing --explain-index <file>` output now classifies each import as `internal` (resolved to another source file in the index), `local` (unresolved but with a local-looking path), or `external` (package/remote). This makes dependency graph analysis more actionable.
- **Lane E fixture regression harness**: Comprehensive `review-intelligence-fixtures.test.ts` covers all 4 project profiles (cli-tooling, library, node-service, react-next) with 47+ tests validating signal precision, graceful degradation, quality assertions, and JSON output shape.
- **AI enrichment cache spec**: `docs/AI_ENRICHMENT_CACHE_SPEC.md` defines a deterministic file-based cache for AI enrichment results, keyed by composite hash of source index + provider + model + prompt version + input. Design-only — no runtime implementation yet.
- **ASCII-safe documentation**: All spec docs use ASCII-safe punctuation for terminal readability.

---

# What's New in v1.10.0

## Parallel Lane Integration — Indexing, Review Precision & AI Enrichment Tests

v1.10.0 integrates three parallel development lanes into a single release: Lane B (indexing expansion), Lane C (review precision), and Lane A/C (test coverage completion).

- **.mts/.cts support**: Source indexing now parses `.mts` (ESM TypeScript) and `.cts` (CJS TypeScript) file extensions, alongside existing `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs` support.
- **tsconfig extends resolution**: `tsconfig.json` base configs referenced via `extends` are now resolved and merged when computing path aliases and compiler options, improving import resolution accuracy in monorepos and layered configs.
- **maxFileSize enforcement**: `indexing.maxFileSize` (default 512 KB) now correctly skips oversized files during both full and incremental indexing, preventing tree-sitter parse hangs on large generated/vendor files.
- **Review intelligence signal precision**: `public-api`, `risk`, `test-gap`, and `dependency` signals now have improved precision with edge-case handling and error isolation — false positives reduced when source index is healthy but sparse.
- **AI enrichment determinism tests**: Comprehensive determinism and validation unit tests for `ai-enrichment.ts` covering cache key stability, input/output shape, error handling, and no-network behavior. Lane C enrichment logic is now fully regression-protected.

---

# What's New in v1.9.2

## Incremental Indexing Resilience

v1.9.2 fixes a critical blocker where `create-skills --check` (and thus `agent:skills:check`) would fail because incremental source indexing aborted when a small batch of changed files had parse errors, even though a healthy cached index existed.

- **Incremental parse-error resilience**: `buildSourceIndex()` no longer aborts incremental re-indexing based on the parse-error rate of just the changed batch. Instead, it evaluates final index health (`totalParseErrors / allFiles.length`) and falls back to existing cached entries for files that fail to re-parse. Full rebuilds with high parse-error rates still fail.
- **Never overwrite a good cache**: If an incremental update would push the overall parse-error rate above the 50% threshold while the existing cache was healthy, the existing cache is preserved.
- **Existing cached entry fallback**: When a file that existed in the previous index fails to re-parse during incremental indexing, the old cached entry is reused with a warning instead of counting as a parse error.

---

# What's New in v1.9.1

## Legacy Advisory Hygiene

v1.9.1 reduces noise from legacy generated file diagnostics by grouping duplicate advisories instead of repeating per-file messages.

- **Grouped legacy advisories in doctor output**: `recommendedActions` in JSON now has one entry per agent (e.g. "3 legacy generated file(s) for claude at unexpected path") instead of one per file. The full per-file list is preserved in `legacyFiles`. Console `[warn] Advisory` section shows grouped summaries.
- **Grouped `agent:skills:check` legacy output**: Legacy advisories now print one line per agent instead of one per file. Still exits `0` when only legacy advisories exist.
- **No `recommendedCommands` for legacy cleanup**: Deletion requires user confirmation, so no automated command is emitted for legacy files. Advisory-only.
- **Docs synced**: `CREATE_SKILLS.md` notes the grouped behavior. `WHATS_NEW.md` and `CHANGELOG.md` include v1.9.1. README badge/pointer bumped to v1.9.1.

---

# What's New in v1.9.0

## Skill Encoding Hygiene

v1.9.0 sanitizes generated skill content to ASCII-safe punctuation and adds a quality-gate check for risky Unicode characters.

- **ASCII-safe generated prose**: All em dashes, ellipsis, arrows, and smart quotes in generated skill content replaced with ASCII equivalents. Generated skills now render correctly in terminal environments and AI agent readers.
- **`risky-unicode` quality-gate check**: New deterministic quality check flags 12 risky Unicode characters (em/en dashes, arrows, smart quotes, ellipsis, checkmark, ballot x) in generated skill files. Severity: error. Surfaced in `--check`, `--dry-run`, and `--doctor` flows.
- **Full template sanitization**: All templates in `content.ts`, `knowledge-base.ts`, `ai-enrichment.ts`, and 7 adapter files are now ASCII-clean.

## Doctor Remediation UX (v1.8.0)

v1.8.0 adds remediation UX to `create-skills --doctor` with machine-runnable commands and severity-grouped console output.

- **`recommendedCommands` in JSON output**: New `recommendedCommands: string[]` field in doctor JSON output provides machine-runnable commands in execution order, separate from human-readable `recommendedActions`. Consumers can pipe commands directly into CI/CD remediation steps.
- **Command policy**: Missing index → `mp-sentinel indexing`. Stale index → `mp-sentinel indexing --force`. Stale/missing skills → `npm run agent:skills:refresh` (preferred when script exists) or `mp-sentinel create-skills --all-agents --force` (fallback). Quality errors → action text only (no automated command).
- **Severity-grouped console output**: Console rendering now groups findings by severity: `[fail] Action Required`, `[warn] Advisory`, `[ok] Healthy`. Non-detected agents are neutral (not warnings). `[x]` marker removed entirely.
- **`categorizeDoctorFindings()` helper**: Internal helper centralizes all doctor finding categorization, replacing scattered inline `recommendedActions.push()` calls.
- **`DoctorActionEntry` type**: New type with optional `commands` field for findings that can suggest one or more remediation commands.
- **Status policy documented**: `error` (exit 2) for unreadable/corrupt index only. `action-required` (exit 1) when `failItems` exist. `ok` (exit 0) when no failItems (warnItems may exist). Legacy files and missing scripts are advisory-only and never cause exit 1.
- **Dogfood guard**: `recommendedCommands` validated as array of non-empty trimmed strings in the dogfood doctor step.
- **Full test coverage**: New tests for command preference (`npm run agent:skills:refresh` vs CLI fallback), healthy project has empty `recommendedCommands`, dedup stability, and first command ordering.

---

# What's New in v1.7.1

## Dogfood Step Count Consistency

v1.7.1 is a patch hardening release — no CLI behavior, flags, JSON contracts, or doctor logic changes.

- **Dogfood step labels**: `npm run dogfood` now correctly shows `[1/7]` through `[7/7]` for all seven steps (was showing `[1/6]`–`[4/6]` for the first four steps). A `TOTAL_STEPS` constant guards against future miscounts.
- **Step labels use constant**: All step header lines now use `` `\n[${n}/${TOTAL_STEPS}] ...` `` instead of hardcoded fractions.

---

# What's New in v1.7.0

## Create Skills Doctor

v1.7.0 adds `--doctor` diagnostic mode for `create-skills` — a comprehensive read-only health check.

- **`create-skills --doctor`**: Checks agent detection, source index cache status, generated skill file freshness, quality gate results, legacy/unexpected files, and npm script availability. No file writes, no AI calls, no auto-indexing.
- **JSON output**: `--format json` produces stable, additive JSON suitable for CI health checks and automated monitoring.
- **Exit codes**: 0 (healthy or advisories only), 1 (action required — stale/missing skills, quality errors), 2 (runtime error — corrupt index).
- **Dogfood coverage**: New step in `dogfood.mjs` validates doctor JSON output shape and key fields.

## Previous Releases

### v1.6.2 — ASCII-Safe Script Output

v1.6.2 is a patch hardening release — no new CLI behavior, no new flags.

- **ASCII-only script output**: All `scripts/*.mjs` runtime output now uses ASCII exclusively. Replaced `—` (em dash) with `-`, `→` (right arrow) with `->` across `dogfood.mjs`, `agent-skills-check.mjs`, and `agent-skills-refresh.mjs`. Prevents mojibake like `â€"` or `â†'` on Windows/CI terminals.
- **Release guard**: `npm run release:check` now includes a script ASCII safety check that scans all `scripts/*.mjs` files for output-risky Unicode characters (`—`, `→`, `←`, `…`) and fails if any are found. This prevents regression in future script changes.
- **JSON CLI output unchanged**: Only script-level console output is affected. All structured JSON output from `create-skills`, `indexing`, and `--explain-context` remains untouched.

---

# What's New in v1.6.1

## Explain Agents Dogfood Guard

v1.6.1 is a patch hardening release — no new behavior, no new CLI flags.

- **Dogfood `--explain-agents` step**: `npm run dogfood` now includes a `create-skills --explain-agents --format json` smoke test that parses the JSON output and asserts all required fields (`projectName`, `defaultSelection`, `agents`, and per-agent `id`, `detected`, `selected`, `detectionSignals`, `resolvedOutput`, `officialDocsUrl`). Ensures the v1.6.0 diagnostic mode is always validated with the dist build.
- **Dogfood step count bumped to 6/6**: The workflow now covers release:check → build → indexing → create-skills dry-run → explain-agents → explain-context.

---

# What's New in v1.6.0

## Explain Agent Detection

v1.6.0 adds a diagnostic mode to `create-skills` so users can see exactly which agents/IDEs mp-sentinel detects, why, and what output paths they resolve to.

- **`create-skills --explain-agents`**: Console output listing every agent with detection status, signals, default selection, output kind, workspace template, and resolved output path.
- **`create-skills --explain-agents --format json`**: Machine-readable JSON output. JSON mode is allowed without `--agent` or `--all-agents`.
- **No side effects**: Does not write files, does not build the source index, does not call AI.
- **Detection contract documented**: `.claude/` detects Claude (not root `CLAUDE.md` alone). `.agents/` or `.codex/` detects Codex. `.antigravity/` or `.agent/` detects Antigravity. `.clinerules/` detects Cline. Generic is never auto-detected.
- **Detection signals**: Each agent entry lists which specific paths triggered detection (e.g., `.claude/ exists`).
- **No new deps or breaking changes**: Pure additive diagnostic feature.

---

# What's New in v1.5.0

## Agent Skills Bootstrap

v1.5.0 introduces a local agent skills bootstrap workflow — generated skills are always fresh before coding, without committing generated files or requiring network/API keys.

- **`npm run agent:skills:check`**: CI-style staleness gate that reports missing, stale, wrong-agent, and quality errors. Exit 0 = up-to-date, 1 = stale, 2 = runtime error.
- **`npm run agent:skills:refresh`**: Regenerates all agent skills from the current source index, then runs check to verify.
- **Local-only generated skills**: Output directories (`.agents/skills/`, `.cursor/rules/*-best-practices.mdc`, `.windsurf/rules/*-best-practices.md`, `.antigravity/rules/*-best-practices.md`, `.agents/rules/*-best-practices.md`) are gitignored. Generated skills are local bootstrap artifacts — never committed, never published.
- **Expanded legacy/unexpected artifact detection**: `create-skills` now scans all known agent directories for `@mp-sentinel-generated` files at unexpected paths. Detects misplaced artifacts (e.g., claude skill under `.clinerules/`) as advisories without blocking.
- **Updated agent rules**: `AGENTS.md` and `CLAUDE.md` now enforce a check-first workflow: run `agent:skills:check` → `agent:skills:refresh` if stale → read relevant generated skill.
- **Deterministic**: Both scripts use `--no-ai-enrich` — no network calls, no API keys, fully deterministic.
- **No new CLI flags**: All changes are npm scripts and diagnostics.

---

# What's New in v1.4.0

## Review Intelligence Explainability

v1.4.0 turns review intelligence signals from opaque labels into explainable structured metadata — no behavior changes, no AI calls, no network calls.

- **`ReviewIntelligenceSignal` type**: Each signal now carries `type`, `file`, `reason`, `evidence`, and `confidence` — so users and agents can understand **why** a signal was raised.
- **`buildReviewContext()`**: Populates `intelligenceSignals` array alongside the existing `includedSignals` (backward compatible). Signals are deduplicated by `type + file + evidence` and respect the 12k character budget.
- **`--explain-context --format json`**: JSON output includes the new `intelligenceSignals` field with full structured metadata for each signal.
- **Console output**: Shows a concise `Signal details: public-api(1), test-gap(2)` summary line.
- **Graceful fallback**: Indexes without `insights` produce no signals. No new CLI flags.
- **Full test coverage**: 4 new fixture tests validate structured signal fields, deduplication, and graceful degradation.

---

# What's New in v1.3.0

## Review Intelligence Fixture Coverage

v1.3.0 adds a comprehensive fixture-based regression harness for review intelligence signals — no behavior changes.

- **4 profile fixtures** (`cli-tooling`, `library`, `node-service`, `react-next`): Each creates a realistic mini-project with source files, dependencies, public API surface, test files, and hub files, then builds a real source index through the pipeline.
- **Signal precision tests**: Verify that `buildReviewContext()` correctly includes `public-api`, `risk` (hub-file), `test-gap`, and `dependency` signals when conditions are met, and excludes them when they are not.
- **Graceful degradation tests**: Confirm missing index, disabled indexing, and empty changed-files cases all return empty context without throwing.
- **Quality assertions**: Context starts with changed files before related files, `includedSignals` has no duplicates, context length never exceeds budget, and `--explain-context --format json` output is always parseable with expected fields.
- **No new CLI flags or behavior changes**: Pure test coverage — the goal is confidence and regression protection, not expanding the feature surface.

---

# What's New in v1.2.0

## Dogfood Validation Workflow

v1.2.0 adds `npm run dogfood` — a single command that validates the full source-index → review → create-skills loop end-to-end, without network calls.

- **`npm run dogfood`**: Runs release:check → build → indexing --stats → create-skills --dry-run → explain-context. All JSON outputs are parsed and validated, not just visually inspected.
- **Publish-ready acceptance suite**: Every step runs against the built CLI (`dist/`) so it validates what ships, not just source.
- **No API keys required**: The dogfood workflow avoids all AI/network calls — it validates the local tooling surface only.

---

# What's New in v1.1.5

## Release Script Packaging Self-Check

v1.1.5 extends `release:check` to validate its own packaging — no runtime code changes.

- **Packaging self-check**: `release:check` now asserts `scripts/release-check.mjs` is listed in `package.json.files` when referenced by the `release:check` script. Also validates required published entries (`dist`, `README.md`, `docs`, `WHATS_NEW.md`, `examples`) are present. Prevents the v1.1.3 → v1.1.4 packaging gap from recurring.
- **5 new tests**: Missing release script in files, absent `release:check` script skips check, missing required entry, missing `files` field.

---

# What's New in v1.1.4

## Release Script Packaging Fix

v1.1.4 fixes a packaging gap — no runtime code changes.

- **Packaging fix**: `scripts/release-check.mjs` now included in the npm tarball via `package.json.files`. Previously, `npm run release:check` would fail when run from an installed package because the script was missing from the published artifact.

---

# What's New in v1.1.3

## Release Automation Guardrails

v1.1.3 adds automated release consistency validation — no runtime code changes.

- **`npm run release:check`**: New script that validates version consistency across `package.json`, `package-lock.json`, README badge, README "What's New" pointer, `WHATS_NEW.md`, and `CHANGELOG.md`.
- **Lockfile integrity check**: Validates that every `resolved` tarball URL in `package-lock.json` matches the entry's declared version. Prevents the lockfile corruption seen in v1.1.1.
- **Release checklist updated**: `AGENTS.md` now includes `npm run release:check` as the first verification step. Version bump rules enforce npm tooling or root-only edits — never global search/replace on `"version"` in the lockfile.

---

# What's New in v1.1.2

## Lockfile Integrity Patch

v1.1.2 is a lockfile integrity patch — no runtime code changes.

- **Lockfile regeneration**: Full clean `npm install` from scratch to restore correct dependency version fields. Previous v1.1.1 release accidentally over-edited `package-lock.json` dependency entries during version bumps.
- **Root version bump**: `1.1.1` → `1.1.2` using npm tooling with manual root-only edits to prevent recurrence.

---

# What's New in v1.1.1

## README Release Metadata Consistency

v1.1.1 is a docs/release metadata patch only — no runtime code changes.

- **README badge**: Updated from `v1.0.19` to `v1.1.1`.
- **"What's New" pointer**: Updated from `v1.0.19` to `v1.1.1`.
- **Feature bullets**: Added Shared Repository Intelligence to the top of the feature list.

---

# What's New in v1.1.0

## Shared Repository Intelligence for Review

v1.1.0 reuses the same `SkillKnowledgeBase` that powers `create-skills` inside repository-aware review context. Review now catches higher-level risks beyond code-level issues.

### Intelligence Signals in Review Context

When a source index with insights is available, the review context now includes a `--- Review Intelligence ---` section with compact risk signals:

- **Public API Risk** — flags changed files that are part of the public API surface (re-exported from entrypoints like `src/lib.ts` or `src/index.ts`). Changes to these files may be semver-breaking.
- **Hub File Blast Radius** — flags changed files that are imported by many other files. High blast-radius changes deserve extra scrutiny.
- **Test Coverage Gap** — lists changed source files that have no associated test files. Helps reviewers spot untested changes before they merge.
- **Key Dependencies Used** — shows external packages relevant to the changed files, so reviewers can assess dependency-aware risks.

### Diagnostics via --explain-context

`--explain-context --format json` now reports:
- `includedSignals` — which signal types (`public-api`, `test-gap`, `dependency`, `risk`) were included in the context.
- `indexUsed: true` — confirms the source index was consumed.
- When `indexing.enabled` is `false`, the reason clearly states "Indexing disabled in configuration" — expected behavior, not a failure.

### Architecture

- `create-skills` and `review` now share the same `SkillKnowledgeBase` derived from `SourceIndex`. No duplicate codebase summaries.
- Review gets concise risk summaries; `create-skills` keeps richer documentation.
- Review never auto-runs indexing. Intelligence signals gracefully skip when the index is absent, disabled, corrupt, or has excessive parse errors.
- Context budget remains strict and diff-first remains the primary review rule.

---

# What's New in v1.0.19

## Release Checklist & Docs Polish

v1.0.19 is a documentation and release-process consistency release. No runtime code changes.

- **Release checklist**: Added structured release checklist to AGENTS.md for consistent tagging and publishing.
- **Remote sync**: Full tag synchronization with `origin` — all tags v1.0.11 through v1.0.18 pushed and verified.
- **Docs polish**: README badge, CHANGELOG, and WHATS_NEW updated for v1.0.19 consistency.

---

# What's New in v1.0.18

## Legacy Generated File Migration Diagnostics

`create-skills` now detects legacy generated files left over from pre-v1.0.17 adapter paths and reports them as advisories — no automatic deletion.

### What gets detected

- **Codex legacy**: `.agents/rules/<project>-best-practices.md` with `@mp-sentinel-generated` metadata.
- **Antigravity legacy**: `.antigravity/rules/<project>-best-practices.md` with `@mp-sentinel-generated` metadata.

Files at those paths without mp-sentinel metadata (user-authored rule files) are never flagged.

### How it works

- **Console mode**: Prints a concise advisory when legacy files are found.
- **JSON mode**: Adds an optional `legacyFiles` field to all output shapes (`results`, `dryRun`, `check`).
- **`--check` mode**: Legacy advisories do **not** cause `--check` to fail. Exit code 0 when official files are current and only legacy advisories exist.

### No automatic deletion

Legacy files are advisory-only. Users can delete them manually after confirming new official skills exist at the v1.0.17 paths (`.agents/skills/<project>-codex-best-practices/SKILL.md` and `.agents/skills/<project>-antigravity-best-practices/SKILL.md`).

### JSON backward compatibility

The `legacyFiles` field is optional and additive — no existing fields change. Each entry contains `path`, `agent`, `supersededBy`, and `suggestion`.

---

# What's New in v1.0.17

## Official Skills Layout Audit & Adapter Layout Contract

### Adapter layout alignment with official docs

Antigravity and Codex adapters now write to the correct official skills directories:

- **Antigravity**: `.antigravity/rules/<project>-best-practices.md` → `.agents/skills/<project>-antigravity-best-practices/SKILL.md`
- **Codex**: `.agents/rules/<project>-best-practices.md` → `.agents/skills/<project>-codex-best-practices/SKILL.md`

Both now produce a `SKILL.md` with YAML frontmatter (`name`, `description`) following the official Antigravity/Codex skills layout. Old files are not deleted automatically.

### Adapter Specification (AdapterSpec)

Every adapter now declares an `AdapterSpec` with fields verified against official agent/IDE documentation:

- `officialDocsUrl` — source confirming the layout
- `outputKind` — `"skill"` or `"rule"`
- `workspacePath` — output path template with `{projectName}`
- `requiredFiles` — files that must exist (e.g. `["SKILL.md"]` for skills)
- `frontmatterRules` — required/optional YAML frontmatter keys
- `sizeLimit` — max total output size

### Adapter Layout Contract (quality gate)

New `adapter-layout-contract` quality check validates:

- Output paths match the official workspace path
- Skill-style adapters produce a `SKILL.md`
- `SKILL.md` has required YAML frontmatter (at minimum `description`)
- Legacy paths (`.antigravity/rules/`, `.agents/rules/` for skill adapters) are hard errors

Errors fail `--check` with exit code 1.

### Cleaner `--all-agents` separation

Codex and Antigravity use suffixed directory names (`-codex-best-practices`, `-antigravity-best-practices`) under `.agents/skills/` to avoid collisions. No adapter pairs share output paths.

### Updated instruction file detection

`computeIndexHash()` and `buildSkillKnowledgeBase()` now include `.agents/skills/` in instruction file detection, ensuring `--check` correctly tracks the new output paths.

---

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
