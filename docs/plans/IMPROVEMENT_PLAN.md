# MP Sentinel — Feature Improvement Plan

> Status: Phase 1 landed (1.1–1.5) · Author: review pass on v3.0.2 · Last updated: 2026-05-27
>
> Scope: strengthen the *existing* feature set rather than add net-new product surface. Each item lists why it matters, the concrete change, the files most likely to be touched, and a rough size estimate (S/M/L). Verification steps follow `AGENTS.md §8`.

---

## 1. Inventory of current features (baseline)

The plan below assumes the following capabilities exist today and are working. Baseline checked against `main` at commit `da156d5` (release `3.0.2`). The most recent code changes after the original review pass were a 3.0.1 → 3.0.2 release bump, the `--find-code` indexing query (already covered below), and a documentation-only fix updating command references to use `npx`. None of those alter the gap analysis in §2.

| Area | What ships in v3.0.2 |
|------|----------------------|
| Review pipeline | CI/CD diff review, local review (commit/range/staged/files), dry-run, `--explain-context`, fallback provider chain, concurrency limiter, audit cache, retry with exponential backoff |
| AI providers | Gemini, OpenAI, Anthropic, Grok, OpenRouter with `premium/balanced/budget` tier catalog |
| Security | 16 default secret patterns + suspicious-keyword scan, REDACTION_MARKER, per-file payload summary |
| Risk analyzer | Deterministic pre-AI scan (security, runtime-crash, architecture, performance) — JS/TS focused |
| Rule packs | 19 packs: builtin + Svelte, Vue, React, Next, TS-strict, Python, Go, Rust, Astro, Solid, Angular, Nuxt, Dart, Flutter, PHP, Laravel, Ruby, Rails |
| Source indexing | Tree-sitter for JS/TS/JSX/TSX, lexical fallback for Python/Go/Rust/Dart/PHP/Ruby/Svelte/Vue, schema 1.3 with codeSearch entries, health/recovered/parse-errors drilldown |
| create-skills | 7 agent adapters (claude, cursor, codex, windsurf, antigravity, cline, generic), AI enrichment v2, `--check`, `--doctor`, `--explain-agents`, quality gate |
| MCP integration | Stdio MCP context gathering (github + fetch presets), separate cache, diagnostics; `mcp-server` exposes 14+ read-only tools |
| Misc | Skills fetcher (`.skills`, `.agent/skills`, `.cursor/rules`, `.sentinel/skills`), tech profile, dependency context, compliance + perf harness, release check |

---

## 2. Gaps observed

The plan addresses these concrete gaps surfaced while reviewing the source:

1. No structured output (tool_use / responseSchema) — providers return free-form JSON parsed via regex; brittle when models add prefixes/code fences.
2. No token-usage / cost telemetry — `IAIProvider.generateContent` returns a string only; we never capture input/output tokens or cost, so budgets cannot be enforced.
3. Retry triggers are narrow — only `429 / 503 / ECONNRESET / AbortError` are retried (`src/utils/retry.ts`); `502/504/ETIMEDOUT/network timeouts/empty body` are not.
4. Secret detection is prefix-only — `DEFAULT_SECRET_PATTERNS` rely on `AKIA…`, `ghp_…`, `AIza…`. High-entropy custom tokens slip through; Azure / Twilio / SendGrid / Postman / Datadog / OpenAI / Anthropic provider keys are not covered.
5. Risk analyzer is JS/TS-only — no Python (`pickle.loads`), Go (`exec.Command` shell:true), Rust (`unsafe { … }` near FFI), PHP (`eval`, `unserialize`), Ruby (`Marshal.load`), or generic SSRF/insecure-deserialization patterns.
6. Indexing is sequential and full-rebuild — no worker_threads, no incremental "what changed since last commit" mode; large monorepos pay full cost every run.
7. No call-graph — only file-level import/export edges; "blast radius" reasoning is coarse.
8. No SARIF / GitHub Code Scanning output — JSON + Markdown + console only.
9. No JSON Schema for `.mp-sentinelrc.json` — Zod validation at runtime, but IDE autocomplete is missing.
10. No `--severity-threshold` flag — every CRITICAL fails; can't escalate WARNING on protected branches.
11. Skills generator has no per-rule opt-out — packs activate atomically; users can't disable a single rule.
12. MCP transport is stdio only with two presets — no SSE/HTTP, no `filesystem` / `git` / `slack` / `linear` / `postgres` presets.
13. Cache is local FS only — CI runs across runners can't share `.mp-sentinel-cache/` unless explicitly mounted.
14. No `init` command for guided setup — users hand-write `.mp-sentinelrc.json` against examples.
15. Skills fetcher reads `.cursor/rules` as flat files only — Cursor uses `.cursor/rules/*.mdc` (already partially handled) but recursive walks aren't done.

