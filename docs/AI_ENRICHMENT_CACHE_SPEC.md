# AI Enrichment Cache Spec

**Status:** Implemented in v1.12.0
**Target:** shipped in v1.12.0

## Implemented behavior (v1.12.0)

The runtime implementation follows this spec. Key behaviors:

- **Cache hit skips provider**: When a cached enrichment result exists for the current composite key, `enrichIndex()` returns the cached output without calling the AI provider.
- **Corrupt cache falls back**: Invalid JSON, Zod validation failure, or cacheKey mismatch deletes the corrupt file and proceeds to a fresh provider call. Cache failure never blocks enrichment.
- **Warnings stay off JSON stdout**: Cache warnings go to stderr via `log.warning`. JSON stdout (`--format json`) is never polluted with cache status lines.
- **Atomic writes**: Cache files are written to a temp file then renamed, preventing corruption on crash mid-write.
- **`projectRoot` absent skips cache**: When `enrichIndex()` is called without `projectRoot` in config, cache is neither read nor written — behavior is unchanged from pre-cache versions.

---

## 1. Motivation

Every `create-skills` run with `createSkills.ai.enabled: true` calls an AI provider -- currently
Gemini, OpenAI, Anthropic, Grok, or OpenRouter. The AI enrichment output is **deterministic for a given
input**: the same `SourceIndex` + same provider + same model + same prompt version always
produces the same result. Without a cache, every invocation burns API credits and adds latency
(typically 2-10 seconds) even when nothing has changed.

A file-based cache on the enrichment input hash eliminates redundant provider calls.

---

## 2. Cache key

The cache key is the **composite input hash**, a SHA256 hex digest (16 chars) computed from
the concatenation of these components, each separated by `::`:

```
<cacheKey> = sha256(
  sourceIndexHash :: provider :: model :: promptVersion :: inputHash
).slice(0, 16)
```

| Component | Source | Rationale |
|-----------|--------|-----------|
| `sourceIndexHash` | `computeIndexHash(index)` in `metadata.ts` | Captures structural index changes (files, imports, manifest). Covers schema version, manifest hash, all file hashes, dependency lists, scripts, and frameworks. |
| `provider` | resolved provider name (`"gemini"` / `"openai"` / `"anthropic"` / `"grok"` / `"openrouter"`) | Different providers return different output for the same input. |
| `model` | resolved model name (e.g. `"gemini-2.5-flash"`) | Same provider, different model -> different output. |
| `promptVersion` | `ENRICHMENT_PROMPT_VERSION` (`"2026-04-28"`) | Prompt template changes invalidate all prior caches. |
| `inputHash` | `computeEnrichmentInputHash(input)` from `ai-enrichment.ts` | Captures the derived `AIEnrichmentInput` (KB data, module roles, dependency versions, profile, etc.). |

### Why a composite hash instead of reusing `inputHash` alone?

`computeEnrichmentInputHash()` only hashes `AIEnrichmentInput`. It does **not** include:
- `sourceIndexHash` -- structural index changes beyond what `AIEnrichmentInput` captures
- `provider` or `model` -- resolved at call time from config/env
- `promptVersion` -- currently defined but not fed into the input hash

All five must change the cache key. A composite hash is the simplest correct approach.

### 2.1 Cache key computation (pseudocode)

```typescript
function computeEnrichmentCacheKey(
  sourceIndexHash: string,   // from computeIndexHash()
  provider: string,          // e.g. "gemini"
  model: string,             // e.g. "gemini-2.5-flash"
  promptVersion: string,     // ENRICHMENT_PROMPT_VERSION
  inputHash: string,         // from computeEnrichmentInputHash()
): string {
  const composite = [sourceIndexHash, provider, model, promptVersion, inputHash].join("::");
  return sha256(composite).slice(0, 16);
}
```

This function lives in `ai-enrichment.ts` alongside the existing hash helpers.

---

## 3. Cache path

```
.mp-sentinel-cache/ai-enrichment/<cacheKey>.json
```

- **Root:** `.mp-sentinel-cache/` -- same directory already used by the source index cache
  (`.mp-sentinel-cache/source-index.json`). No new top-level directory.
- **Subdirectory:** `ai-enrichment/` -- separates enrichment cache entries from the source
  index. Created automatically on first write if it doesn't exist.
