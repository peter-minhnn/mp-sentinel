/**
 * Tests for AI audit result cache.
 *
 * Verifies that readCachedAuditResult rejects invalid/ERROR cached data
 * and buildAuditCacheKey is sensitive to all input fields.
 */

import { describe, it, expect, jest } from "@jest/globals";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readCachedAuditResult,
  writeCachedAuditResult,
  buildAuditCacheKey,
} from "../services/ai/cache.js";

// ── File-based cache tests (readCachedAuditResult) ──────────────────────

describe("readCachedAuditResult", () => {
  let tmpDir: string;

  const writeCache = (key: string, content: string) =>
    writeFile(join(tmpDir, ".mp-sentinel-cache", `${key}.json`), content, "utf-8");

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mp-sentinel-cache-test-"));
    await mkdir(join(tmpDir, ".mp-sentinel-cache"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns null for a non-existent cache file", async () => {
    const result = await readCachedAuditResult("nonexistent-key", tmpDir);
    expect(result).toBeNull();
  });

  it("returns null for malformed JSON in cache", async () => {
    await writeCache("bad-json", "this is not json{;;;");
    const result = await readCachedAuditResult("bad-json", tmpDir);
    expect(result).toBeNull();
  });

  it("returns null for valid JSON with invalid status (ERROR schema)", async () => {
    // "INVALID" is not a valid status → parseAuditResponse returns ERROR
    await writeCache("bad-status", JSON.stringify({ status: "INVALID", issues: [] }));
    const result = await readCachedAuditResult("bad-status", tmpDir);
    expect(result).toBeNull();
  });

  it("returns null for valid JSON with ERROR status (e.g. empty result)", async () => {
    // Primed with an ERROR result that the runtime would never write
    await writeCache(
      "cached-error",
      JSON.stringify({ status: "ERROR", message: "Invalid AI response format", issues: [] }),
    );
    const result = await readCachedAuditResult("cached-error", tmpDir);
    expect(result).toBeNull();
  });

  it("returns normalized result for valid cached PASS", async () => {
    await writeCache("pass", JSON.stringify({ status: "PASS", issues: [] }));
    const result = await readCachedAuditResult("pass", tmpDir);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("PASS");
    expect(result!.issues).toEqual([]);
  });

  it("returns normalized result for valid cached FAIL with issues", async () => {
    await writeCache(
      "fail",
      JSON.stringify({
        status: "FAIL",
        issues: [{ line: 10, severity: "CRITICAL", message: "security issue" }],
      }),
    );
    const result = await readCachedAuditResult("fail", tmpDir);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("FAIL");
    expect(result!.issues).toHaveLength(1);
    expect(result!.issues![0]!.message).toBe("security issue");
  });

  it("ignores temp/partial .tmp.* files as cache miss", async () => {
    // Only a .tmp.* file exists, no final .json file
    await writeFile(
      join(tmpDir, ".mp-sentinel-cache", "somekey.json.tmp.12345"),
      JSON.stringify({ status: "PASS", issues: [] }),
      "utf-8",
    );
    const result = await readCachedAuditResult("somekey", tmpDir);
    expect(result).toBeNull();
  });

  it("v1-key cache entry is a miss when read with v2 key (version bump)", async () => {
    // Write a cache file using the known v1 fixture key
    const v1Key = "0ee565d102dd0a524b79a701494f2d97688c19864ab76de4dc604f44b1d48cf5";
    await writeCache(v1Key, JSON.stringify({ status: "PASS", issues: [] }));

    // Read with the v2 key for the same inputs — should miss
    const v2Key = buildAuditCacheKey({
      provider: "anthropic",
      model: "claude-opus-4-7",
      promptVersion: "2026-05-04",
      systemPrompt: "you are a code reviewer",
      filePath: "src/utils/auth.ts",
      payload: "console.log('hello');",
      toolVersion: "1.33.1",
    });
    const result = await readCachedAuditResult(v2Key, tmpDir);
    expect(result).toBeNull();
  });
});

// ── Atomic write tests (writeCachedAuditResult) ─────────────────────────

