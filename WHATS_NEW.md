# 🎉 What's New in v1.0.6

## 🚀 Improvements & Fixes

### 1. Robust Local Review by Commit 🎯

Fixed a critical path in Local Review mode where specifying a specific commit SHA using `--commit <hash>` was being ignored in favor of the default HEAD commit. Now, you can precisely review any historical commit directly on your branch.

### 2. Enhanced Interactive Experience ⚡

We've improved the interactive commit picker (`-i, --interactive`):
- **Dynamic Defaults**: Removed the restrictive 1-commit default. The picker now smartly defaults to showing the last 15 commits for selection when no specific count is provided.
- **Improved UX**: Better handling of selection states when browsing multiple commits.

### 3. CLI Logic Synchronization 🔄

Code paths for parsing review targets and commit counts have been unified across the core engine. This ensures that whether you are running in CI/CD mode or Local mode, the arguments behave predictably and honor your configuration files.

## 🔄 Migration

### Backward Compatible

**Full compatibility.** Version 1.0.6 is a maintenance release focused on stability and fixing logical edge cases in Local Review mode. No configuration changes are required.

## 📚 Documentation

- [Commands Cheat Sheet](./docs/COMMANDS_CHEAT_SHEET.md) - Updated with more examples
- [Changelog](./docs/CHANGELOG.md) - Detailed technical changes

## ✨ Summary

**Version**: 1.0.6  
**Release Date**: 2026-02-23  
**Status**: Stable

Enjoy! 🎉