- **File per key:** `<cacheKey>.json` -- one JSON file per unique composite input hash.
  Multiple entries may coexist (e.g. after provider/model switch or source index updates).
- **Git:** `.mp-sentinel-cache/` is already in `.gitignore`. No new gitignore entry needed.

### 3.1 Cache file schema

```jsonc
{
  "cacheKey": "a1b2c3d4e5f6a7b8",  // self-referential, for validation
  "createdAt": "2026-04-29T10:30:00.000Z",
  "metadata": {
    "mode": "ai",
    "provider": "gemini",
    "model": "gemini-2.5-flash",
    "promptVersion": "2026-04-28",
    "inputHash": "abcd1234efgh5678",
    "outputHash": "deadbeefcafe1234"
  },
  "output": {
    "languageRules": ["..."],
    "libraryRules": ["..."],
    "versionNotes": ["..."],
    "riskWarnings": ["..."],
    "recommendedChecks": ["..."]
  }
}
```

- `metadata` matches the `EnrichmentMetadata` "ai" variant exactly.
- `output` matches `AIEnrichmentOutput` (the Zod-validated result).

---

## 4. Cache read/write flow

### 4.1 Read (on `enrichIndex` call)

```
1. Compute composite cache key from the five components.
2. Check if .mp-sentinel-cache/ai-enrichment/<cacheKey>.json exists.
3. If not -> cache miss. Proceed to provider call.
4. If yes -> read and JSON.parse.
   a. Validate against a Zod schema for the cache envelope.
   b. If cacheKey in file != computed key -> warn, treat as miss.
   c. Return cached { metadata, output }.
```

### 4.2 Write (after successful provider call)

```
1. Compute composite cache key.
2. Validate that the AI output passes Zod (already done by enrichIndex).
3. Build the cache envelope: { cacheKey, createdAt, metadata, output }.
4. Ensure .mp-sentinel-cache/ai-enrichment/ directory exists.
5. Write JSON atomically: write to a temp file, then rename.
   (Avoids corrupting the cache on crash mid-write.)
6. Log at info level: "AI enrichment cached -> .mp-sentinel-cache/ai-enrichment/<key>.json"
```

### 4.3 Cache miss -> provider call

No change from the current flow. Provider call and Zod validation happen exactly as today.

---

## 5. Invalidation policy

### 5.1 Automatic (key-based)

Any change to the five key components produces a different cache key, so stale cache files are
**never read**. They accumulate on disk but are inert.

### 5.2 Stale cache cleanup

Old cache files (from previous source index states, prompt versions, or provider switches) are
not read but consume disk space. Each file is ~1-5 KB. Cleanup is not urgent for v1 but should
be addressed eventually:

- **v1 (this spec):** No automatic cleanup. Manual deletion of `.mp-sentinel-cache/ai-enrichment/`
  clears all cached entries. The `doctor` command may report cache file count.
- **Future:** LRU eviction (keep last N entries or entries younger than T days). The cache
  key does not embed a timestamp, so eviction uses `createdAt` from the file body.

### 5.3 Provider/model deprecation

If a provider or model becomes unavailable, its cache files are never read (no matching key
will be computed since the caller resolves to a different model). They're harmless.

---

## 6. Failure policy

| Scenario | Behavior |
|----------|----------|
| Cache file exists but is not valid JSON | Log warning, delete corrupt file, proceed to provider call. |
| Cache file exists but Zod validation fails | Log warning with details, delete corrupt file, proceed to provider call. |
| Cache file exists but `cacheKey` field mismatch | Log warning, delete corrupt file, proceed to provider call. |
| Cache write fails (disk full, permissions) | Log warning, do NOT fail the command. Enrichment succeeded -- the cache write is best-effort. |
| Cache read fails (permissions, filesystem error) | Log warning, proceed to provider call as if cache miss. |
| Provider call fails (network, auth, rate limit) | Same as today -- `ProviderError`, exit code 2. No cache write. |
| AI output fails Zod validation | Same as today -- throw `Error`, exit code 2. No cache write. |

**Key principle:** Cache is an optimization, not a correctness dependency. A broken or missing
cache never blocks enrichment. The only user-visible effect is a warning in the console.

---

