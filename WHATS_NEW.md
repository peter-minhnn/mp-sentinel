# What's New in v3.0.1

## v3.0.1

### Fast Index Lookup: Symbols + Code Text

New indexed search paths let users and agents find symbols or code snippets without broad `grep` loops.

- **`mp-sentinel indexing --find-code <query>`** — Search indexed code snippets by exact text, case-insensitive text, or token-normalized query (e.g., `build source index` matches `buildSourceIndex`). Results include file, line, nearest symbol, and redacted snippet text. JSON output with `--index-format json`.
- **MCP tool `mp_sentinel_index_find_code`** — Read-only code snippet search via the MCP server.
- **Source index schema 1.3** — Optional `codeSearch` entries per file: trimmed, secret-redacted snippets with nearest symbol metadata. Optional `endLine`/`endColumn` on `SymbolInfo`.
- **Improved symbol normalization** — Token-variant matching (camelCase, PascalCase, snake_case, concatenated) enables space-separated queries like `build source index` to match `buildSourceIndex` in `--find-symbol`.
- **Refactored query handlers** — Extracted from the oversized `src/commands/indexing.ts` into `src/commands/indexing-queries.ts`.

### Source Indexing and `create-skills` Quality Fixes

- **JSONC tsconfig parsing** — path aliases and globs such as `@/*`, `./src/*`, and `**/*.ts` are no longer mistaken for comments.
- **Cleaner generated skill checks** — framework/API/import tokens such as `Next.js`, `.map()`, `React.memo`, `next/image`, and `@/lib` no longer produce false unknown-path warnings.
- **Index cache versioning** — source indexes now record the `mp-sentinel` tool version rather than the scanned project's package version.
- **TypeScript parser recovery** — valid `import("...").Type` type queries are treated as parser warnings instead of hard parse errors.

## Upcoming (v3.0.0)

### Multi-Ecosystem Support

`create-skills` now supports projects outside the Node.js ecosystem. Pure Python, Go, Rust, Dart, PHP, and Ruby projects (no `package.json`) work without the previous exit-2 crash.

- **Manifest abstraction** (`manifests/registry.ts`) — ecosystem-aware project manifest readers. Detects `pyproject.toml`, `go.mod`, `Cargo.toml`, `pubspec.yaml`, `composer.json`, `Gemfile` automatically.
- **Universal lexical extractors** (`extractors/lexical-framework.ts`) — register a new language in ~50 lines; imports, exports, and symbols extracted via regex.
- **7 new rule packs** — Nuxt, Dart, Flutter, PHP, Laravel, Ruby, Rails — each activates based on the detected ecosystem.
- **`npm run smoke:<ecosystem>` pattern** — regression guards for Python, Go, Rust, Dart, PHP, Ruby, Nuxt.

### Upcoming (v2.5.0)

### Stronger Skills — Language-Aware `create-skills` (v2.0.0 generator)

> **Upgrading from a previous version?** The generator output schema changed. Run `npx mp-sentinel create-skills` once after upgrade to regenerate; `--check` now flags `generatorVersionUpgrade` so CI fails with an actionable message instead of a generic `stale`. See the [Generator 2.0 migration guide](./docs/plans/MIGRATION_2.0_GENERATOR.md).

The `create-skills` command now produces opinionated, language-aware best-practices skills:

- **`LanguageProfile`** — detects dominant/secondary languages, codebase language distribution, and non-indexable hotspots (Svelte, Vue, Python, Go, Rust, etc.)
- **`CodeStyleProfile`** — samples real files to detect indent style, quote preference, semicolon usage, file-size percentiles, and formatter/linter configs
- **8 deterministic rule packs** — Svelte, Vue, React, Next.js, TypeScript (strict), Python, Go, Rust — each activates based on actual codebase content
- **`## Language & Framework Rules`** SKILL.md section — auto-generated, no AI required
- **`## Clean Code Policy`** and **`## File Size Policy`** — configurable limits (maxFileLines, maxFunctionLines, maxParams, forbidDefaultExports) with observed-offender reporting
- **Three new reference files**: `references/code-style.md`, `references/language-patterns.md`, `references/clean-code-checklist.md`
- **AI Enrichment v2** — when enabled, sends secret-scrubbed code samples to the AI provider, requesting per-language rules and file-cited anti-patterns
- **`--no-code-samples` CLI flag** — disables code sample loading for AI enrichment
- **`createSkills.policies` config** — configure clean-code limits in `.mp-sentinelrc.json`
- **Svelte/Vue lexical extractors** — extract imports and symbols from `.svelte`/`.vue` files using regex, no tree-sitter required
- **Generator version** bumped to `2.0.0` — existing generated skills flagged stale on first `--check`
- **Svelte/Vue indexing fix** (Phase 7) — `parseNonIndexableFile()` is now wired into `buildSourceIndex()`. `.svelte`/`.vue` files are indexed via `lexical-fallback` with imports, exports, and symbols properly extracted. `CodeStyleProfile` now runs for all skill generations (not just AI-enriched). New `npm run smoke:svelte` regression guard.

