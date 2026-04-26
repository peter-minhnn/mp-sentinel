# What's New in v1.0.8

## Major Improvements

### 1. Graph-Aware Dependency Index

Building on the source indexing foundation introduced in v1.0.7, v1.0.8 upgrades the index schema to `1.1` with a full dependency graph. Every indexed file now carries `importsFrom` and `importedBy` edges, enabling precise context injection for AI reviews.

**What's new in the graph:**
- **tsconfig `paths`/`baseUrl` support** — aliases like `@/lib/foo` resolve to actual files
- **JSONC tsconfig** — tsconfig files with comments or trailing commas parse without error
- **External package filtering** — `react`, `node:*`, `@types/*`, and URLs are never added as graph edges
- **Missing import safety** — unresolvable imports are silently skipped, never crash indexing
- **Circular import detection** — `a→b→a` correctly populates both directions of the graph

### 2. New CLI Flags: `--stats` and `--explain`

```bash
# Show index statistics after building
npx mp-sentinel indexing --stats

# Get machine-readable stats
npx mp-sentinel indexing --stats --index-format json

# Inspect symbol and dependency info for a file
npx mp-sentinel indexing --explain src/cli/review.ts

# Get machine-readable file info
npx mp-sentinel indexing --explain src/cli/review.ts --index-format json
```

### 3. Smarter AI Review Context

When the source index is enabled, the review prompt now includes:
1. **Changed files first** (the files being reviewed)
2. **Direct imports** of each changed file (capped at 3 per file)
3. **Direct dependents** that import the changed file (capped at 3 per file)

Character budget raised to 12 000 for richer context without exceeding token limits.

### 4. Pure JSON stdout

`--index-format json` now suppresses all informational log messages so stdout contains only valid JSON — safe to pipe directly into `jq` or `JSON.parse`.

```bash
node dist/index.js indexing --index-format json | jq '.stats'
node dist/index.js indexing --stats --index-format json | jq '.'
node dist/index.js indexing --explain src/index.ts --index-format json | jq '.importsFrom'
```

## Migration

### Fully Backward Compatible

Schema `1.1` adds optional `importsFrom`, `importedBy`, and `exportedSymbols` fields to `SourceIndexFile`. Existing code that reads schema `1.0` caches will continue to work — the new fields are simply absent.

The `indexing.enabled` setting is `false` by default. Set it to `true` in `.mp-sentinelrc.json` when you are ready to use the enhanced AI context during reviews.

## Documentation

- [Commands Cheat Sheet](./docs/COMMANDS_CHEAT_SHEET.md) — all indexing flags in one place
- [Changelog](./docs/CHANGELOG.md) — detailed technical changes per version

## Summary

**Version**: 1.0.8
**Release Date**: 2026-04-26
**Status**: Stable
**Builds on**: v1.0.7 source indexing baseline