---

## 3. Roadmap

Each phase is ordered so earlier work unblocks later work. Sizes: **S** ≈ ½–1 day, **M** ≈ 2–4 days, **L** ≈ 1–2 weeks.

### Phase 1 — Stability & observability (P0)

These changes harden existing surfaces without introducing new abstractions.

#### 1.1 Capture token usage & cost in every provider response (M)

**Why.** Today `IAIProvider.generateContent(...)` returns `Promise<string>`. We discard usage metadata that every provider already includes (`usage.input_tokens` / `usage.output_tokens` for Anthropic, `usage.prompt_tokens` / `usage.completion_tokens` for OpenAI, `usageMetadata` for Gemini). Without it we can't enforce budgets, surface cost in the report, or warn on runaway prompts.

**Change.**

- Extend the provider interface in `src/services/ai/types.ts`:
  ```ts
  export interface AIResponse {
    text: string;
    usage?: { inputTokens: number; outputTokens: number };
    finishReason?: "stop" | "length" | "content_filter" | "error";
  }
  export interface IAIProvider {
    generate(systemPrompt: string, userPrompt: string): Promise<AIResponse>;
    /** @deprecated use generate() — kept for backward compatibility */
    generateContent(systemPrompt: string, userPrompt: string): Promise<string>;
    isAvailable(): boolean;
  }
  ```
- Update each provider in `src/services/ai/providers/*.provider.ts` to populate `usage` from the SDK response.
- Aggregate into `ReviewSummary` in `src/types/index.ts`:
  ```ts
  interface ReviewSummary {
    // ...existing fields
    tokenUsage?: { input: number; output: number; estimatedCostUsd?: number };
  }
  ```
- Add a cost lookup table (`src/services/ai/pricing.ts`) keyed by provider+model. Treat unknown models as "no cost reported" rather than crashing.
- Show in the console report and JSON output.

**Files.** `src/services/ai/types.ts`, all 5 files in `src/services/ai/providers/`, `src/services/ai/index.ts`, `src/types/index.ts`, `src/formatters/report.ts`, `src/__tests__/ai.test.ts` + per-provider tests.

**Verification.** `npm run typecheck && npm test`; add a unit test per provider that mocks the SDK and asserts usage propagation.

#### 1.2 Broaden retry triggers and add circuit breaker (S+M)

**Why.** `isRetryableError` in `src/utils/retry.ts` only catches `429 / 503 / ECONNRESET / AbortError`. Real-world transient failures we miss: `502`, `504`, `ETIMEDOUT`, `EAI_AGAIN`, `fetch failed`, empty body, gateway HTML. We also retry indefinitely against persistently failing providers, wasting tokens.

**Change.**

- Add `502`, `504`, `ETIMEDOUT`, `EAI_AGAIN`, `socket hang up`, `fetch failed`, `network timeout` to the retryable matcher.
- Honor `Retry-After` headers when the underlying error preserves them (Anthropic and OpenAI both expose them).
- Implement a per-provider circuit breaker (`src/services/ai/circuit-breaker.ts`): track rolling failure rate over a 60s window; trip to `open` after 5 consecutive failures, transition to `half-open` after 30s, close on the first success. When `open`, `auditFile` skips the primary and goes straight to the fallback chain.

**Files.** `src/utils/retry.ts`, new `src/services/ai/circuit-breaker.ts`, `src/services/ai/index.ts`, `src/__tests__/retry.test.ts`, new `src/__tests__/circuit-breaker.test.ts`.

**Verification.** Unit tests with fake clocks; integration test: 6 forced failures should trip breaker and skip retry on call #7.

#### 1.3 SARIF formatter (S)

**Why.** GitHub Code Scanning, GitLab Security Dashboard, and Sonar all ingest SARIF 2.1.0. Adding it unlocks a major CI integration without changing the review logic.

**Change.**

- Add `src/formatters/sarif.ts` that maps `ReviewReport.results[].issues[]` to SARIF runs/results. Use `category` as `tags[]` and `severity` → SARIF `level`.
- Register `--format sarif` in `src/cli/args.ts` and route in `src/index.ts`.
- Schema-validate the output with a small fixture under `src/__tests__/fixtures/sarif/`.

