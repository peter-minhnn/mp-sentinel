# 🌐 Network Efficiency Guidelines

> Best practices for optimizing network performance in MP Sentinel

This guide focuses specifically on network-related optimizations for contributors who want to improve MP Sentinel's performance, especially for high-volume code auditing scenarios.

---

## 📋 Core Principles

| Principle | Description |
|-----------|-------------|
| **Minimize Requests** | Reduce the number of API calls through batching and validation |
| **Reuse Connections** | Use singleton patterns to reuse HTTP connections |
| **Parallel Processing** | Process independent operations concurrently |
| **Fail Fast** | Validate before making network requests |
| **Optimize Payloads** | Send only necessary data in requests |

---

## 1. Connection Pooling & Singleton Pattern

### Current Implementation

```typescript
// src/services/ai/index.ts
let providerInstance: IAIProvider | null = null;

const getProvider = (): IAIProvider => {
  if (providerInstance) {
    return providerInstance; // ✅ Reuse existing connection
  }
  
  const config = AIConfig.fromEnvironment();
  AIConfig.validate(config);
  
  providerInstance = AIProviderFactory.createProvider(config);
  log.info(`AI Provider initialized: ${config.provider} (${config.model})`);
  
  return providerInstance;
};
```

### Benefits

- **Single TCP connection** per provider session
- **Reduced latency** from connection reuse
- **Memory efficiency** with single instance

### When to Clear Cache

```typescript
// Clear only for testing or provider switching
export const clearProviderCache = (): void => {
  providerInstance = null;
};
```

---

## 2. Batch Processing with Concurrency Control

### The Problem

Making 100 sequential API calls:
```
Total Time = 100 × (latency + processing)
```

### The Solution: Controlled Batching

```typescript
// src/services/ai/index.ts
export const auditFilesWithConcurrency = async (
  files: Array<{ path: string; content: string }>,
  config: ProjectConfig,
  maxConcurrency: number = 5  // Default batch size
): Promise<FileAuditResult[]> => {
  const results: FileAuditResult[] = [];
  
  for (let i = 0; i < files.length; i += maxConcurrency) {
    const batch = files.slice(i, i + maxConcurrency);
    
    // Process batch in parallel
    const batchResults = await Promise.all(
      batch.map(file => auditFile(file.path, file.content, systemPrompt))
    );
    
    results.push(...batchResults);
    
    // Progress feedback
    log.progress(
      Math.min(i + maxConcurrency, files.length),
      files.length,
      `${results.length}/${files.length} files audited`
    );
  }
  
  return results;
};
```

### Concurrency Tuning

| Scenario | Recommended Value | Reason |
|----------|-------------------|--------|
| Free tier API | 3-5 | Avoid rate limits |
| Paid API | 10-20 | Better throughput |
| CI/CD pipeline | 5-10 | Balance time/cost |
| Local development | 3-5 | Avoid blocking |

---

## 3. Request Optimization

### Minimal Headers

```typescript
// ✅ Good: Only necessary headers
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

// ❌ Bad: Unnecessary headers
headers: {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${this.apiKey}`,
  'X-Custom-Header': 'not-needed',
  'Accept-Language': 'en-US',  // Not used by API
}
```

### Early Validation (Fail Fast)

```typescript
// ✅ Good: Validate before network request
async postComment(filePath: string, line: number, issue: AuditIssue): Promise<void> {
  // Fail fast - no network request if invalid context
  if (!this.token || !this.owner || !this.repo || !this.prNumber) {
    log.warning('Skipping GitHub comment: Invalid context.');
    return;
  }
  
  // Only make request if validation passes
  const response = await fetch(url, {
    // ...
  });
}
```

---

## 4. File Processing Optimization

### Size Limits

```typescript
// src/services/file.ts
const MAX_FILE_SIZE = 500 * 1024; // 500KB limit

export const readFilesForAudit = async (filePaths: string[]): Promise<FileReadResult> => {
  const readPromises = filePaths.map(async (filePath): Promise<FileReadItem> => {
    const stats = await stat(absolutePath);
    
    // ✅ Skip oversized files before reading
    if (stats.size > MAX_FILE_SIZE) {
      return { 
        path: filePath, 
        skipped: true, 
        reason: `File too large (${formatBytes(stats.size)})` 
      };
    }
    
    const content = await readFile(absolutePath, 'utf-8');
    return { path: filePath, content, size: stats.size, skipped: false };
  });
  
  return Promise.all(readPromises);
};
```

### Parallel File I/O

```typescript
// ✅ Good: Read all files in parallel
const readPromises = filePaths.map(filePath => readFile(filePath, 'utf-8'));
const results = await Promise.all(readPromises);

