# Phase 7 Field Validation

> Generated from running `mp-sentinel create-skills --force` against the real `mvp-sentinel-landing-page` SvelteKit project.

## Source Index

```
Files indexed: 42
Svelte files:  23 (54.8%)
Parse errors:  0
```

23 `.svelte` files indexed via `lexical-fallback` parser with imports, exports, and symbols properly extracted.

## Language Distribution

```
| svelte     | 23 | 54.8% |
| typescript | 18 | 42.9% |
| css        |  1 |  2.4% |
```

## Code Style Profile

| Attribute | Value |
|---|---|
| Indent | Tabs |
| Profile | Populated (not the null fallback) |
| Svelte import-outside-script | Detected |

## SKILL.md Svelte Rules

The generated SKILL.md `## Language & Framework Rules` section contains 4 Svelte-specific rules:

1. Place all `import` statements inside the `<script>` block in `.svelte` files
2. Do NOT put top-level logic or statements outside the `<script>` tag in `.svelte` files
3. Use `lang="ts"` consistently on all `<script>` tags in `.svelte` files
4. Keep `.svelte` components focused on presentation

## Quality Gate

- No `Path '.svelte' not found` **errors** (warnings only, which are non-blocking)
- No tsconfig parse warnings
- All adapter quality checks pass

## Phase 8 (K1) — Language Label Fix

After K1, the `language` field in `source-index.json` now correctly reflects the file type:

```json
{ "path": "src/routes/+page.svelte", "language": "svelte", "parserMode": "lexical-fallback" }
```

Previously this was `"language": "typescript"` (a workaround for the strict `IndexableLanguage` type). A new `IndexedLanguage` union (`IndexableLanguage | "svelte" | "vue"`) was introduced.

## Full Verification Chain (Phase 8 K2)

| Command | Exit Code |
|---|---|
| `format:check` | 0 ✅ |
| `typecheck` | 0 ✅ |
| `typecheck:tests` | 0 ✅ |
| `npm test` (56 suites, 1695 tests) | 0 ✅ |
| `npm run build` | 0 ✅ |
| `npm run release:check` (19 checks) | 0 ✅ |
| `npm run dogfood` (13/13 steps) | 0 ✅ |
| `npm run compliance:dry` | 0 ✅ |
| `npm run perf-budget` (P95=0.18s, budget=5s) | 0 ✅ |
| `npm run smoke:svelte` | 0 ✅ |
| `agent:skills:check` (22/22 up-to-date) | 0 ✅ |

## ✅ Acceptance Criteria

- [x] Running `mp-sentinel indexing` against a SvelteKit project produces a `source-index.json` whose `files[]` array includes every `.svelte` file
- [x] `mp-sentinel create-skills --force` produces `references/language-patterns.md` with a `svelte` row showing the actual file count
- [x] `references/code-style.md` has a real profile (not the "No code style profile available" fallback)
- [x] SKILL.md `## Language & Framework Rules` section has Svelte rules
- [x] No quality gate errors related to `.svelte` path resolution
- [x] `npm run smoke:svelte` exits 0
- [x] Full verification chain: format:check → typecheck → typecheck:tests → test → build → smoke:svelte
