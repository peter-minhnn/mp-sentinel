# 📦 Versions & Installation Guide

This document provides detailed instructions on **MP Sentinel** versions and how to troubleshoot errors encountered during `npm` installation.

---

## 🚀 Available Versions

You can install a specific version by adding `@version` after the package name.

| Version | Status | Notes | Installation Command |
| :--- | :--- | :--- | :--- |
| **1.0.3** | `Latest` | Version synchronization, build improvements, and Prettier integration. | `npm install -g mp-sentinel@1.0.3` |
| **1.0.2** | `Stable` | Skills.sh integration, enhanced parallel processing, 3-layer security. | `npm install -g mp-sentinel@1.0.2` |
| **1.0.1** | `Legacy` | Added Branch Diff Mode, improved commit pattern matching. | `npm install -g mp-sentinel@1.0.1` |
| **1.0.0** | `Legacy` | Initial version with multi-provider AI support. | `npm install -g mp-sentinel@1.0.0` |

---

## 🛠️ Troubleshooting `npm install` Failures

If you encounter errors (Timeout, 403, 500, or slow connection) during installation, try the following methods:

### 1. Use an Alternative Registry (for slow connection areas)

```bash
# Use China registry (common when international networks are slow)
npm install -g mp-sentinel --registry=https://registry.npmmirror.com
```

### 2. Clean Cache and Reinstall

```bash
npm cache clean --force
npm install -g mp-sentinel@latest
```

### 3. Install Directly from GitHub (If npmjs.com has issues)

```bash
npm install -g https://github.com/peter-minhnn/mp-sentinel.git
```

---

## 🔄 Upgrade & Downgrade

### How to Upgrade

To update to the latest version:

```bash
npm update -g mp-sentinel
# Or overwrite with the latest version
npm install -g mp-sentinel@latest
```

### How to Downgrade

If a new version has compatibility issues with your system, you can revert to an older version:

```bash
# Example: Revert to version 1.0.1
npm install -g mp-sentinel@1.0.1
```

---

## 📥 Manual Download

If you cannot use `npm`, you can download the source code from [GitHub Releases](https://github.com/peter-minhnn/mp-sentinel/releases) and run it directly:

1. Download the `.zip` or `.tar.gz` file of the desired version.
2. Extract it and navigate into the project directory.
3. Run the following commands:

```bash
npm install
npm run build
npm link
```
