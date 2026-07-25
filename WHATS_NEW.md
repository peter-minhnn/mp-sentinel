# What's New in v3.2.7

## Generated skills that describe the codebase you actually have

- **tsconfig path aliases are no longer reported as npm dependencies.** `@/app` and friends look like bare specifiers, so they used to appear in `references/dependencies.md` with version `unknown`, and could even be suggested as the project's "top dependency" in a search example. `collectAliasPrefixes()` now resolves them as internal, at index time and again in `buildDepMap()` so a stale index cache cannot resurrect them.
- **Rule packs require evidence of use.** Dependency-activated packs (`tanstack-query`, `supabase`, `antd`) declare `usageAnchors`; `computeDependencyReach()` counts importers plus one hop, and a pack whose anchor reaches fewer than 3 files is dropped. Presence in package.json is not evidence that a library shapes the code, and a pack for a library used once buries the rules that apply. Gating is skipped below 40 indexed files, where "used twice" means nothing.
- **Detected conventions follow the same rule.** A state or form library is only described as the project's stack when at least two files import it.
- **Reference routing carries information again.** The fallback row now uses a weaker reference set (`codebase-map`) than any classified row, rows that merely repeated the fallback are dropped, and a row naming dozens of directories collapses to a bounded sample plus a count.
- **Module counts agree across documents.** `commands.md` no longer labels total files as "source file(s)", and per-module references that a run no longer selects are deleted instead of lingering with an older `sourceIndexHash` and contradictory counts.
- **The advertised dependency count matches the table.** SKILL.md said "20 dependencies" while `dependencies.md` rendered 15; both now come from `MAX_TRACKED_DEPENDENCIES`.
- **Every React rule can now be disabled.** The React pack's rules had no ids, so `createSkills.disableRules` could not target them — a project whose App Router code legitimately reads data during a server render had no way to drop the generic "never fetch in render" advice. All nine now carry stable `react/*` ids.
- **Project overlays, for every agent.** Drop a `.mp-sentinel/skill-overlay.md` (or set `createSkills.overlayFile`) and it is copied verbatim into every generated skill and rule file as `## Project Overlay (authoritative)`, above the generated rules. It feeds the generation-config hash, so editing it makes `--check` report stale. This replaces post-processing scripts that patched one agent's `SKILL.md` and were undone by the next `--force`.

---

# What's New in v3.2.6

## DeepSeek provider, OpenAI reasoning models, and Windows compatibility

- **DeepSeek provider.** `deepseek` is now a first-class AI provider — pick it with `MP_SENTINEL_AI_PROVIDER=deepseek` and a DeepSeek API key. The provider uses Anthropic-compatible message shapes and **deterministic reviews** (`reasoning.effort` controls thinking depth, `reasoning.summary` controls token-efficient summaries). Supported models: `deepseek-chat`, `deepseek-reasoner`. DeepSeek reviews are fully cacheable (stable cache keys), with automatic retry on 429.
- **OpenAI reasoning models and custom endpoints.** OpenAI users can now select `o3`, `o4-mini`, `gpt-5`, and `codex`-series models. `o3`/`o4-mini` use `reasoning.effort` to control explicit `max_completion_tokens`, while reasoning-summary models pass `reasoning: { summary: "auto" }`. Custom endpoints (e.g. Azure, proxies) now resolve via `OPENAI_BASE_URL` — the provider auto-detects the concrete OpenAI-compatible API shape, no config flag needed.
- **Windows compatibility for VS Code / `npx`.** The CliRunner now detects Windows and runs `npx.cmd` instead of `npx` (PowerShell-compatible), with proper shell escaping. `npx` command resolution is also guarded against ENOENT / EACCES errors on Windows, with clearer diagnostics. A PowerShell helper `scripts/run-review.ps1` handles review execution natively.
- **Review guardrails script.** `scripts/check-review-guardrails.mjs` validates finding hygiene (severity ordering, evidence formatting, reference validity) across the pipeline — useful for CI pre-commit and debugging review quality regressions.

