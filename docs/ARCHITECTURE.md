# Architecture Overview

## System Design

MP Sentinel v1.1.0 implements a **multi-provider AI architecture** following clean code principles and SOLID design patterns. The codebase is structured for maximum modularity — no source file exceeds 350 lines.

## Directory Structure

```
mp-sentinel/
├── src/
│   ├── cli/                         # CLI layer (split for maintainability)
│   │   ├── args.ts                  # Argument parsing & validation
│   │   ├── help.ts                  # Help & version display
│   │   ├── summary.ts              # Audit results formatting
│   │   ├── local-review.ts         # Local review mode logic
│   │   └── cicd-review.ts          # CI/CD review mode logic
│   ├── services/
│   │   ├── ai/                      # Multi-provider AI service
│   │   │   ├── index.ts             # Core AI audit orchestration
│   │   │   ├── config.ts            # AI provider configuration
│   │   │   ├── factory.ts           # Provider factory (Strategy pattern)
│   │   │   ├── types.ts             # AI provider interfaces
│   │   │   ├── README.md            # AI service documentation
│   │   │   └── providers/
│   │   │       ├── gemini.provider.ts
│   │   │       ├── openai.provider.ts
│   │   │       └── anthropic.provider.ts
│   │   ├── security/                # Security service (split)
│   │   │   ├── index.ts             # SecurityService class (Layer 2 & 3)
│   │   │   └── patterns.ts          # Secret patterns & types
│   │   ├── file-handler/            # File filtering service (split)
│   │   │   ├── index.ts             # FileHandler class (Layer 1)
│   │   │   └── constants.ts         # Extensions, blocked patterns
│   │   ├── ai.ts                    # Legacy AI re-exports
│   │   ├── file.ts                  # File read operations
│   │   ├── file-handler.ts          # Legacy file-handler re-exports
│   │   ├── security.service.ts      # Legacy security re-exports
│   │   ├── git-provider.ts          # GitHub/GitLab integration
│   │   └── skills-fetcher.ts        # skills.sh API integration
│   ├── config/
│   │   └── prompts.ts               # AI prompt templates
│   ├── utils/
│   │   ├── config.ts                # Project configuration loader
│   │   ├── git.ts                   # Git utilities
│   │   ├── logger.ts                # Console output & formatting
│   │   └── parser.ts                # AI response parsing
│   ├── types/
│   │   └── index.ts                 # Type definitions
│   ├── index.ts                     # CLI entry point (thin orchestrator)
│   └── lib.ts                       # Public API barrel
├── docs/                            # Documentation
│   ├── ARCHITECTURE.md              # This file
│   ├── CHANGELOG.md                 # Version history
│   ├── CICD_SETUP.md                # CI/CD pipeline setup
│   ├── CODE_STYLE.md                # Code style guide
│   ├── CONTRIBUTING.md              # Contributing guidelines
│   ├── MIGRATION_1.1.0.md           # v1.1.0 migration guide
│   ├── NETWORK_EFFICIENCY.md        # Network optimization details
│   ├── PROVIDER_COMPARISON.md       # AI provider comparison
│   ├── QUICK_REFERENCE.md           # Quick reference card
│   ├── QUICK_START.md               # Getting started guide
│   ├── README.md                    # Main documentation
│   ├── SKILLS_INTEGRATION.md        # skills.sh integration guide
│   └── SKILLS_QUICK_START.md        # skills.sh quick start
├── examples/
│   ├── multi-provider-demo.ts       # Multi-provider usage
│   ├── security-demo.ts             # Security features demo
│   ├── skills-demo.ts               # skills.sh demo
│   └── workflows/                   # CI/CD workflow examples
├── .sentinelrc.example.json         # Example configuration
├── .env.example                     # Environment template
└── README.md                        # Root documentation index
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
  providerInstance = AIProviderFactory.createProvider(config);
  return providerInstance;
};
```

### 3. Strategy Pattern

**Location:** `src/services/ai/providers/`

Different AI providers implement the same interface:

```typescript
interface IAIProvider {
  generateContent(systemPrompt: string, userPrompt: string): Promise<string>;
  isAvailable(): boolean;
}
```

### 4. Modular CLI Architecture

**Location:** `src/cli/`

The CLI entry point (`index.ts`) is a thin ~130-line orchestrator that delegates to focused modules:

| Module            | Responsibility                 |
| ----------------- | ------------------------------ |
| `args.ts`         | Parse & validate CLI arguments |
| `help.ts`         | Display help text & version    |
| `summary.ts`      | Format & print audit results   |
| `local-review.ts` | Local branch review mode       |
| `cicd-review.ts`  | CI/CD pipeline review mode     |

## Data Flow

