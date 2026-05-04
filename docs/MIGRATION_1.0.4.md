# Migration Guide: v1.0.3 → v1.0.4

## 🎯 Overview

Version 1.0.4 introduces major enhancements to **Local Review Mode**, making it a first-class citizen alongside CI/CD workflows. This version focuses on developer experience (DX), interactivity, and smarter synchronization.

## 🔄 Breaking Changes

**None.** Version 1.0.4 preserved the existing project config format and did not require a migration.

## ✨ New Features

### 1. Interactive Commit Picker
Hand-pick which commits to review using a terminal UI. Useful for giant branches where you only want to focus on specific logical changes.
```bash
npx mp-sentinel --local --interactive
```

### 2. Mixed Uncommitted Mode
Bridge the gap between your workspace and your history. Review your active changes (including unstaged files) along with your branch history.
```bash
npx mp-sentinel --local --include-uncommitted
```

### 3. Auto-Fetch Context
Eliminate stale branch comparisons. Automatically sync with `origin` before detecting the merge-base.
```bash
npx mp-sentinel --local --branch-diff --fetch
```

### 4. Verbose Dry-Run
Get a per-file token breakdown to understand exactly what is consuming your AI quota.
```bash
npx mp-sentinel --verbose-dry-run
```

## 🚀 Upgrade Steps

### Step 1: Update Package
Update your global or local installation:
```bash
npm install -g mp-sentinel@latest
# or
npm install mp-sentinel@1.0.4
```

### Step 2: Use New Flags
Try the new local workflow:
```bash
npx mp-sentinel --local -i --include-uncommitted
```

## 📊 Summary of Changes
- ✅ **New Guide**: Added `docs/COMMANDS_CHEAT_SHEET.md`.
- ✅ **Secure Local Review**: Security scrubbing and file ignores now applied to local commits.
- ✅ **Token Guard**: More accurate estimations in dry-run mode.

---

**Version**: 1.0.4  
**Release Date**: 2026-02-22  
**Migration Difficulty**: Zero (Fully Compatible)