### MCP Review Preview Tools

Three new read-only MCP tools for previewing what mp-sentinel would review:
- **`mp_sentinel_review_scope`**: Resolve review target, filter files, return diff metadata (no raw patches). Supports `staged`, `range`, `commit`, and `files` modes.
- **`mp_sentinel_review_deterministic`**: Non-AI review with risk analysis, secret redaction, and token estimation. Returns `aiEnabled: false`.
- **`mp_sentinel_review_filter_files`**: Run explicit paths through file filtering; returns accept/reject with reasons.

### MCP Agent/Skill Diagnostics

Three new read-only MCP tools for agent and generated-skill health:
- **`mp_sentinel_agents_explain`**: Agent/IDE adapter detection with signals and default selection.
- **`mp_sentinel_skills_doctor`**: Comprehensive skill health check — index status, adapter files, package scripts. Missing index is diagnostic data.
- **`mp_sentinel_skills_check`**: Skill freshness verification — checks file existence and metadata hash. Missing index returns an error.

### MCP Index Query Tools

Six new read-only MCP tools extending the `mp-sentinel mcp-server`:
- **`mp_sentinel_index_find_symbol`**: Symbol search with match scores.
- **`mp_sentinel_index_find_import`**: Import search with match scores.
- **`mp_sentinel_index_explain_file`**: File dependency info with import classification and parser telemetry.
- **`mp_sentinel_index_stats`**: Index statistics, parser breakdown, chunk telemetry, insights.
- **`mp_sentinel_index_recovered_files`**: Files parsed via fallback parser (limit: 50 default, 100 max).
- **`mp_sentinel_index_parse_errors`**: Files with hard parse errors (limit: 50 default, 100 max).

# What's New in v2.3.0

## MCP Server Command

A read-only stdio MCP server (`mp-sentinel mcp-server`) that exposes project context over MCP JSON-RPC. No AI calls, no mutations, no network — safe for editors and MCP clients.

- **`mp_sentinel_index_health`**: Read-only index health check (never builds or refreshes the index).
- **`mp_sentinel_agent_context`**: Structured agent context for a file — symbols, imports, dependents, hub files, suggested commands.
- **`mp_sentinel_explain_context`**: Context preview for a set of files with index metadata and MCP diagnostics.
- Routes before git repo checks and review config startup. Stdout reserved for JSON-RPC; all logs suppressed or routed to `stderr`.
- Exit code `0` on clean close, `2` on crash. Protocol-level tool errors return `isError: true` without crashing the server.

## MCP Review Context Integration

Optional external review context from MCP (Model Context Protocol) servers can now be gathered before AI code review — SCM metadata, docs, or any stdio-based MCP source.