describe("writeCachedAuditResult", () => {
  let tmpDir: string;
  let warnSpy: jest.SpiedFunction<typeof console.warn>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mp-sentinel-cache-write-"));
    await mkdir(join(tmpDir, ".mp-sentinel-cache"), { recursive: true });
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(async () => {
    warnSpy.mockRestore();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("resolves when the cache directory path is blocked by a file", async () => {
    // Replace .mp-sentinel-cache directory with a regular file
    await rm(join(tmpDir, ".mp-sentinel-cache"), { recursive: true, force: true });
    await writeFile(join(tmpDir, ".mp-sentinel-cache"), "not-a-directory", "utf-8");

    // Should not throw despite the blocked path
    await expect(
      writeCachedAuditResult("test-key", { status: "PASS", issues: [] }, tmpDir),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("resolves when passed null-like or minimal result (edge case)", async () => {
    await expect(
      writeCachedAuditResult("minimal", { status: "PASS" }, tmpDir),
    ).resolves.toBeUndefined();
  });

  it("successfully written data can be read back by readCachedAuditResult", async () => {
    await writeCachedAuditResult(
      "roundtrip",
      {
        status: "FAIL",
        issues: [{ line: 5, severity: "WARNING", message: "test warning" }],
      },
      tmpDir,
    );
    const result = await readCachedAuditResult("roundtrip", tmpDir);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("FAIL");
    expect(result!.issues).toHaveLength(1);
    expect(result!.issues![0]!.message).toBe("test warning");
  });
});

// ── Cache key stability tests ───────────────────────────────────────────

describe("buildAuditCacheKey", () => {
  const BASE_INPUT = {
    provider: "anthropic",
    model: "claude-opus-4-7",
    promptVersion: "2026-05-04",
    systemPrompt: "you are a code reviewer",
    filePath: "src/utils/auth.ts",
    payload: "console.log('hello');",
    toolVersion: "1.33.1",
  };

  it("produces stable keys for identical inputs", () => {
    const a = buildAuditCacheKey(BASE_INPUT);
    const b = buildAuditCacheKey(BASE_INPUT);
    expect(a).toBe(b);
  });

  it("changes when provider changes", () => {
    const a = buildAuditCacheKey(BASE_INPUT);
    const b = buildAuditCacheKey({ ...BASE_INPUT, provider: "openai" });
    expect(a).not.toBe(b);
  });

  it("changes when model changes", () => {
    const a = buildAuditCacheKey(BASE_INPUT);
    const b = buildAuditCacheKey({ ...BASE_INPUT, model: "gpt-4" });
    expect(a).not.toBe(b);
  });

  it("changes when promptVersion changes", () => {
    const a = buildAuditCacheKey(BASE_INPUT);
    const b = buildAuditCacheKey({ ...BASE_INPUT, promptVersion: "2026-05-01" });
    expect(a).not.toBe(b);
  });

  it("changes when systemPrompt changes", () => {
    const a = buildAuditCacheKey(BASE_INPUT);
    const b = buildAuditCacheKey({ ...BASE_INPUT, systemPrompt: "different prompt" });
    expect(a).not.toBe(b);
  });

  it("changes when filePath changes", () => {
    const a = buildAuditCacheKey(BASE_INPUT);
    const b = buildAuditCacheKey({ ...BASE_INPUT, filePath: "src/utils/db.ts" });
    expect(a).not.toBe(b);
  });

  it("changes when payload changes", () => {
    const a = buildAuditCacheKey(BASE_INPUT);
    const b = buildAuditCacheKey({ ...BASE_INPUT, payload: "const x = 1;" });
    expect(a).not.toBe(b);
  });

  it("changes when toolVersion changes", () => {
    const a = buildAuditCacheKey(BASE_INPUT);
    const b = buildAuditCacheKey({ ...BASE_INPUT, toolVersion: "1.34.0" });
    expect(a).not.toBe(b);
  });

  it("produces deterministic hex strings", () => {
    const key = buildAuditCacheKey(BASE_INPUT);
    expect(key).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes when baseUrl is added", () => {
    const a = buildAuditCacheKey(BASE_INPUT);
    const b = buildAuditCacheKey({
      ...BASE_INPUT,
      baseUrl: "https://api.deepseek.com/anthropic/v1/messages",
    });
    expect(a).not.toBe(b);
  });

  it("different baseUrl values produce different keys", () => {
    const a = buildAuditCacheKey({
      ...BASE_INPUT,
      baseUrl: "https://api.deepseek.com/anthropic/v1/messages",
    });
    const b = buildAuditCacheKey({
      ...BASE_INPUT,
      baseUrl: "https://custom.example.com/v1/messages",
    });
    expect(a).not.toBe(b);
  });

  it("same baseUrl produces same key (stable key)", () => {
    const a = buildAuditCacheKey({
      ...BASE_INPUT,
      baseUrl: "https://api.deepseek.com/anthropic/v1/messages",
    });
    const b = buildAuditCacheKey({
      ...BASE_INPUT,
      baseUrl: "https://api.deepseek.com/anthropic/v1/messages",
    });
    expect(a).toBe(b);
  });

  it("preserves the current no-baseUrl fixture hash (v6)", () => {
    const key = buildAuditCacheKey(BASE_INPUT);
    // CACHE_VERSION 6 invalidates entries produced while DeepSeek ran with
    // thinking disabled (rubber-stamped PASS). Bumping forces re-audit.
    expect(key).toBe("515d67ffebea05236cfe629dbf741edbd26d57ed45484f108e4928b964f8fb0f");
  });

  // ── Cache version fixture tests ──

  it("produces the expected v6 fixture hash", () => {
    const key = buildAuditCacheKey(BASE_INPUT);
    expect(key).toBe("515d67ffebea05236cfe629dbf741edbd26d57ed45484f108e4928b964f8fb0f");
  });

  it("no longer produces the old v2 fixture hash", () => {
    const key = buildAuditCacheKey(BASE_INPUT);
    expect(key).not.toBe("99cae7d2355dea0268d18cb28a497edd35f123451570b3e7a2c8409b185b6abe");
  });

  it("no longer produces the old v3 fixture hash", () => {
    const key = buildAuditCacheKey(BASE_INPUT);
    // Pinned so a future contributor accidentally reverting the v3→v4 bump
    // gets a loud, intentional failure rather than silently serving stale
    // cache entries from a different prompt/response contract.
    expect(key).not.toBe("086f3b7a417620b313e0f2c7543f9dfc12e2926ef7725e9b35caece4ddc8c2f7");
  });
});
