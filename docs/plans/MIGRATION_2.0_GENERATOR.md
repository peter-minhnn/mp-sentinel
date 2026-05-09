# Generator v2.0.0 Migration Guide

## What changed

The generated SKILL.md format was upgraded from generator v1.x to v2.0.0. The new format adds four sections:

- `## Language & Framework Rules` — deterministic per-language rule packs
- `## Clean Code Policy` — configurable quality limits
- `## File Size Policy` — hard limits with current codebase statistics
- Three new reference files: `code-style.md`, `language-patterns.md`, `clean-code-checklist.md`

## What you need to do

After upgrading mp-sentinel to a version that includes generator v2.0.0, regenerate your skill files:

```sh
# Generate for all agents
npx mp-sentinel create-skills --all-agents --force

# Or target specific agents
npx mp-sentinel create-skills --agent claude --force
```

Your first `mp-sentinel create-skills --check` after upgrade will report existing files as `stale`. This is expected — their metadata header says `generatorVersion=1.x.y` but the code now expects `2.0.0`. Run the command above to refresh them.

## What if I don't want code samples in AI enrichment?

If AI enrichment is enabled, the v2 prompt includes up to 5 scrubbed code samples. To skip this and use the v1-style prompt:

```sh
npx mp-sentinel create-skills --agent claude --no-code-samples
```

## Rolling back

If you need to revert to the v1 generator format, downgrade mp-sentinel and regenerate. The `--check` gate will flag v2-format files as stale after rollback, since their `generatorVersion` (2.0.0) won't match the older code's constant.
