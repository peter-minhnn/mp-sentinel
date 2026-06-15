# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.2.2] — 2026-06-15

### Fixed
- **ESLint adapter config was unreachable:** the `eslint` block in `.mp-sentinelrc.json` was stripped during config validation (the Zod `ProjectConfigSchema` had no `eslint` field, and Zod strips unknown keys by default), so `eslint.enabled: true` never reached the adapter and `runESLintAdapter` always returned `null`. Added `ESLintAdapterConfigSchema` (`enabled`, `severityOverrides`, `timeoutMs`) to the schema. As a result, the unused-import backstop now actually drops AI "unused import" false positives (ESLint authority) instead of only downgrading them to INFO.

### Added
- **Branch-diff rename following:** multi-commit / branch-diff reviews collected changed files under their historical (pre-rename) names, so a file renamed or deleted later in the range was read from the working tree as "File not found" and reported as a skip. `resolveRenamedPaths` (in `utils/git.ts`) now builds an old-to-new rename map for the review range (`git diff -M --diff-filter=R <base>..HEAD`), remaps old paths to their current location (following rename chains, de-duplicating), and drops genuinely deleted paths. Fail-open: a git failure simply drops missing paths, whose current content is already reviewed under the new path.

## [3.2.1] — 2026-06-15

### Added
- **ESLint adapter in CI review:** the ESLint adapter (`eslint.findings`) now runs in CI reviews too, not just local mode. Project-specific lint rules (e.g. `unused-imports/no-unused-imports`) are merged into the report alongside AI findings, giving the same whole-file analysis coverage in both pipelines.
- **Unused-import backstop (`reconcileUnusedImportFindings`):** AI reviewers often flag imports as "unused" when they only see a diff hunk but not the rest of the file. The new reconciler runs after the ESLint adapter: for files ESLint actually linted, every AI unused-import finding is dropped (ESLint is the authority; if the import were truly unused, ESLint would have already reported it). For files ESLint didn't cover (adapter disabled, non-lintable extension), the AI claim is downgraded to INFO/low-confidence. This eliminates the recurring false-positive class where `React`, `Avatar`, `dayjs`, `clsx`, etc. were flagged unused despite being used elsewhere in the file.

### Changed
- **`isLintableFile` exported from ESLint adapter:** so the unused-import reconciler can determine which files ESLint actually covered.

## [3.2.0] — 2026-06-13