- **Disabled by default** (`mcp.enabled: false`). Enable explicitly in `.mp-sentinelrc.json`.
- **Stdio transport only**: Spawns local commands (e.g., `npx -y @modelcontextprotocol/server-github`). No network servers.
- **Graceful failure**: All MCP failures are logged as warnings — review never blocked. Returns `null` on any failure.
- **Context isolation**: Injected as `### EXTERNAL MCP CONTEXT (optional, untrusted)` in the system prompt, before architecture context.
- **Safety guardrails**: Mutating tools (create*, update*, delete*, merge*, etc.) rejected at config validation. Environment variables only forwarded when explicitly listed in `env` mapping (`{ "CHILD_KEY": "PROCESS_ENV_KEY" }`).
- **Template variables**: `${repo.owner}`, `${repo.name}`, `${repo.fullName}`, `${pr.number}`, `${head.sha}`, `${base.ref}`, `${changedFiles.csv}`, `${cwd}` resolved at call time from CI/CD metadata.
- **PR metadata from event payloads** (`GITHUB_EVENT_PATH`): Parses `pull_request` and `issue_comment` payloads for richer metadata before falling back to env vars.
- **MCP cache**: Separate from AI audit cache, keyed on server config + input (recursive stable JSON) + head SHA + changed files + env mapping pairs. Atomic writes, TTL-based expiration.
- **Context budget**: Strict `mcp.maxContextChars` (default 6000). Total output never exceeds budget.
- **Deterministic-only skip**: MCP servers are not spawned when AI is disabled or in dry-run mode.
- **MCP preset expansion** (`src/services/mcp/presets.ts`): Shorthand `presets` array with `github` (npx @modelcontextprotocol/server-github) and `fetch` (uvx mcp-server-fetch) presets. Fetch `urls[]` auto-expand to individual fetch tool calls. Presets expand into full server definitions before cache/gather. Duplicate IDs across presets and servers are config errors.
- **MCP diagnostics** (`src/services/mcp/diagnostics.ts`, `--explain-context`): Read-only diagnostic checks (no spawns). Reports per-server status (`ready`, `missing_env`, `missing_command`). Surfaced in `--explain-context` JSON output (`mcp` field) and console display.

### Configuration

```json
{
  "mcp": {
    "enabled": true,
    "timeoutMs": 5000,
    "maxContextChars": 6000,
    "cacheEnabled": true,
    "cacheTtlMs": 3600000,
    "presets": [
      {
        "preset": "github",
        "calls": [
          { "tool": "get_file_contents", "input": { "path": "README.md" } }
        ]
      },
      {
        "preset": "fetch",
        "urls": ["https://docs.example.com/api/${base.ref}"]
      }
    ],
    "servers": []
  }
}
```

### New files

| File | Purpose |
|------|---------|
| `src/utils/pr-metadata.ts` | PR metadata from CI env vars + `GITHUB_EVENT_PATH` |
| `src/services/mcp/sanitizer.ts` | Safe env forwarding to MCP child processes |
| `src/services/mcp/template-resolver.ts` | `${repo.owner}`, `${head.sha}`, etc. resolution |
| `src/services/mcp/cache.ts` | MCP result cache with recursive stable JSON keys |
| `src/services/mcp/client.ts` | Stdio MCP client with typed lazy SDK loading |
| `src/services/mcp/context-builder.ts` | Format results, strict budget enforcement |
| `src/services/mcp/index.ts` | gatherMCPContext orchestrator |
| `src/services/mcp/presets.ts` | Preset expansion (github, fetch) |
| `src/services/mcp/diagnostics.ts` | Read-only MCP health checks |

---

# What's New in v2.2.0

## Review Output UI Refresh

Console and markdown review output now renders with a cleaner, table-style layout including icon columns and severity-sorted findings.

---

# What's New in v2.1.0

## Rule Files Config (`ruleFiles`)

`ruleFiles` lets you reference existing project docs (e.g., `docs/FLOW.md`) as review rules in `.mp-sentinelrc.json`, instead of duplicating them inline.

- **New config key** (`ruleFiles`): Array of relative file paths. Each file's content is loaded and appended to project rules at review time and in create-skills AI enrichment.
- **Format**: File-derived rules appear as `From <path>:\n<content>` in prompts.
- **Guardrails**: Max 10 files, 12,000 chars per file. Absolute paths and path traversal (`../`) are rejected. Missing/unreadable files are config errors (exit code 2).
- **Merge order**: Inline `rules` come first, then `ruleFiles` entries. The existing 20-rule prompt cap still applies.
- **Backward compatible**: `rules` is unchanged. `.sentinel/skills/` still works for custom skill prompts — `ruleFiles` is for explicit project-root files.

---

# What's New in v2.0.1

## GitLab CI/CD Audit Alignment