---
# What's New in v3.2.5

## Branch-diff review in your editor, JSON for local mode, and AI setup

- **Local reviews can now emit JSON.** `mp-sentinel --local` and `--branch-diff` accept `--format json` and print a valid `ReviewReport` to stdout (stdout stays JSON-only; logs go to stderr) — even when nothing changed, you get a parseable empty report. Pair it with `--output reports/review-MMDD.md` to also write a clean markdown report. (VS Code branch review needs this; upgrade from ≤ 3.2.4.)
- **VS Code: "Review Current Branch Against Base…".** Review every commit on your current branch against a base branch (default `origin/main`, editable per run). Findings flow into the Problems panel and the MP Sentinel side panel, and the markdown report opens automatically. Configure defaults via `mpSentinel.review.compareBranch`, `mpSentinel.review.branchReportDirectory`, and `mpSentinel.review.branchSeverityThreshold`.
- **VS Code: "Configure AI Provider…".** A wizard to pick provider, model or tier, and (for Anthropic-compatible endpoints like DeepSeek) a custom base URL — then optionally store the API key in Secret Storage. The panel shows a compact, secret-free AI status.

---

# What's New in v3.2.4

## Fewer AI false positives

- **Lodash subpath imports are no longer flagged for bundle size** — `import x from 'lodash/x'` and `lodash-es` imports are already tree-shakeable, so the review no longer claims they "import the entire package". It checks the file's actual imports first and only keeps the warning for a genuine whole-package `import _ from 'lodash'`.
- **Correctly-placed hooks are no longer nagged** — a hook already under `features/<feature>/hooks/` is no longer flagged as "not in a hooks/ directory"; the backstop checks the real file path.
- **No more spurious "Bullet repeated" warnings** -- generated `modules.md` truncation markers ("... and N more files") that naturally repeat once per module are no longer flagged by the skill quality gate.

---

# What's New in v3.2.3

## NestJS support & fewer false positives

- **NestJS is now detected and supported** — projects using `@nestjs/core` / `@nestjs/common` were previously seen as a generic Node service (the detector looked for a non-existent bare `nestjs` package). NestJS is now recognized by both the source index and review cues, and a dedicated rule pack adds NestJS architecture guidance: thin controllers, DTO + `class-validator` validation, constructor DI, feature-module boundaries, and guards/interceptors/pipes/filters. Rules are version-aware (e.g. Express 5 path syntax only on v11+, a legacy note on v9).
- **"Unused import" false positives eliminated for current phrasings** — the backstop only recognized older wording and let through the model's newer "Unused `X` import" / "not used in the component" phrasings as high-severity warnings. It now catches them, so used imports are no longer flagged.
- **React components no longer over-flagged as too long** — the long-function check counted the JSX return as part of the body and ignored configuration, so a well-composed, JSX-heavy component was flagged "spans 198 lines (limit 80)". It is now React-aware: it measures only the imperative body (hooks/handlers), honors the configurable `maxFunctionLines` / new `maxComponentLines` (default 150) limits, and no longer double-reports with the generic function-length check.
- **ASCII-clean skill output** — generated skills no longer emit em dashes / smart punctuation that triggered `[quality:*] ... replace with ASCII equivalent` warnings.

---

# What's New in v3.2.2

## Unused-import accuracy & branch-diff hygiene

- **ESLint adapter is now configurable** — the `eslint` block in `.mp-sentinelrc.json` was being silently dropped by config validation, so the adapter could never actually turn on. The config schema now accepts `eslint` (`enabled`, `severityOverrides`, `timeoutMs`), so `{"eslint": {"enabled": true}}` truly enables whole-file lint analysis.
- **Unused-import false positives eliminated** — with the adapter reachable, the unused-import backstop now drops AI "unused import" claims on files ESLint actually linted (ESLint is the authority; silence means the symbol is used). On files ESLint didn't cover, the claim is downgraded to INFO instead of failing the review.
- **Branch-diff follows renames** — multi-commit reviews listed files under their historical names, so a file renamed or deleted later in the range showed up as "File not found". The file collector now remaps old paths to their current location (following rename chains) and drops genuinely deleted files, so the report stays clean.

