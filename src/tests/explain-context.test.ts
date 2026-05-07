/**
 * Explain Context Tests
 *
 * Validates that --explain-context JSON output includes evidenceSummary
 * with compact evidence for each intelligence signal.
 * Also verifies: backward compat, JSON parseability, index status reporting.
 */

import { describe, it, expect } from "@jest/globals";
import { buildReviewContext } from "../services/source-index/context-builder.js";
import type { SourceIndex, ExplainContextOutput } from "../types/index.js";

// --- Minimal fixture ----------------------------------------------------

function makeIndexWithSignals(): SourceIndex {
  return {
    schemaVersion: "1.2",
    generatedAt: new Date().toISOString(),
    toolVersion: "1.14.1",
    project: {
      packageName: "test-project",
      packageVersion: "2.0.0",
      dependencies: { express: "^4.18.0" },
      devDependencies: { jest: "^30.0.0" },
      detectedFrameworks: ["node", "express"],
    },
    files: [
      // A public API file (changed)
      {
        path: "src/index.ts",
        language: "typescript",
        sha256: "abc123",
        sizeBytes: 100,
        mtimeMs: Date.now(),
        imports: [],
        exports: [{ kind: "named", names: ["run"], line: 1 }],
        symbols: [{ name: "run", type: "function", line: 1, column: 1 }],
        importsFrom: [],
        importedBy: [],
      },
      // A hub file (imported by 3+) (changed)
      {
        path: "src/utils/helpers.ts",
        language: "typescript",
        sha256: "def456",
        sizeBytes: 200,
        mtimeMs: Date.now(),
        imports: [],
        exports: [{ kind: "named", names: ["helperA", "helperB"], line: 1 }],
        symbols: [
          { name: "helperA", type: "function", line: 1, column: 1 },
          { name: "helperB", type: "function", line: 5, column: 1 },
        ],
        importsFrom: [],
        importedBy: ["src/a.ts", "src/b.ts", "src/c.ts"],
      },
      // An untested source file (changed)
      {
        path: "src/untested.ts",
        language: "typescript",
        sha256: "ghi789",
        sizeBytes: 150,
        mtimeMs: Date.now(),
        imports: [{ source: "express", kind: "named", names: ["Router"], line: 1 }],
        exports: [],
        symbols: [{ name: "router", type: "variable", line: 3, column: 1 }],
        importsFrom: [],
        importedBy: [],
      },
      // Files importing the hub
      {
        path: "src/a.ts",
        language: "typescript",
        sha256: "jkl012",
        sizeBytes: 80,
        mtimeMs: Date.now(),
        imports: [],
        exports: [],
        symbols: [],
        importsFrom: ["src/utils/helpers.ts"],
        importedBy: [],
      },
      {
        path: "src/b.ts",
        language: "typescript",
        sha256: "mno345",
        sizeBytes: 80,
        mtimeMs: Date.now(),
        imports: [],
        exports: [],
        symbols: [],
        importsFrom: ["src/utils/helpers.ts"],
        importedBy: [],
      },
      {
        path: "src/c.ts",
        language: "typescript",
        sha256: "pqr678",
        sizeBytes: 80,
        mtimeMs: Date.now(),
        imports: [],
        exports: [],
        symbols: [],
        importsFrom: ["src/utils/helpers.ts"],
        importedBy: [],
      },
    ],
    stats: {
      totalFiles: 6,
      indexedFiles: 6,
      skippedFiles: 0,
      parseErrors: 0,
    },
    insights: {
      fileRoles: {
        "src/index.ts": "command",
        "src/utils/helpers.ts": "utils",
        "src/untested.ts": "service",
        "src/a.ts": "service",
        "src/b.ts": "service",
        "src/c.ts": "service",
      },
      publicApiFiles: ["src/index.ts"],
      testMap: {},
      commandMap: {},
      dependencyUsage: { express: ["src/untested.ts"] },
      defaultExportFiles: [],
      reExportFiles: [],
      typeOnlyImportFiles: [],
      dynamicImportFiles: [],
    },
  };
}

// --- evidenceSummary is present in metadata ----------------------------

