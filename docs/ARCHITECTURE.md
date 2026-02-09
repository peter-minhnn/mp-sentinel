# Architecture Overview

## System Design

MP Sentinel v1.0.0 implements a **multi-provider AI architecture** following clean code principles and SOLID design patterns.

## Directory Structure

```
mp-sentinel/
├── src/
│   ├── services/
│   │   ├── ai/                    # Multi-provider AI service
│   │   │   ├── index.ts          # Main service entry
│   │   │   ├── types.ts          # Type definitions
│   │   │   ├── config.ts         # Configuration management
│   │   │   ├── factory.ts        # Provider factory
│   │   │   ├── providers/        # Provider implementations
│   │   │   │   ├── gemini.provider.ts
│   │   │   │   ├── openai.provider.ts
│   │   │   │   └── anthropic.provider.ts
│   │   │   └── README.md         # Provider documentation
│   │   ├── ai.ts                 # Legacy exports (backward compat)
│   │   ├── file.ts               # File operations
│   │   └── git-provider.ts       # Git integration
│   ├── config/
│   │   └── prompts.ts            # AI prompt templates
│   ├── utils/
│   │   ├── config.ts             # Project configuration
│   │   ├── git.ts                # Git utilities
│   │   ├── logger.ts             # Logging
│   │   └── parser.ts             # Response parsing
│   ├── types/
│   │   └── index.ts              # Type definitions
│   ├── index.ts                  # CLI entry point
│   └── lib.ts                    # Public API
├── docs/
│   ├── QUICK_START.md            # Quick start guide
│   └── ARCHITECTURE.md           # This file
├── examples/
│   └── multi-provider-demo.ts    # Usage examples
├── .env.example                  # Environment template
├── MIGRATION.md                  # Upgrade guide
├── CHANGELOG.md                  # Version history
└── README.md                     # Main documentation
```

## Design Patterns

### 1. Factory Pattern

**Location:** `src/services/ai/factory.ts`

Creates appropriate AI provider based on configuration:

```typescript
const provider = AIProviderFactory.createProvider(config);
```

**Benefits:**

- Decouples provider creation from usage
- Easy to add new providers
- Centralized provider logic

### 2. Singleton Pattern

**Location:** `src/services/ai/index.ts`

Single provider instance per application lifecycle:

```typescript
let providerInstance: IAIProvider | null = null;

const getProvider = (): IAIProvider => {
  if (providerInstance) return providerInstance;
  // Initialize once
  providerInstance = AIProviderFactory.createProvider(config);
  return providerInstance;
};
```

**Benefits:**

- Efficient resource usage
- Consistent configuration
- Easy to clear for testing

### 3. Strategy Pattern

**Location:** `src/services/ai/providers/`

Different AI providers implement same interface:

```typescript
interface IAIProvider {
  generateContent(systemPrompt: string, userPrompt: string): Promise<string>;
  isAvailable(): boolean;
}
```

**Benefits:**

- Interchangeable providers
- Consistent API
- Easy testing with mocks

### 4. Dependency Injection

**Location:** Throughout codebase

Configuration injected via environment:

```typescript
const config = AIConfig.fromEnvironment();
const provider = AIProviderFactory.createProvider(config);
```

**Benefits:**

- Testable code
- Flexible configuration
- No hard dependencies

## Data Flow

```
┌─────────────┐
│   CLI       │
│  (index.ts) │
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│  AI Service     │
│  (ai/index.ts)  │
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│  AI Config      │
│  (ai/config.ts) │
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│  Factory        │
│  (ai/factory.ts)│
└──────┬──────────┘
       │
       ▼
┌─────────────────────────────────┐
│  Provider (Strategy Pattern)    │
├─────────────────────────────────┤
│  • GeminiProvider               │
│  • OpenAIProvider               │
│  • AnthropicProvider            │
└─────────────────────────────────┘
       │
       ▼
┌─────────────────┐
│  External API   │
│  (Gemini/GPT/   │
│   Claude)       │
└─────────────────┘
```

## Component Responsibilities

### AI Service (`src/services/ai/`)