## 7. JSON / doctor / check interactions

These three output modes must never be polluted by cache state.

### 7.1 JSON output (`--index-format json` / `--format json`)

- Cache hit/miss is an internal detail -- no cache-related fields in JSON stdout.
- Cache warnings go to stderr (via `log.warning`), not stdout.
- The `enrichment` field in generated skill file metadata already contains the full
  `EnrichmentMetadata` object (`provider`, `model`, `promptVersion`, `inputHash`,
  `outputHash`). This is sufficient for observability -- no additional cache status field.

### 7.2 Doctor command

- The `doctor` diagnostic may report:
  - Whether the `ai-enrichment/` cache directory exists.
  - Number of cached entries.
  - Total cache size on disk.
  - Age of the most recent cache entry.
- These are purely informational -- doctor never modifies the cache.

### 7.3 Check command (`create-skills-check`)

- `create-skills-check` determines staleness by comparing `sourceIndexHash` in the skill
  file metadata against the current index hash. The check command does NOT call AI enrichment
  and does NOT interact with the enrichment cache.
- If a skill file was generated with enrichment and the source index hash changed, the file
  is flagged as stale. On next `create-skills` run, enrichment runs again (cache hit if the
  new cache key matches, otherwise provider call + new cache write).

### 7.4 `--no-ai-enrich` flag

- When `--no-ai-enrich` is passed, `enrichIndex()` is never called. The cache is neither
  read nor written. This flag already exists and skips the entire `enrichIndex()` call site
  in `create-skills.ts`.

---

## 8. Implementation notes (for future reference)

### 8.1 What gets touched

- `src/services/skills-generator/ai-enrichment.ts` -- add `computeEnrichmentCacheKey()`,
  cache read/write helpers, and modify `enrichIndex()` to check/write cache.
- `src/utils/logger.ts` -- existing `log.warning` / `log.info` sufficient; no changes needed.
- Types may need a cache envelope type in `src/types/index.ts`.

### 8.2 What must NOT be touched

- `src/commands/create-skills.ts` -- the call site (`enrichIndex(index, aiEnrichConfig)`)
  does not change. The caching is transparent to the caller.
- `src/types/index.ts` `AIEnrichmentInput` / `AIEnrichmentOutput` / `EnrichmentMetadata` --
  existing types suffice. The cache envelope is internal to `ai-enrichment.ts`.
- Config schema (`.mp-sentinelrc.json`) -- no new config fields. The cache directory is derived
  from the existing convention.

### 8.3 Atomic write helper

Node.js `fs.rename()` is atomic on the same filesystem. The pattern:

```typescript
const tmp = cachePath + ".tmp." + Date.now();
await writeFile(tmp, JSON.stringify(envelope, null, 2), "utf-8");
await rename(tmp, cachePath);
```

If `rename` fails, the temp file is left behind (harmless, cleaned up on next write).

### 8.4 Determinism guarantee

The cache is correct because enrichment is a pure function of its inputs:
- `computeIndexHash()` is deterministic (deep-sorted).
- `computeEnrichmentInputHash()` is deterministic (`deepSortForHash()`).
- `buildEnrichmentPrompt()` is deterministic (sorted keys in JSON templates).
- Provider output for the same prompt is deterministic at `temperature: 0.3` (the default).
  In practice, providers with low temperature are stable enough for caching.

---

## 9. Verification

After implementation, verify with the standard suite:

```sh
npm run format:check && npm run typecheck && npm test && npm run build
```

Additional manual smoke tests (not automated):

1. **Cache miss -> hit:** Run `create-skills` with AI enabled twice. First run calls provider
   and writes cache. Second run reads cache (verifiable via console log "Using cached AI
   enrichment" vs "Running AI enrichment with ..."). Both runs produce identical skill files.

2. **Cache invalidation:** Add a file to the project, rebuild source index, re-run
   `create-skills`. A new cache entry is written (different key because `sourceIndexHash`
   changed). The old entry remains on disk but is unused.

3. **Corrupt cache:** Write invalid JSON to a cache file with a valid-looking name. Re-run
   `create-skills`. The corrupt file is deleted and a fresh provider call is made.

4. **JSON stdout clean:** Run with `--format json` (or equivalent). stdout contains only the
   expected JSON -- no cache status lines.
