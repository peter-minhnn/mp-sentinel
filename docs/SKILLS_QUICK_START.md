# Skills.sh Integration - Quick Start

## 🚀 5-Minute Setup

### Step 1: Update Configuration

Add to your `.sentinelrc.json`:

```json
{
  "techStack": "Your, Tech, Stack, Here",
  "enableSkillsFetch": true,
  "skillsFetchTimeout": 3000
}
```

### Step 2: Run Review

```bash
npx mp-sentinel --local
```

That's it! Skills will be automatically fetched and integrated.

## 📋 Common TechStack Examples

### JavaScript/TypeScript
```json
{
  "techStack": "TypeScript 5.7, Node.js 18, React 18, Next.js 14"
}
```

### Python
```json
{
  "techStack": "Python 3.11, FastAPI, SQLAlchemy, PostgreSQL"
}
```

### Go
```json
{
  "techStack": "Go 1.21, Gin, GORM, Redis, PostgreSQL"
}
```

### Java
```json
{
  "techStack": "Java 17, Spring Boot 3, Hibernate, MySQL"
}
```

### Full Stack
```json
{
  "techStack": "TypeScript, React, Node.js, Express, PostgreSQL, Redis, Docker"
}
```

## ⚙️ Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enableSkillsFetch` | boolean | `true` | Enable skills.sh integration |
| `skillsFetchTimeout` | number | `3000` | Timeout in milliseconds |

## 🔍 Verify It's Working

Run with verbose flag:

```bash
npx mp-sentinel --local --verbose
```

Look for these log messages:

```
✅ Fetching skills from skills.sh for: typescript, nodejs, react
✅ Fetched 8 skills from skills.sh
```

Or if it fails (which is OK):

```
⚠️  Failed to fetch skills from skills.sh: timeout. Continuing with default prompts.
```

## 🚫 Disable Skills.sh

If you don't want skills.sh integration:

```json
{
  "enableSkillsFetch": false
}
```

## 🐛 Troubleshooting

### Skills not fetched?

1. Check `techStack` is set in `.sentinelrc.json`
2. Check network connectivity
3. Increase timeout: `"skillsFetchTimeout": 5000`

### Slow performance?

1. Reduce timeout: `"skillsFetchTimeout": 2000`
2. Or disable: `"enableSkillsFetch": false`

### Want to see what's happening?

Use verbose mode:

```bash
npx mp-sentinel --local --verbose
```

## 📚 Learn More

- [Full Documentation](./SKILLS_INTEGRATION.md)
- [Configuration Guide](./README.md#⚙️-configuration-sentinelrcjson)
- [Examples](../examples/skills-demo.ts)

## 💡 Pro Tips

1. **Be Specific**: Include versions for better matching
   ```json
   "techStack": "React 18, TypeScript 5.7"
   ```

2. **Keep Updated**: Update techStack as your project evolves

3. **Test Offline**: Ensure your CI/CD works even when skills.sh is down

4. **Use Cache**: Skills are cached for 1 hour automatically

5. **Monitor Logs**: Check verbose output to see which skills are fetched