---

# What's New in v3.2.0

## Report noise & output

- **Self-negated findings filtered** — "…this is compliant. No issue." no longer ships as a finding.
- **Near-duplicates collapsed** — same line/category/severity with overlapping wording becomes one finding `(+N similar)`.
- **`--output report.md`** — clean markdown report file (no ANSI) from both CI and local mode.
- **Top recurring issues** — reports open with a top-5 frequency table so 400 warnings are triageable in one screen.

---

# What's New in v3.2.0

## Review accuracy hardening — severity clamp, evidence verification, chronological commits

Driven by a benchmark of real-world reports (critical precision 75%, severity
calibration ~42%), this release adds three deterministic accuracy passes:

- **Severity ceilings per category** — architecture/performance/maintainability/
  test-gap findings are capped at WARNING (configurable via
  `ai.severityCeilings`). CRITICAL is reserved for security and runtime-crash.
- **Evidence verification** — every AI CRITICAL must quote its offending line
  verbatim; the quote is mechanically checked against the file and downgraded
  to WARNING `[unverified]` when not found. This eliminates the dominant
  false-positive class (guard clause above the hunk, import at top of file,
  stale finding from an earlier commit).
- **Chronological commit metadata** — commits are always displayed and emitted
  oldest → newest with explicit labels, and JSON/markdown reports include a
  `commits` array, so downstream report writers can no longer invert
  "fixed by a later commit" reasoning.
- **`--no-cache`** — one-flag cache bypass for pre-merge gate runs.
- **Refactor review** — new `refactor` AI rubric category plus three
  deterministic React evaluators (`component-inside-component`,
  `unstable-context-value`, `long-function`) so complex components and
  full-component re-render pitfalls get concrete refactor suggestions
  instead of passing review silently.
- **HEAD reconciliation (`--commit` mode)** — findings from a historical
  commit are re-verified against the current working tree; issues already
  fixed by a later commit are tagged `resolved-at-head` (with the fixing
  SHA via `git log -S`), shown under "Resolved During Branch", and excluded
  from pass/fail. No more "must fix before merge" lists full of bugs the
  branch already fixed.

---

# What's New in v3.1.0

## Deterministic scanner false-positive fixes & local review UI parity

### Non-null assertion — significantly fewer false positives

The `Non-null assertion` risk pattern now avoids a wide class of content that
is not TypeScript non-null assertion syntax:

- **Tailwind numeric suffix** (`text-red-500!`) — the regex now requires the
  matched word to start with a letter or `$`/`_` (valid JS identifier start),
  so numeric class-name fragments like `500!` are never matched.
- **String and JSX content** (`"Hello!"`, `<p>Done!</p>`) — a positive
  lookahead `(?=[.,;:)\]}\ ]|$)` now requires `!` to be followed by a
  character that is valid in a TypeScript post-expression position.
- **JSDoc / comment lines** (`// note!`, `* description!`) — lines starting
  with `//` or `*` are skipped entirely.
- **Bare JSX text** (`No comments yet!` on its own line) — lines with no
  TypeScript constructs (no operators, keywords, or brackets) are skipped.
- **Tailwind `className=` attribute lines** (`className="block! flex!"`) — the
  whole line is skipped when a class attribute is detected.

### SQL string concatenation — no longer fires on Storybook & JSDoc

The `SQL string concatenation` pattern now skips:

- **Test, spec, and Storybook files** (`.stories.tsx`, `.test.ts`, etc.) —
  component/library names like `Select` or `MultiSelect` coincidentally match
  `\bSELECT\b` (case-insensitive) and were producing CRITICAL false positives
  in Storybook description strings.
- **Comment lines** (`//` and JSDoc `*` lines) — these can never contain real
  SQL concatenation.

### Local review console UI now matches AI review layout

`printResultsSummary` (used by `--local` mode) now renders the same Overview
section as the full AI review console report:

| Row / Section | Before | After |
|---|---|---|
| Target | — | `local (N commits)` / `commit (sha)` / `branch-diff (branch)` |
| AI review | — | `enabled` / `disabled` |
| Skipped files | — | Dedicated section at bottom |
| Runtime errors | — | Dedicated section at bottom |
| Header subtitle | `N files · duration` | `status · target · duration` |

The new `ResultsSummaryContext` interface is exported from `cli/summary.ts` for
callers that need to pass context.

---

# What's New in v3.0.7

## Smarter `create-skills` for Next.js 12 + TanStack Query v4 projects

Three targeted fixes and one enhancement to the skill generator make generated
skills accurate for the most common Pages Router / TanStack Query v4 stack --
and for any Next.js project, regardless of version.

### Pages Router-specific rules (Next.js <= 12)

The `Next.js` rule pack now emits three Pages Router-only rules when the
installed `next` major is 12 or lower:

- **MUST** `next/pages-router-only` -- forbids `app/` directory,
  `'use client'`/`'use server'` directives, Server Components, and route
  handlers in Pages Router projects.
- **SHOULD** `next/ssr-ssg-patterns` -- guides data fetching to
  `getServerSideProps` / `getStaticProps` / `getStaticPaths` at the page
  level, with React Query / SWR for client-side component fetches.
- **SHOULD** `next/api-routes` -- enforces `pages/api/` as the home for
  API endpoints with the `(req: NextApiRequest, res: NextApiResponse)` handler
  signature.

App Router rules (`'use client'`/`'use server'`, Server Components, route
segment config, server-component bundle bloat) continue to be emitted only for
`next >= 13`.

### Version-aware TanStack Query loading-state rule

`tanstack-query/error-loading-states` is now split into three version-gated
variants:

| Package | Emitted rule |
|---|---|
| `@tanstack/react-query` <= 4 | Use `isLoading` / `isError` |
| `react-query` (legacy) | Use `isLoading` / `isError` |
| `@tanstack/react-query` >= 5 | Use `isPending` / `isError` |

Previously the v5 wording (`isPending`) was emitted for all versions, causing
misleading guidance on v4 projects.

### `enabled`-predicate filtering for TypeScript strict rules

TypeScript strict rules that depend on `tsconfig.json` compiler options
(`verbatimModuleSyntax`, `moduleResolution: NodeNext`) now correctly apply
their `enabled` predicates. Projects using `moduleResolution: node` (bundler
or classic resolution) no longer receive NodeNext-specific rules about `.js`
import extensions or the `node:` built-in prefix.

### Test-script guard in Test Expectations

When no `test` script is present in `package.json`, the generated skill no
longer emits `npm test` as a pre-commit command. Instead it shows:

> No `test` script in `package.json` -- check the project README for the
> correct test command before committing logic changes.

---

# What's New in v3.0.6

## Fewer false positives in AI review — alias-aware import checks

The review prompt no longer invents "this imported module does not exist → build failure" findings. The reviewer only sees diff hunks, so it cannot verify the file tree — yet it was flagging valid imports (especially tsconfig/bundler path aliases like `@/utils/sanitize`) as missing and escalating them to CRITICAL.

A new `EVIDENCE & FALSE-POSITIVE GUARDRAILS` section in the audit prompt now:

- forbids "module/file/symbol does not exist", "not found", or "build failure" claims based on an import statement alone;
- declares path aliases valid with an **arbitrary, user-defined prefix** — not just `@/`; the prefix can be `~/`, `#`, `$lib/`, `@app/`, or any custom token configured in `tsconfig`/`jsconfig` `paths`/`baseUrl`, bundler config, or package `imports`;
- only allows flagging an import when the diff itself deletes/renames the target or changes the imported export, cited as evidence;
- forbids unverified **dependency-version** claims — e.g. "antd v5 removed `dist/reset.css` → build failure" — unless the installed version is in the dependency context and matches; training data lags real releases, so these "the package dropped X in version Y" claims are a frequent hallucination;
- downgrades unverifiable claims to INFO / low confidence instead of asserting certainty about unseen repository structure or installed package internals.