**Files.** new `src/formatters/sarif.ts`, `src/cli/args.ts`, `src/index.ts`, `src/types/index.ts` (`ReviewFormat` union), `src/__tests__/sarif-formatter.test.ts`, docs.

**Verification.** Round-trip parse the produced JSON and assert top-level `version: "2.1.0"`, `runs[0].tool.driver.name === "mp-sentinel"`.

#### 1.4 JSON Schema for `.mp-sentinelrc.json` (S)

**Why.** The Zod schemas in `src/utils/config.ts` are the source of truth at runtime, but editors can't read them. A published JSON Schema gives users IDE autocomplete and inline docs.

**Change.**

- Generate `schemas/mp-sentinelrc.schema.json` from the existing Zod schemas using `zod-to-json-schema`.
- Add the standard `$schema` reference at the top of `.mp-sentinelrc.example.json`.
- Add `npm run schema:gen` to keep it current; wire it into `release:check`.

**Files.** new `scripts/gen-config-schema.mjs`, new `schemas/mp-sentinelrc.schema.json`, `.mp-sentinelrc.example.json`, `package.json` scripts, `scripts/release-check.mjs`.

**Verification.** CI script: run schema generation and `git diff --exit-code schemas/`.

#### 1.5 `--severity-threshold` and exit-code escalation (S) — shipped

**Status.** Landed. Note: existing review behavior already treated CRITICAL *and* WARNING as failing — the plan's "default = CRITICAL" would have silently relaxed this for every user. Implementation preserves the historical default (**WARNING**) and exposes `CRITICAL` (stricter) and `INFO` (any finding fails) as opt-ins.

**What landed.**

- `--severity-threshold <CRITICAL|WARNING|INFO>` CLI flag in `src/cli/args.ts`.
- `review.severityThreshold` + `review.protectedBranches[<branch>]` in `.mp-sentinelrc.json` (Zod + JSON Schema both updated).
- Shared `src/utils/severity.ts` — `parseSeverityThreshold`, `resolveSeverityThreshold` (CLI > branch override > config baseline > default WARNING), `issuesFailThreshold`.
- Wired into `buildReport` (CI/CD path) and `printResultsSummary` (local-review path).
- Tests: `src/__tests__/severity-threshold.test.ts`; updated edge-case assertions in `src/__tests__/deterministic-review.test.ts` (FAIL-with-INFO-only now passes by default — see test for explanation).

---

### Phase 2 — Detection quality (P0–P1)

These changes raise the precision / recall of what we flag.

#### 2.1 Entropy-based secret detection (M)

**Why.** Prefix-based regex misses anything custom. Adding a Shannon-entropy check (≥ 4.5 bits/char, length ≥ 24, not a known dictionary word) catches arbitrary high-entropy strings in `=`, `:`, or env-var assignments. Combine with allowlist support for fixture paths.

**Change.**

- Add `src/services/security/entropy.ts` with a tested entropy function and an allowlist mechanism.
- Extend `DEFAULT_SECRET_PATTERNS` with a fallback "high-entropy assignment" matcher that delegates to the entropy check for the captured value.
- Add `security.allowPaths: string[]` and `security.customPatterns: Array<{ name, pattern, flags }>` to `.mp-sentinelrc.json`.

**Files.** new `src/services/security/entropy.ts`, `src/services/security/patterns.ts`, `src/services/security/index.ts`, `src/utils/config.ts`, `src/__tests__/security-entropy.test.ts`.

**Verification.** Test corpus of true secrets vs. fixture strings; track false-positive rate target ≤ 1% on the project's own test files.

#### 2.2 Missing high-value secret patterns (S)

**Why.** Common provider keys aren't in `patterns.ts`. Add them with the same shape used today:

- Anthropic: `sk-ant-(?:api03|admin)-[A-Za-z0-9_-]{93,}`
- OpenAI: `sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}` (legacy 51-char and project keys)
- Azure: `(?:AccountKey|DefaultEndpointsProtocol|SharedAccessSignature)\s*=\s*[^;\s]+`
- Twilio: `SK[0-9a-fA-F]{32}` and `AC[0-9a-fA-F]{32}`
- SendGrid: `SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}`
- Datadog: `dd[ap]_[A-Za-z0-9]{32,}`
- Postman: `PMAK-[A-Fa-f0-9]{24}-[A-Fa-f0-9]{34}`
- Square / Shopify access tokens
- GCP service-account JSON shape (`"private_key_id"` adjacent to `"private_key"` with PEM block)