- **Purpose:** Unified interface for code auditing
- **Responsibilities:**
  - Manage provider lifecycle
  - Handle concurrent file auditing
  - Parse AI responses
  - Error handling and fallbacks

### AI Config (`src/services/ai/config.ts`)

- **Purpose:** Configuration management
- **Responsibilities:**
  - Read environment variables
  - Validate configuration
  - Provide defaults
  - Map provider to API keys

### AI Factory (`src/services/ai/factory.ts`)

- **Purpose:** Provider instantiation
- **Responsibilities:**
  - Create provider instances
  - Provide default models
  - List recommended models
  - Validate provider types

### Providers (`src/services/ai/providers/`)

- **Purpose:** AI API integration
- **Responsibilities:**
  - Implement IAIProvider interface
  - Handle API-specific requests
  - Format prompts correctly
  - Parse responses

## SOLID Principles Applied

### Single Responsibility Principle (SRP)

- Each provider handles only its own API
- Config class only manages configuration
- Factory only creates providers

### Open/Closed Principle (OCP)

- Open for extension (add new providers)
- Closed for modification (existing code unchanged)

### Liskov Substitution Principle (LSP)

- All providers implement IAIProvider
- Can substitute any provider without breaking code

### Interface Segregation Principle (ISP)

- IAIProvider has minimal interface
- Providers only implement what they need

### Dependency Inversion Principle (DIP)

- Depend on IAIProvider interface, not concrete classes
- High-level modules don't depend on low-level modules

## Testing Strategy

### Unit Tests

```typescript
// Mock provider for testing
class MockProvider implements IAIProvider {
  async generateContent() {
    return '{"status":"PASS"}';
  }
  isAvailable() {
    return true;
  }
}

// Test with mock
const provider = new MockProvider();
const result = await auditFile(path, content, prompt);
```

### Integration Tests

```typescript
// Test with real provider
process.env.AI_PROVIDER = "gemini";
process.env.GEMINI_API_KEY = "test-key";

const config = AIConfig.fromEnvironment();
const provider = AIProviderFactory.createProvider(config);
```

## Performance Considerations

### Concurrency Control

```typescript
// Process files in batches
for (let i = 0; i < files.length; i += maxConcurrency) {
  const batch = files.slice(i, i + maxConcurrency);
  const results = await Promise.all(batch.map(auditFile));
}
```

### Singleton Pattern

- Single provider instance reduces initialization overhead
- Reuses HTTP connections

### Streaming (Future Enhancement)

- Support streaming responses for large files
- Real-time feedback during auditing

## Security Considerations

1. **API Key Management**
   - Never commit API keys
   - Use environment variables
   - Validate keys before use

2. **Input Validation**
   - Validate file paths
   - Sanitize code content
   - Limit file sizes

3. **Error Handling**
   - Don't expose API keys in errors
   - Graceful degradation
   - Proper logging

## Extensibility

### Adding a New Provider

1. Create provider class:

```typescript
// src/services/ai/providers/newai.provider.ts
export class NewAIProvider implements IAIProvider {
  async generateContent(system: string, user: string): Promise<string> {
    // Implementation
  }
  isAvailable(): boolean {
    return !!this.apiKey;
  }
}
```

2. Update types:

```typescript
// src/services/ai/types.ts
export type AIProvider = "gemini" | "openai" | "anthropic" | "newai";
```

3. Register in factory:

```typescript
// src/services/ai/factory.ts
case 'newai':
  return new NewAIProvider(config);
```

4. Update config:

```typescript
// src/services/ai/config.ts
case 'newai':
  return process.env.NEWAI_API_KEY;
```

## Future Enhancements

1. **Caching Layer**
   - Cache AI responses for identical code
   - Reduce API costs

2. **Streaming Support**
   - Real-time feedback
   - Better UX for large files

3. **Custom Providers**
   - Allow users to add custom providers
   - Plugin system

4. **Model Fine-tuning**
   - Project-specific model training
   - Improved accuracy

5. **Multi-model Consensus**
   - Query multiple providers
   - Aggregate results for higher confidence