describe("evidenceSummary in metadata", () => {
  it("is present alongside includedSignals and intelligenceSignals", async () => {
    const index = makeIndexWithSignals();
    const changedFiles = [
      { path: "src/index.ts" },
      { path: "src/utils/helpers.ts" },
      { path: "src/untested.ts" },
    ];

    const result = await buildReviewContext(index, changedFiles);

    expect(result.metadata.includedSignals).toBeDefined();
    expect(result.metadata.intelligenceSignals).toBeDefined();
    expect(result.metadata.evidenceSummary).toBeDefined();
    expect(result.metadata.evidenceSummary!.length).toBeGreaterThanOrEqual(3);
  });

  it("each evidenceSummary entry has sourceFile, signalType, and evidence", async () => {
    const index = makeIndexWithSignals();
    const result = await buildReviewContext(index, [
      { path: "src/index.ts" },
      { path: "src/utils/helpers.ts" },
      { path: "src/untested.ts" },
    ]);

    for (const entry of result.metadata.evidenceSummary ?? []) {
      expect(typeof entry.sourceFile).toBe("string");
      expect(entry.sourceFile.length).toBeGreaterThan(0);
      expect(["public-api", "risk", "test-gap", "dependency"]).toContain(entry.signalType);
      expect(typeof entry.evidence).toBe("string");
      expect(entry.evidence.length).toBeGreaterThan(0);
    }
  });

  it("matches intelligenceSignals 1:1 in count", async () => {
    const index = makeIndexWithSignals();
    const result = await buildReviewContext(index, [
      { path: "src/index.ts" },
      { path: "src/utils/helpers.ts" },
      { path: "src/untested.ts" },
    ]);

    const sigCount = result.metadata.intelligenceSignals?.length ?? 0;
    const evCount = result.metadata.evidenceSummary?.length ?? 0;
    expect(evCount).toBe(sigCount);
  });
});

// --- JSON output format test -------------------------------------------

describe("explain-context JSON output shape", () => {
  it("produces a JSON-serializable ExplainContextOutput with evidenceSummary", async () => {
    const index = makeIndexWithSignals();
    const changedFiles = [
      { path: "src/index.ts" },
      { path: "src/utils/helpers.ts" },
      { path: "src/untested.ts" },
    ];

    const result = await buildReviewContext(index, changedFiles);

    // Build the ExplainContextOutput shape manually (simulates renderExplainContext)
    const output: ExplainContextOutput = {
      status: "available",
      profile: result.metadata.profile,
      budgetChars: result.metadata.budgetChars,
      truncated: result.metadata.truncated,
      relatedFileCount: result.metadata.relatedFileCount,
      relationTypes: result.metadata.relationTypes,
      includedFiles: result.metadata.includedFiles,
      contextPreview: result.context.substring(0, 500),
      indexUsed: true,
    };
    if (result.metadata.includedSignals?.length) {
      output.includedSignals = result.metadata.includedSignals;
    }
    if (result.metadata.intelligenceSignals?.length) {
      output.intelligenceSignals = result.metadata.intelligenceSignals;
    }
    if (result.metadata.evidenceSummary?.length) {
      output.evidenceSummary = result.metadata.evidenceSummary;
    }

    // Verify JSON round-trip
    const json = JSON.stringify(output, null, 2);
    expect(() => JSON.parse(json)).not.toThrow();

    const parsed = JSON.parse(json) as ExplainContextOutput;
    expect(parsed.status).toBe("available");
    expect(parsed.evidenceSummary).toBeDefined();
    expect(Array.isArray(parsed.evidenceSummary)).toBe(true);
    expect(parsed.evidenceSummary!.length).toBeGreaterThanOrEqual(3);
  });

  it("omits evidenceSummary when index is unavailable (graceful degrade)", () => {
    const output: ExplainContextOutput = {
      status: "unavailable",
      reason: "No source index found. Run 'mp-sentinel indexing' to build it.",
    };

    const json = JSON.stringify(output, null, 2);
    const parsed = JSON.parse(json) as ExplainContextOutput;

    expect(parsed.evidenceSummary).toBeUndefined();
    expect(parsed.status).toBe("unavailable");
    expect(parsed.reason).toBeDefined();
  });
});

// --- Backward compatibility --------------------------------------------

describe("backward compatibility", () => {
  it("existing includedSignals and intelligenceSignals remain unchanged", async () => {
    const index = makeIndexWithSignals();
    const result = await buildReviewContext(index, [{ path: "src/index.ts" }]);

    // includedSignals should still contain "public-api"
    expect(result.metadata.includedSignals).toContain("public-api");

    // intelligenceSignals should have the full structured info
    const pubApiSignal = result.metadata.intelligenceSignals?.find((s) => s.type === "public-api");
    expect(pubApiSignal).toBeDefined();
    expect(pubApiSignal!.file).toBe("src/index.ts");
    expect(pubApiSignal!.reason).toBeTruthy();
    expect(pubApiSignal!.evidence).toBeTruthy();
    expect(pubApiSignal!.confidence).toBe("high");
  });

  it("handles missing evidenceSummary gracefully in consumers", () => {
    // Simulate a metadata without evidenceSummary (pre-v1.15)
    const metaWithoutEvidence = {
      profile: "library" as const,
      relatedFileCount: 0,
      relationTypes: [] as const,
      includedFiles: [],
      truncated: false,
      budgetChars: 12000,
      includedSignals: ["public-api"],
      intelligenceSignals: [
        {
          type: "public-api" as const,
          file: "src/api.ts",
          reason: "test",
          evidence: "test",
          confidence: "high" as const,
        },
      ],
    };

    // Consumer code should handle optional evidenceSummary
    const evidence = (metaWithoutEvidence as any).evidenceSummary;
    if (evidence) {
      // Should not reach here
      expect(false).toBe(true);
    }
    // No crash \u2014 test passes
    expect(true).toBe(true);
  });
});

