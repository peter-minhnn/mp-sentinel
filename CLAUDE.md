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

### Verification before done

Always run the checklist from `AGENTS.md §7` before reporting a task complete. For runtime changes:

```sh
npm run format:check && npm run typecheck && npm test && npm run build
```

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
