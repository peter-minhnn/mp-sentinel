# Migration Guide: v1.0.x → v1.0.2

## 🎯 Overview

Version 1.0.2 introduces Skills.sh integration and enhanced parallel processing. This guide helps you upgrade smoothly.

## 🔄 Breaking Changes

### 1. `buildSystemPrompt()` is now async

**Before (v1.0.x):**
```typescript
const prompt = buildSystemPrompt(config);
```

**After (v1.0.2):**
```typescript
const prompt = await buildSystemPrompt(config);
```

**Impact**: If you're using `buildSystemPrompt()` directly in your code, you need to add `await`.

**Who's affected**: Only if you're importing and using this function directly. CLI users are not affected.

## ✨ New Features

### Skills.sh Integration

Automatically enabled by default. To configure:

```json
{
  "techStack": "Your tech stack here",
  "enableSkillsFetch": true,
  "skillsFetchTimeout": 3000
}
```

### Enhanced Parallel Processing

Files are now processed with `Promise.allSettled` for better error handling. No configuration needed.

## 📝 Configuration Updates

### Optional New Fields

Add to your `.sentinelrc.json`:

```json
{
  "enableSkillsFetch": true,
  "skillsFetchTimeout": 3000
}
```

**Defaults:**
- `enableSkillsFetch`: `true` (enabled by default)
- `skillsFetchTimeout`: `3000` (3 seconds)

### Backward Compatibility

Your existing `.sentinelrc.json` will work without changes. New features are opt-in by default.

## 🚀 Upgrade Steps

### Step 1: Update Package

```bash
npm install mp-sentinel@latest
# or
pnpm update mp-sentinel
# or
yarn upgrade mp-sentinel
```

### Step 2: Update Configuration (Optional)

Add skills.sh config to `.sentinelrc.json`:

```json
{
  "techStack": "TypeScript 5.7, Node.js 18, React 18",
  "enableSkillsFetch": true,
  "skillsFetchTimeout": 3000,
  "rules": [
    // Your existing rules
  ]
}
```

### Step 3: Test

```bash
# Test with verbose output
npx mp-sentinel review --range origin/main..HEAD --verbose

# Look for skills.sh logs
# ✅ Fetched X skills from skills.sh
# or
# ⚠️  Failed to fetch skills... Continuing with default prompts
```

### Step 4: Verify (Optional)

Run the demo to see skills.sh in action:

```bash
npm run demo:skills
```

## 🔧 Troubleshooting

### Issue: Skills not fetched

**Solution 1**: Check techStack is set
```json
{
  "techStack": "Your, Tech, Stack"
}
```

**Solution 2**: Increase timeout
```json
{
  "skillsFetchTimeout": 5000
}
```

**Solution 3**: Disable if not needed
```json
{
  "enableSkillsFetch": false
}
```

### Issue: Slower performance

**Solution**: Reduce timeout or disable
```json
{
  "skillsFetchTimeout": 2000,
  "enableSkillsFetch": false
}
```

### Issue: Network errors in CI/CD

**No action needed**: Skills.sh failures are graceful and won't break your pipeline.

## 📊 What's New

### Features
- ✅ Skills.sh integration for enhanced prompts
- ✅ Parallel file processing with better error handling
- ✅ Failed files are tracked and reported
- ✅ Graceful degradation when skills.sh is unavailable

### Improvements
- ⚡ Faster file processing
- 🛡️ Better error handling
- 📝 Enhanced logging
- 🎯 More accurate reviews

### Performance
- Same or better performance
- Skills are cached for 1 hour
- Parallel processing is more robust

## 🎓 Learning Resources

- [Skills.sh Quick Start](./SKILLS_QUICK_START.md)
- [Skills.sh Full Guide](./SKILLS_INTEGRATION.md)
- [Changelog](./CHANGELOG.md)

## ❓ FAQ

### Q: Do I need to change my existing config?
**A**: No, existing configs work without changes. New features are optional.

### Q: Will skills.sh slow down my CI/CD?
**A**: No, it has a 3-second timeout and fails gracefully. Your pipeline won't be affected.

### Q: What if skills.sh is down?
**A**: MP Sentinel continues with default prompts. No errors, no failures.

### Q: Can I disable skills.sh?
**A**: Yes, set `"enableSkillsFetch": false` in your config.

### Q: Do I need a skills.sh account?
**A**: No, the API is public and free to use.

### Q: What if my techStack isn't on skills.sh?
**A**: MP Sentinel will use default prompts. No errors.

## 🎉 Benefits of Upgrading

1. **Better Reviews**: Technology-specific best practices
2. **Faster Processing**: Enhanced parallel processing
3. **Better Errors**: Failed files are tracked and reported
4. **Zero Risk**: Backward compatible, graceful failures

## 📞 Support

If you encounter issues:

1. Check [Troubleshooting](#🔧-troubleshooting)
2. Read [Skills.sh Guide](./SKILLS_INTEGRATION.md)
3. Open an issue on GitHub

## ✅ Checklist

- [ ] Update to v1.0.2
- [ ] Add `techStack` to config (if not already)
- [ ] Test with `--verbose` flag
- [ ] Verify skills.sh is working (optional)
- [ ] Update CI/CD if needed (usually not required)

---

**Version**: 1.0.2  
**Release Date**: 2026-02-10  
**Migration Difficulty**: Easy (5 minutes)
