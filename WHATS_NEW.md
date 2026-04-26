# What's New in v1.0.10

## Major Features

### 1. Profile-Aware Generated Skills

The `create-skills` command now generates project-specific best practices based on detected profile:

- **`cli-tooling`**: Exit codes, diff-first review, CLI parsing separation, entry file routing, script change warnings
- **`node-service`**: Handler purity, error middleware, env validation, async boundaries, health checks
- **`react-next`**: Server/client boundary, data fetching colocation, DOM mutation avoidance, image optimization, bundle vigilance
- **`library`**: Public API surface, SemVer awareness, type definitions, peer dependencies, tree-shakeability

The profile is auto-detected from manifest signals (`bin`, scripts, dependencies, frameworks) — no CLI flag required.

### 2. Manifest-Aware Cache Invalidation

Source index caching now fingerprints `package.json`, `tsconfig*.json`, and lockfile identity via a `manifestHash` field. When only manifest inputs change (scripts, dependencies, framework signals), cached parsed files are reused and only the dependency graph is rebuilt — no full reparse required. This ensures profile skills always reflect the current manifest without unnecessary reindexing.

### 3. Cline Adapter

MP Sentinel now supports **Cline** AI assistant via the `.clinerules/` directory:

```bash
npx mp-sentinel create-skills --agent cline
```

Output: `.clinerules/<project>-best-practices.md`

Cline is included in `--all-agents` and auto-detected when `.clinerules/` exists.

### 4. Claude SKILL.md Frontmatter Fix

Claude Code skills now correctly place the metadata header **after** the YAML frontmatter, preserving the frontmatter as the very first content in `SKILL.md`. This matches Claude Code's skill file expectations.

## Documentation

- [Create Skills Guide](./docs/CREATE_SKILLS.md) — full adapter reference, output paths, automation
- [Commands Cheat Sheet](./docs/COMMANDS_CHEAT_SHEET.md) — `create-skills` section
- [Changelog](./docs/CHANGELOG.md) — detailed technical changes per version

## Migration

No breaking changes. All improvements are additive.

## Summary

**Version**: 1.0.10
**Release Date**: 2026-04-26
**Builds on**: v1.0.9 create-skills MVP

---

# What's New in v1.0.9

## Major Features

### 1. `create-skills` — Generate Agent/IDE Skill Files

MP Sentinel can now generate structured best-practices files for AI agents and IDEs directly from your source index. One command, multiple targets:

```bash
# Interactive picker — auto-detects existing agent folders
npx mp-sentinel create-skills

# Generate for specific agents
npx mp-sentinel create-skills --agent claude,cursor

# Generate for all supported agents at once
npx mp-sentinel create-skills --all-agents

# Automation-friendly JSON output
npx mp-sentinel create-skills --agent claude --format json

# Overwrite existing skill files
npx mp-sentinel create-skills --agent claude --force
```

**Supported agents:**

| Agent | Output path |
|-------|-------------|
| `claude` | `.claude/skills/<project>-best-practices/SKILL.md` + `references/` |
| `cursor` | `.cursor/rules/<project>-best-practices.mdc` |
| `codex` | `.agents/rules/<project>-best-practices.md` |
| `windsurf` | `.windsurf/rules/<project>-best-practices.md` |
| `antigravity` | `.antigravity/rules/<project>-best-practices.md` |
| `cline` | `.clinerules/<project>-best-practices.md` |
| `generic` | `.agents/rules/<project>-best-practices.md` |

> **Note:** `--all-agents` generates for the 6 primary adapters (`claude`, `cursor`, `codex`, `windsurf`, `antigravity`, `cline`). `generic` shares an output path with `codex` and is excluded from `--all-agents` to avoid conflicts — use `--agent generic` to target it explicitly.

**What's generated:**
- Project overview (name, version, frameworks, package manager)
- Architecture (top-level directories, dependency graph stats when schema 1.1)
- Hub files (most-imported files with their exported symbols — schema 1.1 only)
- Module map (per-directory breakdown with key exported symbols)
- Development commands (`npm test`, `npm run build`, type-check)
- Code conventions (ESM imports, TypeScript, test file count)

**Auto-index:** `create-skills` always ensures a valid source index exists before generating. If the cache is absent it builds automatically — no manual `mp-sentinel indexing` step required. The index is also automatically refreshed when manifest inputs (`package.json`, `tsconfig*.json`, or lockfile identity) change, ensuring profile skills stay in sync with the current scripts, `bin`, dependencies, and framework signals.

### 2. Preview and CI Modes

**`--dry-run`** — preview what would happen without writing files:
```bash
npx mp-sentinel create-skills --all-agents --dry-run --format json
```
Possible actions per file: `create` (new), `skip` (exists, no `--force`), `overwrite` (exists with `--force`), `conflict` (path already claimed by another adapter in the same batch).

**`--check`** — CI staleness gate:
```bash
npx mp-sentinel create-skills --agent claude --check --format json
# exits 0 = up-to-date, 1 = stale/missing, 2 = runtime error
```
Possible statuses: `up-to-date`, `stale` (hash mismatch), `missing`, `wrong-agent` (file exists but was generated by a different adapter).

### 3. Deterministic Output

Every generated file begins with a metadata header:
```
<!-- @mp-sentinel-generated generatorVersion=1.0.9 sourceIndexSchema=1.1 sourceIndexHash=<16hexchars> agent=claude projectName=my-project -->
```
The `sourceIndexHash` is a sha256 over sorted file paths, symbols, and import edges — no timestamps, no random values. Re-running `create-skills` on the same index always produces byte-identical files. `--check` uses this hash to detect staleness without re-reading file content.

### 4. Hardened CLI Contract

- `create-skills --help` now shows all options including `--format`.
- Invalid format (`--format xml`) returns exit code `2` with a clear error message.
- Unknown `--agent` id returns exit code `2` listing valid options.
- Absent or corrupt cache with `--skip-index-refresh` fails with exit code `2` instead of silently generating incomplete files.
- Missing `package.json` name field returns exit code `2` rather than generating files under the generic `"project"` name.

## Migration

No breaking changes. `create-skills` is an additive command. Existing `review` and `indexing` workflows are unaffected.

## Summary

**Version**: 1.0.9
**Release Date**: 2026-04-26
**Builds on**: v1.0.8 graph-aware source indexing
