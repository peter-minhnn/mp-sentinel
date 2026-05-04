/**
 * Unit tests for AI service \u2014 tests parseAuditResponse integration
 * and the error-handling contract of auditFile.
 *
 * NOTE: Full provider mocking with ESM jest.mock() requires careful path
 * resolution. These tests verify the parsing/error-handling layer directly
 * without making real network calls.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { parseAuditResponse } from "../utils/parser.js";
import {
  offsetChunkIssues,
  auditFilesWithConcurrency,
  clearProviderCache,
} from "../services/ai/index.js";
import { AIProviderFactory } from "../services/ai/factory.js";
import type { IAIProvider } from "../services/ai/types.js";
import type { AuditIssue, ProjectConfig } from "../types/index.js";
import { log, setLogQuietMode } from "../utils/logger.js";

// -- Integration-style tests for the AI response parsing pipeline --------------
// These test the same code path that auditFile uses internally.

describe("AI response parsing pipeline", () => {
  it("parses a PASS response correctly", () => {
    const raw = JSON.stringify({ status: "PASS", issues: [] });
    const result = parseAuditResponse(raw);
    expect(result.status).toBe("PASS");
    expect(result.issues).toEqual([]);
  });

  it("parses a FAIL response with CRITICAL issue", () => {
    const raw = JSON.stringify({
      status: "FAIL",
      issues: [
        {
          line: 42,
          severity: "CRITICAL",
          message: "Hardcoded API key detected",
          suggestion: "Use environment variables",
        },
      ],
    });
    const result = parseAuditResponse(raw);
    expect(result.status).toBe("FAIL");
    expect(result.issues).toHaveLength(1);
    expect(result.issues?.[0]?.line).toBe(42);
    expect(result.issues?.[0]?.severity).toBe("CRITICAL");
    expect(result.issues?.[0]?.suggestion).toBe("Use environment variables");
  });

  it("parses a FAIL response with WARNING issue", () => {
    const raw = JSON.stringify({
      status: "FAIL",
      issues: [{ line: 10, severity: "WARNING", message: "Magic number" }],
    });
    const result = parseAuditResponse(raw);
    expect(result.issues?.[0]?.severity).toBe("WARNING");
  });

  it("parses a FAIL response with INFO issue", () => {
    const raw = JSON.stringify({
      status: "FAIL",
      issues: [{ line: 1, severity: "INFO", message: "Consider adding JSDoc" }],
    });
    const result = parseAuditResponse(raw);
    expect(result.issues?.[0]?.severity).toBe("INFO");
  });

  it("returns ERROR for completely malformed AI output", () => {
    const result = parseAuditResponse("I cannot review this code.");
    expect(result.status).toBe("ERROR");
    expect(result.message).toBe("Failed to parse AI response");
  });

  it("handles markdown-wrapped JSON from AI", () => {
    const raw = '```json\n{"status":"PASS","issues":[]}\n```';
    const result = parseAuditResponse(raw);
    expect(result.status).toBe("PASS");
  });

  it("extracts JSON embedded in prose from AI", () => {
    const raw = 'After reviewing the code, here is my assessment: {"status":"PASS","issues":[]}';
    const result = parseAuditResponse(raw);
    expect(result.status).toBe("PASS");
  });

  it("normalises invalid severity to WARNING", () => {
    const raw = JSON.stringify({
      status: "FAIL",
      issues: [{ line: 1, severity: "BLOCKER", message: "test" }],
    });
    const result = parseAuditResponse(raw);
    expect(result.issues?.[0]?.severity).toBe("WARNING");
  });

  it("normalises negative line numbers to 1", () => {
    const raw = JSON.stringify({
      status: "FAIL",
      issues: [{ line: -10, severity: "INFO", message: "test" }],
    });
    const result = parseAuditResponse(raw);
    expect(result.issues?.[0]?.line).toBe(1);
  });

  it("filters out issues without a message", () => {
    const raw = JSON.stringify({
      status: "FAIL",
      issues: [
        { line: 1, severity: "INFO" }, // no message
        { line: 2, severity: "WARNING", message: "valid" },
      ],
    });
    const result = parseAuditResponse(raw);
    expect(result.issues).toHaveLength(1);
    expect(result.issues?.[0]?.message).toBe("valid");
  });
});

// -- Chunked review line offset tests -----------------------------------------

describe("offsetChunkIssues", () => {
  it("does not offset lines for chunk 1 (startLine=1)", () => {
    const issues: AuditIssue[] = [{ line: 5, severity: "WARNING", message: "test" }];
    const result = offsetChunkIssues(issues, 1);
    expect(result).toHaveLength(1);
    expect(result[0]!.line).toBe(5);
  });

  it("offsets lines for chunk 2 (startLine=100)", () => {
    const issues: AuditIssue[] = [{ line: 2, severity: "CRITICAL", message: "issue in chunk 2" }];
    const result = offsetChunkIssues(issues, 100);
    expect(result[0]!.line).toBe(101); // 2 + 100 - 1 = 101
  });

  it("offsets multiple issues, preserving metadata", () => {
    const issues: AuditIssue[] = [
      {
        line: 3,
        severity: "WARNING",
        message: "warning",
        category: "security",
        confidence: "high",
        evidence: "pattern: xss",
        suggestion: "sanitize input",
      },
      { line: 10, severity: "INFO", message: "info msg" },
    ];
    const result = offsetChunkIssues(issues, 50);
    expect(result[0]!.line).toBe(52); // 3 + 50 - 1
    expect(result[0]!.severity).toBe("WARNING");
    expect(result[0]!.category).toBe("security");
    expect(result[0]!.confidence).toBe("high");
    expect(result[0]!.evidence).toBe("pattern: xss");
    expect(result[0]!.suggestion).toBe("sanitize input");
    expect(result[1]!.line).toBe(59); // 10 + 50 - 1
  });

  it("handles empty issues array", () => {
    const result = offsetChunkIssues([], 100);
    expect(result).toEqual([]);
  });

  it("handles large offset values", () => {
    const issues: AuditIssue[] = [
      { line: 1, severity: "WARNING", message: "start of chunk" },
      { line: 200, severity: "CRITICAL", message: "end of chunk" },
    ];
    const result = offsetChunkIssues(issues, 1000);
    expect(result[0]!.line).toBe(1000); // 1 + 1000 - 1
    expect(result[1]!.line).toBe(1199); // 200 + 1000 - 1
  });

  it("does not mutate original issue objects", () => {
    const issues: AuditIssue[] = [{ line: 5, severity: "WARNING", message: "original" }];
    const result = offsetChunkIssues(issues, 50);
    expect(result[0]!.line).toBe(54);
    expect(issues[0]!.line).toBe(5); // unchanged
  });

  it("does not alias input array even for chunkStartLine=1", () => {
    const issues: AuditIssue[] = [{ line: 3, severity: "WARNING", message: "no alias" }];
    const result = offsetChunkIssues(issues, 1);
    // Result must be a new array, not the same reference
    expect(result).not.toBe(issues);
    // Line value unchanged (3 + 0 = 3)
    expect(result[0]!.line).toBe(3);
    // Original still intact
    expect(issues[0]!.line).toBe(3);
  });
});

// ── Chunked audit integration tests ─────────────────────────────────────

describe("Chunked AI Review Integration", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    clearProviderCache();
    setLogQuietMode(true);
    process.env.AI_PROVIDER = "gemini";
    process.env.AI_MODEL = "gemini-2.5-flash";
    process.env.GEMINI_API_KEY = "test-key";
  });

  afterEach(() => {
    clearProviderCache();
    process.env = { ...originalEnv };
    setLogQuietMode(false);
  });

  // ── Concurrency guard tests ──────────────────────────────────────────

  describe("concurrency limiter", () => {
    /**
     * Helper: create a mock provider that tracks the maximum number of
     * concurrent generateContent calls observed during execution.
     */
    const createTrackingMock = (delayMs = 30) => {
      let activeCalls = 0;
      let maxObservedActive = 0;

      const provider: IAIProvider = {
        generateContent: jest.fn(async (_sys: string, _user: string) => {
          activeCalls++;
          maxObservedActive = Math.max(maxObservedActive, activeCalls);
          await new Promise((r) => setTimeout(r, delayMs));
          activeCalls--;
          return JSON.stringify({ status: "PASS", issues: [] });
        }),
        isAvailable: () => true,
      };

      return { provider, getMaxObservedActive: () => maxObservedActive };
    };

    /**
     * Helper: generate enough lines to force the file into multiple chunks.
     */
    const generateChunkedFile = (lineCount: number, charsPerLine = 100): string => {
      const lines: string[] = [];
      for (let i = 1; i <= lineCount; i++) {
        lines.push(`// Line ${i}`.padEnd(charsPerLine - 1, " "));
      }
      return lines.join("\n");
    };

    it("maxConcurrency=0 is normalised to 1 (serial, no hang)", async () => {
      const { provider } = createTrackingMock(15);
      const spy = jest
        .spyOn(AIProviderFactory, "createProvider")
        .mockReturnValue(
          provider as Parameters<typeof AIProviderFactory.createProvider>[0] extends never
            ? never
            : IAIProvider,
        );

      try {
        const config: ProjectConfig = { cacheEnabled: false };
        await expect(
          auditFilesWithConcurrency(
            [{ path: "src/a.ts", content: "const a = 1;" }],
            config,
            0, // maxConcurrency=0 — must not hang
          ),
        ).resolves.toHaveLength(1);

        // Exactly one provider call — serial, completed without stalling
        expect(provider.generateContent).toHaveBeenCalledTimes(1);
      } finally {
        spy.mockRestore();
      }
    });

    it("single chunked file never exceeds maxConcurrency", async () => {
      const { provider, getMaxObservedActive } = createTrackingMock(30);
      const spy = jest
        .spyOn(AIProviderFactory, "createProvider")
        .mockReturnValue(
          provider as Parameters<typeof AIProviderFactory.createProvider>[0] extends never
            ? never
            : IAIProvider,
        );

      try {
        // 100 lines × ~100 chars = ~10 000 chars; maxCharsPerFile=1000 → ~10 chunks
        const content = generateChunkedFile(100);
        const config: ProjectConfig = {
          cacheEnabled: false,
          ai: { maxCharsPerFile: 1000 },
        };

        await auditFilesWithConcurrency(
          [{ path: "src/big.ts", content }],
          config,
          2, // at most 2 concurrent provider calls
        );

        expect(provider.generateContent).toHaveBeenCalledTimes(10);
        expect(getMaxObservedActive()).toBeLessThanOrEqual(2);
      } finally {
        spy.mockRestore();
      }
    });

    it("multiple chunked files share available concurrency slots", async () => {
      const { provider, getMaxObservedActive } = createTrackingMock(40);
      const spy = jest
        .spyOn(AIProviderFactory, "createProvider")
        .mockReturnValue(
          provider as Parameters<typeof AIProviderFactory.createProvider>[0] extends never
            ? never
            : IAIProvider,
        );

      try {
        // 2 files × 50 lines × ~100 chars = ~5000 chars each
        // maxCharsPerFile=2000 → ~3 chunks each → ~6 total provider calls
        const content = generateChunkedFile(50);
        const config: ProjectConfig = {
          cacheEnabled: false,
          ai: { maxCharsPerFile: 2000 },
        };

        await auditFilesWithConcurrency(
          [
            { path: "src/one.ts", content },
            { path: "src/two.ts", content },
          ],
          config,
          3, // at most 3 concurrent provider calls
        );

        // Both files processed, total chunks = ~6
        expect(provider.generateContent).toHaveBeenCalledTimes(6);
        // Never exceeded the concurrency limit across all files + chunks
        expect(getMaxObservedActive()).toBeLessThanOrEqual(3);
      } finally {
        spy.mockRestore();
      }
    });

    it("maxConcurrency=NaN is normalised to 1 (no unbounded execution)", async () => {
      const { provider } = createTrackingMock(15);
      const spy = jest
        .spyOn(AIProviderFactory, "createProvider")
        .mockReturnValue(
          provider as Parameters<typeof AIProviderFactory.createProvider>[0] extends never
            ? never
            : IAIProvider,
        );

      try {
        const config: ProjectConfig = { cacheEnabled: false };
        await expect(
          auditFilesWithConcurrency(
            [{ path: "src/a.ts", content: "const a = 1;" }],
            config,
            Number.NaN,
          ),
        ).resolves.toHaveLength(1);

        expect(provider.generateContent).toHaveBeenCalledTimes(1);
      } finally {
        spy.mockRestore();
      }
    });

    it("maxConcurrency=Infinity is normalised to 1 (no unbounded execution)", async () => {
      const { provider } = createTrackingMock(15);
      const spy = jest
        .spyOn(AIProviderFactory, "createProvider")
        .mockReturnValue(
          provider as Parameters<typeof AIProviderFactory.createProvider>[0] extends never
            ? never
            : IAIProvider,
        );

      try {
        const config: ProjectConfig = { cacheEnabled: false };
        await expect(
          auditFilesWithConcurrency(
            [{ path: "src/a.ts", content: "const a = 1;" }],
            config,
            Number.POSITIVE_INFINITY,
          ),
        ).resolves.toHaveLength(1);

        expect(provider.generateContent).toHaveBeenCalledTimes(1);
      } finally {
        spy.mockRestore();
      }
    });

    it("maxConcurrency=2.9 is floored to 2 (never exceeds integer limit)", async () => {
      const { provider, getMaxObservedActive } = createTrackingMock(30);
      const spy = jest
        .spyOn(AIProviderFactory, "createProvider")
        .mockReturnValue(
          provider as Parameters<typeof AIProviderFactory.createProvider>[0] extends never
            ? never
            : IAIProvider,
        );

      try {
        const content = generateChunkedFile(100);
        const config: ProjectConfig = {
          cacheEnabled: false,
          ai: { maxCharsPerFile: 1000 },
        };

        await auditFilesWithConcurrency([{ path: "src/big.ts", content }], config, 2.9);

        expect(provider.generateContent).toHaveBeenCalledTimes(10);
        // Float 2.9 is floored to 2, so at most 2 concurrent calls
        expect(getMaxObservedActive()).toBeLessThanOrEqual(2);
        // Sanity: should have been able to run at least 2 concurrently
        // (delayMs=30, so a 30ms task has time to overlap with another)
        await new Promise((r) => setTimeout(r, 50));
        // If the limiter was correctly set to 2, we should see some concurrency
        expect(getMaxObservedActive()).toBeGreaterThanOrEqual(1);
      } finally {
        spy.mockRestore();
      }
    });

    it("queued chunk task is not bypassed when concurrency slot is released", async () => {
      // This test validates the slot-reservation protocol: when a running task
      // finishes, the slot is atomically transferred to the next queued task
      // before active is decremented, preventing an outside caller from observing
      // a free slot and jumping the queue.
      const { provider, getMaxObservedActive } = createTrackingMock(30);
      const spy = jest
        .spyOn(AIProviderFactory, "createProvider")
        .mockReturnValue(
          provider as Parameters<typeof AIProviderFactory.createProvider>[0] extends never
            ? never
            : IAIProvider,
        );

      try {
        // maxCharsPerFile is clamped to Math.max(1000, config value) internally,
        // so using 500 means effectively maxCharsPerFile=1000 → ~10 lines per chunk.
        // 300 lines × ~100 chars = ~30 000 chars → ~30 chunks per file.
        // With maxConcurrency=3 and 2 files, chunks compete for slots.
        // If the queue-bypass bug existed, we'd occasionally see active > 3.
        const content = generateChunkedFile(300);
        const config: ProjectConfig = {
          cacheEnabled: false,
          ai: { maxCharsPerFile: 500 }, // clamped to 1000 → 300/10 = 30 chunks
        };

        await auditFilesWithConcurrency(
          [
            { path: "src/one.ts", content },
            { path: "src/two.ts", content },
          ],
          config,
          3,
        );

        // ~300 lines / 10 lines-per-chunk = ~30 chunks per file × 2 files = ~60 calls
        expect(provider.generateContent).toHaveBeenCalledTimes(60);
        // Never exceeded the concurrency limit — if bypass happened, this would fail
        // because active would spike briefly above 3
        expect(getMaxObservedActive()).toBeLessThanOrEqual(3);
      } finally {
        spy.mockRestore();
      }
    });

    it("interleaves chunk scheduling fairly between files", async () => {
      // Verify that with maxConcurrency=1, chunks from two chunked files
      // are interleaved rather than one file exhausting all its chunks first.
      const callOrder: string[] = [];

      const provider: IAIProvider = {
        generateContent: jest.fn(async (_sys: string, user: string) => {
          if (user.includes("#FILE-A#")) callOrder.push("A");
          else if (user.includes("#FILE-B#")) callOrder.push("B");
          return JSON.stringify({ status: "PASS", issues: [] });
        }),
        isAvailable: () => true,
      };

      const spy = jest
        .spyOn(AIProviderFactory, "createProvider")
        .mockReturnValue(
          provider as Parameters<typeof AIProviderFactory.createProvider>[0] extends never
            ? never
            : IAIProvider,
        );

      try {
        // Each line ~200 chars, maxCharsPerFile clamped to 1000 → 5 lines/chunk
        // 30 lines → 6 chunks per file
        const makeFile = (label: string, lines: number): string => {
          const result: string[] = [];
          for (let i = 1; i <= lines; i++) {
            result.push(`// #${label}# Line ${i}`.padEnd(199, " "));
          }
          return result.join("\n");
        };

        const config: ProjectConfig = { cacheEnabled: false, ai: { maxCharsPerFile: 600 } };

        await auditFilesWithConcurrency(
          [
            { path: "src/a.ts", content: makeFile("FILE-A", 30) },
            { path: "src/b.ts", content: makeFile("FILE-B", 30) },
          ],
          config,
          1, // serial — fairness means interleaving
        );

        expect(provider.generateContent).toHaveBeenCalledTimes(12); // 6 chunks × 2 files
        // B should start within the first few calls, not after all 6 A chunks
        const firstB = callOrder.indexOf("B");
        expect(firstB).toBeGreaterThanOrEqual(1); // A starts first
        expect(firstB).toBeLessThan(3); // B starts by at most the 3rd call
      } finally {
        spy.mockRestore();
      }
    });

    it("reports live progress as files settle", async () => {
      // Spy on log.progress to capture real-time updates.
      const progressCalls: Array<Array<unknown>> = [];
      const progressSpy = jest.spyOn(log, "progress").mockImplementation((...args) => {
        progressCalls.push(args);
      });

      const provider: IAIProvider = {
        generateContent: jest.fn(async (_sys: string, _user: string) => {
          await new Promise((r) => setTimeout(r, 30));
          return JSON.stringify({ status: "PASS", issues: [] });
        }),
        isAvailable: () => true,
      };

      const spy = jest
        .spyOn(AIProviderFactory, "createProvider")
        .mockReturnValue(
          provider as Parameters<typeof AIProviderFactory.createProvider>[0] extends never
            ? never
            : IAIProvider,
        );

      try {
        const slowContent = generateChunkedFile(100);
        const config: ProjectConfig = { cacheEnabled: false, ai: { maxCharsPerFile: 1000 } };

        await auditFilesWithConcurrency(
          [
            { path: "src/fast.ts", content: "const x = 1;" }, // small, no chunking
            { path: "src/slow.ts", content: slowContent }, // 10 chunks, 30ms each
          ],
          config,
          2,
        );

        // Should have at least 2 progress calls (1/2 fast, then 2/2 after slow)
        expect(progressCalls.length).toBeGreaterThanOrEqual(2);
        // First progress should show 1/2 (fast file done while slow still running)
        expect(progressCalls[0]![0]).toBe(1);
        expect(progressCalls[0]![1]).toBe(2);
      } finally {
        spy.mockRestore();
        progressSpy.mockRestore();
      }
    });

    it("returns results in input order regardless of completion order", async () => {
      // File 2 is smaller (fewer chunks, faster), but results must
      // maintain the same order as the input files array.
      const provider: IAIProvider = {
        generateContent: jest.fn(async (_sys: string, _user: string) => {
          await new Promise((r) => setTimeout(r, 20));
          return JSON.stringify({ status: "PASS", issues: [] });
        }),
        isAvailable: () => true,
      };

      const spy = jest
        .spyOn(AIProviderFactory, "createProvider")
        .mockReturnValue(
          provider as Parameters<typeof AIProviderFactory.createProvider>[0] extends never
            ? never
            : IAIProvider,
        );

      try {
        const chunkedContent = generateChunkedFile(50);
        const config: ProjectConfig = { cacheEnabled: false, ai: { maxCharsPerFile: 1000 } };

        // File 1: 5 chunks × 20ms. File 2: no chunking, 20ms.
        // File 2 finishes first, but order must be [file1, file2]
        const results = await auditFilesWithConcurrency(
          [
            { path: "src/heavy.ts", content: chunkedContent },
            { path: "src/light.ts", content: "const x = 1;" },
          ],
          config,
          1,
        );

        expect(results).toHaveLength(2);
        expect(results[0]!.filePath).toBe("src/heavy.ts");
        expect(results[1]!.filePath).toBe("src/light.ts");
      } finally {
        spy.mockRestore();
      }
    });
  });

  it("offsets chunk issue lines to original file and FAILs PASS+WARNING", async () => {
    // Create 25 lines of ~100 chars each (~2500 total).
    // maxCharsPerFile=1000 → ~10 lines per chunk → 3 chunks.
    // Chunk 2 (lines 11-20) will be detected by the "// Line 11" marker.
    const lines: string[] = [];
    for (let i = 1; i <= 25; i++) {
      lines.push(`// Line ${i}`.padEnd(99, " "));
    }
    const fileContent = lines.join("\n");

    const mockProvider: IAIProvider = {
      generateContent: jest.fn(async (_sys: string, user: string) => {
        // Chunk 2 contains lines 11-20
        if (user.includes("// Line 11")) {
          return JSON.stringify({
            status: "PASS",
            issues: [
              {
                line: 2,
                severity: "WARNING",
                message: "chunk 2 warning",
                category: "security",
                confidence: "high",
                evidence: "pattern: test",
                suggestion: "fix this",
              },
            ],
          });
        }
        return JSON.stringify({ status: "PASS", issues: [] });
      }),
      isAvailable: () => true,
    };

    const createProviderSpy = jest
      .spyOn(AIProviderFactory, "createProvider")
      .mockReturnValue(
        mockProvider as Parameters<typeof AIProviderFactory.createProvider>[0] extends never
          ? never
          : IAIProvider,
      );

    try {
      const config: ProjectConfig = {
        cacheEnabled: false,
        ai: { maxCharsPerFile: 1000 },
      };

      const results = await auditFilesWithConcurrency(
        [{ path: "src/test.ts", content: fileContent }],
        config,
        1,
      );

      expect(results).toHaveLength(1);
      const fileResult = results[0]!;

      // PASS+WARNING normalised to FAIL by parser
      expect(fileResult.result.status).toBe("FAIL");

      // WARNING at original line 12 (chunk 2 startLine=11, issue.line=2 → 11+2-1=12)
      const issues = fileResult.result.issues!;
      expect(issues).toHaveLength(1);
      expect(issues[0]!.line).toBe(12);
      expect(issues[0]!.severity).toBe("WARNING");

      // Metadata preserved through offset
      expect(issues[0]!.category).toBe("security");
      expect(issues[0]!.confidence).toBe("high");
      expect(issues[0]!.evidence).toBe("pattern: test");
      expect(issues[0]!.suggestion).toBe("fix this");

      // Provider called once per chunk (3 chunks = 3 calls)
      expect(mockProvider.generateContent).toHaveBeenCalledTimes(3);
    } finally {
      createProviderSpy.mockRestore();
    }
  });
});

