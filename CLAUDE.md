# MP Sentinel — Claude Code Instructions

Full development rules are in [AGENTS.md](AGENTS.md). This file adds Claude Code-specific guidance only.

---

## Read First

Before working on any task, read [AGENTS.md](AGENTS.md). It is the authoritative source for:

- Pipeline architecture and exit code semantics
- TypeScript/ESM conventions (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`, etc.)
- `create-skills` behavioral contract and adapter rules
- Indexing behavioral contract and required test matrix
- Review context enrichment rules
- Docs/runtime consistency requirements
- Verification checklist (must pass before marking a task done)

---

## Claude Code Notes

### Agent skills — always current before coding

Generated skill files are **local-only** (gitignored). Run these before touching code:

```sh
npm run agent:skills:check
```

If the check reports stale or missing files, run:

```sh
npm run agent:skills:refresh
```

Then read `.claude/skills/mp-sentinel-best-practices/SKILL.md` before making changes.

These commands are deterministic (`--no-ai-enrich`) — no network, no API key needed.

### Verification before done

Always run the checklist from `AGENTS.md §8` before reporting a task complete. For runtime changes:

```sh
npm run format:check && npm run typecheck && npm test && npm run build
```

For release changes, also run `npm run release:check` after version bumps.

### Version bumps

Use `npm version <newversion> --no-git-tag-version` or manual root-only edits (`package.json.version` and `package-lock.json` top-level `version` + `packages[""].version`). **Never** global search/replace `"version"` across the lockfile — it corrupts dependency version fields.

### File references

Use `src/types/index.ts` as the single source for shared types. Do not redeclare types inline in service files.

### Imports

- Internal imports: always include `.js` extension.
- Node built-ins: always use `node:` prefix.
- Type-only imports: always use `import type`.

### Do not touch

- `src/index.ts` beyond SIGINT handling and top-level command routing.
- Exit codes — `0 / 1 / 2` semantics are contractual.
- `.sentinel/skills/` — these are runtime review prompts injected for end users, not agent rules.
- Generated skill files (`.agents/skills/`, `.cursor/rules/*-best-practices.mdc`, `.cline/skills/`, `.clinerules/*.md`, `.windsurf/skills/`, `.windsurf/rules/*.md`, `.roo/skills/`, `.antigravity/rules/*.md`, `.agents/rules/*-best-practices.md`) — these are local bootstrap artifacts, never commit them.