### Added (field test round 6)
- **Evidence-based line relocation:** ~50% of findings were anchored at `line 1` (the parser's fallback when the model omits a line). Findings that carry an `evidence` snippet are now relocated to the line where that snippet actually appears in the file (whitespace-insensitive, first match, multi-line aware). Fail-open: no evidence, no match, or unreadable file leaves the finding untouched. Runs after the import backstop in both CI and local pipelines. Ellipsis-abstracted evidence (`const getColumns = () => { ... }`) is relocated via its longest literal segment. Markdown formatting the model leaks into evidence (surrounding/inline backticks, code fences) is stripped before matching.

### Added (field test round 5)
- **Generic per-file-per-rule aggregation:** the deterministic-review engine now collapses any rule that fires 3+ times in one file into a single finding listing the affected lines (`... (4× in this file: lines 1, 2, 3, 4)`). Covers every evaluator uniformly (inline style, inline query keys, hex colors, double casts, …); the hex evaluator's bespoke aggregation was removed in favor of this.
- **Confidence floor for crash/security CRITICALs:** a `runtime-crash` or `security` CRITICAL the model marks `confidence: "medium"` is downgraded to WARNING `[needs-human-review]` — speculative crashes ("apiItems[0] on empty array", "navigator.clipboard without support check") no longer block a merge. High-confidence and unspecified-confidence CRITICALs are unaffected.

### Fixed (field test round 4)
- **AI no longer duplicates deterministic checks:** the prompt now lists the categories already covered deterministically (hardcoded hex, inline style literals, inline query keys, parseInt-without-radix, double casts, Tailwind canonical values, suppressed exhaustive-deps) and instructs the model to skip them. Cuts the dominant maintainability-noise overlap. `DEFAULT_PROMPT_VERSION` → `2026-06-13`.
- **Import-existence backstop:** a CRITICAL claiming an import path is missing / will cause a build failure is downgraded to WARNING when the imported file actually resolves on disk (alias `@/`, `~`, `$lib/` and relative specifiers, with extension/index resolution). Closes the recurring `RichTextEditor`-style false positive.
- **Recurring-issues table excludes synthetic summaries:** the per-file noise-budget cap notice no longer appears as a "recurring issue".

### Added (noise budget)
- **Per-file hex aggregation:** `antd/no-hardcoded-hex-color` now collapses 3+ hex literals in one file into a single finding listing the affected lines (was one finding per line — 137 across 29 files in a real run).
- **`review.maxFindingsPerFile`:** optional per-file cap on non-CRITICAL findings (CRITICALs never capped). Over-budget files keep the most severe / most informative findings and gain one INFO summary recording how many were hidden. Off by default.

### Fixed (local mode parity)
- **Rule-pack evaluators now run in local mode:** `--local` previously skipped the entire rule-pack evaluator pass (react re-render/refactor checks, typescript-strict, antd, tailwind canonical-classes only fired in CI review). Local review now reads package.json deps and runs the same dependency/version-gated evaluator pass, merged identically to the CI path.

### Added (Tailwind v4)
- **`tailwind` rule pack** (dependency-gated on `tailwindcss`): two prompt rules (canonical classes over arbitrary values; no hardcoded design tokens) plus deterministic evaluator `tailwind/canonical-classes` (version-gated `tailwindcss >= 4`) — flags `z-[9999]`-style bracketed integers on bare-value utilities (`z`, `order`, `opacity`, `columns`, `line-clamp`, grid/col/row utilities) and suggests the canonical `z-9999` form, mirroring Tailwind IntelliSense `suggestCanonicalClasses`. Values that genuinely need brackets (units, fractions, CSS vars, colors) are never flagged.

### Fixed (field test round 2)
- **`parseInt without radix` false positive:** the same-line suppression could not see past nested parens in the first argument — `parseInt(String(x ?? ''), 10)` was flagged despite the explicit radix. The check now accepts nested calls and identifier radixes.
- **Hedged self-negation:** patterns now also catch "this may be acceptable", "if they are, this is compliant", "likely intentional" — and the suggestion field is checked in addition to the message.
- **Unsinked XSS claims downgraded:** CRITICAL security findings claiming XSS whose evidence quotes no actual sink (`dangerouslySetInnerHTML`, `innerHTML =`, `parseFromString`, `createElement`, etc.) are downgraded to WARNING — JSX interpolation auto-escapes, so "renders user content without sanitization" alone is not a vulnerability. Matching guardrail added to the prompt.

### Added (Phase 4 — noise & output)
- **Self-negation filter:** AI findings whose message negates itself ("No issue", "this is compliant", "false positive", "works as intended") are dropped (WARNING/INFO) or downgraded to INFO with `[self-negated]` (CRITICAL). New `src/utils/finding-hygiene.ts`, applied to AI findings before the severity clamp.
- **Near-duplicate collapse:** `dedupeFindings` now also collapses findings at the same file/line/severity/category whose wording overlaps (overlap coefficient ≥ 0.35), keeping the variant with the richest evidence and annotating `(+N similar)`. Issues without a category are exempt.
- **`--output <path>`:** review (CI and local mode) additionally writes a clean, ANSI-free markdown report to the given path — local mode reuses the CI report builder, including Commits and Resolved sections.
- **Top recurring issues:** console and markdown reports open the findings with a top-5 table of repeated issues (same category/severity/message-prefix, ≥3 occurrences) with counts and file spread, so large reports are triageable at a glance.

## [3.1.1] — 2026-06-12

### Added
- **Category severity ceilings (`ai.severityCeilings`):** Deterministic post-parse clamp caps AI finding severity per rubric category. Defaults: `architecture`, `performance`, `maintainability`, `test-gap` → max WARNING; `security`, `runtime-crash`, `dependency-version` uncapped. User config merges over defaults; mapping a category to `CRITICAL` disables its default cap. Fixes severity inflation where style/architecture rule violations shipped as CRITICAL.
- **Evidence verification for CRITICAL findings:** The prompt now requires a verbatim `evidence` quote for every CRITICAL issue, and a deterministic pass re-checks that evidence against the current file content (whitespace-insensitive). Evidence not found → downgraded to WARNING with `confidence: "low"` and an `[unverified]` tag. Fail-open for unreadable files and findings without evidence (deterministic/rule-pack findings unaffected).
- **Chronological commit metadata:** Local review sorts and prints commits oldest → newest with explicit ordering labels; `printResultsSummary` renders a "Commits reviewed" section. The JSON/markdown `ReviewReport` gains an optional additive `commits` field (chronological) populated for `range`/`commit` targets via new `getCommitsForRange()`. Prevents report consumers from misreading `git log`'s newest-first order when reasoning about "fixed in a later commit".
- **`--no-cache` flag:** Bypasses the AI response cache for a single run — recommended for pre-merge gate runs.
- **HEAD reconciliation for `--commit <sha>` reviews:** Findings from a historical commit are re-checked against the current working tree. Evidence still present → active; evidence gone but `git log -S` attributes the change to a commit → tagged `resolution: "resolved-at-head"` + `resolvedBy: <sha>` (kept in the report, excluded from pass/fail, severity counts, and the Findings section — rendered under "Resolved During Branch"); evidence in neither file nor history → `resolution: "unverified"`, downgraded to WARNING/low-confidence. `issuesFailThreshold` and all severity counts now operate on active issues only (new `activeIssues` helper).

### Added (refactor review)
- **`refactor` rubric category:** the AI review now explicitly scans changed components/functions for refactor-worthy structures — >80-line bodies, god-components, and React re-render pitfalls (unstable props/context value identity, components declared inside components, state lifted too high, unmemoized expensive derivations) — and must propose a concrete extraction/memoization, not generic advice. Added to the output schema and capped at WARNING by the severity clamp.
- **React re-render evaluators (deterministic):** `react/component-inside-component` (remounts whole subtree every parent render), `react/unstable-context-value` (Provider `value={{...}}` re-renders every consumer), `react/long-function` (>80-line function/component bodies, full-file scans only). Two matching rules added to the React rule pack.

### Changed
- **Diff context width:** `collectReviewInput` default `contextLines` raised 2 → 8 — the dominant AI false-positive class was guard clauses/imports just outside a narrow hunk. Token cost remains bounded by `maxCharsPerFile`.
- **Confidence gating:** a CRITICAL the model marks `confidence: "low"` is downgraded to WARNING `[downgraded: low-confidence CRITICAL]` during the clamp pass.
- **Prompt severity rubric:** `BASE_AUDIT_PROMPT` now states that CRITICAL is reserved for reachable security/runtime-crash impact, requires guard-clause/import/prop checks before crash claims, and demands verbatim evidence. `DEFAULT_PROMPT_VERSION` bumped to `2026-06-12` (invalidates stale AI cache entries).

## [3.1.0] — 2026-06-10

### Fixed
- **Non-null assertion false positives:** Regex now requires an identifier-start character before `!` and a post-expression character after, preventing matches inside Tailwind utility classes (`text-red-500!`), `className` attribute values, comment lines, and bare JSX text content.
- **SQL string concatenation false positives:** Pattern now skips test/stories files and comment lines, eliminating false matches on AntD `<Select>` imports and JSDoc comments.

### Changed
- **Local review console UI:** `printResultsSummary` now renders Target, AI review, Skipped, and Runtime errors rows, matching the AI review console report layout.

## [3.0.7] — 2026-06-10

### Added
- **Pages Router rules for Next.js <= 12 projects.** The `Next.js` rule pack now emits three version-gated rules (`requires: [{ dep: "next", maxMajor: 12 }]`): `next/pages-router-only` (MUST -- forbids `app/` directory, `'use client'`/`'use server'`, Server Components), `next/ssr-ssg-patterns` (SHOULD -- data fetching via `getServerSideProps`/`getStaticProps`/`getStaticPaths`), and `next/api-routes` (SHOULD -- API endpoints in `pages/api/`). App Router rules continue to require `minMajor: 13`. Existing generic rules gained stable `id` fields (`next/image-optimization`, `next/data-fetching-colocation`).

### Fixed
- **TanStack Query loading-state rule: version-aware wording.** `tanstack-query/error-loading-states` is split into three variants: `error-loading-states-v4` (`isLoading`/`isError`, `maxMajor: 4`), `error-loading-states-legacy` (`isLoading`/`isError`, legacy `react-query` package), and `error-loading-states-v5` (`isPending`/`isError`, `minMajor: 5`). Previously v5 wording was emitted for all versions, producing misleading guidance on v4 projects.
- **TypeScript strict rules: `enabled` predicate now filtered by `selectActiveRulePacks`.** The NodeNext-specific rules (`.js` import extensions, `node:` prefix, `import type` for `verbatimModuleSyntax`) were emitted for all TypeScript projects because `enabled` predicates were not applied during rule selection. Projects with `moduleResolution: node` or without `verbatimModuleSyntax` no longer receive these rules.
- **Test Expectations: no `npm test` when script is absent.** When `package.json` defines no `test` script, the generated skill now emits a message directing agents to check the project README, instead of suggesting a command that does not exist.
- **Em dash in generated Test Expectations text.** The `--` separator in the "no test script" guidance was written as a Unicode em dash (U+2014), triggering the quality gate. Replaced with ASCII `--`.

## [3.0.6] — 2026-06-08

### Fixed
- **Review false positives: "imported module does not exist → build failure".** The AI review prompt could raise CRITICAL findings claiming an imported module/file was missing based on an import statement alone, even though the reviewer only sees diff hunks and cannot see the file tree. In particular, tsconfig/bundler path aliases were misread as literal missing paths. Added an `EVIDENCE & FALSE-POSITIVE GUARDRAILS` section to `BASE_AUDIT_PROMPT` that forbids "module does not exist / not found / build failure" claims unless the diff itself supplies the evidence, declares path aliases valid with an **arbitrary, user-defined prefix** (not just `@/` — also `~/`, `#`, `$lib/`, or any custom token configured in tsconfig/jsconfig `paths`, bundler config, or package `imports`), and requires a low-confidence/INFO downgrade for unverifiable claims. The guardrail also forbids unverified **dependency-version** factual claims — asserting that a package file/export/API "was removed / no longer exists / moved" in a specific version (e.g. "antd v5 removed `dist/reset.css`") unless the installed version appears in the dependency context and the claim matches it — since training data lags real releases and such removals are a frequent hallucination. The source-index resolver already matched arbitrary alias prefixes generically; a regression test now locks that in for non-`@` prefixes (`~/*`, `#components/*`). `DEFAULT_PROMPT_VERSION` bumped to `2026-06-08`, which (together with the system-prompt hash) invalidates stale cached findings.

## [3.0.5] — 2026-06-06

### Added
- **Module grouping, references, and usability sections in `create-skills`.** Generated skill files now include module groupings (by directory/layer), cross-module references with dependency links, and usability sections (quick-start patterns, common tasks) for a more structured progressive-disclosure layout.
- **Adoption preview script.** New `scripts/adoption-preview.mjs` for previewing generated skill output before adoption.
- **New rule packs.** Added built-in rule packs for Ant Design, React Router, Supabase, TanStack Query, and Vite.
- **Package manager detection.** `create-skills` now auto-detects the project's package manager (npm, pnpm, yarn) for more accurate stack profiling.

### Changed
- **GitLab CI/CD variable instructions updated.** Documentation now clarifies `GITLAB_TOKEN` and `CI_JOB_TOKEN` usage across CI workflow examples.


## [Unreleased]

### Added
- **Light source-index cache (schema 1.5).** `source-index.json` is now a compact core (project/files/graph/insights/stats, single-line JSON) while the heavy `codeSearch` and `calls` payloads move to JSONL sidecars (`source-index.<id>.code.jsonl` / `.calls.jsonl` / `.lookup.json`) written before the core and cleaned up across generations. Queries hydrate only what they read: `--find-symbol`/`--find-import` use the core, `--find-code` streams the code sidecar with bounded memory, `--agent-context` (and review call-impact) hydrate call edges. Legacy 1.0-1.4 monolithic caches still load; missing/corrupt sidecars degrade gracefully and flag `--health` as stale. New config: `indexing.cacheMode: "light" | "full"` (default light) and `indexing.validationMode: "fast" | "strict"` (default fast — size+mtime stat check first, hash only changed candidates). New flag: `indexing --full-index` hydrates sidecar payloads into the JSON export. `--stats`/`--health` report `cacheMode`, `sidecarsPresent`, `sidecarsValid`, `coreBytes`, `sidecarBytes`. The reverse dependency graph (`importedBy`) is now built in one pass instead of O(files^2). No new runtime dependencies.
- **Per-agent skill upgrade for `create-skills`.** All skill-capable adapters (Claude, Codex, Antigravity, Zed, Windsurf, Roo, Cline) now share the progressive-disclosure layout: a lean `SKILL.md` plus the full reference set (architecture, modules, commands, codebase map, testing map, dependencies, public API, code style, language patterns, clean-code checklist). Windsurf moved to `.windsurf/skills/<project>-windsurf-best-practices/`, Roo to `.roo/skills/<project>-roo-best-practices/`, Cline to `.cline/skills/<project>-cline-best-practices/`; old rule paths are detected as legacy advisories (never auto-deleted). Rule-only adapters (Cursor, Continue, Copilot, Aider, JetBrains/Junie, generic) now emit concise agent-native rule files without the bulky maps.
- **Deterministic version gating for rule packs.** `RulePackRule` and `FileEvaluator` accept internal `requires` dependency-major constraints, checked by a conservative package.json range parser (exact/caret/tilde/compound inequalities/npm & workspace aliases resolve; `*`, `latest`, one-sided `>=`, `file:`/`link:`/git ranges never do). Svelte 5 runes, Angular v16/v17+ rules, Next.js 13+ App Router rules, Vue 3 rules, and Nuxt 3 rules are emitted only when the manifest safely identifies a qualifying major; unknown or broad ranges emit only stable generic rules.
- **Stronger skill quality gate for all adapters.** Required-reference checks now apply to every skill-folder adapter (not only Claude), plus new checks: SKILL.md frontmatter `name` must match the skill folder name, every `./references/*.md` link must resolve to a generated file, and version-gated framework advice must not leak when the manifest doesn't qualify (defense in depth against rule-pack regressions).

### Fixed
- **Incremental indexing no longer resurrects stale "zombie" entries.** When a re-parsed file has parse errors, the builder falls back to the cached entry only for transient flakes: the cached entry must have parsed cleanly AND describe the same content (same sha256). If the file actually changed, or the old entry also failed parsing, the fresh parse (current sha/mtime/symbols) wins. Previously such files were pinned to ancient cache entries forever, making `indexing --health` report "source files changed" permanently.
- MCP `explain_context` now hydrates call edges from light-cache sidecars (matching CLI `--explain-context`), so caller/call-impact intelligence survives the schema 1.5 layout; the MCP response now also includes `includedSignals` and `relationTypes` when present.

### Changed
- **Node baseline lowered to `>=20.11.0`** (was `>=24.0.0`): `engines.node`, build target (`tsup` `node20.11`), and `@types/node` (`^20.19.41`) all aligned; `tsx` bumped to `4.22.4` to silence the `module.register()` deprecation on newer Node versions. Cold-path imports in source-index storage (`readdir`/`unlink`/`createReadStream`/`createInterface`/`randomBytes`) and `smol-toml` in the Python/Rust manifest readers are now lazy-loaded, so `dist/lib.js` builds without unused-external-import warnings. No CLI, JSON schema, or exit-code changes.
- `GENERATOR_VERSION` bumped to `3.0.0` -- existing generated skills (v2.0.0) are flagged stale by `--check` even when the source hash matches; regenerate with `create-skills --force`. Empty per-pack rule headings (e.g. `### Built-in Policies Rules` with no rules) are no longer rendered.
- Windsurf/Roo/Cline `create-skills` output kind changed from `rule` to `skill`; `--explain-agents` reports the new workspace paths. Cline detection now also accepts a `.cline/` directory.
- **Phase 4.6 — Call-aware review intelligence.** The review context builder now consumes schema 1.4 call edges: changed files' exported symbols are matched (textually, candidate-based) against other files' `calls[].callee`, adding a `caller` relation tier between direct dependents and hub files, a compact `Call Impact` section with capped caller files/call sites, and a `call-impact` intelligence signal (medium confidence). `--explain-context` surfaces the signal in `includedSignals`/`intelligenceSignals`/`evidenceSummary` and suggests `indexing --agent-context <caller-file>` for top callers. Budget-safe: the section is omitted before overflowing context; pre-1.4 caches without `calls` are unaffected.
- **Phase 4.1 — Call-edge indexing (source index schema 1.4).** `SourceIndexFile.calls: CallEdge[]` records outgoing call edges (plain, member, and constructor calls) with line/column and the nearest enclosing function (`inSymbol`), capped at 1,000 per file. All parser recovery modes (chunked, ASCII, retry) emit calls with correct line offsets. `indexing --agent-context <file>` now returns capped outbound `calls` (+`callsTruncated`) and `incomingCalls` candidates matched textually against the file's symbols. Backwards compatible: 1.0–1.3 caches still load; the new field is optional and included in the deterministic index hash by callee/inSymbol only (line shifts don't invalidate skills).
- **`generationConfigHash` metadata field.** Generated skill files now record a deterministic hash of generation-affecting config (`createSkills.policies` + `createSkills.disableRules`). `create-skills --check` compares it, so config-only changes flag files as stale. Default-equivalent config normalizes to the same hash as "no config", keeping pre-existing files up-to-date until something actually changes. `createSkills.policies` is now validated by the config schema, and both fields survive config merging (previously dropped).
- **Phase 4.5 — `init` command.** New `npx mp-sentinel init` subcommand that scaffolds `.mp-sentinelrc.json` interactively from a detected tech profile. Picks a provider based on env (`ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `OPENAI_API_KEY`), enables the GitHub MCP preset automatically if `GITHUB_TOKEN` is set, derives `techStack` + a starter `rules[]` from `package.json`, and writes a config that round-trips through `ProjectConfigSchema`. Refuses to overwrite an existing file without `--force`. `--non-interactive` (or `MP_SENTINEL_INIT_NONINTERACTIVE=1`) writes the proposed defaults without prompts. `--format json` returns a machine-readable summary.
- **Phase 4.2 — New agent adapters.** Added `aider`, `continue`, `roo`, `copilot`, `zed`, and `jetbrains` adapters. Each writes to the agent's documented project layout (`CONVENTIONS.md`, `.continue/rules/`, `.roo/rules/`, `.github/copilot-instructions.md`, `.agents/skills/<project>-zed-best-practices/`, `.junie/AGENTS.md`). Detection uses the same dotfile/config-file convention as the existing adapters; `--explain-agents` reports each new adapter's signals.
- **Phase 4.3 — Per-rule opt-out.** New `createSkills.disableRules: string[]` config — provide a list of `<packId>/<ruleId>` strings to omit individual rules from generated SKILL.md output without disabling whole packs. Backwards compatible: rules without an `id` are always kept (they can't be targeted).
- **Phase 4.4 — MCP preset library expansion.** Five new MCP presets in addition to `github` / `fetch`: `filesystem` (`@modelcontextprotocol/server-filesystem`), `git` (`uvx mcp-server-git`), `slack` (gated on `SLACK_BOT_TOKEN`), `linear` (community stdio server `@tacticlaunch/mcp-linear`, gated on `LINEAR_API_KEY` — not Linear’s hosted remote MCP server), `postgres` (read-only via `@modelcontextprotocol/server-postgres`; the connection URL is read from `DATABASE_URL` — or the env var named by `connectionUrlEnv` — and passed as the CLI argument the server expects). Mutating-tool prefix guard still applies; no new dependencies (presets spawn community MCP servers via `npx`/`uvx`).
- **Phase 3.2 — Streaming AI responses.** `IAIProvider.generateStream(systemPrompt, userPrompt, schema?)` is now part of the provider interface. Implemented natively for Anthropic (SSE `content_block_delta` / `input_json_delta`) and OpenAI Responses API (`response.output_text.delta`). Other providers transparently fall back through `callGenerateStream` → `generate()` and emit a single terminal chunk. `assembleStream` drains an `AsyncIterable<AIStreamChunk>` back into a complete `AIResponse` so cache writes, JSON-output mode, and other non-interactive consumers stay unaware of streaming.
- **Phase 3.3 — Pluggable cache backends.** `src/services/ai/cache-backends/` introduces a `CacheBackend` interface with two ship-in-tree implementations: `fs` (default, behavior-equivalent to the previous on-disk store) and `http` (`GET/PUT /<key>` against any HTTP key-value service — Cloudflare Workers KV, in-house caches, etc., no new dependencies). Selected via `cache.backend` in `.mp-sentinelrc.json`. Misses and writes are best-effort: backends never throw on read errors and never break the review pipeline on write errors.
- **Phase 3.1 — Parallel + incremental indexing.** The parse loop in `buildSourceIndex` is now driven by a bounded-concurrency `parallelMap` (default = `os.availableParallelism()` capped at 8). File I/O and tree-sitter parse work overlap across files, cutting wall-clock time on cold cache rebuilds. SHA-256-based incremental indexing was already in place; the new code keeps that contract (reuse cached files whose hash matches, only reparse changes). The index now records `gitHeadSha` at index time, and `indexing --health` surfaces `currentGitHeadSha` + `gitHeadDrift` so users can see when the indexed snapshot has drifted from the working tree.
- **Phase 2.1 — Entropy-based secret detection.** New `src/services/security/entropy.ts` adds a Shannon-entropy fallback that catches high-entropy assignment-style secrets that don't match a known prefix (custom internal tokens, opaque webhook secrets). Off by default; enable via `security.entropyEnabled: true` in `.mp-sentinelrc.json`. New config keys: `security.entropyMinLength`, `security.entropyMinBitsPerChar`, `security.allowValues`, `security.allowPaths`, `security.customPatterns`.
- **Phase 2.2 — High-value secret patterns.** Added regex patterns for Anthropic, OpenAI (legacy + project + service-account), Azure storage connection strings + SAS, Twilio SK/AC, SendGrid, Datadog, Postman, Shopify, Square, and GCP service-account JSON blocks (`private_key_id` + `private_key`).
- **Phase 2.3 — Risk-analyzer language packs.** New per-language pattern files under `src/services/risk-analyzer/patterns/` (Python, Go, Rust, PHP, Ruby) with security-focused checks like `pickle.loads`, `subprocess shell=True`, `exec.Command("/bin/sh","-c",…)`, `unsafe { … }`, `unserialize($_POST)`, `Marshal.load`, shell-interpolation, etc. The analyzer dispatches by file extension; the universal JS/TS pack always applies on top.
- **Phase 2.5 — Provider-native structured output.** `IAIProvider.generate()` accepts an optional `responseSchema` parameter. `AUDIT_RESPONSE_SCHEMA` (a JSON Schema mirror of the audit rubric) is now passed to OpenAI's `text.format.json_schema`, Anthropic's tool_use, Gemini's `responseSchema`, Grok's `response_format.json_schema`, and OpenRouter (for `openai/*` models). AI audit cache version bumped to `4` because the request shape changed.

### Changed
- **Phase 2.4 — Tightened noisy risk patterns.** `Path traversal` now requires the `../` to be syntactically inside an fs/path/sendFile call rather than appearing anywhere in the line — eliminates the noise from `import "../foo"`. `parseInt without radix` downgraded from WARNING to INFO and suppressed inside test/example paths (modern engines no longer interpret leading-zero as octal). New filters: `unwrap()` and `unsafe { … }` suppressed for `__tests__/` and `*-sys/`, `ffi/`, `bindings/` paths respectively.

### Added (Phase 1 — recap, already documented above)
- **Phase 1.1 — Token usage & cost capture.** Provider responses now carry `usage: { inputTokens, outputTokens }` and an optional `finishReason`. `ReviewReport.summary` gains an optional `tokenUsage` field with input/output tokens, AI call count, and a best-effort USD cost estimate. Surfaced in console + markdown reports.
- **Phase 1.2 — Broader retries + circuit breaker.** `isRetryableError` now covers 408/425/500/502/504/522/524 HTTP statuses plus `ETIMEDOUT`, `EAI_AGAIN`, `ENETUNREACH`, `ENOTFOUND`, `socket hang up`, `fetch failed`, `Service Unavailable`, `Bad Gateway`, `Gateway Timeout`. `withRetry` honors `Retry-After` headers and JSON `retry_after` / `retry_after_ms` fields. A new per-provider circuit breaker (`src/services/ai/circuit-breaker.ts`) trips after 5 consecutive failures and skips the primary provider until a 30s cooldown allows a half-open trial.
- **Phase 1.3 — SARIF formatter.** New `--format sarif` produces SARIF 2.1.0 output consumable by GitHub Code Scanning, GitLab Security Dashboard, and SonarQube.
- **Phase 1.4 — JSON Schema for `.mp-sentinelrc.json`.** New `schemas/mp-sentinelrc.schema.json` shipped with the package; `npm run schema:gen` regenerates from Zod via `zod-v4`'s native `z.toJSONSchema`. The example config now references it via `$schema`.
- **Phase 1.5 — Severity threshold.** New `--severity-threshold <CRITICAL|WARNING|INFO>` flag plus `review.severityThreshold` and `review.protectedBranches` config keys. Default remains `WARNING` (existing behavior). Resolved threshold is plumbed through `buildReport` and `printResultsSummary`.

### Fixed
- **`runReview` explicit-files fallback.** When `--files <path>` is passed but `git diff` produces no patch (e.g. running outside a git repository, file not yet committed), the file is now read directly and a synthetic diff is generated so the deterministic pipeline can still surface findings. Previously the empty `diffResult.files` triggered an early-exit with `results: []`, which left the deterministic non-AI fallback tests asserting on a missing `report.results[0]`. The new path matches the contract that `review-fallback.test.ts` asserts.
- Set `MP_SENTINEL_DEBUG_EMPTY_DIFF=1` (or pass `--verbose`) to surface the diagnostic stderr line when the early-exit still triggers on a fully-unreadable file set.
- **Multi-ecosystem support** — Python, Go, Rust, Dart, PHP, Ruby, Nuxt now first-class
- `manifests/` abstraction: ecosystem-aware project manifest readers for `pyproject.toml`, `go.mod`, `Cargo.toml`, `pubspec.yaml`, `composer.json`, `Gemfile`
- `extractors/lexical-framework.ts`: universal lexical extractor registry — register a new language in ~50 lines
- 6 new manifest readers (Python/Go/Rust/Dart/PHP/Ruby)
- 6 new lexical extractors (Python/Go/Rust/Dart/PHP/Ruby)
- 7 new rule packs: Nuxt, Dart, Flutter, PHP, Laravel, Ruby, Rails
- Pure-language projects (no `package.json`) no longer crash with exit 2
- `create-skills`: Svelte/Vue files are now indexed via `parseNonIndexableFile()` in `buildSourceIndex()` — imports, exports, and symbols properly extracted (Phase 7 fix)
- `create-skills`: `CodeStyleProfile` now computed for all skill generations (not just AI-enriched runs)
- New `isLexicallyExtractableLanguage()` function in `manifest.ts` for detecting `.svelte`/`.vue` files
- `npm run smoke:svelte` regression guard
- `svelte-skill-e2e.test.ts`: now asserts `.svelte` files appear in the built index

### Changed
- Quality gate: `SINGLE_FILE_MAX` and `SKILL_MD_MAX` increased from 27K to 30K
- `SkillsGenerationContext` now carries `codeStyleProfile` for adapter use
- TypeScript 6.0 compatibility: added `ignoreDeprecations: "6.0"` in tsconfig

### Fixed
- `.svelte` and `.vue` files were silently dropped from the source index — `parseNonIndexableFile()` was defined but never called. **This is the central Phase 7 bug fix.**
- AI-only gate on `CodeStyleProfile` — profile now built for all `create-skills` runs, not just AI-enriched ones

## [3.0.4] - 2026-06-04

### Added
- Schema 1.5 with lighter cache layout and sidecar support.

## [3.0.3] - 2026-06-04

### Added
- `mp-sentinel indexing --find-code <query>` — fast code snippet search with declaration-aware ranking.

### Fixed
- Command references updated to use `npx` for consistency.

## [3.0.1] - 2026-05-15

### Fixed
- `tsconfig.json` JSONC parsing now preserves path aliases and glob strings containing slash-star patterns.
- `create-skills` quality checks no longer report framework/API/package/import-alias tokens as missing paths.
- Source index cache metadata now records the `mp-sentinel` tool version instead of the scanned project version.
- Valid TypeScript `import("...").Type` type queries now produce parser warnings rather than hard parse errors.

## [3.0.0] - 2026-05-09

### Added
> **Nine-phase upgrade complete.** See [WHATS_NEW.md](../WHATS_NEW.md) for the full story.

- Multi-ecosystem support: Python, Go, Rust, Dart, PHP, Ruby, Nuxt
- Manifest abstraction with registry pattern (`manifests/`)
- Universal lexical extractor framework (`extractors/lexical-framework.ts`)
- 6 new manifest readers (Python/Go/Rust/Dart/PHP/Ruby)
- 6 new lexical extractors (Python/Go/Rust/Dart/PHP/Ruby)
- 7 new rule packs: Nuxt, Dart, Flutter, PHP, Laravel, Ruby, Rails
- Pure-language projects (no `package.json`) no longer crash with exit 2
- Language label fix: `.svelte`/`.vue` files now show `language: "svelte"`/`"vue"` in the index
- `npm run smoke:svelte` regression guard
- Full 11-command verification chain

### Changed
- Generator version bumped to `2.0.0`
- Quality gate size limits increased from 27K to 30K
- ProjectManifest now includes `ecosystem` field
- `CodeStyleProfile` computed for all skill generations

## [2.4.0] - 2026-05-09

### Added
> **Generator v2.0.0 upgrade:** See the [migration guide](./plans/MIGRATION_2.0_GENERATOR.md) for upgrade instructions and `--check` behaviour changes.

- `create-skills`: LanguageProfile detection (dominant/secondary languages, distribution, hotspots)
- `create-skills`: CodeStyleProfile detection (indent, quotes, semicolons, formatter configs, file sizes)
- `create-skills`: 8 rule packs for Svelte, Vue, React, Next.js, TypeScript, Python, Go, Rust
- `create-skills`: `## Language & Framework Rules`, `## Clean Code Policy`, `## File Size Policy` SKILL.md sections
- `create-skills`: Three new reference files: `code-style.md`, `language-patterns.md`, `clean-code-checklist.md`
- `create-skills`: AI Enrichment v2 with secret-scrubbed code samples, per-language rules, and file-cited anti-patterns
- `create-skills`: `--no-code-samples` CLI flag to disable code sample loading
- `create-skills`: `createSkills.policies` config block (maxFileLines, maxFunctionLines, maxParams, forbidDefaultExports)
- Svelte/Vue lexical extractors for import/symbol extraction without tree-sitter
- Generator version bump to `2.0.0` (independent of package version)

### Changed
- All 7 adapters (claude, codex, antigravity, cline, cursor, windsurf, generic) include new SKILL.md sections
- Codex and Antigravity adapters now write 3 new reference files
- SKILL.md size limit increased from 4200 to 8000 chars
- Quality gate: reference count check relaxed from "exactly 7" to "at least 7"
- Quality gate: glob patterns (*) no longer trigger unknown-path warnings
- `ENRICHMENT_PROMPT_VERSION` bumped to `2026-05-08`

- **MCP server review preview tools** (`src/services/mcp-server/review-preview.ts`, `src/utils/git.ts`): Three new read-only MCP tools — `mp_sentinel_review_scope` (target resolution, file filtering, diff metadata without raw patches), `mp_sentinel_review_deterministic` (non-AI risk analysis, secret redaction, token estimation), `mp_sentinel_review_filter_files` (file path filtering with accept/reject reasons). Git helpers extended with `cwd` support for project-root-safe operations.
- **MCP server agent/skill diagnostics** (`src/services/skills-generator/mcp-diagnostics.ts`, `src/services/mcp-server/service.ts`, `src/commands/mcp-server.ts`): Three new read-only MCP tools — `mp_sentinel_agents_explain` (agent detection), `mp_sentinel_skills_doctor` (health check), `mp_sentinel_skills_check` (freshness verification). Index read-only; no file generation or AI calls.
- **MCP server index query tools** (`src/services/mcp-server/service.ts`, `src/commands/mcp-server.ts`): Six new read-only MCP tools extending the existing stdio MCP server — `mp_sentinel_index_find_symbol`, `mp_sentinel_index_find_import`, `mp_sentinel_index_explain_file`, `mp_sentinel_index_stats`, `mp_sentinel_index_recovered_files`, `mp_sentinel_index_parse_errors`. No new CLI flags or commands.

## [2.3.0] - 2026-05-07

### Added

- **MCP server command** (`mp-sentinel mcp-server`, `src/commands/mcp-server.ts`, `src/services/mcp-server/service.ts`): Read-only stdio MCP server exposing three tools — `mp_sentinel_index_health`, `mp_sentinel_agent_context`, and `mp_sentinel_explain_context`. No AI calls, no mutations, no outbound MCP spawning. Routes before git repo checks and review config startup. Stdout reserved for JSON-RPC; all logs suppressed or routed to stderr.
- **MCP review context integration** (`.mp-sentinelrc.json`, `src/services/mcp/`, `src/utils/pr-metadata.ts`): Optional external review context from MCP servers via stdio transport. Disabled by default (`mcp.enabled: false`). Context is capped, cached, provenance-labeled, and injected into the AI system prompt.
- **MCP config** (`src/types/index.ts`, `src/utils/config.ts`): `mcp.enabled`, `mcp.timeoutMs`, `mcp.maxContextChars`, `mcp.cacheEnabled`, `mcp.cacheTtlMs`, `mcp.servers[]`. Mutating tool names are rejected at config validation. Duplicate tool+input pairs detected with recursive stable JSON.
- **Template variable resolution** (`src/services/mcp/template-resolver.ts`): `${repo.owner}`, `${repo.name}`, `${repo.fullName}`, `${pr.number}`, `${head.sha}`, `${base.ref}`, `${changedFiles.csv}`, `${cwd}`.
- **PR metadata from event payloads** (`src/utils/pr-metadata.ts`): Parses `GITHUB_EVENT_PATH` for `pull_request` and `issue_comment` payloads with fallback to env vars.
- **MCP cache** (`src/services/mcp/cache.ts`): Separate from AI audit cache, keyed on server config + recursive stable JSON input + head SHA + changed files + env mapping pairs. Atomic writes, TTL-based expiration.
- **Env sanitization** (`src/services/mcp/sanitizer.ts`): Only explicitly named env vars are forwarded to MCP child processes.
- **Deterministic-only skip**: MCP servers are not spawned when AI is disabled or in dry-run mode.
- **MCP smoke tests** (`src/__tests__/mcp-integration.test.ts`): Real mocked stdio MCP server tests proving connect + tool call lifecycle.
- **MCP preset expansion** (`src/services/mcp/presets.ts`): Shorthand `github` and `fetch` presets. Fetch `urls[]` auto-expand to fetch calls. Duplicate IDs across presets and servers are config errors.
- **MCP diagnostics** (`src/services/mcp/diagnostics.ts`): Read-only health checks (no spawns) surfaced in `--explain-context` JSON (`mcp` field) and console output. Reports `ready`, `missing_env`, `missing_command` per server.

## [2.2.0] - 2026-05-07

### Added

- ASCII brand banner for console and markdown review output.
- Severity-sorted findings (CRITICAL → WARNING → INFO) in console and markdown reports.
- Console summary now renders an icon table layout.
- Markdown summary table now includes an Icon column.
- Rule file path traversal detection now handles Windows-style backslashes on Unix.

### Changed

- Review orchestration no longer writes UI text before choosing console / json / markdown format.
- Legacy `printResultsSummary` updated to match the new icon table layout.

## [2.1.0] - 2026-05-06

### Added

- **`ruleFiles` config key** (`.mp-sentinelrc.json`, `src/types/index.ts`, `src/utils/config.ts`): Specify relative file paths to load additional project rules from. Each file's content is formatted as `From <path>:\n<content>` and appended after inline `rules`. Max 10 files, 12,000 chars each. Absolute paths and path traversal are rejected as config errors. Content is included in AI review prompts and create-skills AI enrichment.

## [2.0.1] - 2026-05-06

### Changed

- **GitLab CI/CD audit alignment** (`.gitlab-ci.yml`, `examples/workflows/gitlab/`, `docs/CICD_SETUP.md`): GitLab CI pipeline now matches the GitHub workflow — MR-only trigger (`merge_request_event`, `main` push rule removed), Node 24 image, source index build (`mp-sentinel indexing`) before audit, MR-safe git fetch (`--unshallow` + target branch), and blocking audit (removed `allow_failure: true`). All four GitLab inline examples in CICD_SETUP.md updated with indexing step and MR-safe fetch. GitLab cost optimization guidance updated for blocking default.

## [2.0.0] - 2026-05-05

### Breaking

- **Node runtime baseline raised to 24** (`package.json`, `manifest.ts`, docs): `engines.node` changed from `>=20.0.0` to `>=24.0.0`. Source index `project.nodeEngine` now reads from `package.json.engines.node` instead of always `undefined`. Generated skills display the real engine constraint. `@types/node` bumped to `^24.12.2`.

### Changed

- **Source index manifest** (`src/services/source-index/manifest.ts`): `readPackageManifest()` now returns `nodeEngine` parsed from `package.json.engines.node`. `readManifest()` passes it through instead of hardcoding `undefined`.
- **Config/docs/examples** (`.mp-sentinelrc.json`, `docs/README.md`, `docs/SKILLS_INTEGRATION.md`, `examples/skills-demo.ts`): `Node.js 20` references updated to `Node.js 24`.

## [1.34.2] - 2026-05-05

### Added
- **`ANTHROPIC_BASE_URL` env var**: Point the Anthropic provider at custom compatible endpoints (e.g., `https://api.deepseek.com/anthropic` for DeepSeek).
- **Model whitelist bypass**: When a valid custom `ANTHROPIC_BASE_URL` is set, the Anthropic model whitelist is skipped — any non-empty model name is accepted.
- **URL normalizer** (`src/services/ai/anthropic-utils.ts`): Shared `normalizeAnthropicBaseUrl()` handles URL normalization for both config and provider.
- **Cache key sensitivity**: Audit cache key (`buildAuditCacheKey`) and enrichment cache key (`computeEnrichmentCacheKey`) include `baseUrl` when non-empty.
- **Provider cache invalidation**: Runtime provider cache in `getProviderConfig()` invalidates when `baseUrl` changes.

### Changed
- **AnthropicProvider** (`src/services/ai/providers/anthropic.provider.ts`): Uses `config.baseUrl` from `normalizeAnthropicBaseUrl()` instead of hardcoded `https://api.anthropic.com/v1/messages`.
- **AIConfig** (`src/services/ai/config.ts`): `probeEnvironment()` and `fromEnvironmentForProvider()` read `ANTHROPIC_BASE_URL` for the anthropic provider and return normalized `baseUrl` in the config.
- **AI enrichment** (`src/services/skills-generator/ai-enrichment.ts`): Enrichment cache key and provider config carry `baseUrl`.

### Documentation
- `ANTHROPIC_BASE_URL` documented in `.env.example`, `src/services/ai/README.md`, `docs/README.md`, `docs/QUICK_START.md`, `docs/QUICK_REFERENCE.md`, `docs/PROVIDER_COMPARISON.md`, `docs/CICD_SETUP.md`, `docs/CREATE_SKILLS.md`, and `docs/AI_ENRICHMENT_CACHE_SPEC.md`.

## [1.34.1] - 2026-05-05

### Added
- **500-line limit per generated skill file**: `countFileLines()` trailing-newline-safe helper prevents false 501-line failures on files ending in `\n`.
- **Critical signal promotion**: CLI entrypoint, command file, and package.json script checks promoted from warnings to hard errors in generated skill quality validation.
- **Known-path allowlist extension**: `.sentinel/skills/`, `.js`, `.ts`, `.tsx`, `.mjs`, `.cjs` added to reduce false-positive unknown-path warnings in generated skills.

### Fixed
- **Line-count gate**: A 500-line file ending in `\n` no longer falsely reports as 501 lines and fails `--check`.

### Changed
- **Quality gate validation**: Generated skills must now mention real CLI entrypoints, command files, and package.json scripts, or `--check` fails with a hard error.

## [1.34.0] - 2026-05-04

### Added
- **Model tier selection** (`ai.modelTier` in `.mp-sentinelrc.json`, `AI_MODEL_TIER` env): Choose `premium` for security/architecture reviews, `balanced` for everyday CI (default), or `budget` for bulk passes.
- **Model tier catalog** (`src/services/ai/factory.ts`): Five provider tier catalogs with `getModelForTier()`, `getModelTiers()`, `getPremiumModels()` — premium-first ordering for hard reviews, budget fallback for cost-sensitive passes.
- **Configurable model resolution** (`src/services/ai/config.ts`): Resolved via `AI_MODEL` > `AI_MODEL_TIER` > `ai.modelTier` > provider default, wired through all audit entrypoints so `.mp-sentinelrc.json` settings affect runtime model selection.
- **OpenRouter budget tier**: Added `google/gemini-2.5-flash` as the OpenRouter budget fallback.
- **OpenRouter validation hardening** (`src/services/ai/factory.ts`): Replaced permissive `includes("/")` with strict `isValidOpenRouterModelId()` rejecting empty, malformed, or whitespace-containing IDs.
- **Mutation-safe tier API** (`src/services/ai/factory.ts`): `getModelTiers()` and `getPremiumModels()` return array copies — callers cannot mutate the internal catalog.
- **Consistency guard tests** (`src/__tests__/docs-consistency.test.ts`): Lockfile engine check, deprecated SDK scan, doc/factory model cross-reference.
- **Provider tests** (`src/__tests__/gemini.provider.test.ts`, `src/__tests__/openai.provider.test.ts`): Request shape, response parsing, error handling, `isAvailable()` contract.

### Changed
- **OpenAI provider migrated to Responses API** (`src/services/ai/providers/openai.provider.ts`): Endpoint changed from `/v1/chat/completions` to `/v1/responses`. Request body uses `instructions`, `input`, `max_output_tokens`, `store: false`. Parser handles `output_text` and nested `output[].content[].text`.
- **Gemini provider migrated to @google/genai** (`src/services/ai/providers/gemini.provider.ts`): Replaced deprecated `@google/generative-ai` SDK with `@google/genai`. Now uses `GoogleGenAI` with `models.generateContent()` and `abortSignal` support. `isAvailable()` returns correct API-key-based result.
- **Model catalog refreshed** (`src/services/ai/factory.ts`): Removed shut-down `gemini-3-pro-preview` and stale `gpt-5.3-codex`. Premium tiers updated with current model names (`gemini-3-flash-preview`, `gpt-5.4-mini`, `gpt-5.4-nano`). OpenAI default changed from `gpt-5.3-codex` to `gpt-5.2`.
- **Node runtime baseline raised to 20** (`package.json`, `tsup.config.ts`, docs): Changed `engines.node` from `>=18.0.0` to `>=20.0.0`. Build target updated to `node20`.
- **AI cache version bumped to v3** (`src/services/ai/cache.ts`): Invalidates stale entries from previous provider transport and model catalog.
- **Model tier wired through review runtime** (`src/services/ai/index.ts`, `src/cli/review.ts`, `src/cli/local-review.ts`, `src/cli/cicd-review.ts`): Provider config cache invalidates on model change; all audit functions pass `modelTier` through the call chain.
- **FromEnvironment/ForProvider tier support** (`src/services/ai/config.ts`): `probeEnvironment()`, `fromEnvironment()`, `fromEnvironmentForProvider()` all accept optional `modelTier`. Fallback providers use the same tier as the primary.

### Docs
- `README.md`: Model tier table, `AI_MODEL_TIER` env, OpenRouter budget tier.
- `PROVIDER_COMPARISON.md`: Tier-labeled tables, OpenRouter budget, decision guide updated.
- `COMMANDS_CHEAT_SHEET.md`: Tier selection examples.
- `CONTRIBUTING.md`: Model docs rule (factory catalog + tests + docs in one change).
- `WHATS_NEW.md`: v1.34.0 entry.
- `src/services/ai/README.md`: `AI_MODEL_TIER` env var doc.

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
- **Non-AI fallback on bad AI env** (`src/cli/review.ts`, `src/cli/local-review.ts`, `src/commands/create-skills.ts`): Unsupported `AI_PROVIDER`, unsupported `AI_MODEL`, or missing API key now warns and disables AI for the run. Review continues with deterministic non-AI review (secret redaction + risk analyzer); create-skills skips AI enrichment and still emits deterministic skills.
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
- **Stale comments** (`src/commands/indexing.ts`, `s