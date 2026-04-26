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
| `generic` | `.agents/rules/<project>-best-practices.md` |

**What's generated:**
- Project overview (name, version, frameworks, package manager)
- Architecture (top-level directories, dependency graph stats when schema 1.1)
- Hub files (most-imported files with their exported symbols — schema 1.1 only)
- Module map (per-directory breakdown with key exported symbols)
- Development commands (`npm test`, `npm run build`, type-check)
- Code conventions (ESM imports, TypeScript, test file count)

**Auto-index:** `create-skills` always ensures a valid source index exists before generating. If the cache is absent it builds automatically — no manual `mp-sentinel indexing` step required.

### 2. Hardened CLI Contract

- `create-skills --help` now shows all options including `--format`.
- Invalid format (`--format xml`) returns exit code `2` with a clear error message.
- Unknown `--agent` id returns exit code `2` listing valid options.
- Absent or corrupt cache with `--skip-index-refresh` fails with exit code `2` instead of silently generating incomplete files.
- Missing `package.json` name field returns exit code `2` rather than generating files under the generic `"project"` name.

## Documentation

- [Create Skills Guide](./docs/CREATE_SKILLS.md) — full adapter reference, output paths, automation
- [Commands Cheat Sheet](./docs/COMMANDS_CHEAT_SHEET.md) — `create-skills` section added
- [Changelog](./docs/CHANGELOG.md) — detailed technical changes per version

## Migration

No breaking changes. `create-skills` is an additive command. Existing `review` and `indexing` workflows are unaffected.

## Summary

**Version**: 1.0.9
**Release Date**: TBD
**Status**: Release candidate
**Builds on**: v1.0.8 graph-aware source indexing
