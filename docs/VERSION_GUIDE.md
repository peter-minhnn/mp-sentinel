# 📦 Versions & Installation Guide

This document provides detailed instructions on **MP Sentinel** versions and how to troubleshoot errors encountered during `npm` installation.

---

## 🚀 Available Versions

You can install a specific version by adding `@version` after the package name.

| Version | Status | Notes | Installation Command |
| :--- | :--- | :--- | :--- |
| **1.0.6** | `Latest` | Critical fixes for Local Review by commit and improved interactive selection logic. | `npm install -g mp-sentinel@1.0.6` |
| **1.0.5** | `Stable` | Offline agent skills integration, smarter techStack matching, and performance boost. | `npm install -g mp-sentinel@1.0.5` |
| **1.0.4** | `Stable` | Interactive local review, auto-fetch syncing, and mixed uncommitted audits. | `npm install -g mp-sentinel@1.0.4` |
| **1.0.3** | `Legacy` | Version synchronization, build improvements, and Prettier integration. | `npm install -g mp-sentinel@1.0.3` |
| **1.0.2** | `Legacy` | Skills.sh integration, enhanced parallel processing, 3-layer security. | `npm install -g mp-sentinel@1.0.2` |
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

## 📥 Manual Download & Local Installation

If you cannot use `npm` to install from the public registry (e.g., due to strict firewall or company proxies), you have two options:

### Option A: Install from Tarball (Recommended for corporate environments)

1. Download the `.tgz` package (e.g., `mp-sentinel-1.0.6.tgz`) from [GitHub Releases](https://github.com/peter-minhnn/mp-sentinel/releases).
2. Install it locally:
```bash
npm install -g ./packages/v1.0.6/mp-sentinel-1.0.6.tgz
```
*This method is identical to a standard npm install but doesn't require an active connection to npmjs.org.*

### Option B: Build from Source

1. Download the `.zip` or `.tar.gz` source code of the desired version.
2. Extract it and navigate into the project directory.
3. Run the following commands:

```bash
npm install
npm run build
npm link
```
