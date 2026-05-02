# 📋 Code Style Quick Reference

> Quick reference for MP Sentinel coding standards

---

## ✅ DO's

### Naming

```typescript
// Functions: camelCase, verb + noun
export const loadProjectConfig = async () => { ... };
export const parseAuditResponse = (text: string) => { ... };
export const isCodeFile = (path: string): boolean => { ... };

// Constants: SCREAMING_SNAKE_CASE
const MAX_FILE_SIZE = 500 * 1024;
const SUPPORTED_EXTENSIONS = /\.(ts|tsx|js|jsx)$/;

// Interfaces: PascalCase, descriptive
interface ProjectConfig { ... }
interface FileAuditResult { ... }
interface IAIProvider { ... }  // I prefix for interfaces that are implemented

// Types: PascalCase
type AIProvider = 'gemini' | 'openai' | 'anthropic' | 'grok';
type AuditStatus = 'PASS' | 'FAIL';
```

### Functions

```typescript
// Clear return types
export const isGitRepository = async (): Promise<boolean> => { ... };

// Descriptive parameters
export const auditFilesWithConcurrency = async (
  files: Array<{ path: string; content: string }>,
  config: ProjectConfig,
  maxConcurrency: number = 5
): Promise<FileAuditResult[]> => { ... };

// Error handling with type guards
catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown error';
  return { status: 'FAIL', message };
}
```

### Imports

```typescript
// 1. Node.js built-ins (with 'node:' prefix)
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// 2. External packages
import { GoogleGenerativeAI } from '@google/generative-ai';

// 3. Type imports (separate)
import type { ProjectConfig, AuditResult } from './types/index.js';

// 4. Internal modules (with .js extension)
import { loadProjectConfig } from './utils/config.js';
```

### Types

```typescript
// Explicit type imports
import type { IAIProvider, AIModelConfig } from './types.js';

// Union types for constrained values
export type AIProvider = 'gemini' | 'openai' | 'anthropic' | 'grok';

// Optional properties with defaults in implementation
interface Config {
  required: string;
  optional?: number;  // Default provided where used
}
```

---

## ❌ DON'Ts

```typescript
// ❌ Avoid 'any'
const processData = (data: any) => { ... };

// ❌ Avoid abbreviations
const cfg = loadConfig();
const msg = getLastCommitMessage();

// ❌ Avoid magic numbers
if (file.size > 512000) { ... }

// ❌ Avoid missing return types
export const doSomething = async () => { ... };

// ❌ Avoid missing .js extension
import { log } from './utils/logger';

// ❌ Avoid non-descriptive names
const x = await getData();
const temp = processFile(f);
```

---

## 📁 File Structure

```
src/
├── index.ts              # CLI entry point only
├── lib.ts                # Public API exports only
├── config/               # Configuration/prompt templates
├── services/             # Business logic and external services
│   ├── ai/               # AI provider integrations
│   │   ├── index.ts      # Service orchestration
│   │   ├── types.ts      # AI-specific types
│   │   ├── config.ts     # AI configuration
│   │   ├── factory.ts    # Provider factory
│   │   └── providers/    # Provider implementations
│   ├── file.ts           # File operations
│   └── git-provider.ts   # Git platform integration
├── types/                # Shared type definitions
│   └── index.ts
└── utils/                # Pure utility functions
    ├── config.ts         # Config loading
    ├── git.ts            # Git commands
    ├── logger.ts         # Console output
    └── parser.ts         # Response parsing
```

---

## 📝 Comments

```typescript
/**
 * Multi-line JSDoc for public functions
 * @param config - Project configuration
 * @returns Audit results for all files
 */
export const auditFiles = async (config: ProjectConfig): Promise<AuditResult[]> => {
  // Single line for non-obvious logic
  const filtered = files.filter(f => f.size < MAX_FILE_SIZE);
  
  return filtered.map(audit);
};

// TODO: Future enhancement - add caching
// FIXME: Handle edge case for empty files
```

---

## 🔧 Quick Commands

```bash
# Type check
npm run typecheck

# Build
npm run build

# Watch mode
npm run dev

# Run staged review
npm run review:staged
```

---

*Full guidelines: [CONTRIBUTING.md](../CONTRIBUTING.md)*