// ❌ Bad: Sequential reads
const results = [];
for (const filePath of filePaths) {
  results.push(await readFile(filePath, 'utf-8'));
}
```

---

## 5. Git Operations Optimization

### Promisified Commands

```typescript
// src/utils/git.ts
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// ✅ Non-blocking git operations
export const getLastCommitMessage = async (): Promise<string> => {
  try {
    const { stdout } = await execAsync('git log -1 --pretty=%B');
    return stdout.trim();
  } catch {
    return '';
  }
};
```

### Fallback Strategy

```typescript
// Try efficient method first, fallback to alternative
export const getChangedFiles = async (options: GitDiffOptions = {}): Promise<string[]> => {
  const { targetBranch = 'origin/main', extensions = SUPPORTED_EXTENSIONS } = options;

  try {
    // ✅ Three-dot diff (efficient for PR/MR)
    const command = `git diff --name-only --diff-filter=ACMR ${targetBranch}...HEAD`;
    const { stdout } = await execAsync(command);
    return parseAndFilterFiles(stdout, extensions);
  } catch {
    try {
      // ✅ Fallback to two-dot diff
      const command = `git diff --name-only --diff-filter=ACMR ${targetBranch}`;
      const { stdout } = await execAsync(command);
      return parseAndFilterFiles(stdout, extensions);
    } catch {
      return [];
    }
  }
};
```

---

## 6. Provider-Specific Optimizations

### Gemini (Google)

```typescript
// Uses SDK with built-in connection management
const genAI = new GoogleGenerativeAI(config.apiKey);
this.model = genAI.getGenerativeModel({
  model: config.model,
  generationConfig: {
    temperature: config.temperature ?? 0.2,
    maxOutputTokens: config.maxTokens ?? 8192,
  },
});
```

### OpenAI / Anthropic

```typescript
// Native fetch with minimal overhead
const response = await fetch(this.baseURL, {
  method: 'POST',
  headers: { /* minimal headers */ },
  body: JSON.stringify({ /* minimal payload */ }),
});
```

---

## 7. Response Parsing Optimization

### Efficient JSON Extraction

```typescript
// src/utils/parser.ts
export const cleanJSON = (text: string): string => {
  return text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();
};

export const parseAuditResponse = (responseText: string): AuditResult => {
  const cleaned = cleanJSON(responseText);
  
  try {
    const parsed = JSON.parse(cleaned) as AuditResult;
    if (!parsed.status || !['PASS', 'FAIL'].includes(parsed.status)) {
      return createErrorResult('Invalid AI response format');
    }
    return parsed;
  } catch {
    // ✅ Try to extract JSON from mixed content
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]) as AuditResult;
      } catch {
        // Fall through
      }
    }
    return createErrorResult('Failed to parse AI response');
  }
};
```

---

## 8. Future Enhancements

### Response Caching

```typescript
// Pattern for reducing duplicate API calls
interface CacheEntry {
  result: AuditResult;
  timestamp: number;
  contentHash: string;
}

class AuditCache {
  private cache = new Map<string, CacheEntry>();
  private ttl = 3600000; // 1 hour

  set(contentHash: string, result: AuditResult): void {
    this.cache.set(contentHash, {
      result,
      timestamp: Date.now(),
      contentHash,
    });
  }

  get(contentHash: string): AuditResult | null {
    const entry = this.cache.get(contentHash);
    if (entry && Date.now() - entry.timestamp < this.ttl) {
      return entry.result;
    }
    this.cache.delete(contentHash);
    return null;
  }
}
```

### Request Deduplication

```typescript
// Prevent duplicate in-flight requests
const pendingRequests = new Map<string, Promise<AuditResult>>();

const deduplicatedAudit = async (
  contentHash: string,
  auditFn: () => Promise<AuditResult>
): Promise<AuditResult> => {
  if (pendingRequests.has(contentHash)) {
    return pendingRequests.get(contentHash)!;
  }
  
  const promise = auditFn();
  pendingRequests.set(contentHash, promise);
  
  try {
    return await promise;
  } finally {
    pendingRequests.delete(contentHash);
  }
};
```

### Streaming Responses

```typescript
// Pattern for processing large responses incrementally
const streamResponse = async function* (response: Response): AsyncGenerator<string> {
  const reader = response.body?.getReader();
  if (!reader) return;
  
  const decoder = new TextDecoder();
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    yield decoder.decode(value, { stream: true });
  }
};
```

---

## 📊 Performance Metrics

### What to Measure

| Metric | Target | Measurement |
|--------|--------|-------------|
| Request latency | <2s avg | `performance.now()` |
| Batch completion | < files × 0.5s | Total audit time |
| Memory usage | <100MB | Process memory |
| Error rate | <1% | Failed requests / total |

### Logging Example

```typescript
const startTime = performance.now();
const result = await auditFile(file.path, file.content, systemPrompt);
const duration = performance.now() - startTime;

return {
  filePath: file.path,
  result,
  duration,  // Track for analysis
};
```

---

## 🔍 Debugging Network Issues

### Enable Verbose Mode

```bash
# See detailed request/response info
npx mp-sentinel --local --verbose
```

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Timeout | Large files | Reduce file size limit |
| Rate limit | Too many requests | Lower concurrency |
| Connection reset | Long-running requests | Implement retry logic |
| Memory spike | Large batches | Smaller batch size |

---

## ✅ Checklist for Network Efficiency

- [ ] Singleton pattern for provider instances
- [ ] Batch processing with concurrency control
- [ ] Early validation before network requests
- [ ] File size limits enforced
- [ ] Parallel I/O for independent operations
- [ ] Minimal request payloads
- [ ] Proper error handling without retries (currently)
- [ ] Progress feedback for long operations

---

*For general contribution guidelines, see [CONTRIBUTING.md](./CONTRIBUTING.md)*
