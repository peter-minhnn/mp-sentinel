# 🤝 Contributing to MP Sentinel

> **Welcome, Contributor!**  
> Thank you for your interest in making MP Sentinel even better. This guide provides comprehensive best practices, clean code standards, and network efficiency guidelines for contributors.

[![NPM Version](https://img.shields.io/badge/npm-v1.0.1-blue?style=flat-square)](https://www.npmjs.com/package/mp-sentinel)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-blue?style=flat-square)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green?style=flat-square)](https://nodejs.org/)

---

## 📑 Table of Contents

1. [Project Overview](#-project-overview)
2. [Architecture & Design Patterns](#-architecture--design-patterns)
3. [Development Setup](#-development-setup)
4. [Clean Code Guidelines](#-clean-code-guidelines)
5. [Network Efficiency Best Practices](#-network-efficiency-best-practices)
6. [File Structure Standards](#-file-structure-standards)
7. [TypeScript Standards](#-typescript-standards)
8. [Testing Guidelines](#-testing-guidelines)
9. [Adding New AI Providers](#-adding-new-ai-providers)
10. [Git Workflow](#-git-workflow)
11. [Pull Request Process](#-pull-request-process)

---

## 🏗️ Project Overview

MP Sentinel is a high-performance CLI tool for AI-powered code auditing. It supports multiple AI providers (Gemini, OpenAI, Anthropic) and operates in two modes:

- **CI/CD Mode**: Integrates with GitHub Actions and GitLab CI/CD
- **Local Review Mode**: Runs directly on branches for local commit review

### Technology Stack

| Component | Technology |
|-----------|------------|
| Language | TypeScript 5.7+ |
| Runtime | Node.js 18+ |
| Module System | ESM (ECMAScript Modules) |
| Build Tool | tsup (esbuild-based) |
| Package Manager | npm |

---

## 🏛️ Architecture & Design Patterns

### Directory Structure

```
mp-sentinel/
├── src/
│   ├── index.ts              # CLI entry point (main runner)
│   ├── lib.ts                # Public API exports (for library usage)
│   ├── config/
│   │   └── prompts.ts        # AI prompt templates
│   ├── services/
│   │   ├── ai/               # Multi-provider AI service
│   │   │   ├── index.ts      # Service orchestration
│   │   │   ├── types.ts      # AI-specific types
│   │   │   ├── config.ts     # AI configuration management
│   │   │   ├── factory.ts    # Provider factory (Strategy Pattern)
│   │   │   └── providers/    # Provider implementations
│   │   │       ├── gemini.provider.ts
│   │   │       ├── openai.provider.ts
│   │   │       └── anthropic.provider.ts
│   │   ├── ai.ts             # Legacy exports (backward compatibility)
│   │   ├── file.ts           # File operations service
│   │   └── git-provider.ts   # GitHub/GitLab integration
│   ├── types/
│   │   └── index.ts          # Core type definitions
│   └── utils/
│       ├── config.ts         # Project configuration loader
│       ├── git.ts            # Git command utilities
│       ├── logger.ts         # Console output with colors
│       └── parser.ts         # AI response parsing
├── docs/                     # Documentation
├── examples/                 # Usage examples
├── dist/                     # Compiled output (auto-generated)
├── package.json
├── tsconfig.json
└── tsup.config.ts            # Build configuration
```

### Design Patterns Used

| Pattern | Location | Purpose |
|---------|----------|---------|
| **Factory** | `src/services/ai/factory.ts` | Creates AI providers based on configuration |
| **Strategy** | `src/services/ai/providers/` | Interchangeable AI provider implementations |
| **Singleton** | `src/services/ai/index.ts` | Single provider instance per lifecycle |
| **Dependency Injection** | Throughout | Configuration via environment variables |

---

## 🛠️ Development Setup

### Prerequisites

- Node.js 18.0.0 or higher
- npm 9.0.0 or higher
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/peter-minhnn/mp-sentinel.git
cd mp-sentinel

# Install dependencies
npm install

# Create environment file
cp .env.example .env
# Edit .env with your API keys
```

### Development Commands

```bash
# Build the project
npm run build

# Watch mode for development
npm run dev

# Type checking only
npm run typecheck

# Run the CLI locally
npm start

# Run demo examples
npm run demo
```

---

## ✨ Clean Code Guidelines

### 1. Naming Conventions

```typescript
// ✅ Good: Semantic, descriptive names
const auditFilesWithConcurrency = async (files: FileInput[]) => { ... };
const isGitRepository = async (): Promise<boolean> => { ... };
const MAX_FILE_SIZE = 500 * 1024; // Named constant

// ❌ Bad: Abbreviations, unclear names
const afc = async (f: any[]) => { ... };
const igr = async () => { ... };
const size = 512000; // Magic number
```

### 2. Function Design

```typescript
// ✅ Good: Single Responsibility, clear purpose
export const parseAuditResponse = (responseText: string): AuditResult => {
  const cleaned = cleanJSON(responseText);
  try {
    const parsed = JSON.parse(cleaned) as AuditResult;
    return validateAuditResult(parsed);
  } catch {
    return createErrorResult('Failed to parse AI response');
  }
};

// ✅ Good: Small, focused functions with clear return types
export const isCodeFile = (filePath: string): boolean => {
  const codeExtensions = new Set([
    'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
    'py', 'cs', 'go', 'java', 'rs', 'kt', 'swift',
  ]);
  return codeExtensions.has(getFileExtension(filePath));
};

// ❌ Bad: Functions doing too many things
export const processEverything = async (input: any) => {
  // 200+ lines of mixed logic
};
```

### 3. Error Handling

```typescript
// ✅ Good: Explicit error handling with informative messages
export const loadProjectConfig = async (cwd: string = process.cwd()): Promise<ProjectConfig> => {
  const configPath = resolve(cwd, '.sentinelrc.json');
  
  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const content = await readFile(configPath, 'utf-8');
    const userConfig = JSON.parse(content) as Partial<ProjectConfig>;
    return { ...DEFAULT_CONFIG, ...userConfig };
  } catch (error) {
    console.warn('⚠️  Found .sentinelrc.json but failed to parse it.');
    return { ...DEFAULT_CONFIG };
  }
};

// ✅ Good: Type-safe error handling
catch (error) {
  return {
    status: 'FAIL',
    message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    issues: [],
  };
}
```

### 4. Immutability & Pure Functions

```typescript
// ✅ Good: Pure function, no side effects
const parseAndFilterFiles = (output: string, extensions: RegExp): string[] => {
  return output
    .split('\n')
    .map(file => file.trim())
    .filter(file => file.length > 0)
    .filter(file => extensions.test(file));
};

// ✅ Good: Immutable data handling
const mergeConfig = (defaults: Config, custom: Partial<Config>): Config => ({
  ...defaults,
  ...custom,
});
```

### 5. Documentation

```typescript
/**
 * Audit multiple files with concurrency control
 * @param files - Array of files with path and content
 * @param config - Project configuration
 * @param maxConcurrency - Maximum parallel audits (default: 5)
 * @returns Promise resolving to array of audit results
 * 
 * @example
 * const results = await auditFilesWithConcurrency(
 *   [{ path: 'src/index.ts', content: '...' }],
 *   config,
 *   5
 * );
 */
export const auditFilesWithConcurrency = async (
  files: Array<{ path: string; content: string }>,
  config: ProjectConfig,
  maxConcurrency: number = 5
): Promise<FileAuditResult[]> => {
  // Implementation
};
```

---

## 🌐 Network Efficiency Best Practices

### 1. Connection Pooling & Reuse

```typescript
// ✅ Good: Singleton pattern reuses HTTP connections
let providerInstance: IAIProvider | null = null;

const getProvider = (): IAIProvider => {
  if (providerInstance) {
    return providerInstance; // Reuse existing instance
  }
  
  const config = AIConfig.fromEnvironment();
  providerInstance = AIProviderFactory.createProvider(config);
  return providerInstance;
};

// ✅ Good: Clear cache only when necessary
export const clearProviderCache = (): void => {
  providerInstance = null;
};
```

### 2. Batch Processing with Concurrency Control

```typescript
// ✅ Good: Process files in controlled batches
export const auditFilesWithConcurrency = async (
  files: Array<{ path: string; content: string }>,
  config: ProjectConfig,
  maxConcurrency: number = 5  // Configurable limit
): Promise<FileAuditResult[]> => {
  const results: FileAuditResult[] = [];
  
  // Process in batches to avoid overwhelming the API
  for (let i = 0; i < files.length; i += maxConcurrency) {
    const batch = files.slice(i, i + maxConcurrency);
    
    const batchPromises = batch.map(async (file) => {
      const startTime = performance.now();
      const result = await auditFile(file.path, file.content, systemPrompt);
      return {
        filePath: file.path,
        result,
        duration: performance.now() - startTime,
      };
    });

    // Wait for batch to complete before starting next
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }
  
  return results;
};
```

### 3. Request Optimization

```typescript
// ✅ Good: Minimal payload in API requests
const response = await fetch(this.baseURL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${this.apiKey}`,
  },
  body: JSON.stringify({
    model: this.model,
    messages,
    temperature: this.temperature,
    max_tokens: this.maxTokens,
  }),
});

// ✅ Good: Early validation to avoid unnecessary requests
if (!this.token || !this.owner || !this.repo || !this.prNumber) {
  log.warning('Skipping GitHub comment: Invalid context.');
  return; // Don't make the request
}
```

### 4. File Size Limits

```typescript
// ✅ Good: Prevent processing oversized files
const MAX_FILE_SIZE = 500 * 1024; // 500KB limit

export const readFilesForAudit = async (filePaths: string[]): Promise<FileReadResult> => {
  const readPromises = filePaths.map(async (filePath): Promise<FileReadItem> => {
    const stats = await stat(absolutePath);
    
    // Skip files that are too large
    if (stats.size > MAX_FILE_SIZE) {
      return { 
        path: filePath, 
        skipped: true, 
        reason: `File too large (${formatBytes(stats.size)})` 
      };
    }
    
    // Read only files within size limits
    const content = await readFile(absolutePath, 'utf-8');
    return { path: filePath, content, size: stats.size, skipped: false };
  });
  
  return Promise.all(readPromises);
};
```

### 5. Async/Await with Promisified APIs

```typescript
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

// ✅ Good: Promisify for async/await compatibility
const execAsync = promisify(exec);

export const getLastCommitMessage = async (): Promise<string> => {
  try {
    const { stdout } = await execAsync('git log -1 --pretty=%B');
    return stdout.trim();
  } catch {
    return '';
  }
};
```

### 6. Parallel Operations for Independent Tasks

```typescript
// ✅ Good: Parallel file reads (no dependencies between files)
const readPromises = filePaths.map(async (filePath) => {
  // Each file read is independent
  return readFile(filePath, 'utf-8');
});

const results = await Promise.all(readPromises);

// ✅ Good: Parallel git operations
const [commitMsg, changedFiles, currentBranch] = await Promise.all([
  getLastCommitMessage(),
  getChangedFiles({ targetBranch }),
  getCurrentBranch(),
]);
```

### 7. Response Caching (Future Enhancement)

```typescript
// Pattern for implementing response caching
interface CacheEntry {
  result: AuditResult;
  timestamp: number;
  hash: string;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 3600000; // 1 hour

const getCachedResult = (contentHash: string): AuditResult | null => {
  const entry = cache.get(contentHash);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.result;
  }
  return null;
};
```

---

## 📁 File Structure Standards

### Module Organization

```typescript
// ✅ Good: Clear exports in index files
// src/types/index.ts
export interface ProjectConfig { ... }
export interface AuditResult { ... }
export const DEFAULT_CONFIG: ProjectConfig = { ... };

// ✅ Good: Separate public API from internal implementation
// src/lib.ts - Public API (for library consumers)
export { loadProjectConfig } from './utils/config.js';
export { auditFilesWithConcurrency } from './services/ai.js';

// src/index.ts - CLI entry point (internal)
import { loadProjectConfig } from './utils/config.js';
```

### Import Order

```typescript
// 1. Node.js built-in modules
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// 2. External dependencies
import * as dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

// 3. Internal types
import type { ProjectConfig, AuditResult } from './types/index.js';

// 4. Internal modules
import { loadProjectConfig } from './utils/config.js';
import { log } from './utils/logger.js';
```

### Extension Requirements

```typescript
// ✅ Required: Use .js extension in imports for ESM compatibility
import { log } from './utils/logger.js';
import type { AIProvider } from './types.js';

// ❌ Will fail: Missing extension
import { log } from './utils/logger';
```

---

## 📝 TypeScript Standards

### Strict Type Configuration

The project uses strict TypeScript settings (see `tsconfig.json`):

| Option | Value | Purpose |
|--------|-------|---------|
| `strict` | `true` | Enable all strict type checks |
| `noUncheckedIndexedAccess` | `true` | Require null checks for array access |
| `exactOptionalPropertyTypes` | `true` | Strict optional property handling |
| `noImplicitReturns` | `true` | All code paths must return |
| `verbatimModuleSyntax` | `true` | Explicit import/export types |

### Type Imports

```typescript
// ✅ Good: Use 'import type' for type-only imports
import type { ProjectConfig, AuditResult } from './types/index.js';
import type { IAIProvider, AIModelConfig } from './types.js';

// ✅ Good: Mixed imports
import { parseArgs } from 'node:util';
import type { ParseArgsConfig } from 'node:util';
```

### Interface Design

```typescript
// ✅ Good: Clear, focused interfaces
export interface IAIProvider {
  generateContent(systemPrompt: string, userPrompt: string): Promise<string>;
  isAvailable(): boolean;
}

// ✅ Good: Union types for constrained values
export type AIProvider = 'gemini' | 'openai' | 'anthropic';
export type AuditStatus = 'PASS' | 'FAIL';
export type IssueSeverity = 'CRITICAL' | 'WARNING' | 'INFO';

// ✅ Good: Optional properties with defaults
export interface AIModelConfig {
  provider: AIProvider;
  model: string;
  apiKey: string;
  temperature?: number;  // Optional with default in implementation
  maxTokens?: number;    // Optional with default in implementation
}
```

---

## 🧪 Testing Guidelines

### Unit Test Structure

```typescript
// Pattern for unit tests
import { describe, it, expect, beforeEach } from 'vitest';
import { parseAuditResponse } from './parser.js';

describe('parseAuditResponse', () => {
  it('should parse valid JSON response', () => {
    const response = '{"status": "PASS", "issues": []}';
    const result = parseAuditResponse(response);
    
    expect(result.status).toBe('PASS');
    expect(result.issues).toEqual([]);
  });

  it('should handle markdown-wrapped JSON', () => {
    const response = '```json\n{"status": "PASS"}\n```';
    const result = parseAuditResponse(response);
    
    expect(result.status).toBe('PASS');
  });

  it('should return FAIL for invalid JSON', () => {
    const response = 'not valid json';
    const result = parseAuditResponse(response);
    
    expect(result.status).toBe('FAIL');
  });
});
```

### Mock Providers for Testing

```typescript
// Create mock provider for testing without API calls
class MockAIProvider implements IAIProvider {
  private response: string;

  constructor(mockResponse: string = '{"status":"PASS"}') {
    this.response = mockResponse;
  }

  async generateContent(system: string, user: string): Promise<string> {
    return this.response;
  }

  isAvailable(): boolean {
    return true;
  }
}

// Usage in tests
const mockProvider = new MockAIProvider('{"status":"FAIL","issues":[]}');
```

---

## 🔌 Adding New AI Providers

### Step-by-Step Guide

#### 1. Create Provider Class

```typescript
// src/services/ai/providers/newai.provider.ts
import type { IAIProvider, AIModelConfig } from '../types.js';

interface NewAIMessage {
  role: 'system' | 'user';
  content: string;
}

interface NewAIResponse {
  output: string;
}

export class NewAIProvider implements IAIProvider {
  private apiKey: string;
  private model: string;
  private temperature: number;
  private maxTokens: number;
  private baseURL = 'https://api.newai.com/v1/generate';

  constructor(config: AIModelConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.temperature = config.temperature ?? 0.2;
    this.maxTokens = config.maxTokens ?? 8192;
  }

  async generateContent(systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await fetch(this.baseURL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        system: systemPrompt,
        prompt: userPrompt,
        temperature: this.temperature,
        max_tokens: this.maxTokens,
      }),
    });

    if (!response.ok) {
      throw new Error(`NewAI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as NewAIResponse;
    return data.output || '';
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }
}
```

#### 2. Update Types

```typescript
// src/services/ai/types.ts
export type AIProvider = 'gemini' | 'openai' | 'anthropic' | 'newai';
```

#### 3. Register in Factory

```typescript
// src/services/ai/factory.ts
import { NewAIProvider } from './providers/newai.provider.js';

export class AIProviderFactory {
  static createProvider(config: AIModelConfig): IAIProvider {
    switch (config.provider) {
      case 'gemini':
        return new GeminiProvider(config);
      case 'openai':
        return new OpenAIProvider(config);
      case 'anthropic':
        return new AnthropicProvider(config);
      case 'newai':  // Add new provider
        return new NewAIProvider(config);
      default:
        throw new Error(`Unsupported AI provider: ${config.provider}`);
    }
  }

  static getDefaultModel(provider: AIProvider): string {
    const defaults: Record<AIProvider, string> = {
      gemini: 'gemini-2.5-flash',
      openai: 'gpt-4o',
      anthropic: 'claude-sonnet-4.5',
      newai: 'newai-pro',  // Add default model
    };
    return defaults[provider];
  }
}
```

#### 4. Update Config

```typescript
// src/services/ai/config.ts
private static getApiKey(provider: AIProvider): string | undefined {
  switch (provider) {
    case 'gemini':
      return process.env.GEMINI_API_KEY;
    case 'openai':
      return process.env.OPENAI_API_KEY;
    case 'anthropic':
      return process.env.ANTHROPIC_API_KEY;
    case 'newai':  // Add API key mapping
      return process.env.NEWAI_API_KEY;
    default:
      return undefined;
  }
}

private static getApiKeyEnvName(provider: AIProvider): string {
  const names: Record<AIProvider, string> = {
    gemini: 'GEMINI_API_KEY',
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    newai: 'NEWAI_API_KEY',  // Add env variable name
  };
  return names[provider];
}
```

#### 5. Update Documentation

- Add to `README.md` provider comparison table
- Add to `.env.example`
- Update `docs/PROVIDER_COMPARISON.md`

---

## 📌 Git Workflow

### Branch Naming

```
feat/add-new-ai-provider
fix/github-comment-error
docs/update-contributing-guide
refactor/optimize-file-reading
```

### Commit Message Format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Code style (formatting, semicolons)
- `refactor`: Code refactoring
- `perf`: Performance improvement
- `test`: Adding tests
- `build`: Build system changes
- `ci`: CI/CD changes
- `chore`: Maintenance tasks

**Examples:**

```bash
feat(ai): add support for NewAI provider
fix(git): handle undefined PR number in GitHub provider
docs(contributing): add network efficiency guidelines
perf(file): implement parallel file reading
refactor(config): extract validation logic
```

---

## 📋 Pull Request Process

### Before Submitting

1. **Run type check:**
   ```bash
   npm run typecheck
   ```

2. **Build successfully:**
   ```bash
   npm run build
   ```

3. **Test your changes locally:**
   ```bash
   npm start -- --local
   ```

4. **Update documentation** if adding new features

### PR Checklist

- [ ] Code follows clean code guidelines
- [ ] TypeScript types are properly defined
- [ ] No `any` types (unless absolutely necessary with comment)
- [ ] Functions have clear return types
- [ ] Error handling is implemented
- [ ] Documentation updated (if applicable)
- [ ] Commit messages follow Conventional Commits
- [ ] Build passes without errors

### Review Process

1. **Automated Checks**: CI/CD runs type checking and build
2. **Code Review**: Maintainers review for:
   - Clean code adherence
   - SOLID principles
   - Network efficiency
   - TypeScript best practices
3. **Merge**: Squash and merge with clean commit message

---

## 🙏 Thank You!

Your contributions help make MP Sentinel better for everyone. If you have questions, feel free to:

- Open an issue for discussion
- Reach out to maintainers
- Check existing documentation

**Happy Coding!** 🚀