**Files.** `src/services/security/patterns.ts`, `src/__tests__/security.test.ts`.

#### 2.3 Risk-analyzer language packs (M)

**Why.** `src/services/risk-analyzer/index.ts` is JS/TS-centric. With lexical extractors already supporting Python/Go/Rust/PHP/Ruby/Dart in the indexer, add equivalent deterministic patterns gated on file extension:

| Language | Examples to add |
|---|---|
| Python | `pickle.loads`, `subprocess.*shell=True`, `yaml.load(` (no `Loader=`), `eval(`, `exec(`, `os.system(` |
| Go | `exec.Command(..., "/bin/sh", "-c", …)`, `unsafe.Pointer`, `crypto/md5` use for auth, `http.Client{}` without timeout |
| Rust | `unsafe {` blocks in non-FFI modules, `unwrap()` on `Result`/`Option` in non-test files, `mem::transmute` |
| PHP | `eval(`, `unserialize(`, `extract($_REQUEST)`, `include $_GET[..]` |
| Ruby | `Marshal.load`, `eval(`, `system("...#{…}")`, `Open3.popen3` with interpolation |
| Cross-language | SSRF: HTTP client called with `req.body|query|params|userInput`-derived URL |

**Change.** Split `risk-analyzer/index.ts` (already 793 lines — close to the 500-line policy ceiling) into per-language files under `src/services/risk-analyzer/patterns/{js,python,go,rust,php,ruby}.ts`. Dispatch by extension.

**Files.** new `src/services/risk-analyzer/patterns/*`, `src/services/risk-analyzer/index.ts` refactor, `src/__tests__/risk-analyzer.test.ts` + per-language fixtures.

**Verification.** Per-language fixture corpus with expected findings; ensure existing JS/TS tests stay green.

#### 2.4 Tighten existing patterns to reduce noise (S)

**Why.** Two patterns are known to over-fire today:

- `Path traversal` (`(?:\.\.\/|\.\.\\)`) — matches every `import "../foo"`. Scope to runtime path APIs: only flag inside `fs.*`, `path.join`, `readFile`, `open`, etc.
- `parseInt without radix` — common in test fixtures; downgrade severity from WARNING to INFO and only flag in non-test files.

