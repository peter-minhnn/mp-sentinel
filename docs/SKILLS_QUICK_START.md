# Agent Skills Integration - Quick Start

## 🚀 5-Minute Setup

### Step 1: Install a Skill from the Community

You can find and add agent skills (curated markdown rules/practices) using the `skills` CLI:
```bash
npx skills add vercel-labs/agent-skills@vercel-react-best-practices
```
*(This creates local `.md` files in a `.skills/` or `.agent/skills/` directory)*

### Step 2: Update Configuration

Add to your `.sentinelrc.json`:

```json
{
  "techStack": "React, TypeScript"
}
```

### Step 3: Run Review

```bash
npx mp-sentinel review --range origin/main..HEAD
```

That's it! Sentinel automatically scans your `.skills` directories, boosts relevance based on your `techStack`, and securely attaches the guidelines into your AI review prompts.

## 📋 Custom Skills (Manual Rules)

You aren't restricted to `npx skills`! You can also create personal markdown checklists:

1. Create a folder: `mkdir -p .sentinel/skills`
2. Create a markdown file: `touch .sentinel/skills/my-backend-rules.md`
3. Add instructions:
   ```markdown
   # Backend Rules
   - Always validate DTOs
   - Never use `SELECT *`
   ```
4. Run Sentinel. It will auto-detect and bundle these rules for your review.

## ⚙️ Supported Directories

MP Sentinel automatically scans these folders in your repository:
- `.skills/`
- `.agent/skills/`
- `.cursor/rules/`
- `.sentinel/skills/`

## 🔍 Verify It's Working

Run with verbose flag:

```bash
npx mp-sentinel review --range origin/main..HEAD --verbose
```

Look for these log messages:

```
✅ Loaded 2 local skills from project directories.
```

Or if no directories exist or they're empty:

```
(No local skills loaded, continues normally with generic rules)
```

## 🚫 Disable Skills Integration

If you don't want skills integration, simply delete the local `.skills/` directories, or add them to your `.archignore` / `.antigravityignore` to bypass file loading.

## 📚 Learn More

- [Full Documentation](./SKILLS_INTEGRATION.md)
- [Configuration Guide](./README.md#⚙️-configuration-sentinelrcjson)

## 💡 Pro Tips

1. **Be Specific in TechStack**: Include versions or module names (e.g. `React, GraphQL, TailwindCSS`) to help MP Sentinel dynamically prioritize the right local `.md` files in repositories with hundreds of skill files.

2. **Commit Your Skills**: Check the `.skills/` directories into Git. This ensures your CI/CD pipelines automatically enforce the exact same standard as your local environment.

3. **Fallback Supported**: The deprecated fields `enableSkillsFetch` or `skillsFetchTimeout` in `.sentinelrc.json` will be safely ignored if you leave them in your existing project configuration.
