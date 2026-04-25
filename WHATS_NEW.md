# 🎉 What's New in v1.0.7

## 🚀 Major Improvements

### 1. Source Indexing & Enhanced AI Context 📚

Introducing **Source Indexing** — a powerful new feature that parses your JavaScript/TypeScript codebase to build an intelligent cache of symbols, imports, exports, and project structure. This index supercharges AI code reviews with deeper project context.

**Key Features:**
- **AST-based parsing** using tree-sitter for accurate symbol extraction
- **Graph-aware dependency resolution** — `importsFrom` / `importedBy` edges for every file (schema `1.1`)
- **tsconfig `paths`/`baseUrl` support** — aliases like `@/lib/foo` resolve correctly
- **Incremental caching** — only re-index changed files for speed
- **Configurable** — enable/disable, choose languages, set cache path & file size limits
- **Enhanced AI prompts** — injects changed files first, then capped direct imports and dependents

**Usage:**
```bash
# Build or update the source index cache
npx mp-sentinel indexing

# Force rebuild (ignores existing cache)
npx mp-sentinel indexing --force

# Get JSON output for automation
npx mp-sentinel indexing --index-format json

# Show index statistics
npx mp-sentinel indexing --stats

# Show symbol and dependency info for a specific file
npx mp-sentinel indexing --explain src/utils/git.ts
```

**Configuration (in `.mp-sentinelrc.json`):**
```json
{
  "indexing": {
    "enabled": true,
    "languages": ["typescript", "tsx", "javascript", "jsx"],
    "cachePath": ".mp-sentinel-cache/source-index.json",
    "maxFileSize": 512000
  }
}
```

### 2. Unified Configuration Schema 🎯

The configuration system has been standardized to handle all nested config sections (`ai`, `localReview`, `indexing`) consistently. This means cleaner code, better type safety, and more predictable behavior.

### 3. Improved Type Safety & API Contracts 🔒

Removed legacy `any` types from configuration handling. The public contract for indexing is now fully typed and documented, making integrations more reliable.

## 🔄 Migration

### Backward Compatible

**Full compatibility.** Version 1.0.7 is a feature release focused on source indexing. Existing configurations work without changes.

The `indexing.enabled` setting is `false` by default. When `false`, the `review` command does not use the source index for enhanced AI context. However, the `indexing` command itself always builds or updates the cache when invoked directly — regardless of this setting. This means you can safely run `mp-sentinel indexing` to generate the cache, then enable `indexing.enabled: true` in your config when ready to start consuming it during reviews.

## 📚 Documentation

- [Commands Cheat Sheet](./docs/COMMANDS_CHEAT_SHEET.md) - New indexing workflow section
- [Changelog](./docs/CHANGELOG.md) - Detailed technical changes

## ✨ Summary

**Version**: 1.0.7
**Release Date**: 2026-04-25
**Status**: Stable

Enjoy! 🎉
