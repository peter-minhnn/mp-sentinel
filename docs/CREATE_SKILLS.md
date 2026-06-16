# `create-skills` — Generate Agent/IDE Skill Files

`mp-sentinel create-skills` generates structured best-practices files from your source index for AI agents and IDEs. Each supported agent gets its own adapter that places files exactly where that agent reads them.

---

## Quick Start

```sh
# Interactive picker (auto-detects existing agent folders)
npx mp-sentinel create-skills

# Generate for specific agents
npx mp-sentinel create-skills --agent claude,cursor

# Generate for all supported agents
npx mp-sentinel create-skills --all-agents

# Overwrite existing files
npx mp-sentinel create-skills --agent claude --force

# JSON output for automation (requires --agent or --all-agents)
npx mp-sentinel create-skills --agent claude --format json
```

---

## Supported Agents

| ID | Label | Detection | Default output path |
|----|-------|-----------|---------------------|
| `claude` | Claude Code | `.claude/` exists | `.claude/skills/<project>-best-practices/SKILL.md` + `references/*.md` |
| `cursor` | Cursor | `.cursor/` exists | `.cursor/rules/<project>-best-practices.mdc` |
| `codex` | Codex / OpenAI | `.codex/` or `.agents/` exists | `.agents/skills/<project>-codex-best-practices/SKILL.md` |
| `windsurf` | Windsurf | `.windsurf/` exists | `.windsurf/skills/<project>-windsurf-best-practices/SKILL.md` |
| `antigravity` | Google Antigravity | `.antigravity/` or `.agent/` exists | `.agents/skills/<project>-antigravity-best-practices/SKILL.md` |
| `cline` | Cline | `.cline/` or `.clinerules/` exists | `.cline/skills/<project>-cline-best-practices/SKILL.md` |
| `generic` | Generic (fallback) | never auto-detected | `.agents/rules/<project>-best-practices.md` |

### Official Adapter Layouts (v1.0.17+)

Each adapter declares an `AdapterSpec` with the official layout verified against the target agent/IDE documentation:

| Adapter | Kind | Workspace | Source |
|---------|------|-----------|--------|
| `claude` | skill | `.claude/skills/{projectName}-best-practices/` | [Claude Code Skills](https://docs.anthropic.com/en/docs/claude-code/skills) |
| `codex` | skill | `.agents/skills/{projectName}-codex-best-practices/` | [Codex Skills](https://developers.openai.com/codex/skills) |
| `antigravity` | skill | `.agents/skills/{projectName}-antigravity-best-practices/` | [Antigravity Skills](https://antigravity.google/docs/skills) |
| `cursor` | rule | `.cursor/rules/{projectName}-best-practices.mdc` | [Cursor Rules](https://docs.cursor.com/context/rules-for-ai) |
| `windsurf` | skill | `.windsurf/skills/{projectName}-windsurf-best-practices/` | [Windsurf Skills](https://docs.windsurf.com/windsurf/cascade/skills) |
| `cline` | skill | `.cline/skills/{projectName}-cline-best-practices/` | [Cline Skills](https://docs.cline.bot/customization/skills) |
| `aider` | rule | `CONVENTIONS.md` | [Aider Conventions](https://aider.chat/docs/usage/conventions.html) |
| `continue` | rule | `.continue/rules/{projectName}-best-practices.md` | [Continue Rules](https://docs.continue.dev/customize/deep-dives/rules) |
| `roo` | skill | `.roo/skills/{projectName}-roo-best-practices/` | [Roo Code Skills](https://roocodeinc.github.io/Roo-Code/features/skills/) |
| `copilot` | rule | `.github/copilot-instructions.md` | [GitHub Copilot Response Customization](https://docs.github.com/en/copilot/concepts/prompting/response-customization) |
| `zed` | skill | `.agents/skills/{projectName}-zed-best-practices/` | [Zed Skills](https://zed.dev/docs/ai/skills) |
| `jetbrains` | rule | `.junie/AGENTS.md` | [JetBrains Junie Guidelines](https://www.jetbrains.com/help/junie/customize-guidelines.html) |
| `generic` | rule | `.agents/rules/{projectName}-best-practices.md` | — (fallback) |

> **`--all-agents`** generates for all 12 registered non-generic adapters: `claude`, `cursor`, `codex`, `windsurf`, `antigravity`, `cline`, `aider`, `continue`, `roo`, `copilot`, `zed`, `jetbrains`. The `generic` adapter is excluded from `--all-agents` — use `--agent generic` to target it explicitly.

### Migration Notes (v1.0.17)

- **Antigravity**: Output moved from `.antigravity/rules/<project>-best-practices.md` to `.agents/skills/<project>-antigravity-best-practices/SKILL.md`. Old files are not deleted automatically.
- **Codex**: Output moved from `.agents/rules/<project>-best-practices.md` to `.agents/skills/<project>-codex-best-practices/SKILL.md`. Old files are not deleted automatically.
- Folder names are suffixed (`-codex-best-practices`, `-antigravity-best-practices`) to prevent collisions under `.agents/skills/`.

### Migration Notes (v3 generator)

- **Windsurf**: Output moved from `.windsurf/rules/<project>-best-practices.md` to `.windsurf/skills/<project>-windsurf-best-practices/SKILL.md` (skill folder with full reference set). Old files are not deleted automatically.
- **Roo Code**: Output moved from `.roo/rules/<project>-best-practices.md` to `.roo/skills/<project>-roo-best-practices/SKILL.md`. Old files are not deleted automatically.
- **Cline**: Output moved from `.clinerules/<project>-best-practices.md` to `.cline/skills/<project>-cline-best-practices/SKILL.md`. Old files are not deleted automatically.
- All skill adapters (Claude, Codex, Antigravity, Zed, Windsurf, Roo, Cline) now share the same progressive-disclosure layout: a lean `SKILL.md` plus the full reference set (architecture, modules, commands, codebase map, testing map, dependencies, public API, code style, language patterns, clean-code checklist).
- Rule-only adapters (Cursor, Continue, Copilot, Aider, JetBrains/Junie, generic) now emit concise rule files: workflow contract, overview, language/framework rules, and code policies. Bulky maps are skill-folder material and are no longer inlined.
- Framework rules are now version-gated: Svelte 5 runes, Angular v16/v17+ rules, Next.js App Router rules, Vue 3 rules, and Nuxt 3 rules are emitted only when package.json safely identifies a qualifying major version. Unknown or broad ranges emit only stable generic rules.

### Legacy File Detection (v1.0.18+)

`create-skills` automatically detects legacy generated files left over from pre-v1.0.17 paths:

- **Detected**: `.agents/rules/<project>-best-practices.md` with `@mp-sentinel-generated` metadata → advisory for `codex`.
- **Detected**: `.antigravity/rules/<project>-best-practices.md` with `@mp-sentinel-generated` metadata → advisory for `antigravity`.
- **Detected** (v3 generator): `.windsurf/rules/<project>-best-practices.md`, `.roo/rules/<project>-best-practices.md`, and `.clinerules/<project>-best-practices.md` with `@mp-sentinel-generated` metadata → advisories for `windsurf`, `roo`, and `cline`.
- **Ignored**: Files at those paths without mp-sentinel metadata (user-authored files are never flagged).
- **Never deleted**: Legacy files are advisory-only. Delete them manually after confirming new official skills exist.

Legacy advisories appear in all output modes (console warns, JSON includes `legacyFiles` field) but do **not** cause `--check` to fail. See `--format json` for structured legacy file information.

**v1.9.1+:** Legacy advisories are grouped by agent in `recommendedActions` and console output. The full per-file list is preserved in the JSON `legacyFiles` field. `agent:skills:check` also groups legacy advisories instead of repeating per-file messages.

---

## Auto-Detection

When you run `create-skills` without `--agent` or `--all-agents`, the command:

1. Scans the project root for known agent folders (`.claude/`, `.cursor/`, `.windsurf/`, `.codex/`, `.agents/`, `.antigravity/`, `.agent/`, `.clinerules/`).
2. Pre-selects detected agents in the interactive picker.
3. If no known folder is found and the terminal is interactive, shows all options with `claude` pre-selected.
4. If no TTY is available (non-interactive), falls back to detected agents or `claude` + `generic`.

### Detection Contract (v1.6.0+)

| Signal | Detects |
|--------|---------|
| `.claude/` exists | Claude Code |
| `.cursor/` exists | Cursor |
| `.codex/` or `.agents/` exists | Codex / OpenAI |
| `.windsurf/` exists | Windsurf |
| `.antigravity/` or `.agent/` exists | Google Antigravity |
| `.cline/` or `.clinerules/` exists | Cline |

- Root `CLAUDE.md` alone does **not** detect Claude.
- Root `AGENTS.md` alone does **not** detect Codex.
- Generic is never auto-detected — only selected explicitly via `--agent generic`.

### Diagnostic: Explain Agent Detection (v1.6.0+)

Use `--explain-agents` to see exactly which agents are detected, why, and what output paths they resolve to — without writing any files, building the source index, or calling AI.

```sh
# Human-readable console output
npx mp-sentinel create-skills --explain-agents

# JSON output (no --agent / --all-agents required)
npx mp-sentinel create-skills --explain-agents --format json
```

JSON shape:

```json
{
  "projectName": "my-project",
  "defaultSelection": ["claude", "cline"],
  "agents": [
    {
      "id": "claude",
      "label": "Claude Code (.claude/skills/)",
      "detected": true,
      "selected": true,
      "detectionSignals": [".claude/ exists"],
      "outputKind": "skill",
      "workspacePath": ".claude/skills/{projectName}-best-practices/",
      "resolvedOutput": ".claude/skills/my-project-best-practices/SKILL.md",
      "officialDocsUrl": "https://docs.anthropic.com/en/docs/claude-code/skills"
    }
  ]
}
```

`--explain-agents` is a pure diagnostic — it never writes files, never builds the index, and never calls AI. JSON mode is allowed without `--agent` or `--all-agents`.

---

## Auto-Index Behavior

`create-skills` always ensures a valid source index exists before generating:

- **Default:** builds or refreshes the index using `buildSourceIndex()` (same as `mp-sentinel indexing`).
- **`--skip-index-refresh`:** uses the existing cache only. Fails with exit code `2` if no cache is present.

The generated content is richest when a schema `1.2` index is available (dependency graph, hub files, import/export metadata, and codebase insights).

`create-skills` auto-refreshes the index when manifest inputs (`package.json`, `tsconfig*.json`, lockfile identity) change, even if source files are unchanged. This ensures profile skills always reflect the current scripts, `bin`, dependencies, and framework signals.

---

## AI Enrichment

By default, generated skills are deterministic and use only the source index. If you enable `createSkills.ai`, `create-skills` asks the configured AI provider to add version-aware dependency rules based on `package.json` versions, the indexed codebase, and project `rules` from `.mp-sentinelrc.json`.

```json
{
  "createSkills": {
    "ai": {
      "enabled": true,
      "provider": "openai",
      "model": "gpt-5.2",
      "temperature": 0.2,
      "maxTokens": 4096
    }
  }
}
```

Supported providers: `gemini`, `openai`, `anthropic`, `grok`, `openrouter`. Provider, model, and API key readiness are checked before any provider call. If AI is unavailable or unsupported, `create-skills` prints a warning, skips enrichment, and still generates deterministic index-only skills. `create-skills --doctor` reports that state as `aiEnrichment.status = "action-required"` without making network calls.

Anthropic uses `ANTHROPIC_API_KEY` first and also accepts `ANTHROPIC_AUTH_TOKEN` as a fallback alias. For custom Anthropic-compatible endpoints (e.g., DeepSeek), set `ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic` with `AI_MODEL=deepseek-v4-pro`.

Use `--no-ai-enrich` to temporarily generate deterministic index-only skills even when config enables AI:

```sh
npx mp-sentinel create-skills --agent claude --no-ai-enrich
```

`--check` compares enrichment metadata too, so skills become stale if AI enrichment is enabled/disabled or if provider, model, prompt version, input hash, or output hash changes.

### AI Enrichment v2 (generator v2.0.0+)

When AI enrichment is enabled, the prompt is enriched with:

- **`codeSamples`:** Up to 5 source files are selected deterministically (largest non-test file, hub file, test file, component file if present), read from disk, run through the SecurityService secret scrubber, and included in the AI prompt. The `__scrubbed: true` brand on each sample ensures a runtime assertion blocks un-scrubbed content.
- **Language mix:** The LanguageProfile (dominant language, secondary languages, distribution) is passed to the AI provider.
- **Code style profile:** Indent style, quote preference, semicolons, formatter configs, file-size distribution.
- **Clean-code policies:** The configured policy limits (maxFileLines, maxFunctionLines, etc.).

The AI is instructed to return per-language rules (`rulesByLanguage`) and file-cited anti-patterns (`antiPatterns`), not generic advice.

#### --no-code-samples flag

To skip code sample loading (v1-style prompt, less context, useful for data-residency-sensitive environments):

```sh
npx mp-sentinel create-skills --agent claude --no-code-samples
```

When `--no-code-samples` is set, the AI enrichment prompt still receives dependency versions, language mix, and code style profile, but no actual file content.

---

## Output Content

Every adapter generates content derived from the source index and `SkillKnowledgeBase`:

| Section | Description |
|---------|-------------|
| **Overview** | Project name, version, frameworks, package manager, file count, **language distribution** |
| **Architecture** | Top-level directories with file counts; graph stats (schema 1.2) |
| **Hub Files** | Files imported by the most other files (schema 1.2) |
| **Module Map** | Per-directory breakdown with key exported symbols |
| **Codebase Map** | Module ownership (dominant role, key files, key symbols, import/export dirs) + entrypoints (CLI, commands, public API, config) |
| **Testing Map** | Test-to-source associations, test gaps (source files without test coverage), most-tested modules |
| **Dependencies** | Top 20 external dependencies with versions from `package.json` + optional AI-enriched rules |
| **Public API** | Entry points + risk surface (default exports, re-exports, dynamic imports, type-only imports, hub files) |
| **Profile Rules** | Project-specific rules derived from manifest: real scripts, `bin`, dependencies, framework signals, import conventions, and profile-specific review pitfalls |
| **Language & Framework Rules** | Deterministic per-language rules from built-in rule packs (Svelte, Vue, React, Next.js, Vite, React Router, TanStack Query, Ant Design, Supabase, Astro, Solid, Angular, TypeScript, Python, Go, Rust, Nuxt, Dart, Flutter, PHP, Laravel, Ruby, Rails) |
| **Clean Code Policy** | Configurable limits (maxFileLines, maxFunctionLines, maxParams, maxCyclomaticHint, forbidDefaultExports) |
| **File Size Policy** | Hard limit with current codebase percentiles and observed offender reporting |
| **AI Enrichment** | Optional version-aware dependency rules from the configured AI provider |

### Claude output structure

```
.claude/skills/<project>-best-practices/
  SKILL.md                    ← frontmatter + overview + new sections + 10 references
  references/
    architecture.md           ← Architecture + Hub Files sections
    modules.md                ← Module Map section
    commands.md               ← Commands + Conventions sections
    codebase-map.md           ← Module Ownership + Entrypoints tables
    testing-map.md            ← Test Associations + Test Gaps + Most Tested Modules
    dependencies.md           ← Top Dependencies (always present; AI enrichment appended when active)
    public-api.md             ← Entry Points + Risk Surface tables
    code-style.md             ← Detected code style (indent, quotes, semicolons, formatter configs) — NEW
    language-patterns.md      ← Language distribution + per-language framework rules — NEW
    clean-code-checklist.md   ← Code quality checklist with limits + observed offenders — NEW
```

### Codex / Antigravity output structure

```
.agents/skills/<project>-codex-best-practices/
  SKILL.md                    ← YAML frontmatter (name, description) + all sections inline
  references/
    code-style.md             ← Detected code style
    language-patterns.md      ← Language distribution + framework rules
    clean-code-checklist.md   ← Code quality checklist

.agents/skills/<project>-antigravity-best-practices/
  SKILL.md                    ← YAML frontmatter (name, description) + all sections inline
  references/
    code-style.md             ← Detected code style
    language-patterns.md      ← Language distribution + framework rules
    clean-code-checklist.md   ← Code quality checklist
```

### Single-file rule adapters (Cursor, Windsurf, Cline, Generic)

Single markdown (`.md` / `.mdc`) file containing all sections inline, including the new `## Language & Framework Rules`, `## Clean Code Policy`, and `## File Size Policy` sections.

---

## Configuration — createSkills.policies

Configure clean-code limits in `.mp-sentinelrc.json`:

```json
{
  "createSkills": {
    "policies": {
      "maxFileLines": 500,
      "warnFileLines": 350,
      "maxFunctionLines": 80,
      "maxComponentLines": 150,
      "maxParams": 5,
      "maxCyclomaticHint": 12,
      "forbidDefaultExports": false
    }
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `maxFileLines` | `500` | Hard limit: no file should exceed this line count |
| `warnFileLines` | `350` | Soft warning threshold for file length |
| `maxFunctionLines` | `80` | Maximum lines per function/method body |
| `maxComponentLines` | `150` | Maximum lines for a React component's logic body. The React `long-function` evaluator excludes the JSX return from this count, so it measures hooks/handlers/derived state only |
| `maxParams` | `5` | Maximum function parameters (use an options object for more) |
| `maxCyclomaticHint` | `12` | Cyclomatic complexity hint threshold |
| `forbidDefaultExports` | `false` | When true, the generated skill instructs agents to use named exports only |

These policies are rendered into `## Clean Code Policy` and `## File Size Policy` sections in the SKILL.md, including any current offenders (files exceeding `maxFileLines`) observed from the CodeStyleProfile.

## Rule Packs (Deterministic, No AI Required)

Built-in rule packs activate based on the detected language profile and dependencies. Each pack produces `must`/`should`/`avoid` rules in the `## Language & Framework Rules` SKILL.md section.

| Pack | Activation trigger | Key rules |
|------|-------------------|-----------|
| **Svelte** | `.svelte` files or `svelte` dependency | Imports inside `<script>`, Svelte 5 runes, `lang="ts"`, SvelteKit server/client boundaries |
| **Vue** | `.vue` files or `vue` dependency | `<script setup>`, `defineProps`/`defineEmits`, scoped styles |
| **React** | `react` dependency | Rules of Hooks, no fetch in render, `key` prop, function components |
| **Next.js** | `next` dependency | `'use client'`/`'use server'`, Server Components, `next/image`, route segments |
| **Vite** | `vite` dependency | `VITE_` env prefix + `import.meta.env`, dynamic-import chunking, asset imports, no Node built-ins in client code |
| **React Router** | `react-router` / `react-router-dom` dependency | Lazy routes, `<Link>`/`useNavigate` over `window.location`, param validation |
| **TanStack Query** | `@tanstack/react-query` dependency | Stable query keys, invalidate after mutations, no state mirroring |
| **Ant Design** | `antd` dependency | `Form`-owned field state, `ConfigProvider` theme tokens, stable `rowKey`, hook-based context APIs |
| **Supabase** | `@supabase/supabase-js` / `@supabase/ssr` dependency | No `service_role` key in clients, RLS as the authz boundary, `{ data, error }` handling, single client instance |
| **Astro** | `.astro` files or `astro` dependency | Frontmatter logic, `client:*` island directives, content collections, image optimization |
| **Solid** | `solid-js` dependency + `.tsx`/`.jsx` files | `createSignal`/`createEffect`, no destructured props, `For`/`Show` control flow |
| **Angular** | `@angular/core` or `@angular/common` dependency | `inject()` over constructor DI, standalone components, signals, `OnPush` change detection |
| **NestJS** | `@nestjs/core` / `@nestjs/common` dependency | Thin controllers, DTO + `class-validator` validation via `ValidationPipe`, constructor DI, feature-module boundaries, guards/interceptors/pipes/filters; version-gated (Express 5 paths on v11+, legacy note on v9) |
| **TypeScript (Strict)** | `.ts` or `.tsx` files | Config-aware: `.js` extension + `node:` prefix only under NodeNext/Node16 resolution (never `moduleResolution: "bundler"`); `import type` and strict-flag reminders only when the flags are enabled in `tsconfig.json` |
| **Python** | `.py` files | Type hints, PEP 8, no top-level side effects, `pathlib`, `async`/`await` |
| **Go** | `.go` files | `gofmt`, error handling, no panics in libraries, `context.Context` |
| **Rust** | `.rs` files | `clippy`, `?` operator over `unwrap()`, `cargo fmt`, derive traits |
| **Nuxt** | `nuxt` dependency + Vue ecosystem | `definePageMeta()`, `useFetch` over bare `fetch`, `server/` boundaries, auto-imports |
| **Dart** | `.dart` files or `dart` SDK | `const` constructors, `final` over `var`, null safety, `Effective Dart` style |
| **Flutter** | `flutter` dependency | `BuildContext` lifecycle, `StatelessWidget` by default, `const` widgets, Riverpod/Bloc extraction |
| **PHP** | `.php` files or `composer.json` manifest | `strict_types=1`, type declarations, PSR-12, `final` classes, constructor promotion |
| **Laravel** | `laravel/framework` dependency | Eloquent vs raw SQL, Form Requests, route model binding, thin controllers |
| **Ruby** | `.rb` files or `Gemfile` manifest | Frozen string literals, `snake_case` naming, keyword arguments, safe navigation `&.` |
| **Rails** | `rails` gem dependency | Strong Parameters, scopes, `before_action` discipline, concerns vs modules |

### Rule Pack Evaluators

In addition to static rules, some rule packs supply **file evaluators** — deterministic checks that run against changed files during review (no AI calls). They produce findings in the same `AuditIssue` shape as the AI review pipeline and are surfaced alongside AI review results.

| Evaluator | Pack | Trigger | Severity |
|-----------|------|---------|----------|
| `island-directive-missing` | Astro | Interactive JS (`onclick`, `addEventListener`, etc.) without `client:*` island directive in `.astro` files | WARNING |
| `no-destructured-props` | Solid | Destructured props in component parameters that break Solid's reactive tracking | WARNING |
| `prefer-inject` | Angular | Constructor-based DI in `.ts` files (Angular v17+ prefers `inject()`) | INFO |
| `no-data-access-in-controller` | NestJS | Repository / query-builder access inside a `*.controller.ts` (logic leaking into the transport layer) | WARNING |
| `body-must-be-typed-dto` | NestJS | `@Body()` parameter typed as `any`/`object`/`unknown` (bypasses `class-validator`) | WARNING |
| `long-function` | React | Component logic body (JSX return excluded) over `maxComponentLines`, or a plain function over `maxFunctionLines` | WARNING |

Each evaluator is purely deterministic — no AI calls, no network. They run during `mp-sentinel review` as part of the deterministic (non-AI) pipeline and enrich the findings output.

## Overwrite Protection

By default, `create-skills` refuses to overwrite existing output files and returns exit code `1`.
Pass `--force` to overwrite.

```sh
npx mp-sentinel create-skills --agent claude --force
```

---

## Dry Run

`--dry-run` previews what would happen without writing any files.

```sh
npx mp-sentinel create-skills --all-agents --dry-run
npx mp-sentinel create-skills --all-agents --dry-run --format json
```

Each file entry has one of these actions:

| Action | Meaning |
|--------|---------|
| `create` | File does not exist — would be created |
| `skip` | File exists and `--force` is not set — would be skipped |
| `overwrite` | File exists and `--force` is set — would be overwritten |
| `conflict` | Another adapter in the same batch already claimed this output path |

JSON shape:
```json
{
  "dryRun": [
    {
      "agent": "claude",
      "label": "Claude Code (.claude/skills/)",
      "files": [
        { "outputPath": ".claude/skills/my-project-best-practices/SKILL.md", "action": "create" }
      ]
    }
  ]
}
```

---

## Generator Version & --check Staleness

Each generated SKILL.md carries a `generatorVersion` field in its metadata header (distinct from the mp-sentinel package version). The current generator version is **`3.0.0`** — bumped when the generated output schema changes meaningfully (v3.0.0: per-agent progressive skill layout, version-gated framework rules, shared instruction-file discovery, fresh-project hash/content drift fix).

When `--check` runs, it compares the stored `generatorVersion` against the code's `GENERATOR_VERSION` constant by **major version only** (e.g. `2.x.x` files are stale under a `3.x.x` generator, while a `3.0.0` file stays current under `3.1.0`). A lower stored major is reported as stale with the reason:

```json
{
  "outputPath": ".claude/skills/my-project-best-practices/SKILL.md",
  "status": "stale",
  "reason": "generatorVersionUpgrade",
  "from": "2.0.0",
  "to": "3.0.0",
  "note": "Run mp-sentinel create-skills to regenerate with the v3 layout."
}
```

**To regenerate after a generator version bump:** run `mp-sentinel create-skills --all-agents --force` (or target specific agents with `--agent`).

## Check Mode (CI Staleness Gate)

`--check` verifies that generated skill files match the current source index without regenerating them.

```sh
npx mp-sentinel create-skills --agent claude --check
npx mp-sentinel create-skills --all-agents --check --format json
# exits 0 = all up-to-date, 1 = any stale or missing, 2 = runtime error
```

Each file entry has one of these statuses:

| Status | Meaning |
|--------|---------|
| `up-to-date` | File exists and `sourceIndexHash` matches current index |
| `stale` | File exists but hash has changed since generation |
| `missing` | File does not exist |
| `wrong-agent` | File exists with correct hash but `agent` field in the header belongs to a different adapter |

JSON shape:
```json
{
  "check": [
    {
      "agent": "claude",
      "label": "Claude Code (.claude/skills/)",
      "files": [
        { "outputPath": ".claude/skills/my-project-best-practices/SKILL.md", "status": "up-to-date" }
      ]
    }
  ],
  "status": "ok"
}
```

### Quality Gate (v1.0.14+)

Every generated file undergoes deterministic quality validation. Quality issues are reported in all modes:

- **Console mode**: Errors logged as warnings, warnings as info
- **JSON mode**: `quality` field present in all output objects
- **`--check` mode**: Quality **errors** cause exit code 1 (files are treated as stale). Warnings are informational only.

Quality checks include: max file size, required H2 sections, required references (Claude), duplicate sections, empty sections (warning), unknown paths (warning), and the **agent workflow contract** (error — requires workflow to instruct reading skill/rules and using indexing diagnostics).

**Stack-consistency checks** guard against known false-positive guidance regressing: Next.js-only advice in React projects without `next` and NodeNext `.js` import-extension rules under `moduleResolution: "bundler"` fail the gate. **Framework heading guards** reject any `### <Framework> Rules` section whose activating dependency is absent. **Package-manager command checks** reject commands rendered with the wrong manager (`npx` in a pnpm/bun project, `npm run` in a bun project, etc.). **Test guidance checks** require `### Test Expectations` whenever the index contains test files, and **repetitive-output checks** warn on duplicated guidance bullets.

### Script-Aware Workflow Commands

Generated workflow commands prefer the project's own package.json scripts over raw CLI invocations (project scripts may carry env guards): `sentinel:index` wraps indexing diagnostics, `sentinel:context` wraps `--explain-context`, and `agent:skills:refresh` / `sentinel:skills` wraps regeneration. Without those scripts, commands fall back per package manager: `bun run <script>` / `bunx --bun mp-sentinel ...`, `pnpm run <script>` / `pnpm exec mp-sentinel ...`, `npm run <script>` / `npx mp-sentinel ...`.

### Detected Conventions (Deterministic)

A `## Detected Conventions` section reports conventions observed from config and the import graph — tsconfig path aliases actually in use, feature-folder shapes (`features/<feature>/types.ts`, `constants.ts`, hooks, `api/`), central HTTP clients, React Query key constants, shared UI system roots, monorepo workspaces (with the right `--filter`/`-w` script routing per package manager), test framework + placement, data-access layers (Prisma/Drizzle/tRPC/GraphQL/Supabase), and state/form libraries (Zustand/Redux/Jotai, React Hook Form/Formik). Nothing is invented: a convention only renders when the codebase shows it.

### Agent Orientation Sections

Skill-folder outputs additionally carry `## First Files To Read` (entrypoints, public API surface, top hub files, root App Router layout — capped at 6) and `## Common Change Paths` (a task table mapping feature/API/UI/test work to the directories where it happens, with the project's own test command). Rule-only adapters stay concise and omit both.

### Per-Module References

Skill-folder adapters additionally generate `references/modules/<safe-module-name>.md` deep-dives for the top bounded contexts (modules with at least 5 source files, max 6 files). Each contains key files, entrypoints, dependency edges, tests, and relevant conventions. The Reference Routing table points agents at `modules/<safe-name>` entries when available.

### Index Fidelity (v1.0.16+)

`--check` staleness detection includes instruction file presence in the deterministic hash — current paths such as `AGENTS.md`, `CLAUDE.md`, `.claude/skills`, `.agents/skills`, `.cursor/rules`, `.windsurf/skills`, `.roo/skills`, and `.cline/skills`. Legacy locations (`.windsurf/rules`, `.roo/rules`, `.clinerules`) count only when they contain user-authored (non-generated) content. Adding or removing instruction files after skill generation causes `--check` to correctly report stale.

---

## Real-Project Rollout

Recommended first run on a repo that has never used mp-sentinel:

```sh
# 1. Preview without writing anything (use your package manager's runner)
npx mp-sentinel create-skills --agent claude --dry-run --format json --no-ai-enrich

# 2. Inspect environment + detection diagnostics
npx mp-sentinel create-skills --doctor

# 3. Generate for the agents you actually use
npx mp-sentinel create-skills --agent claude,cursor
```

- `--dry-run` lists every file with its action (`create` / `skip` / `overwrite` / `conflict`) and runs the full quality gate — review `quality.errors` / `quality.warnings` in the JSON before committing to a real run. Note: resolving the source index may still build the local `.mp-sentinel-cache/` index cache.
- `--doctor` reports index health, detected agents, script availability, and AI-enrichment readiness with recommended commands.
- Maintainers validating generator changes against an external repo can run `node scripts/adoption-preview.mjs <path-to-repo>` (internal tooling): it copies the repo to a temp sandbox, generates there, and prints profile / package manager / frameworks / conventions / quality — the target repo is never written to.
- **Monorepos:** run from the workspace root. Workspace globs (package.json `workspaces` or `pnpm-workspace.yaml`) and package-level manifests are detected automatically; module references prefer the nearest package's own scripts (`pnpm --filter <pkg> run build`, `npm run build -w <pkg>`, ...) while root guidance keeps root scripts.
- **Authoritative local rules:** add `rules` / `ruleFiles` to `.mp-sentinelrc.json` instead of hand-editing generated files. They render as a "Project Rules (authoritative)" section ABOVE generated references, participate in `--check` staleness, and survive regeneration. Hand-written files at generated output paths are never overwritten — even with `--force` — but they also stop receiving updates.

## Automation / CI

Use `--agent` (or `--all-agents`) with `--format json` for machine-readable output. JSON is written to stdout; all log messages go to stderr.

```sh
# CI-friendly JSON output
npx mp-sentinel create-skills --agent claude,cursor --format json

# Direct CLI call avoids npm banners
node dist/index.js create-skills --agent claude --format json
```

JSON shape:
```json
{
  "results": [
    {
      "agent": "claude",
      "label": "Claude Code (.claude/skills/)",
      "outputPaths": [".claude/skills/my-project-best-practices/SKILL.md", "…"],
      "skipped": false
    }
  ]
}
```

On error:
```json
{ "status": "ERROR", "error": "…message…" }
```

---

## Doctor Diagnostic (v1.7.0+)

`--doctor` performs a read-only health check covering agent detection, source index cache status, skill file freshness, quality gate results, legacy files, and npm script availability. No file writes, no AI calls, no auto-indexing.

```sh
# Console output grouped by severity
npx mp-sentinel create-skills --doctor

# JSON output for CI health checks
npx mp-sentinel create-skills --doctor --format json
```

**Exit codes:** `0` = healthy (no fail items; warn items may exist), `1` = action required (fail items exist), `2` = error (corrupt/unreadable index).

**Console sections:** `[fail] Action Required`, `[warn] Advisory`, `[ok] Healthy`. Non-detected agents are neutral and appear in `[ok]` as "not detected".

### JSON Shape (v1.8.0+)

```json
{
  "status": "action-required",
  "projectName": "mp-sentinel",
  "agents": [ { "id": "claude", "detected": true, ... } ],
  "index": { "status": "missing", "reason": "..." },
  "skills": [ { "agent": "claude", "status": "unverifiable", "files": [], ... } ],
  "legacyFiles": [],
  "scripts": [ { "name": "agent:skills:check", "status": "available", ... } ],
  "recommendedActions": [
    "Run \"mp-sentinel indexing\" to build the source index at \".mp-sentinel-cache/source-index.json\"."
  ],
  "recommendedCommands": [
    "mp-sentinel indexing"
  ]
}
```

`recommendedActions` (human-readable) and `recommendedCommands` (machine-runnable) follow this command policy:

| Condition | Command |
|-----------|---------|
| Missing index | `mp-sentinel indexing` |
| Stale index (no manifestHash) | `mp-sentinel indexing --force` |
| Stale/missing/wrong-agent skills | `npm run agent:skills:refresh` (if script exists), else `mp-sentinel create-skills --all-agents --force` |
| Quality errors | (action text only, no automated command) |
| Legacy files, missing scripts | Advisory only (warn, not fail) |

`recommendedCommands` is deduplicated and ordered (index first, then skills).

---

## Agent Workflow-Command Contract

Generated skill files and the `create-skills` quality gate enforce an agent workflow contract. Agents must follow this sequence when working with mp-sentinel projects:

### Required Commands

| Command | Purpose |
|---------|---------|
| `indexing --health` | Check index health: status, version consistency, parser telemetry, suggested commands |
| `indexing --recovered` | List files parsed with recovery modes (chunked, ASCII, lexical fallback) |
| `indexing --parse-errors` | List files with hard parse errors |
| `indexing --agent-context <file>` | Per-file diagnostics: symbols, imports, dependents, parser mode, chunk telemetry, outbound calls + incoming call candidates (schema 1.4+) |
| `indexing --explain-index <file>` | Full parser diagnostics for a single file |
| `indexing --find-symbol <name>` | Locate a symbol across the index |
| `indexing --find-import <package>` | Find files that import a given package |
| `indexing --find-code <query>` | Search indexed code snippets for a query |
| `indexing --stats` | Aggregate index statistics |
| `--explain-context` | Review context diagnostics (available on the root CLI) |

### Workflow Rules

1. **Health first.** Always start with `--health` to assess index state and parser health before touching files. If the index is missing or corrupt, build it first with `indexing` or `indexing --force`.
2. **Drill down when parser issues exist.** If `--health` reports `recoveredFiles > 0` or `parseErrorCount > 0`, inspect with `--recovered` or `--parse-errors` before making code changes. Parser recovery modes (`chunked-tree-sitter`, `ascii-fallback`, `lexical-fallback`) indicate files that may need attention.
3. **Use per-file diagnostics before editing.** Before modifying any file, check its parser state with `--explain-index <file>` or `--agent-context <file>` to understand its parse health and dependency graph.
4. **JSON mode for automation.** All indexing diagnostic commands support `--index-format json` for machine-readable output. Use it in CI and automated workflows.

The quality gate validates that generated skills include this workflow. Missing `--health`, `--recovered`, or `--parse-errors` commands in generated content are hard errors.

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success — all selected adapters generated successfully (or all files up-to-date in `--check` mode). **Doctor:** no fail items (warn items may exist) |
| `1` | **Generate mode:** all outputs were skipped (files exist, `--force` not set). **Check mode:** any file is stale, missing, wrong-agent, or has quality errors. **Doctor:** fail items exist |
| `2` | Runtime error (bad agent id, missing cache with `--skip-index-refresh`, etc.). **Doctor:** corrupt/unreadable index |

---

## Adding a New Adapter

1. Create `src/services/skills-generator/adapters/<name>.adapter.ts` implementing `AgentAdapter`.
2. Register it in `src/services/skills-generator/registry.ts` (add to `ADAPTER_REGISTRY`).
3. Add to the `AgentAdapterId` union in `src/types/index.ts`.
4. Write detection + output path tests in `src/__tests__/create-skills.test.ts`.
5. Update this document and `docs/COMMANDS_CHEAT_SHEET.md`.
