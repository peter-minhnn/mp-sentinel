# MP Sentinel — Agent Development Rules

> Source of truth for AI coding agents (GPT/Codex, Claude Code, Cursor, etc.) working on this repo.
> These rules govern **development of mp-sentinel itself**, not end-user usage.

---

## 1. Architecture

### Core pipeline — do not break this flow

```
CLI args → git target/diff → file filtering → secret scrub → AI/cache → formatter → exit code
```

### Exit code semantics — never change these

| Code | Meaning |
|------|---------|
| `0`  | PASS — no findings above threshold |
| `1`  | FAIL — actionable findings exist |
| `2`  | Runtime/system error (bad config, missing API key, git error, etc.) |

Automation scripts depend on these codes. Introducing a new code or reusing one for a different purpose is a breaking change.

### Review is diff-first

Never send the full file content to the AI when `diff` + surrounding context is sufficient. Full-file reads are only valid for context enrichment when explicitly requested by the user (via `--context` or indexing).

### Dual review modes

- **CI/CD mode** (default): reads `git diff` against a target branch/commit.
- **Local mode** (`--local`): reads commits on the current branch, selected interactively.

Both modes share the same AI pipeline. Do not add mode-specific logic into `ai.ts` or formatters.

---

## 2. TypeScript / ESM

- **Runtime**: Node ≥ 18, ESM (`"type": "module"` in package.json).
- All internal imports **must** include the `.js` extension (NodeNext resolution).
- Node built-ins **must** use the `node:` prefix (e.g., `node:fs`, `node:path`).
- Prefer `import type` for type-only imports (`verbatimModuleSyntax` is enforced).
- **Never use `any`**. If unavoidable (e.g., Tree-sitter untyped nodes), isolate it in one place and add a comment explaining why.
- Respect all strict flags in `tsconfig.json`:
  - `exactOptionalPropertyTypes` — do not assign `undefined` to optional fields explicitly.
  - `noUncheckedIndexedAccess` — guard all array/object index access.
  - `noImplicitReturns` — every code path in non-void functions must return.
  - `noFallthroughCasesInSwitch` — no implicit fallthrough.
  - `verbatimModuleSyntax` — `import type` must be used for type-only imports.

---

## 3. `create-skills` Command

### Behavioral contract

- `mp-sentinel create-skills` generates agent/IDE skill files from the source index.
- It **always** ensures a valid source index exists before generating. If none is available it auto-builds via `buildSourceIndex()`. This mirrors the indexing command's behavior, not the review command's graceful skip.
- `--skip-index-refresh` uses the existing cache only. If the cache is absent or corrupt, the command fails with exit code `2` — it never silently generates with stale or partial data.
- If the source index does not contain a project name (`package.json` has no `"name"` field), the command fails with exit code `2` rather than generating files under the generic `"project"` name.
- `--format json` requires `--agent <ids>` or `--all-agents`. Without an explicit agent selection, JSON mode is disallowed to preserve parseable stdout.
- `--dry-run` previews what would happen (actions: `create`, `skip`, `overwrite`) without writing any files. JSON output: `{ "dryRun": [...] }`.
- `--check` is the CI staleness gate: exit `0` if all generated files have the correct metadata hash, exit `1` if any file is missing or stale, exit `2` on runtime error. JSON output: `{ "check": [...], "status": "ok" | "stale" }`.

### Metadata contract — every generated file begins with a metadata header

The command layer (not adapters) prepends an HTML comment to every generated file:

```
<!-- @mp-sentinel-generated generatorVersion=X.Y.Z sourceIndexSchema=1.1 sourceIndexHash=<16hexchars> agent=claude projectName=my-project -->
```

- **Deterministic**: hash is sha256 over sorted file paths, symbols, and import edges — no timestamps.
- **`--check`** reads this header and compares `sourceIndexHash` against the current index hash. A mismatch = stale.
- Adapters must NOT embed their own metadata — the command layer owns the header.
- Do not change the `@mp-sentinel-generated` marker string — it is the parse key.

### Output contract — never write into `.sentinel/skills/`

`.sentinel/skills/` is the directory for **end-user review-prompt skills** (injected into AI review calls). `create-skills` must never write into that directory. Every adapter must write to its own agent-specific path:

| Adapter | Default output path |
|---------|---------------------|
| `claude` | `.claude/skills/<project>-best-practices/SKILL.md` + `references/` |
| `cursor` | `.cursor/rules/<project>-best-practices.mdc` |
| `codex` | `.agents/rules/<project>-best-practices.md` |
| `windsurf` | `.windsurf/rules/<project>-best-practices.md` |
| `antigravity` | `.antigravity/rules/<project>-best-practices.md` |
| `generic` | `.agents/rules/<project>-best-practices.md` |