**Files.** `src/services/risk-analyzer/index.ts` (or the new patterns/* file after 2.3), `src/__tests__/risk-analyzer.test.ts`.

#### 2.5 Provider-native structured output (M)

**Why.** Today every provider returns text that `parseAuditResponse` extracts JSON from. Models occasionally wrap output in ```` ```json ```` fences or prose, and we lose findings. Modern providers support structured output natively.

**Change.**

- Add a `responseSchema` parameter to `IAIProvider.generate(...)`.
- Wire it to:
  - **OpenAI** — `response_format: { type: "json_schema", json_schema: { name: "audit", schema, strict: true } }`
  - **Anthropic** — tool use with a single tool returning the schema, force `tool_choice: { type: "tool", name }`
  - **Gemini** — `responseSchema` + `responseMimeType: "application/json"`
  - **Grok / OpenRouter** — OpenAI-compatible JSON schema where supported, fall back to the current text+parse path
- Keep `parseAuditResponse` as a defensive fallback for providers that ignore the schema.

**Files.** all `src/services/ai/providers/*.provider.ts`, `src/services/ai/types.ts`, `src/config/prompts.ts` (remove the "OUTPUT FORMAT (JSON ONLY)" footer when structured output is active), tests.

**Verification.** Replay 30+ recorded prompt/responses; assert zero parse failures with structured mode on.

---

### Phase 3 — Performance & scale (P1)

#### 3.1 Parallel + incremental indexing (M)

**Why.** `buildSourceIndex()` walks files sequentially. For a 5k-file repo on a 10-core machine, tree-sitter is CPU-bound — straight-line wall time is mostly idle cores. Incremental indexing (only reparse files whose SHA-256 changed) cuts subsequent builds 80–95%.

**Change.**

- Add a worker-thread pool (`node:worker_threads`) sized to `os.availableParallelism()` for tree-sitter parsing. Each worker owns its grammar instance; shared parser pool stays in the worker.
- Add `--incremental` (default on) to `mp-sentinel indexing`: read the previous cache, keep entries whose `sha256` matches the current file, only reparse changed/new files. Honor `--force` for full rebuild.
- Track the git HEAD SHA at index time so MCP `index_health` can report drift.

**Files.** `src/services/source-index/parser.ts`, `src/services/source-index/storage.ts`, `src/commands/indexing.ts`, new `src/services/source-index/worker.ts`, tests.

**Verification.** Benchmark via `scripts/perf-budget.mjs` on a fixture monorepo; assert ≥ 50% speedup on the second run.

#### 3.2 Streaming AI responses (M)

**Why.** Large files chunked over many provider calls block until the slowest finishes. Streaming lets us flush partial findings sooner, improve perceived latency, and abort early if an issue stream surfaces a CRITICAL.

**Change.**

- Add `generateStream(systemPrompt, userPrompt) → AsyncIterable<{ deltaText, done }>` to `IAIProvider`.
- Use it in `auditFile` to populate a per-file streaming buffer; pass through to a `--stream` console renderer that prints issues as they parse.
- Keep `generate()` for non-streaming consumers (cache writers, JSON mode).

**Files.** all provider files, `src/services/ai/index.ts`, `src/cli/review.ts`, new `src/formatters/streaming-console.ts`.

**Verification.** Manual: run against a 20-file PR, observe progressive output. Unit: stream-mock returns 3 chunks, assert assembly equals non-stream output.

#### 3.3 Remote cache backend (M)

**Why.** `.mp-sentinel-cache/` is local-only. CI runners (especially ephemeral GitHub Actions) can't share it without explicit artifact upload. A pluggable backend lets teams point at S3 / GCS / Redis / HTTP for org-wide reuse.

**Change.**

- Abstract the cache interface in `src/services/ai/cache.ts` (`read`, `write`, `has`).
- Add backends:
  - `fs` (current behavior, default)
  - `s3` (gated on `@aws-sdk/client-s3` as an optional dep)
  - `redis` (optional dep)
  - `http` (any HTTP key-value store with `GET`/`PUT`)
- Config:
  ```json
  { "cache": { "backend": "s3", "s3": { "bucket": "...", "prefix": "mp-sentinel/" } } }
  ```
- Keep the same key-derivation (`buildAuditCacheKey`) so backends interop.

**Files.** new `src/services/ai/cache-backends/{fs,s3,redis,http}.ts`, `src/services/ai/cache.ts`, `src/utils/config.ts`, docs.

**Verification.** Backend-by-backend unit tests using local stubs; opt-in optional dependency installation tests.

---

### Phase 4 — Intelligence (P2)

#### 4.1 Call-graph indexing (L)

**Why.** Today's `index.insights` knows which files import each other. It doesn't know which *symbols* are called where. Adding a call graph gives precise "blast radius" — if `getUser()` changes, we can list every call site, not just every importer.

**Change.**

- Extend the tree-sitter visitor to capture `call_expression` and `member_expression` nodes, resolving the callee to a known symbol via the same name/path heuristics already used for imports.
- Add `callGraph: { from: SymbolRef; to: SymbolRef; line: number }[]` to the source index schema (1.4).
- Surface in `queryAgentContext()`: "this symbol is called by N files at M sites".
- Index schema bump must be backwards compatible: optional field, no rename.

**Files.** `src/services/source-index/parser.ts`, `src/services/source-index/query.ts`, `src/services/source-index/storage.ts`, `src/types/index.ts`, tests.

**Verification.** Fixture project with 3 files; assert call edges are recorded and queryable.

#### 4.2 New agent adapters (M)

**Why.** The agent ecosystem has expanded. Adding adapters for the most-used new ones gives users out-of-box skill generation:

- **Aider** — `.aider.conf.yml` and `CONVENTIONS.md` (already a de facto pattern)
- **Continue.dev** — `.continuerc.json` and `.continue/config.json`
- **Roo Code** — `.roo/rules.md`
- **JetBrains AI Assistant** — `.idea/aiassistant/rules.xml`
- **Zed** — `.zed/agents.json` (verify upstream path)
- **GitHub Copilot Workspace** — `copilot-instructions.md` at repo root

Follow the adapter contract in `AGENTS.md §4`: each adapter must include a verified `officialDocsUrl` in `spec`. **Do not merge an adapter without confirming the path against current upstream docs** — agent layouts change frequently.

**Files.** new files under `src/services/skills-generator/adapters/`, `src/services/skills-generator/registry.ts`, `src/types/index.ts` (extend `AgentAdapterId`), tests, `docs/CREATE_SKILLS.md`.

#### 4.3 Per-rule opt-out in rule packs (S)

**Why.** Rule packs activate atomically. A team may want React rules but disable the `next/image-optimization` advice. There's no escape hatch today.

**Change.**

- Add `createSkills.disableRules: string[]` to `.mp-sentinelrc.json`. Each rule pack already has a stable id pattern (`<packId>/<ruleId>`); filter the rendered list at generation time.
- Surface the active vs. disabled rules in `--explain-agents --format json`.

**Files.** `src/services/skills-generator/content.ts` (or wherever rules render), `src/utils/config.ts`, `src/__tests__/rule-packs.test.ts`.

#### 4.4 MCP preset library expansion (S)

**Why.** Only `github` and `fetch` presets exist. Add the most-requested community presets:

- `filesystem` (`npx -y @modelcontextprotocol/server-filesystem ${cwd}`)
- `git` (`uvx mcp-server-git`)
- `slack` (gated on `SLACK_BOT_TOKEN`)
- `linear` (gated on `LINEAR_API_KEY`)
- `postgres` (read-only, requires `DATABASE_URL`)

All must default to read-only allowlists per the mutating-tool rejection rule in `gatherMCPContext`.

**Files.** `src/services/mcp/presets.ts`, `src/types/index.ts`, `src/__tests__/mcp-presets.test.ts`, docs.

#### 4.5 `init` command for guided setup (M)

**Why.** New users assemble `.mp-sentinelrc.json` by hand from `.mp-sentinelrc.example.json`. A guided `init` lowers onboarding friction substantially.

**Change.**

- New `src/commands/init.ts` (uses the existing `prompts` dep).
- Detects project tech (via `tech-profile.ts`), proposes:
  - Provider + model tier
  - Default rules from detected stack
  - MCP presets if `GITHUB_TOKEN` is set
  - `severityThreshold`
- Writes `.mp-sentinelrc.json` (refuses to overwrite without `--force`).
- Runs `mp-sentinel create-skills --dry-run` at the end to preview agent skill generation.

**Files.** new `src/commands/init.ts`, `src/cli/args.ts`, `src/index.ts`, tests, docs.

---

## 4. Cross-cutting policy

Every PR landing items above must follow the rules already documented in `AGENTS.md`:

- **File-length policy** — refactor before adding to any file above 500 lines. The risk analyzer (793) and several source-index files are near or over already; address as part of 2.3.
- **Schema backwards compatibility** — additions to the source-index schema, JSON CLI output, and config must be additive. Bump schema version (1.3 → 1.4) but never rename / remove.
- **Docs & runtime parity** — every CLI flag added must update `README.md`, `docs/COMMANDS_CHEAT_SHEET.md`, `WHATS_NEW.md`, `docs/CHANGELOG.md`, and the relevant test in the *same commit*.
- **AI cache key invariants** — anytime the system prompt, structured-output schema, or model resolves differently, bump `CACHE_VERSION` in `src/services/ai/cache.ts` so stale entries aren't served.
- **Generated skills are local-only** — never commit `.claude/skills/`, `.agents/skills/`, etc.
- **Exit codes** — `0/1/2` are contractual. New flags must not introduce new codes.

---

## 5. Suggested execution order

A reasonable cadence for one engineer working solo:

| Sprint | Items | Outcome |
|---|---|---|
| 1 | 1.1, 1.2, 1.4, 1.5 | Visible cost, robust retries, IDE-friendly config, flexible severity |
| 2 | 1.3, 2.4, 2.2 | SARIF + sharper detection with low risk |
| 3 | 2.1, 2.5 | Entropy detection + structured output (cache version bump required) |
| 4 | 3.1 | Parallel + incremental indexing (measure with `perf-budget.mjs`) |
| 5 | 2.3 | Risk-analyzer language packs (couples with 2.3-driven refactor) |
| 6 | 3.2, 3.3 | Streaming + remote cache (optional dependencies) |
| 7 | 4.3, 4.4, 4.2 | Rule opt-out + MCP presets + agent adapters |
| 8 | 4.5, 4.1 | `init` command, then call-graph indexing as a larger investment |

---

## 6. Verification checklist per item

For every item above, run `AGENTS.md §8` before opening a PR:

```sh
npm run format:check
npm run typecheck
npm run typecheck:tests
npm test
npm run build
# JSON-output changes
mp-sentinel --format json ... | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>JSON.parse(d))"
# Skill-generator changes
npm run agent:skills:check && npm run agent:skills:refresh
# Release-sensitive changes (Phase 1.4 schema bump, Phase 3 cache layout, Phase 4.1 schema 1.4)
npm run release:check
npm run dogfood
```