The prompt version is bumped to `2026-06-08`; combined with the system-prompt hash in the cache key, this invalidates any stale cached findings from the old prompt.

---

# What's New in v3.0.4

## Schema 1.5 — Light Cache Layout & Sidecar Support

The source index schema has been upgraded to 1.5, introducing a lighter cache layout and sidecar support for improved indexing performance and flexibility.

---

## Phase 4 — Quick Wins: Adapters, Rules, MCP Presets, Init Command

### Call-edge indexing (4.1) — source index schema 1.4

The source index now records outgoing call edges per file (`calls: CallEdge[]`): plain calls (`doWork`), member calls (`axios.get`), and constructor calls (`new Map`), each with line/column and the nearest enclosing function (`inSymbol`). Capped at 1,000 edges per file; backwards compatible (older caches without `calls` still load).

`indexing --agent-context <file>` surfaces the new data:

- `file.calls` — outbound call edges (capped at 30, with `callsTruncated`).
- `incomingCalls` — call sites in other indexed files whose textual callee matches a symbol defined in the requested file (capped at 20). These are candidates, not proof: matching is textual, so same-named symbols elsewhere also match.

### Call-aware review intelligence (4.6)

The schema 1.4 call-edge index now feeds normal AI review context, not just `indexing --agent-context`. When a changed file's exported symbols are called elsewhere, the review prompt gains a compact `Call Impact` section listing top caller files and call sites (capped, clearly marked as candidate/textual matches), so the AI can catch caller contract breaks and judge real blast radius.

- Context ranking is now: changed file -> direct imports -> direct dependents -> caller files (call edges) -> hub files. Callers already included as dependents are deduped and tagged with both relations.
- `--explain-context --format json` reports the new `call-impact` signal in `includedSignals` / `intelligenceSignals` / `evidenceSummary`, the `caller` relation in `relationTypes`, and suggests `indexing --agent-context <caller-file>` for top callers.
- Strict budget behavior: the Call Impact section is the first thing omitted before the context would overflow. Old caches without `calls` simply produce no signal.

### `--check` now catches config-only changes

Generated skill files carry a new `generationConfigHash` metadata field covering `createSkills.policies` and `createSkills.disableRules`. Changing either in `.mp-sentinelrc.json` now flags existing files as stale in `create-skills --check`, even though the source index itself didn't change. Files generated before this field existed are treated as "generated with default config".


### `init` command (4.5)

A guided setup that writes `.mp-sentinelrc.json` from a detected tech profile. New users no longer have to copy `.mp-sentinelrc.example.json` and edit by hand.

```sh
npx mp-sentinel init                       # interactive prompts
npx mp-sentinel init --non-interactive     # accept proposed defaults silently
npx mp-sentinel init --force               # overwrite an existing config
npx mp-sentinel init --format json         # CI-friendly summary
```

Behavior:

- Detects the project's tech stack via the same logic the review pipeline uses (`detectTechProfile`) — derives `techStack` and a starter `rules[]` list.
- Picks a provider based on env: `ANTHROPIC_API_KEY` -> anthropic, `GEMINI_API_KEY`/`GOOGLE_API_KEY` -> gemini, `OPENAI_API_KEY` -> openai, otherwise falls back to gemini.
- Enables the GitHub MCP preset automatically if `GITHUB_TOKEN` is set.
- Defaults to `severityThreshold: "WARNING"` (the existing default); `node-service` projects get `CRITICAL` to encourage stricter gating on services.
- Refuses to overwrite an existing config without `--force` (exits 1).
- `--non-interactive` (or `MP_SENTINEL_INIT_NONINTERACTIVE=1`) writes the proposed defaults without prompts -- this is what CI and tests use.


### New agent adapters (4.2)

Six additional agents recognised by `create-skills`:

| Adapter | Output path | Docs |
|---|---|---|
| `aider` | `CONVENTIONS.md` | https://aider.chat/docs/usage/conventions.html |
| `continue` | `.continue/rules/<project>-best-practices.md` | https://docs.continue.dev/customize/deep-dives/rules |
| `roo` | `.roo/rules/<project>-best-practices.md` | https://docs.roocode.com/features/custom-instructions |
| `copilot` | `.github/copilot-instructions.md` | https://docs.github.com/en/copilot/concepts/prompting/response-customization |
| `zed` | `.agents/skills/<project>-zed-best-practices/SKILL.md` | https://zed.dev/docs/ai/rules |
| `jetbrains` | `.junie/AGENTS.md` | https://www.jetbrains.com/help/junie/customize-guidelines.html |

Each adapter auto-detects from its respective dotfile or config marker. Run `mp-sentinel create-skills --explain-agents` to see which adapters detect on your project.

### Per-rule opt-out (4.3)

You can now disable individual rules in generated SKILL.md output without dropping the entire pack:

```jsonc
{
  "createSkills": {
    "disableRules": ["next/image-optimization", "react/strict-mode-only"]
  }
}
```

Rule IDs follow the `<packId>/<ruleId>` convention. Rules without an `id` field aren't targetable yet — those will be migrated incrementally.

### MCP preset library expansion (4.4)

Five new MCP presets to complement `github` / `fetch`:

```jsonc
{
  "mcp": {
    "enabled": true,
    "presets": [
      { "preset": "filesystem", "rootPaths": ["./docs"], "calls": [...] },
      { "preset": "git",        "calls": [{ "tool": "git_log", "input": { "max_count": 5 } }] },
      { "preset": "slack",      "calls": [{ "tool": "channels_list", "input": {} }] },
      { "preset": "linear",     "calls": [{ "tool": "list_issues", "input": {} }] },
      { "preset": "postgres",   "calls": [{ "tool": "query", "input": { "sql": "SELECT 1" } }] }
      // postgres reads the connection URL from DATABASE_URL (override via "connectionUrlEnv")
      // and passes it as the CLI argument @modelcontextprotocol/server-postgres expects.
      // linear spawns the community stdio server (@tacticlaunch/mcp-linear) -- it is NOT
      // Linear's hosted remote MCP server; use an explicit servers[] entry for that.
    ]
  }
}
```

Mutating-tool prefixes (`create*`, `update*`, `delete*`, etc.) are still rejected globally — these presets only carry read-only verbs. No new npm dependencies: each preset spawns the community MCP server via `npx`/`uvx`.

## Phase 3.2 — Streaming AI + Phase 3.3 — Pluggable Cache

### Streaming AI responses (3.2)

`IAIProvider.generateStream(systemPrompt, userPrompt, schema?)` is now part of the provider contract. Implemented natively for **Anthropic** (SSE `content_block_delta` + `input_json_delta` for tool_use) and **OpenAI Responses API** (`response.output_text.delta`). Providers without a streaming implementation fall back through `callGenerateStream` → `generate()` and emit a single terminal chunk, so callers can always `for await (…)` regardless of provider.

`assembleStream(iter, onDelta?)` collapses a stream back into a complete `AIResponse` with the same `usage` and `finishReason` accounting, so cache writes / JSON-output mode / SARIF / etc. stay unchanged. A new `parseSseStream` helper lives in `src/services/ai/sse.ts` and is shared by both streaming providers.

### Pluggable cache backends (3.3)

Cache storage is now backend-driven. The default behavior is unchanged (local `.mp-sentinel-cache/` directory), but teams running parallel CI workers can swap in a shared store:

```jsonc
{
  "cache": {
    "backend": "http",
    "http": {
      "baseUrl": "https://cache.internal.example.com/mp-sentinel",
      "headers": { "Authorization": "Bearer ..." },
      "timeoutMs": 5000
    }
  }
}
```