### Adding a new adapter

1. Create `src/services/skills-generator/adapters/<name>.adapter.ts` implementing `AgentAdapter`.
2. Register in `src/services/skills-generator/registry.ts` (append to `ADAPTER_REGISTRY`).
3. Add `<name>` to the `AgentAdapterId` union in `src/types/index.ts`.
4. Write detection + output-path tests in `src/__tests__/create-skills.test.ts`.
5. Update `docs/CREATE_SKILLS.md` and `docs/COMMANDS_CHEAT_SHEET.md`.

---

## 4. Source Indexing (`mp-sentinel indexing`)

### Behavioral contract

- `mp-sentinel indexing` (direct invocation) **always** builds/rebuilds the cache — no dry-run by default.
- `indexing.enabled` in `.sentinelrc.json` only controls whether `review` **consumes** the cache. It does not affect the `indexing` command itself.
- Never auto-trigger indexing inside the review pipeline. If cache is stale or absent, review continues without index context.

### Output / caching rules

- JSON output mode (`--index-format json`) must write **only** valid JSON to stdout. All logs, progress, and warnings go to stderr.
- The index schema and cache files must be **backward compatible**. Add fields; never remove or rename existing ones without a migration path.
- Cache location: `.mp-sentinel-cache/`. Do not change this default without a config option.

### Graph-aware indexing — required test coverage

Every change to `src/services/source-index/` must maintain passing tests for:

- [ ] Relative imports (`./foo`, `../bar/baz`)
- [ ] Index file resolution (`import from './dir'` → `./dir/index.ts`)
- [ ] `tsconfig.json` path aliases
- [ ] External package imports (must not be treated as internal graph edges)
- [ ] Missing/unresolvable imports (must not crash, emit a warning)
- [ ] Circular imports (must be detected and reported, not cause infinite loops)

---

## 5. Review Context Enrichment

- Context priority order: **changed file → direct imports → direct dependents**.
- Respect the token budget at all times. Never exceed the configured limit even when adding context.
- AI cache keys must change whenever the **system prompt**, **context content**, or **model version** changes. Stale cache serving wrong responses is worse than a cache miss.
- Do not add index-dependent logic to the review path without a graceful fallback for when the index is absent.

---

## 6. Docs & Runtime Consistency

- **Never document a flag or feature that is not yet implemented.** If it's planned, add a `<!-- TODO -->` comment, not a user-facing paragraph.
- **No duplicate sections** across `README.md`, `docs/`, and `COMMANDS_CHEAT_SHEET.md`. If content must appear in two places, use a single source and cross-link.
- When changing CLI flags, config keys, or JSON schema, update **all of the following in the same commit**:
  - `README.md` (or the relevant `docs/` file)
  - `docs/COMMANDS_CHEAT_SHEET.md`
  - `WHATS_NEW.md`
  - `docs/CHANGELOG.md`
  - Affected tests
- Before a release commit, verify that `package.json`, `package-lock.json`, and version references in docs all match.

---

## 7. Verification Checklist

Run these before marking any feature complete.

### Feature / runtime change
```sh
npm run format:check
npm run typecheck
npm test
npm run build
```

### Package / release change
```sh
npm run format:check
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

### JSON CLI output change
Verify by actually parsing the output — do not rely on visual inspection:
```sh
mp-sentinel review --format json ... | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>JSON.parse(d))"
```

---

## 8. What Belongs Where

| Concern | Location |
|---------|----------|
| CLI argument parsing | `src/cli/args.ts` |
| CI/CD review orchestration | `src/cli/review.ts` |
| Local review orchestration | `src/cli/local-review.ts` |
| Indexing command | `src/commands/indexing.ts` |
| create-skills command | `src/commands/create-skills.ts` |
| Agent adapter registry | `src/services/skills-generator/` |
| AI provider abstraction | `src/services/ai/` |
| Source index / graph | `src/services/source-index/` |
| Secret detection | `src/services/security/` |
| File filtering | `src/services/file-handler/` |
| Shared TypeScript types | `src/types/index.ts` |
| Public programmatic API | `src/lib.ts` |

Do not put business logic in `src/index.ts` (CLI entry). It should only handle SIGINT, top-level routing, and process.exit.

---

## 9. Out of Scope for This File

These rules govern **mp-sentinel development**. They do not apply to:

- End-user `.sentinelrc.json` configuration advice.
- Skills/rules that mp-sentinel injects into review prompts (those live in `.sentinel/skills/`).
- Generic TypeScript project conventions outside this repo.