```
┌─────────────┐
│   CLI       │   ← Thin orchestrator (src/index.ts)
│  (index.ts) │
└──────┬──────┘
       │
       ├──────────────────┐
       ▼                  ▼
┌──────────────┐  ┌──────────────┐
│ Local Review │  │ CI/CD Review │
│ (cli/)       │  │ (cli/)       │
└──────┬───────┘  └──────┬───────┘
       │                 │
       ▼                 ▼
┌─────────────────┐
│  File Handler   │ ◄── Layer 1: Filtering
│ (file-handler/) │
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│ Security Service│ ◄── Layer 2: Redaction
│ (security/)     │
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│  AI Service     │
│  (ai/index.ts)  │
└──────┬──────────┘
       │
       ├── Skills Fetcher (skills.sh integration)
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

### CLI Layer (`src/cli/`)

- **Purpose:** User interface and mode orchestration
- **Responsibilities:**
  - Parse CLI arguments and validate options
  - Display help, version, and audit summaries
  - Orchestrate local review vs CI/CD review flows
  - Handle commit filtering and pattern matching

### AI Service (`src/services/ai/`)

- **Purpose:** Unified interface for code auditing
- **Responsibilities:**
  - Manage provider lifecycle (singleton)
  - Handle concurrent file auditing with batching
  - Parse AI responses into structured results
  - Error handling and graceful fallbacks

### Skills Fetcher (`src/services/skills-fetcher.ts`)

- **Purpose:** Technology-specific best practices integration
- **Responsibilities:**
  - Parse techStack configuration
  - Fetch skills from skills.sh API (fail-fast, 3s timeout)
  - Cache results (1-hour TTL)
  - Build prompt sections from fetched skills

### File Handler (`src/services/file-handler/`)

- **Purpose:** Smart source code filtering (Layer 1)
- **Responsibilities:**
  - Traverse project tree with fast-glob
  - Respect `.gitignore` and `.archignore` rules
  - Apply extension allowlist (~50 extensions)
  - Block sensitive files (.env, keys, locks)

### Security Service (`src/services/security/`)

- **Purpose:** Content sanitization & Transparency (Layer 2 & 3)
- **Responsibilities:**
  - Redact secrets via 18+ multi-pattern regex rules
  - Detect suspicious keywords
  - Generate payload summary for dry-runs
  - Singleton pattern for efficient reuse

### Git Provider (`src/services/git-provider.ts`)

- **Purpose:** Post review comments to GitHub/GitLab
- **Responsibilities:**
  - Detect CI/CD environment (Actions/GitLab CI)
  - Post inline PR/MR comments for issues

## SOLID Principles Applied

| Principle | Implementation                                                    |
| --------- | ----------------------------------------------------------------- |
| **SRP**   | Each file has a single responsibility (args, help, summary, etc.) |
| **OCP**   | New AI providers added without modifying existing code            |
| **LSP**   | All providers implement `IAIProvider` interchangeably             |
| **ISP**   | `IAIProvider` has minimal 2-method interface                      |
| **DIP**   | Depends on `IAIProvider` interface, not concrete classes          |

## Performance Considerations

### Concurrency Control

```typescript
// Process files in batches with Promise.allSettled
for (let i = 0; i < files.length; i += maxConcurrency) {
  const batch = files.slice(i, i + maxConcurrency);
  const results = await Promise.allSettled(batch.map(auditFile));
}
```

### Key Optimizations

- **Singleton AI provider** — reduces initialization overhead
- **Promise.allSettled** — parallel file processing, no blocking on errors
- **In-memory skills cache** — 1-hour TTL avoids repeated API calls
- **Fail-fast skills fetch** — 3s timeout prevents pipeline hanging
- **Lazy git provider loading** — only imported when needed in CI/CD

## Security Layers

| Layer       | Module            | Purpose                                 |
| ----------- | ----------------- | --------------------------------------- |
| **Layer 1** | `FileHandler`     | Filter out non-code and sensitive files |
| **Layer 2** | `SecurityService` | Redact secrets from code content        |
| **Layer 3** | `SecurityService` | Payload transparency summary            |

## Extensibility

### Adding a New AI Provider

1. Create provider: `src/services/ai/providers/newai.provider.ts`
2. Update types: Add to `AIProvider` union in `types.ts`
3. Register in factory: Add case in `factory.ts`
4. Update config: Add API key mapping in `config.ts`

### Adding New Secret Patterns

Add to `DEFAULT_SECRET_PATTERNS` in `src/services/security/patterns.ts`, or pass custom patterns to the `SecurityService` constructor.

## Code Quality Standards

- **Max file length:** 350 lines (enforced by refactoring)
- **Console output:** All output through `log` utility (no raw `console.log`)
- **Error handling:** Graceful degradation, never crash the pipeline
- **TypeScript:** Strict mode with `noUncheckedIndexedAccess`
- **Imports:** ESM with `.js` extensions, `node:` prefix for built-ins
