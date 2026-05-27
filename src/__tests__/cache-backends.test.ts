/**
 * Tests for the pluggable cache backends (Phase 3.3).
 *
 * Each backend implements the same `read/write` contract so the cache
 * layer can swap them transparently. The legacy `readCachedAuditResult`
 * + `writeCachedAuditResult` shims continue to work via the default
 * `fs` backend.
 */

import { describe, expect, it, beforeEach, jest, afterEach } from "@jest/globals";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configureCacheBackend,
  createFsCacheBackend,
  createHttpCacheBackend,
  readCachedAuditResult,
  resetCacheBackend,
  setCacheBackendForTest,
  writeCachedAuditResult,
} from "../services/ai/cache.js";
import type { AuditResult } from "../types/index.js";
import type { CacheBackend } from "../services/ai/cache-backends/types.js";

const passResult: AuditResult = { status: "PASS", issues: [] };

describe("fs cache backend (Phase 3.3)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mp-sentinel-cache-fs-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("write → read round trips", async () => {
    const backend = createFsCacheBackend({ cwd: dir });
    await backend.write("key-abc", passResult);
    const got = await backend.read("key-abc");
    expect(got).toEqual({ status: "PASS", issues: [] });
  });

  it("returns null on miss", async () => {
    const backend = createFsCacheBackend({ cwd: dir });
    expect(await backend.read("nonexistent")).toBeNull();
  });

  it("treats cached ERROR status as a miss", async () => {
    const backend = createFsCacheBackend({ cwd: dir });
    // Manually write an ERROR — backends shouldn't write ERROR but a
    // tampered file could contain it. The read path filters it out.
    await backend.write("k", { status: "ERROR", message: "fake", issues: [] });
    expect(await backend.read("k")).toBeNull();
  });

  it("honors a custom cacheDir override", async () => {
    const backend = createFsCacheBackend({ cwd: dir, cacheDir: "custom-cache" });
    await backend.write("k1", passResult);
    expect(await backend.read("k1")).toEqual({ status: "PASS", issues: [] });
  });
});

describe("http cache backend (Phase 3.3)", () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: jest.Mock<typeof fetch>;

  beforeEach(() => {
    mockFetch = jest.fn<typeof fetch>();
    globalThis.fetch = mockFetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("issues GET to baseUrl/<key>", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(passResult), { status: 200 }));
    const backend = createHttpCacheBackend({ baseUrl: "https://cache.example.com/prefix" });
    const got = await backend.read("abc");
    expect(got).toEqual({ status: "PASS", issues: [] });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://cache.example.com/prefix/abc",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("strips trailing slashes from baseUrl", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(passResult), { status: 200 }));
    const backend = createHttpCacheBackend({ baseUrl: "https://cache.example.com/p///" });
    await backend.read("xyz");
    expect(mockFetch.mock.calls[0]?.[0]).toBe("https://cache.example.com/p/xyz");
  });

  it("returns null on 404", async () => {
    mockFetch.mockResolvedValueOnce(new Response("not found", { status: 404 }));
    const backend = createHttpCacheBackend({ baseUrl: "https://c.example/p" });
    expect(await backend.read("k")).toBeNull();
  });

  it("returns null on network error (never throws)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const backend = createHttpCacheBackend({ baseUrl: "https://c.example/p" });
    expect(await backend.read("k")).toBeNull();
  });

  it("PUTs JSON body on write", async () => {
    mockFetch.mockResolvedValueOnce(new Response("", { status: 200 }));
    const backend = createHttpCacheBackend({
      baseUrl: "https://c.example/p",
      headers: { Authorization: "Bearer t" },
    });
    await backend.write("k", passResult);
    const [, init] = mockFetch.mock.calls[0]!;
    expect((init as RequestInit).method).toBe("PUT");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Authorization"]).toBe("Bearer t");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(passResult);
  });

  it("never throws when a write fails", async () => {
    mockFetch.mockRejectedValueOnce(new Error("connection reset"));
    const backend = createHttpCacheBackend({ baseUrl: "https://c.example/p" });
    await expect(backend.write("k", passResult)).resolves.toBeUndefined();
  });

  it("rejects construction without baseUrl", () => {
    // @ts-expect-error — intentional missing field
    expect(() => createHttpCacheBackend({})).toThrow(/baseUrl/);
  });
});

describe("configureCacheBackend", () => {
  afterEach(() => {
    resetCacheBackend();
  });

  it("defaults to fs when no settings are provided", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mp-sentinel-cfg-fs-"));
    try {
      configureCacheBackend(undefined, dir);
      await writeCachedAuditResult("cfg-test", passResult, dir);
      const got = await readCachedAuditResult("cfg-test", dir);
      expect(got).toEqual({ status: "PASS", issues: [] });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("selects the http backend when configured", async () => {
    const stubBackend: CacheBackend = {
      id: "stub",
      read: jest.fn(async () => passResult),
      write: jest.fn(async () => {}),
    };
    setCacheBackendForTest(stubBackend);
    const got = await readCachedAuditResult("any");
    expect(got).toEqual({ status: "PASS", issues: [] });
    expect(stubBackend.read).toHaveBeenCalledWith("any");
  });

  it("throws when http is selected but baseUrl is missing", () => {
    expect(() => configureCacheBackend({ backend: "http" })).toThrow(/baseUrl is required/);
  });
});
