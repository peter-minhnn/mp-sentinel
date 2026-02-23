# 🎉 What's New in v1.0.5

## 🚀 Major Features

### 1. Local Agent Skills Integration 🎯

MP Sentinel now integrates with the open agent skills ecosystem (e.g., `npx skills`) by scanning local directories instead of relying on external APIs.

**Key highlights:**
- **100% Offline**: No network calls to `skills.sh`, making it faster and more secure.
- **Support for Standard Ecosystem**: Native support for rules downloaded via `npx skills`.
- **Smarter Matching**: Skills are prioritized based on your `techStack` configuration.
- **Customizable**: Add your own company rules in `.sentinel/skills/*.md`.

### 2. Performance & Security Improvements ⚡

- **Instant Startup**: By removing remote API calls, the tool starts auditing your code immediately.
- **Increased Rule Capacity**: Supports longer markdown rule files (up to 8,000 characters per file) for better precision.
- **Fault-Tolerant**: If no local skills are found, Sentinel continues with its robust built-in rules.

## 📝 Configuration

### techStack Configuration

Your existing `techStack` in `.sentinelrc.json` is used to pick the most relevant local skills:

```json
{
  "techStack": "React, TypeScript, Node.js"
}
```

Sentinel will automatically boost the relevance of rule files like `react-best-practices.md` or `typescript.md` found in your project.

### Supported Directories

The system automatically scans:
- `.skills/`
- `.agent/skills/`
- `.cursor/rules/`
- `.sentinel/skills/`

## 🎨 Usage

### 1. Install Skills from Community

```bash
npx skills add vercel-labs/agent-skills@vercel-react-best-practices
```

### 2. Run Review

```bash
npx mp-sentinel review
```

Sentinel will detect the new skills and apply them to your audit.

## 🔄 Migration

### Backward Compatible

**None.** Version 1.0.5 is fully backward compatible with all `.sentinelrc.json` configurations.
The old fields `enableSkillsFetch` and `skillsFetchTimeout` are now deprecated and safely ignored.

## 📚 Documentation

- [Agent Skills Integration](./docs/SKILLS_INTEGRATION.md) - Comprehensive guide
- [Skills Quick Start](./docs/SKILLS_QUICK_START.md) - 5-minute setup
- [Changelog](./docs/CHANGELOG.md) - All changes in v1.0.5

## ✨ Summary

**Version**: 1.0.5  
**Release Date**: 2026-02-23  
**Status**: Production Ready

Enjoy! 🎉