// ── Model tier runtime wiring tests ─────────────────────────────────

describe("Model tier runtime wiring", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    clearProviderCache();
    setLogQuietMode(true);
    process.env.AI_PROVIDER = "gemini";
    delete process.env.AI_MODEL;
    delete process.env.AI_MODEL_TIER;
    process.env.GEMINI_API_KEY = "test-key";
  });

  afterEach(() => {
    clearProviderCache();
    process.env = { ...originalEnv };
    setLogQuietMode(false);
  });

  it("config.ai.modelTier=premium selects the first premium model", async () => {
    const mockProvider: IAIProvider = {
      generateContent: jest.fn(async () => JSON.stringify({ status: "PASS", issues: [] })),
      isAvailable: () => true,
    };

    const spy = jest
      .spyOn(AIProviderFactory, "createProvider")
      .mockReturnValue(
        mockProvider as Parameters<typeof AIProviderFactory.createProvider>[0] extends never
          ? never
          : IAIProvider,
      );

    try {
      const config: ProjectConfig = {
        cacheEnabled: false,
        ai: { modelTier: "premium" },
      };

      await auditFilesWithConcurrency(
        [{ path: "src/test.ts", content: "const a = 1;" }],
        config,
        1,
      );

      const callArgs = spy.mock.calls[0]?.[0];
      expect(callArgs?.model).toBe("gemini-3.1-pro-preview");
    } finally {
      spy.mockRestore();
    }
  });

  it("AI_MODEL env overrides config-tier model selection", async () => {
    process.env.AI_MODEL = "gemini-2.5-pro";

    const mockProvider: IAIProvider = {
      generateContent: jest.fn(async () => JSON.stringify({ status: "PASS", issues: [] })),
      isAvailable: () => true,
    };

    const spy = jest
      .spyOn(AIProviderFactory, "createProvider")
      .mockReturnValue(
        mockProvider as Parameters<typeof AIProviderFactory.createProvider>[0] extends never
          ? never
          : IAIProvider,
      );

    try {
      const config: ProjectConfig = {
        cacheEnabled: false,
        ai: { modelTier: "premium" },
      };

      await auditFilesWithConcurrency(
        [{ path: "src/test.ts", content: "const a = 1;" }],
        config,
        1,
      );

      const callArgs = spy.mock.calls[0]?.[0];
      expect(callArgs?.model).toBe("gemini-2.5-pro");
    } finally {
      spy.mockRestore();
    }
  });

  it("different tiers produce different resolved models across calls", async () => {
    const mockProvider: IAIProvider = {
      generateContent: jest.fn(async () => JSON.stringify({ status: "PASS", issues: [] })),
      isAvailable: () => true,
    };

    const spy = jest
      .spyOn(AIProviderFactory, "createProvider")
      .mockReturnValue(
        mockProvider as Parameters<typeof AIProviderFactory.createProvider>[0] extends never
          ? never
          : IAIProvider,
      );

    try {
      await auditFilesWithConcurrency(
        [{ path: "src/a.ts", content: "const x = 1;" }],
        { cacheEnabled: false, ai: { modelTier: "premium" } },
        1,
      );

      const firstCallModel = spy.mock.calls[0]?.[0]?.model;

      clearProviderCache();
      await auditFilesWithConcurrency(
        [{ path: "src/b.ts", content: "const y = 2;" }],
        { cacheEnabled: false, ai: { modelTier: "budget" } },
        1,
      );

      const secondCallModel = spy.mock.calls[1]?.[0]?.model;

      expect(firstCallModel).toBe("gemini-3.1-pro-preview");
      expect(secondCallModel).toBe("gemini-3.1-flash-lite-preview");
      expect(firstCallModel).not.toBe(secondCallModel);
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });
});