v2.0.1 aligns the GitLab CI/CD audit pipeline with the GitHub workflow: MR-only trigger, Node 24 runtime, source index build before audit, MR-safe git fetch, and blocking audit behavior.

- **MR-only trigger** (`.gitlab-ci.yml`, examples): `code_audit` now runs only on `merge_request_event`, matching GitHub's `pull_request` trigger. The `main` branch push rule was removed.
- **Node 24 runtime** (`.gitlab-ci.yml`, examples): GitLab CI image and examples updated from `node:20` to `node:24` to match the v2.0.0 Node engine requirement.
- **Source indexing before audit**: GitLab CI pipeline now runs `mp-sentinel indexing` before the audit step, matching the GitHub workflow's `Build Source Index` step.
- **Blocking audit**: `allow_failure: true` removed from `.gitlab-ci.yml` and GitLab examples so the audit gates MRs the same way GitHub's audit does.
- **MR-safe git fetch**: `git fetch --unshallow` added before target-branch fetch to ensure complete history for three-dot diff computation and accurate MR discussion positions.
- **GitLab examples** (`examples/workflows/gitlab/`): Claude and OpenAI examples updated with Node 24, indexing step, blocking behavior, and MR-safe fetch.
- **CI/CD docs** (`docs/CICD_SETUP.md`): All four GitLab inline examples (Gemini, OpenAI, Claude, OpenRouter) updated with indexing step, inline `--target-branch`, and MR-safe fetch. Cost optimization guidance updated for blocking audit default.

---

# What's New in v2.0.0

## Node 24 Runtime Baseline

v2.0.0 raises the public package baseline from **Node.js 20** to **Node.js >=24.0.0**.

- **Breaking**: `engines.node` changed from `>=20.0.0` to `>=24.0.0`.
- **Source index**: `project.nodeEngine` now reads from `package.json.engines.node` at index build time instead of always `undefined`. Generated skills display the real engine constraint.
- **`@types/node`**: Bumped from `^22.19.9` to `^24.12.2`.
- **Config/docs/examples**: All `Node.js 20` references updated to `Node.js 24`.
- **No CI workflow changes**: Actual GitHub workflows still use `node-version: 'latest'`.

---

# What's New in v1.34.2

## Anthropic Custom Base URL Support

v1.34.2 adds env-only `ANTHROPIC_BASE_URL` support for Anthropic-compatible endpoints, with DeepSeek as the primary target.

- **New env var** (`ANTHROPIC_BASE_URL`): Point the Anthropic provider at any compatible endpoint (e.g., `https://api.deepseek.com/anthropic` for DeepSeek).
- **Model whitelist bypass**: When a valid custom base URL is set, the Anthropic model whitelist is bypassed — any non-empty model name is accepted.
- **DeepSeek example**: `AI_PROVIDER=anthropic AI_MODEL=deepseek-v4-pro ANTHROPIC_API_KEY=<key> ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic`
- **URL normalizer**: A shared `normalizeAnthropicBaseUrl()` utility handles URL normalization (trailing slash, `/v1/messages` suffix) in both config and provider.
- **Cache key sensitivity**: Both audit cache keys and enrichment cache keys include the base URL when non-empty, so switching endpoints invalidates cached results.
- **Provider cache invalidation**: Runtime provider cache invalidates when `baseUrl` changes.
- **No `.mp-sentinelrc.json` changes**: This is an env-only feature — no config key added.

---

# What's New in v1.34.1

## Generated Skill Quality Gate Hardening

v1.34.1 hardens the create-skills quality gate with stricter validation and fixed line counting.

