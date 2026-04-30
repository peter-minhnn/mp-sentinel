# Agent Skills Integration

MP Sentinel integrates with the open agent skills ecosystem (e.g. `npx skills`) to automatically enhance code review prompts with specialized best practices and knowledge bases found locally in your project repository.

## Overview

When enabled, MP Sentinel will:
1. Parse your `techStack` from `.sentinelrc.json`
2. Scan local directories (like `.skills`, `.agent/skills`, `.cursor/rules`, `.sentinel/skills`) for `.md` or `.mdc` files
3. Boost relevance for skill files whose names match technologies defined in your `techStack`
4. Integrate these markdown rules into the AI review prompts directly

Unlike the older implementation, **this process is 100% offline, highly secure, and instant.** It does not rely on any external `skills.sh` HTTP API.

## Configuration

Add these fields to your `.sentinelrc.json`:

```json
{
  "techStack": "TypeScript 5.7, Node.js 18 (ESM), React 18, PostgreSQL 15"
}
```

(The options `enableSkillsFetch` and `skillsFetchTimeout` are now deprecated but will not cause errors if left in the config)

### Configuration Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `techStack` | `string` | `""` | Comma-separated list of technologies used in your project |

## How It Works

### 1. Adding Skills via CLI

Users can download curated best practices from the ecosystem using the `skills` CLI:
```bash
npx skills add vercel-labs/agent-skills@vercel-react-best-practices -g -y
```
Alternatively, users can manually create Markdown files (e.g., `react-architecture.md`) and drop them into the `.skills/` or `.agent/skills/` folder at the root of their repository.

### 2. Technology Parsing

MP Sentinel automatically parses your `techStack` string to identify keywords:

```
Input:  "TypeScript 5.7, Node.js 18 (ESM), tsup (esbuild)"
Output: ["typescript", "nodejs", "esm", "tsup", "esbuild"]
```

### 3. Local Directory Scanning

During the review run, the system scans well-known locations relative to your project root `process.cwd()`:
- `.skills/`
- `.agent/skills/`
- `.cursor/rules/`
- `.sentinel/skills/`

Any file ending with `.md` or `.mdc` is read and converted into a "SkillPrompt". 

### 4. Smart Relevance & Prompt Enhancement

If a file's name matches one of your `techStack` keywords (e.g., a file named `typescript-patterns.md`), its "relevance score" gets significantly boosted.

The top-scoring skills are concatenated and embedded cleanly into the AI's instruction context block:

```markdown
### LOCAL/CUSTOM SKILLS & BEST PRACTICES

#### Skill: vercel-react-best-practices (from .agent/skills)
# React Best Practices...
(Full markdown rule content injected here)
```

## Performance & Security

### 100% Offline
Because the Markdown rules reside purely inside your version control system (or locally), MP Sentinel avoids networking latency and potential HTTP 404s from third-party APIs.

### Extensible
You can put custom instructions in `.sentinel/skills/my-company-rules.md` and Sentinel will pick it up automatically, enabling enterprise-scale customized AI review standardization without tweaking `.sentinelrc.json` rules array.

## Examples

### Example 1: Full Stack JavaScript

```json
{
  "techStack": "TypeScript, Node.js, React, PostgreSQL"
}
```

If you have downloaded skills like `typescript-advanced.md` and `react-best-practices.md`, Sentinel will highlight and prioritize these over generic rules when reading your local `.skills/` directory.

### Example 2: Disabled

If you do NOT want local skills integration, you can simply keep your `.skills` directories empty or simply ignore them in your `.antigravityignore` or `.archignore`.

## Troubleshooting

### Skills Not Detected

Check:
1. Ensure the markdown files have `.md` or `.mdc` extensions.
2. Ensure they are actually inside one of the recognized directories (`.skills`, `.agent/skills`, `.cursor/rules`, `.sentinel/skills`).
3. Ensure file read permissions are correct.

### Too Many Skills Included

If you have downloaded hundreds of skills, Sentinel caps the limit to the top 10 most relevant skills (up to 8,000 characters per skill file). Make sure your `techStack` is precise so that the system boosting accurately picks the best skills for your code review.

## Integration with CI/CD

Because the skills are committed to your GitHub/GitLab repository, MP Sentinel running on CI platforms natively reads them without requiring additional package manager downloads or API keys.

```yaml
# GitHub Actions
- name: Run MP Sentinel
  run: npx mp-sentinel
  env:
    AI_PROVIDER: gemini
    GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
```