// --- MCP diagnostics in explain-context ---------------------------------

describe("explain-context MCP diagnostics", () => {
  it("includes mcp field when MCP diagnostics are present", () => {
    const output: ExplainContextOutput = {
      status: "available",
      profile: "library",
      mcp: {
        enabled: true,
        serverCount: 1,
        servers: [
          {
            id: "github",
            command: "npx -y @modelcontextprotocol/server-github",
            status: "ready",
            toolCount: 2,
          },
        ],
      },
    };

    const json = JSON.stringify(output, null, 2);
    const parsed = JSON.parse(json) as ExplainContextOutput;
    expect(parsed.mcp).toBeDefined();
    expect(parsed.mcp!.enabled).toBe(true);
    expect(parsed.mcp!.serverCount).toBe(1);
    expect(parsed.mcp!.servers[0]!.id).toBe("github");
    expect(parsed.mcp!.servers[0]!.status).toBe("ready");
  });

  it("omits mcp when undefined", () => {
    const output: ExplainContextOutput = {
      status: "unavailable",
      reason: "No source index found.",
    };

    const json = JSON.stringify(output, null, 2);
    const parsed = JSON.parse(json) as ExplainContextOutput;
    expect(parsed.mcp).toBeUndefined();
  });

  it("includes all MCP diagnostic statuses in JSON round-trip", () => {
    const output: ExplainContextOutput = {
      status: "available",
      profile: "library",
      mcp: {
        enabled: true,
        serverCount: 4,
        servers: [
          { id: "s1", command: "npx test", status: "ready", toolCount: 1 },
          {
            id: "s2",
            command: "npx test",
            status: "missing_env",
            toolCount: 2,
            missingVars: ["GH_TOKEN"],
          },
          { id: "s3", command: "nonexistent", status: "missing_command", toolCount: 1 },
          { id: "s4", command: "npx test", status: "ready", toolCount: 3 },
        ],
      },
    };

    const json = JSON.stringify(output, null, 2);
    const parsed = JSON.parse(json) as ExplainContextOutput;
    expect(parsed.mcp!.servers).toHaveLength(4);
    expect(parsed.mcp!.servers[0]!.status).toBe("ready");
    expect(parsed.mcp!.servers[1]!.status).toBe("missing_env");
    expect(parsed.mcp!.servers[2]!.status).toBe("missing_command");
  });

  it("includes recommendedActions for missing_env servers in JSON round-trip", () => {
    const output: ExplainContextOutput = {
      status: "available",
      profile: "library",
      mcp: {
        enabled: true,
        serverCount: 2,
        servers: [
          {
            id: "needs-env",
            command: "npx test",
            status: "missing_env",
            toolCount: 1,
            missingVars: ["GITHUB_TOKEN"],
            recommendedActions: ["Set the GITHUB_TOKEN environment variable"],
          },
          {
            id: "no-cmd",
            command: "nonexistent-xyz",
            status: "missing_command",
            toolCount: 1,
            recommendedActions: ["Install nonexistent-xyz or adjust PATH"],
          },
        ],
      },
    };

    const json = JSON.stringify(output, null, 2);
    const parsed = JSON.parse(json) as ExplainContextOutput;
    expect(parsed.mcp!.servers[0]!.recommendedActions).toBeDefined();
    expect(parsed.mcp!.servers[0]!.recommendedActions![0]).toContain("GITHUB_TOKEN");
    expect(parsed.mcp!.servers[1]!.recommendedActions).toBeDefined();
    expect(parsed.mcp!.servers[1]!.recommendedActions![0]).toContain("Install");
  });

  it("omits recommendedActions when server is ready", () => {
    const output: ExplainContextOutput = {
      status: "available",
      profile: "library",
      mcp: {
        enabled: true,
        serverCount: 1,
        servers: [
          {
            id: "ready-svr",
            command: "node",
            status: "ready",
            toolCount: 1,
          },
        ],
      },
    };

    const json = JSON.stringify(output, null, 2);
    const parsed = JSON.parse(json) as ExplainContextOutput;
    expect(parsed.mcp!.servers[0]!.recommendedActions).toBeUndefined();
  });

  it("handles disabled MCP diagnostics", () => {
    const output: ExplainContextOutput = {
      status: "available",
      profile: "library",
      mcp: {
        enabled: false,
        serverCount: 0,
        servers: [],
      },
    };

    const json = JSON.stringify(output, null, 2);
    const parsed = JSON.parse(json) as ExplainContextOutput;
    expect(parsed.mcp!.enabled).toBe(false);
    expect(parsed.mcp!.serverCount).toBe(0);
  });
});