- **500-line limit per generated file** ([`quality-gate.ts`](src/services/skills-generator/quality-gate.ts#L233-L245)): Every generated skill file is capped at 500 lines. Files exceeding the limit fail `--check` with a hard error.
- **Trailing-newline-safe line counting**: `countFileLines()` strips trailing newlines before splitting, so a real 500-line file ending in `\n` does not falsely fail as 501 lines.
- **Critical signal promotion**: Missing CLI entrypoint, command file, and package.json script mentions are now hard errors — omitting them makes the skill misleading for agents.
- **Known-path allowlist extended**: `.sentinel/skills/`, `.js`, `.ts`, `.tsx`, `.mjs`, `.cjs` added to reduce false-positive unknown-path warnings in generated skills.

---

# What's New in v1.34.0

## Configurable Model Tier Selection

v1.34.0 adds model tier selection so you can choose between premium, balanced, and budget models through config or environment variable without hardcoding a model name.

- **Model tier config** (`ai.modelTier` in `.mp-sentinelrc.json`, `AI_MODEL_TIER` env): Choose `premium` for security/architecture reviews, `balanced` for everyday CI (default), or `budget` for bulk/low-criticality passes.
- **Factory tier API** (`src/services/ai/factory.ts`): `AIProviderFactory.getModelForTier(provider, tier)` resolves the first model in the requested tier. Every provider has non-empty premium, balanced, and budget tiers.
- **Model resolution precedence**: `AI_MODEL` > `AI_MODEL_TIER` > `ai.modelTier` > provider default. Fallback providers use the same tier when no explicit model is set.
- **OpenRouter budget tier**: Added `google/gemini-2.5-flash` as the budget model for OpenRouter.

---

# What's New in v1.33.1

## Review Prompt Intelligence & Local Workflow Polish

v1.33.1 improves review quality and local safety without changing the review contract or exit code semantics.

- **Stack-aware review focus** (`src/services/tech-profile.ts`, `src/config/prompts.ts`): Review prompts now receive concise technology-specific cues from `techStack` or `package.json`, even when the source index is unavailable.
- **Index-independent profile detection** (`src/cli/review.ts`): Explain-context and review prompt construction now fall back through config, package manifest, and generic profile detection instead of relying solely on source indexing.
- **Foreground-only review exit** (`src/index.ts`): Review commands flush output and terminate immediately after printing the report so long-lived handles cannot keep an agent terminal open after the paid AI scan finishes.
- **OpenRouter CI and local setup docs** (`docs/CICD_SETUP.md`, `docs/CONTRIBUTING.md`, `docs/CODE_STYLE.md`, `docs/README.md`, `examples/workflows/gitlab/`): GitHub/GitLab guidance, GitLab examples, and Husky pre-commit review setup are aligned with the current CLI entrypoint and provider configuration.

---

# What's New in v1.33.0

## OpenRouter Provider — Multi-Model AI Routing

v1.33.0 adds OpenRouter as a first-class AI provider, giving you access to 300+ models through a single API key.

- **OpenRouter provider** (`src/services/ai/providers/openrouter.provider.ts`): REST client targeting `https://openrouter.ai/api/v1/chat/completions` with canonical `X-OpenRouter-Title` and `HTTP-Referer` attribution headers. `HTTP-Referer` is only sent when `OPENROUTER_SITE_URL` is configured.
- **Provider integration** (`src/services/ai/types.ts`, `src/services/ai/factory.ts`, `src/services/ai/config.ts`, `src/services/ai/index.ts`, `src/utils/tokens.ts`): `openrouter` added to the `AIProvider` union, factory routing, fallback chain parsing, and token-limits map (200K conservative cap).
- **AI enrichment support** (`src/services/skills-generator/ai-enrichment.ts`, `src/commands/create-skills.ts`): OpenRouter is a validated provider for `createSkills.ai.provider` and doctor readiness checks.
- **`--no-ai-enrich` default fix** (`src/cli/args.ts`): The `--no-ai-enrich` flag now defaults to `false` (AI enrichment enabled when config says so) rather than inverting the default.
- **Model-gated structured output** (`src/services/ai/providers/openrouter.provider.ts`): `response_format: { type: "json_object" }` is sent only for model families known to support it (e.g., `openai/gpt-*`). Other models (including `moonshotai/kimi-*`) omit the parameter, relying on the existing parser's markdown-JSON extraction.

- **Docs** (`docs/README.md`, `docs/CICD_SETUP.md`, `docs/PROVIDER_COMPARISON.md`, `docs/QUICK_REFERENCE.md`, `docs/CREATE_SKILLS.md`, `docs/AI_ENRICHMENT_CACHE_SPEC.md`, `docs/CONTRIBUTING.md`): OpenRouter added to provider tables, config examples, cost comparisons, and decision trees.

## AI Environment Fallback

- **Anthropic key alias** (`src/services/ai/config.ts`): `ANTHROPIC_AUTH_TOKEN` is accepted as a fallback when `ANTHROPIC_API_KEY` is not set.
- **Readiness preflight** (`src/services/ai/config.ts`, `src/cli/review.ts`, `src/cli/local-review.ts`, `src/commands/create-skills.ts`): Unsupported `AI_PROVIDER`, unsupported `AI_MODEL`, or missing key now disables AI for the run and falls back to deterministic non-AI review (secret redaction + risk analyzer; not a full AI substitute) instead of failing review with a provider setup error.
- **Create-skills behavior** (`src/services/skills-generator/ai-enrichment.ts`, `src/commands/create-skills.ts`): `createSkills.ai` still reads provider/model from `.mp-sentinelrc.json`; unavailable AI skips enrichment and generates deterministic skills. Project `rules` are included in the enrichment prompt when AI is available.

---

# What's New in v1.32.1

## Release Finalization

v1.32.1 confirms the v1.32.0 hardening fixes and finalizes the release. This patch contains no runtime changes — it validates that all serial isolation, stale cache cleanup, and chunk boundary improvements from v1.32.0 are stable and production-ready.

- **All v1.32.0 fixes confirmed stable** (`jest.setup.cjs`, `src/services/source-index/parser.ts`, `src/services/source-index/storage.ts`, `scripts/serial-isolation-check.cjs`): Serial isolation, stale cache cleanup, and chunk boundary accuracy remain unchanged and fully validated through the complete test suite and dogfood workflow.
- **Agent skills regenerated** for v1.32.1: All generated skills (Claude, Cursor, Codex, Windsurf, Antigravity, Cline) are refreshed and verified to ensure agents receive the latest workflow guidance and index insights.

---

# What's New in v1.32.0

## Serial Isolation & Stale Cache Fixes

v1.32.0 fixes the historical tree-sitter serial isolation failures in Jest and drops stale index entries when files are deleted from the project.

- **Serial isolation fix** (`jest.setup.cjs`, `src/services/source-index/parser.ts`): Tree-sitter parsers are now preloaded in the root CJS context via `jest.setup.cjs` and shared across Jest VM contexts. `getParser()` detects the pool through `globalThis.__mpTreeSitter` and cycles through pooled parsers to limit reuse per test. `clearParserCache()` resets pools and caches between suites. This avoids loading the native addon per-suite, preventing Windows EPERM errors when Jest creates concurrent VM contexts.
- **Serial isolation guard** (`scripts/serial-isolation-check.cjs`): New script runs the historically fragile tree-sitter suites with `--runInBand` in one Jest process. Acts as a regression canary for serial isolation issues.
- **Stale cache cleanup** (`src/services/source-index/storage.ts`, `src/commands/indexing.ts`): `validateCache()` now detects indexed files that were removed from the current file set and marks them as missing, so cache rebuilds drop stale entries. When all remaining files are cached but the file set shrank, the index graph is rebuilt instead of short-circuiting.
- **Chunk boundary accuracy** (`src/services/source-index/parser.ts`): `netBraceChange()` now skips braces inside line comments, block comments, string literals, and template literal bodies (while continuing to count braces inside `${}` template expressions). Prevents brace-depth skew from comment and string content when finding safe chunk split points.

---

# What's New in v1.31.0

## Smarter Chunk Boundaries for Large Files

v1.31.0 improves `chunked-tree-sitter` parsing by preferring safe chunk boundaries, reducing boundary-warning noise in large files without changing the public telemetry contract.

- **Safe-boundary chunking** (`src/services/source-index/parser.ts`): `chunkedParse` now prefers split points where brace depth returns to the chunk's starting depth and the source line ends at a likely statement/module boundary (`;`, `}`, or blank). When no safe boundary is found within a bounded lookahead capped by the hard chunk limit, it falls back to the existing max-size line split.
- **Stable telemetry**: No new public JSON fields. `chunkBoundaryWarningCount`, `chunkActionableWarningCount`, and `chunkWarningCount` remain unchanged. The `chunkBoundaryWarningCount + chunkActionableWarningCount === chunkWarningCount` invariant is preserved.
- **Line-offset preservation**: All symbol, import, and export line numbers remain correct across chunk boundaries.

---

# What's New in v1.30.0

## Release-Note Symbol Hygiene Gate

v1.30.0 adds a release-check gate that validates function references in WHATS_NEW.md point to real symbols in the source tree, preventing stale backtick-quoted references from shipping in release notes.

- **Release-check symbol hygiene** (`scripts/release-check.mjs`): New symbol hygiene check scans the latest WHATS_NEW.md section for backtick-quoted function references and verifies each symbol exists in `src/**/*.ts`. Missing references cause a hard release-check failure.
- **Path fix** (`scripts/release-check.mjs`): Symbol scan now uses recursive `readdirSync` with `parentPath` for correct nested-file resolution. Removed unused `statSync` import.

---

# What's New in v1.29.1

## Release-Note Hygiene

v1.29.1 is a documentation-only patch removing stale references to removed internal helpers from the v1.29.0 release notes. No runtime changes.

- **WHATS_NEW.md**: Removed stale treeHasMissing and collectErrorRows helper references that were removed from source before v1.29.0 shipped.

---

# What's New in v1.29.0

## Parser Warning Semantics, Docs Accuracy & Workflow Contract

v1.29.0 replaces stub chunk warning classification with Tree-sitter-informed boundary semantics, tightens stale-docs detection, and documents the agent workflow-command contract.

- **Chunk warning classification** (`src/services/source-index/parser.ts`): `chunkBoundaryWarningCount` and `chunkActionableWarningCount` are now computed from actual parse results. Chunked parsing splits files on line boundaries, breaking multi-line constructs, so all chunk parse warnings are classified as boundary artifacts; only no-tree and throw conditions count as actionable.
- **Docs accuracy** (`README.md`, `docs/ARCHITECTURE.md`, `docs/SKILLS_INTEGRATION.md`): Removed stale v1.0.x version references from current-version documentation. Feature-introduced markers like `(v1.0.14+)` are preserved as historical context.
- **Dogfood stale-docs gate** (`scripts/dogfood.mjs`): Lines matching feature-introduced markers (`(v1.0.x+)`, `pre-v1.0.x`) are excluded from stale-docs detection, keeping legitimate historical documentation intact.
- **Agent workflow-command contract** (`docs/CREATE_SKILLS.md`): New `## Agent Workflow-Command Contract` section documents the enforced indexing diagnostic commands (`--health`, `--recovered`, `--parse-errors`, `--agent-context`, `--explain-index`, `--find-symbol`, `--find-import`, `--stats`) and workflow rules (health first, drill down on parser issues, per-file diagnostics before editing, JSON mode for automation).

---

# What's New in v1.28.0

## Agent Parser Diagnostics Workflow

v1.28.0 closes the parser diagnostics workflow gap: generated skills now teach agents the health-first workflow, doctor exposes chunk aggregate telemetry, and docs explicitly include `chunked-tree-sitter` in recovery drilldowns.

- **Generated skills workflow** (`src/services/skills-generator/content.ts`): Required Agent Workflow now includes `--health`, `--recovered`, and `--parse-errors` diagnostic commands with `--index-format json`, teaching agents to check parser health before touching files.
- **Quality gate expanded** (`src/services/skills-generator/quality-gate.ts`): Agent workflow contract now validates that `--health`, `--recovered`, and `--parse-errors` are present in generated skills, flagging any missing command as a hard error.
- **Doctor chunk telemetry** (`src/types/index.ts`, `src/commands/create-skills.ts`): `DoctorIndexInfo` gains optional `chunkedFiles`, `totalChunks`, `totalChunkWarnings`, `chunkSize` fields, populated when chunked files exist. Console output shows a compact "Chunks: N files, N chunks @ N bytes/chunk, N warnings" line.
- **Docs** (`AGENTS.md`): Parser recovery drilldown explicitly includes `chunked-tree-sitter`. Health-first workflow documented.
- **Dogfood** (`scripts/dogfood.mjs`): Doctor step asserts chunk aggregate fields when `chunked-tree-sitter` mode count > 0, and their absence when count is 0.

---

# What's New in v1.27.0

## Parser Telemetry Propagation

v1.27.0 propagates parser telemetry consistently across all output surfaces, adds a shared serializer for parser diagnostics, and surfaces aggregate chunk stats in health/stats output.

- **Shared parser telemetry serializer** (`src/services/source-index/query.ts`): New `getParserTelemetry(file, options?)` function consolidates all parser diagnostic fields (`parserMode`, `parseWarnings`, `parseErrors`, `parseErrorMessages`, `chunkCount`, `chunkSize`, `chunkWarningCount`) into a single call. Supports `agentContext: true` option to emit `parseErrors` as a count with separate `parseErrorMessages` array.
- **Consistent telemetry in all outputs** (`src/commands/indexing.ts`): `--explain-index` and `--agent-context` now include chunk telemetry for chunked-tree-sitter files. `handleDrilldown()` and `handleExplain()` both use the shared serializer.
- **Aggregate chunk summary** (`src/commands/indexing.ts`, `src/types/index.ts`): `--health` and `--stats` JSON now include `chunkedFiles`, `totalChunks`, `totalChunkWarnings`, `chunkSize` when chunked files exist. Console output shows a compact "Chunks: N files, N chunks @ N bytes/chunk, N warnings" line.
- **Dogfood extended** (`scripts/dogfood.mjs`): Health step asserts aggregate chunk fields. Index queries step validates chunk fields in `agent-context` and `explain-index` output per parser mode.

---

# What's New in v1.26.1

## Hygiene Patch

v1.26.1 is a small cleanup patch removing duplicate chunk telemetry spreads and fixing stale comments.

- **Dedup chunk fields** (`src/commands/indexing.ts`): Removed duplicate `chunkCount`/`chunkSize`/`chunkWarningCount` spreads in `handleDrilldown()` that were emitted twice per entry.
- **Comment fixes** (`src/commands/indexing.ts`, `src/types/index.ts`): `getParserModeBreakdown()` no longer references pre-1.3 caches. `DoctorIndexInfo.recoveredFiles` JSDoc now includes `chunked-tree-sitter`.

---

# What's New in v1.26.0

## Chunked Parser Observability & Lexical Fallback Guard

v1.26.0 adds chunk telemetry fields, deduplicates drilldown output, and tightens dogfood validation for chunked and lexical-fallback modes.

- **Chunk telemetry fields** (`src/types/index.ts`, `src/services/source-index/parser.ts`, `src/commands/indexing.ts`): `chunkCount`, `chunkSize`, `chunkWarningCount` added to `SourceIndexFile`. Surfaced in `--recovered` drilldown entries for `chunked-tree-sitter` files.
- **Dogfood lexical-fallback guard** (`scripts/dogfood.mjs`): Health check asserts `parserModeBreakdown["lexical-fallback"] === 0` after fresh index build. Non-zero = silent parser regression.
- **Dogfood chunk validation** (`scripts/dogfood.mjs`): Parser drilldown validates `chunkCount` >= 2, `chunkSize` > 0, `chunkWarningCount` is numeric, `parseWarnings` includes chunked indicator, and non-zero content counts for every `chunked-tree-sitter` recovered file.

---

# What's New in v1.25.0

## Chunked Tree-sitter Parser Recovery

v1.25.0 introduces a new fallback parser that splits large files on line boundaries and merges results, significantly improving parse success rates for oversized files.

- **Chunked Tree-sitter parser recovery** (`src/services/source-index/parser.ts`): New `chunkedParse()` fallback that splits large content on line boundaries (MAX_CHUNK_SIZE=30000), parses each chunk independently via Tree-sitter, and merges results with correct line offsets. Positioned between full-file Tree-sitter and ASCII normalization in the recovery chain. Imports/exports are deduplicated across chunks.
- **New parser mode** (`src/types/index.ts`): `chunked-tree-sitter` added to the `ParserMode` union.
- **Recovery chain order**: `Invalid argument` → chunked Tree-sitter → ASCII normalization → lexical fallback (was: ASCII normalization → lexical fallback).
- **Telemetry** (`src/commands/indexing.ts`, `src/commands/create-skills.ts`): `getRecoveredFileCount`, `getParserModeBreakdown`, drilldown recovered filter, and doctor recovered count all include `chunked-tree-sitter`. Console breakdown displays include `chunked-tree-sitter`.