The HTTP backend is `GET /<key>` + `PUT /<key>` — drop-in for Cloudflare Workers KV (via its REST proxy), in-house Redis-HTTP shims, or any KV service. Uses Node's built-in `fetch` — no new dependencies. Backends share the same SHA-256 key derivation, so an entry written by one is readable by the other.

## Phase 3.1 — Parallel + Incremental Indexing

### Parallel parsing

`buildSourceIndex` now drives the parse loop through a bounded-concurrency `parallelMap` helper (default = `os.availableParallelism()` capped at 8). File I/O (`readFile`, sha256, mtime stat) and tree-sitter parse work overlap across files, cutting wall-clock time on cold cache rebuilds without needing the IPC overhead of worker threads.

### Incremental indexing — git HEAD drift

SHA-256-based incremental indexing was already in place: files whose content hash matches the cached entry are reused, only changed/new files are reparsed. Phase 3.1 adds a git-HEAD snapshot:

- `SourceIndex.gitHeadSha` — recorded at index time.
- `IndexHealthOutput.currentGitHeadSha` — current HEAD at health-check time.
- `IndexHealthOutput.gitHeadDrift` — `true` when the two differ.

Surfaced in `indexing --health` (console + JSON). Lets you spot stale indexes from old branches at a glance.

## Phase 2 — Detection Quality

### Entropy-based secret detection (2.1)

`src/services/security/entropy.ts` adds a Shannon-entropy fallback that complements the regex prefix patterns. When `security.entropyEnabled` is true in `.mp-sentinelrc.json`, the sanitizer scans assignment-style values (`KEY = "VALUE"`, `--token VALUE`) and redacts anything ≥ 24 chars with entropy ≥ 4.5 bits/char that isn't a URL, dictionary word, or in the configured allowlist.

```jsonc
{
  "security": {
    "entropyEnabled": true,
    "allowValues": ["pk_live_publishable_key_safe_to_share"],
    "customPatterns": [
      { "name": "Internal Webhook", "pattern": "WHK-[A-Z0-9]{16}" }
    ]
  }
}
```

### High-value secret patterns (2.2)

Added regex patterns for: Anthropic API keys (`sk-ant-api…`), OpenAI (legacy `sk-…`, `sk-proj-…`, `sk-svcacct-…`), Azure storage connection strings + SAS tokens, Twilio (`SK…`/`AC…`), SendGrid (`SG.…`), Datadog (`ddp_…`/`dda_…`), Postman (`PMAK-…`), Shopify (`shpat_…`), Square (`EAAA…`), and GCP service-account JSON blocks.

### Risk-analyzer language packs (2.3)

The risk analyzer now dispatches per-language patterns based on file extension. New language-specific checks fire only for matching files:

| File ext | Sample checks |
|---|---|
| `.py` | `pickle.loads`, `subprocess shell=True`, `yaml.load`, `os.system`, `mark_safe` |
| `.go` | `exec.Command("sh","-c",…)`, `unsafe.Pointer`, `crypto/md5`, `http.Client{}` no timeout |
| `.rs` | `mem::transmute`, `.unwrap()` outside tests, `unsafe { … }` outside FFI |
| `.php` | `unserialize($_POST)`, `extract($_REQUEST)`, `include $_GET[…]`, `shell_exec` |
| `.rb` | `Marshal.load`, `YAML.load` w/o safe_load, `eval`, `system("… #{x}")` |

The universal JS/TS-leaning pack still runs on every file.

### Tighter noisy patterns (2.4)

- **`Path traversal in fs/path call`** — the regex now requires `../` to be syntactically inside a call to `fs.*`, `path.*`, `readFile`, `writeFile`, `sendFile`, etc. `import "../foo"` no longer triggers.
- **`parseInt without radix`** — downgraded from WARNING to INFO and suppressed inside test/example paths. Modern engines no longer interpret leading-zero as octal, so this is a hygiene hint rather than a bug.

### Provider-native structured output (2.5)

`IAIProvider.generate()` accepts an optional `responseSchema` parameter. `AUDIT_RESPONSE_SCHEMA` — a JSON Schema mirror of the audit rubric — is now forwarded to:

- **OpenAI** → `text.format.json_schema` (strict)
- **Anthropic** → `tools[]` + `tool_choice: { type: "tool", name }` (the `tool_use` block's `input` is serialized back to a JSON string for the existing parser)
- **Gemini** → `responseSchema` + `responseMimeType: "application/json"`
- **Grok** → `response_format.json_schema`
- **OpenRouter** → `response_format.json_schema` for `openai/*` models; legacy `json_object` otherwise

AI audit cache version bumped to `4` because the request shape changes when structured output is on.

## Phase 1 — Stability & Observability

### Token usage & cost capture (1.1)

Every AI call now reports token usage. The review report (`--format json` and console) surfaces aggregate input/output tokens, AI call count, and a best-effort USD cost estimate. Pricing lives in `src/services/ai/pricing.ts` and is keyed by exact model id with a family-prefix fallback so preview variants still get costed.

### Broader retries + circuit breaker (1.2)

`isRetryableError` previously caught only 429/503/ECONNRESET/AbortError. It now also covers 408, 425, 500, 502, 504, 522, 524, `ETIMEDOUT`, `EAI_AGAIN`, `ENETUNREACH`, `ENOTFOUND`, "socket hang up", "fetch failed", and the human-readable variants. `withRetry` honors `Retry-After` headers (RFC 7231) and JSON `retry_after` / `retry_after_ms` fields, capped at `maxDelayMs`.

A new per-provider circuit breaker (`src/services/ai/circuit-breaker.ts`) tracks consecutive failures and trips to **open** after 5 in a row, skipping the primary provider for 30s and going straight to the fallback chain. After cooldown it transitions to **half-open** and a successful call closes it again.

### SARIF formatter (1.3)

`--format sarif` produces SARIF 2.1.0 output suitable for GitHub Code Scanning, GitLab Security Dashboard, and SonarQube. Each finding becomes a `result` with severity → `level` mapping (CRITICAL→error, WARNING→warning, INFO→note); evidence and suggestion ride along in `properties`.

### JSON Schema for `.mp-sentinelrc.json` (1.4)

`schemas/mp-sentinelrc.schema.json` is now shipped with the package. The example config references it via `$schema` so VSCode and JetBrains editors get autocomplete and hover docs out of the box. Regenerate with `npm run schema:gen`.

### `--severity-threshold` (1.5)

New CLI flag and config keys let teams escalate or relax the FAIL boundary without code changes:

```jsonc
{
  "review": {
    "severityThreshold": "CRITICAL",
    "protectedBranches": { "main": "WARNING" }
  }
}
```

CLI flag beats branch override beats config baseline. Default remains **WARNING** to preserve historical behavior.

## v3.0.2

### Fast Code Search with Declaration-Aware Ranking

- **`mp-sentinel indexing --find-code <query>`** — Search indexed code snippets by exact text, case-insensitive text, or token-normalized query (e.g., `build source index` matches `buildSourceIndex`). Results include file, line, column, nearest symbol, and redacted snippet text. JSON output with `--index-format json`. Ranking prioritizes matches near symbol declarations.
- **MCP tool `mp_sentinel_index_find_code`** — Read-only code snippet search via the MCP server.
- **Source index schema 1.3** — Optional `codeSearch` entries per file: trimmed, secret-redacted snippets with nearest symbol metadata. Optional `endLine`/`endColumn` on `SymbolInfo`.
- **Improved symbol normalization** — Token-variant matching (camelCase, PascalCase, snake_case, concatenated) enables space-separated queries like `build source index` to match `buildSourceIndex` in `--find-symbol`.
- **Refactored query handlers** — Extracted from the oversized `src/commands/indexing.ts` into `src/commands/indexing-queries.ts`.

### Fixes

- **CLI command references** — Updated to use `npx` for consistency across all command examples.

## v3.0.1

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

- **Dedup chunk fields** (`src/commands/indexing.ts`): Removed duplicate `chunkCount`/`chunkSize`/`chunkWarningCount` spreads in `hand