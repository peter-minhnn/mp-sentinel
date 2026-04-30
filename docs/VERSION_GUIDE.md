# 📦 Versions & Installation Guide

This document provides detailed instructions on **MP Sentinel** versions and how to troubleshoot errors encountered during `npm` installation.

---

## 🚀 Available Versions

You can install a specific version by adding `@version` after the package name.

```bash
# Install the latest version
npm install -g mp-sentinel@latest

# Install a specific version
npm install -g mp-sentinel@1.28.0
```

For a full list of available versions and their release notes, see:
- [npm registry](https://www.npmjs.com/package/mp-sentinel)
- [WHATS_NEW.md](../WHATS_NEW.md)
- [Changelog](./CHANGELOG.md)

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
# Example: Revert to a previous version
npm install -g mp-sentinel@1.27.0
```

---

## 📥 Manual Download & Local Installation

If you cannot use `npm` to install from the public registry (e.g., due to strict firewall or company proxies), you have two options:

### Option A: Install from Tarball (Recommended for corporate environments)

1. Download the `.tgz` package from [GitHub Releases](https://github.com/peter-minhnn/mp-sentinel/releases).
2. Install it locally:
```bash
npm install -g ./mp-sentinel-x.y.z.tgz
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
