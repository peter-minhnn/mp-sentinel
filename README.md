# 🛡️ MP Sentinel: The AI-Powered Code Guardian

**Your 24/7 Virtual Technical Lead.**  
High-performance CLI tool to automate code reviews, enforce architectural patterns, and maintain clean code at scale using Generative AI.

---

## 📖 Documentation

All documentation has been moved to the `docs/` directory:

- [Main Documentation](./docs/README.md)
- [Quick Start Guide](./docs/QUICK_START.md)
- [Quick Reference Card](./docs/QUICK_REFERENCE.md)
- [Architecture Overview](./docs/ARCHITECTURE.md)
- [Code Style Guide](./docs/CODE_STYLE.md)
- [CI/CD Setup Guide](./docs/CICD_SETUP.md)
- [Provider Comparison](./docs/PROVIDER_COMPARISON.md)
- [Network Efficiency](./docs/NETWORK_EFFICIENCY.md)
- [Create Skills Guide](./docs/CREATE_SKILLS.md)
- [Local Skills Integration](./docs/SKILLS_INTEGRATION.md)
- [Skills Quick Start](./docs/SKILLS_QUICK_START.md)
- [Migration Guide (v1.0.4)](./docs/MIGRATION_1.0.4.md)
- [Version Guide & Installation](./docs/VERSION_GUIDE.md)
- [Contributing Guidelines](./docs/CONTRIBUTING.md)
- [Commands Cheat Sheet](./docs/COMMANDS_CHEAT_SHEET.md)
- [![NPM Version](https://img.shields.io/badge/npm-v1.7.1-blue?style=flat-square)](https://www.npmjs.com/package/mp-sentinel)
- [Changelog](./docs/CHANGELOG.md)

---

## ⚡ Quick Start

```bash
npx mp-sentinel
```

For detailed usage and configuration, please refer to the [Full Documentation](./docs/README.md).

> 💡 **Having trouble with `npm install`?** Check our [Version & Installation Guide](./docs/VERSION_GUIDE.md) for troubleshooting, alternative registries, or **offline installation** using the `.tgz` package. 

---

## 🆕 What's New

See [WHATS_NEW.md](./WHATS_NEW.md) for the latest features in **v1.7.1**:

- 🔎 **Explain Agent Detection** — `create-skills --explain-agents` shows exactly which agents are detected, why, and where files would be generated
- 🤖 **Agent Skills Bootstrap** — `npm run agent:skills:check` / `agent:skills:refresh` keeps generated skills current before coding
- 🔍 **Review Intelligence Explainability** — structured signal metadata explaining why each review signal was raised
- 📋 **`--explain-context` JSON** — full diagnostic transparency for context building
- 🧪 **Regression Coverage** — comprehensive fixture tests for review intelligence and indexing
- ✓ **Full Verification** — all 422 tests pass across 14 suites, `release:check` and `dogfood` pass successfully
- 🎯 **Agent Skills Integration** — inject local ecosystem rules (like `.cursor/rules` or `.claude/skills/`)
- ⚡ **100% Offline & Secure** — No network dependence for rule fetching during auditing.
- 🛡️ **Security Layers** — File filtering, secret scrubbing, payload transparency
- 🔍 **Local Review Mode** — Review commits without CI/CD pipelines
