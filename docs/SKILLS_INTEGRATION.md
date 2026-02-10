# Skills.sh Integration

MP Sentinel integrates with [skills.sh](https://skills.sh/) to automatically enhance code review prompts based on your project's technology stack.

## Overview

When enabled, MP Sentinel will:
1. Parse your `techStack` from `.sentinelrc.json`
2. Fetch relevant best practices and guidelines from skills.sh
3. Integrate them into the AI review prompts
4. **Fail gracefully** if skills.sh is unavailable (no retry, continues with default prompts)

## Configuration

Add these fields to your `.sentinelrc.json`:

```json
{
  "techStack": "TypeScript 5.7, Node.js 18 (ESM), React 18, PostgreSQL 15",
  "enableSkillsFetch": true,
  "skillsFetchTimeout": 3000,
  "rules": [
    "Your project-specific rules..."
  ]
}
```

### Configuration Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `techStack` | `string` | `""` | Comma-separated list of technologies used in your project |
| `enableSkillsFetch` | `boolean` | `true` | Enable/disable skills.sh integration |
| `skillsFetchTimeout` | `number` | `3000` | Timeout for skills.sh API calls (milliseconds) |

## How It Works

### 1. Technology Parsing

MP Sentinel automatically parses your `techStack` string:

```
Input:  "TypeScript 5.7, Node.js 18 (ESM), tsup (esbuild)"
Output: ["typescript", "nodejs", "esm", "tsup", "esbuild"]
```

Version numbers and special characters are automatically removed.

### 2. Skills Fetching

The system fetches relevant skills from skills.sh API:

```typescript
GET https://skills.sh/api/skills?tech=typescript&tech=nodejs&tech=esm&limit=10
```

### 3. Prompt Enhancement

Fetched skills are integrated into the review prompt:

```
### TECHNOLOGY-SPECIFIC BEST PRACTICES (from skills.sh)

#### TYPESCRIPT
- **Type Safety**: Always use explicit types, avoid 'any'
- **Strict Mode**: Enable strict mode in tsconfig.json

#### NODEJS
- **Error Handling**: Use try-catch for async operations
- **Performance**: Use streams for large file operations
```

### 4. Fail-Fast Pattern

**CRITICAL**: If skills.sh is unavailable:
- ✅ No retry attempts
- ✅ No errors thrown
- ✅ Continues with default prompts
- ✅ Logs warning message

This ensures your CI/CD pipeline never fails due to external API issues.

## Performance

### Caching

Skills are cached in-memory for 1 hour to minimize API calls:

```typescript
const CACHE_TTL = 3600000; // 1 hour
```

### Timeout

Default timeout is 3 seconds (configurable):

```typescript
const FETCH_TIMEOUT = 3000; // 3 seconds
```

### Parallel Processing

Skills fetching happens in parallel with file reading for optimal performance.

## Examples

### Example 1: Full Stack JavaScript

```json
{
  "techStack": "TypeScript, Node.js, React, PostgreSQL, Redis",
  "enableSkillsFetch": true
}
```

Will fetch skills for:
- TypeScript best practices
- Node.js patterns
- React component guidelines
- PostgreSQL query optimization
- Redis caching strategies

### Example 2: Python Backend

```json
{
  "techStack": "Python 3.11, FastAPI, SQLAlchemy, PostgreSQL",
  "enableSkillsFetch": true
}
```

Will fetch skills for:
- Python coding standards
- FastAPI best practices
- SQLAlchemy patterns
- Database optimization

### Example 3: Disabled

```json
{
  "techStack": "TypeScript, Node.js",
  "enableSkillsFetch": false
}
```

Skills.sh integration is disabled, uses only default prompts.

## API Response Format

Expected response from skills.sh API:

```json
{
  "skills": [
    {
      "name": "Type Safety",
      "category": "typescript",
      "prompt": "Always use explicit types, avoid 'any'",
      "relevance": 0.95
    },
    {
      "name": "Error Handling",
      "category": "nodejs",
      "prompt": "Use try-catch for async operations",
      "relevance": 0.90
    }
  ]
}
```

## Error Handling

### Network Errors

```
⚠️  Failed to fetch skills from skills.sh: Network timeout. Continuing with default prompts.
```

### API Errors

```
⚠️  Skills.sh API returned 503. Continuing with default prompts.
```

### Parse Errors

```
⚠️  Could not parse technologies from techStack. Continuing with default prompts.
```

## Testing

### Clear Cache

```typescript
import { clearSkillsCache } from './services/skills-fetcher.js';

clearSkillsCache();
```

### Manual Testing

```bash
# Test with skills.sh enabled
npx mp-sentinel --local --verbose

# Test with skills.sh disabled
# Edit .sentinelrc.json: "enableSkillsFetch": false
npx mp-sentinel --local --verbose
```

## Best Practices

1. **Keep techStack Updated**: Regularly update your `techStack` as your project evolves
2. **Be Specific**: Include major versions for better skill matching
3. **Monitor Logs**: Check verbose output to see which skills are fetched
4. **Test Offline**: Ensure your CI/CD works even when skills.sh is down

## Troubleshooting

### Skills Not Fetched

Check:
1. `enableSkillsFetch` is `true` (or not set, defaults to `true`)
2. `techStack` is properly formatted
3. Network connectivity to skills.sh
4. Timeout is sufficient (increase `skillsFetchTimeout` if needed)

### Slow Performance

Solutions:
1. Reduce `skillsFetchTimeout` (default: 3000ms)
2. Disable skills.sh: `"enableSkillsFetch": false`
3. Check network latency

### Cache Issues

Clear cache:
```typescript
import { clearSkillsCache } from './services/skills-fetcher.js';
clearSkillsCache();
```

## Integration with CI/CD

Skills.sh integration works seamlessly in CI/CD:

```yaml
# GitHub Actions
- name: Run MP Sentinel
  run: npx mp-sentinel
  env:
    AI_PROVIDER: gemini
    GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
```

Even if skills.sh is unavailable, your pipeline continues without failure.

## Future Enhancements

Planned features:
- [ ] Custom skills.sh API endpoint
- [ ] Local skills database fallback
- [ ] Skills priority/weighting
- [ ] Skills filtering by category
- [ ] Skills versioning support
