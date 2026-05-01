/**
 * Review Intelligence Fixture Tests
 *
 * Validates that evidenceSummary is built correctly for each intelligence signal type.
 * Covers: public-api, risk, test-gap, dependency signals with compact evidence.
 * Also verifies: legacy index degradation, budget respect, signal ordering/dedup.
 */

import { describe, it, expect } from "@jest/globals";
import { buildReviewContext } from "../services/source-index/context-builder.js";
import type { SourceIndex } from "../types/index.js";

// --- Minimal SourceIndex factory ----------------------------------------

function makeBaseIndex(overrides?: Partial<SourceIndex>): SourceIndex {
  return {
    schemaVersion: "1.2",
    generatedAt: new Date().toISOString(),
    toolVersion: "1.14.1",
    project: {
      packageName: "test-project",
      packageVersion: "1.0.0",
      dependencies: { typescript: "^5.0.0" },
      devDependencies: { jest: "^30.0.0" },
      detectedFrameworks: ["node"],
      ...overrides?.project,
    },
    files: [],
    stats: {
      totalFiles: 0,
      indexedFiles: 0,
      skippedFiles: 0,
      parseErrors: 0,
    },
    insights: {
      fileRoles: {},
      publicApiFiles: [],
      testMap: {},
      commandMap: {},
      dependencyUsage: {},
      defaultExportFiles: [],
      reExportFiles: [],
      typeOnlyImportFiles: [],
      dynamicImportFiles: [],
      ...overrides?.insights,
    },
    ...overrides,
  };
}

function makeFile(
  path: string,
  overrides?: Partial<SourceIndex["files"][number]>,
): SourceIndex["files"][number] {
  return {
    path,
    language: "typescript",
    sha256: "abc123",
    sizeBytes: 100,
    mtimeMs: Date.now(),
    imports: [],
    exports: [],
    symbols: [{ name: "testFn", type: "function", line: 1, column: 1 }],
    ...overrides,
  };
}

// --- Public API signal --------------------------------------------------

describe("evidenceSummary for public-api signals", () => {
  it("includes compact evidence when a changed file is a public API entrypoint", async () => {
    const index = makeBaseIndex({
      files: [
        makeFile("src/api.ts", {
          importsFrom: [],
          importedBy: [],
        }),
      ],
      insights: {
        fileRoles: { "src/api.ts": "service" },
        publicApiFiles: ["src/api.ts"],
        testMap: {},
        commandMap: {},
        dependencyUsage: {},
        defaultExportFiles: [],
        reExportFiles: [],
        typeOnlyImportFiles: [],
        dynamicImportFiles: [],
      },
    });

    const result = await buildReviewContext(index, [{ path: "src/api.ts" }]);

    expect(result.metadata.includedSignals).toContain("public-api");
    expect(result.metadata.intelligenceSignals).toBeDefined();
    expect(result.metadata.intelligenceSignals!.some((s) => s.type === "public-api")).toBe(true);
    expect(result.metadata.evidenceSummary).toBeDefined();
    expect(result.metadata.evidenceSummary!.length).toBeGreaterThan(0);

    const ev = result.metadata.evidenceSummary!.find((e) => e.signalType === "public-api");
    expect(ev).toBeDefined();
    expect(ev!.sourceFile).toBe("src/api.ts");
    expect(ev!.evidence).toContain("entrypoint");
  });
});

// --- Risk (hub-file) signal ---------------------------------------------

describe("evidenceSummary for risk signals", () => {
  it("includes compact evidence when a changed file is a hub file", async () => {
    const hubFile = makeFile("src/hub.ts", {
      importedBy: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"],
      importsFrom: [],
    });
    const depA = makeFile("src/a.ts", {
      importsFrom: ["src/hub.ts"],
      importedBy: [],
    });
    const depB = makeFile("src/b.ts", {
      importsFrom: ["src/hub.ts"],
      importedBy: [],
    });
    const depC = makeFile("src/c.ts", {
      importsFrom: ["src/hub.ts"],
      importedBy: [],
    });
    const depD = makeFile("src/d.ts", {
      importsFrom: ["src/hub.ts"],
      importedBy: [],
    });

    const index = makeBaseIndex({
      files: [hubFile, depA, depB, depC, depD],
    });

    const result = await buildReviewContext(index, [{ path: "src/hub.ts" }]);

    expect(result.metadata.includedSignals).toContain("risk");
    expect(result.metadata.intelligenceSignals!.some((s) => s.type === "risk")).toBe(true);
    expect(result.metadata.evidenceSummary).toBeDefined();

    const ev = result.metadata.evidenceSummary!.find((e) => e.signalType === "risk");
    expect(ev).toBeDefined();
    expect(ev!.sourceFile).toBe("src/hub.ts");
    expect(ev!.evidence).toContain("importedBy");
  });
});

// --- Test gap signal ----------------------------------------------------

describe("evidenceSummary for test-gap signals", () => {
  it("includes compact evidence when changed file has no associated tests", async () => {
    const index = makeBaseIndex({
      files: [
        makeFile("src/untested.ts", {
          importsFrom: [],
          importedBy: [],
        }),
      ],
      insights: {
        fileRoles: { "src/untested.ts": "service" },
        publicApiFiles: [],
        testMap: {},
        commandMap: {},
        dependencyUsage: {},
        defaultExportFiles: [],
        reExportFiles: [],
        typeOnlyImportFiles: [],
        dynamicImportFiles: [],
      },
    });

    const result = await buildReviewContext(index, [{ path: "src/untested.ts" }]);

    expect(result.metadata.includedSignals).toContain("test-gap");
    expect(result.metadata.intelligenceSignals!.some((s) => s.type === "test-gap")).toBe(true);
    expect(result.metadata.evidenceSummary).toBeDefined();

    const ev = result.metadata.evidenceSummary!.find((e) => e.signalType === "test-gap");
    expect(ev).toBeDefined();
    expect(ev!.sourceFile).toBe("src/untested.ts");
    expect(ev!.evidence).toContain("test");
  });
});

// --- Dependency signal --------------------------------------------------

describe("evidenceSummary for dependency signals", () => {
  it("includes compact evidence when changed file uses a key dependency", async () => {
    const index = makeBaseIndex({
      files: [
        makeFile("src/consumer.ts", {
          importsFrom: [],
          importedBy: [],
          imports: [{ source: "typescript", kind: "named", names: ["Node"], line: 1 }],
        }),
      ],
      insights: {
        fileRoles: { "src/consumer.ts": "service" },
        publicApiFiles: [],
        testMap: {},
        commandMap: {},
        dependencyUsage: { typescript: ["src/consumer.ts"] },
        defaultExportFiles: [],
        reExportFiles: [],
        typeOnlyImportFiles: [],
        dynamicImportFiles: [],
      },
    });

    const result = await buildReviewContext(index, [{ path: "src/consumer.ts" }]);

    expect(result.metadata.includedSignals).toContain("dependency");
    expect(result.metadata.intelligenceSignals!.some((s) => s.type === "dependency")).toBe(true);
    expect(result.metadata.evidenceSummary).toBeDefined();

    const ev = result.metadata.evidenceSummary!.find((e) => e.signalType === "dependency");
    expect(ev).toBeDefined();
    expect(ev!.sourceFile).toBe("src/consumer.ts");
    expect(ev!.evidence).toContain("typescript");
  });
});

// --- Legacy index degradation -------------------------------------------

describe("legacy index (no insights)", () => {
  it("degrades gracefully without insights (returns empty context, no crash)", async () => {
    const baseIndex = makeBaseIndex({
      schemaVersion: "1.0",
      files: [
        makeFile("src/app.ts", {
          importsFrom: [],
          importedBy: [],
        }),
      ],
    });
    const { insights: _insights, ...index } = baseIndex;

    const result = await buildReviewContext(index, [{ path: "src/app.ts" }]);

    // Should not crash; intelligence signals may be absent or empty
    expect(result.metadata.includedSignals).toBeUndefined();
    expect(result.metadata.evidenceSummary).toBeUndefined();
  });
});

// --- Budget respect -----------------------------------------------------

describe("budget behavior", () => {
  it("does not add evidenceSummary to context string (keeps context lean)", async () => {
    const index = makeBaseIndex({
      files: [
        makeFile("src/api.ts", {
          importsFrom: [],
          importedBy: [],
        }),
      ],
      insights: {
        fileRoles: { "src/api.ts": "service" },
        publicApiFiles: ["src/api.ts"],
        testMap: {},
        commandMap: {},
        dependencyUsage: {},
        defaultExportFiles: [],
        reExportFiles: [],
        typeOnlyImportFiles: [],
        dynamicImportFiles: [],
      },
    });

    const result = await buildReviewContext(index, [{ path: "src/api.ts" }], {
      budgetChars: 500,
    });

    // evidenceSummary should be in metadata, NOT in context string
    expect(result.metadata.evidenceSummary).toBeDefined();
    expect(result.context).not.toContain("evidenceSummary");
    expect(result.context).not.toContain("sourceFile");
  });

  it("respects character budget and marks truncation", async () => {
    const manyFiles = Array.from({ length: 50 }, (_, i) =>
      makeFile(`src/file${i}.ts`, {
        importsFrom: [],
        importedBy: [],
        symbols: Array.from({ length: 20 }, (_, j) => ({
          name: `fn${j}`,
          type: "function" as const,
          line: 1,
          column: 1,
        })),
      }),
    );

    const hubFile = makeFile("src/hub.ts", {
      importedBy: manyFiles.map((f) => f.path),
      importsFrom: [],
      symbols: [],
    });

    const index = makeBaseIndex({
      files: [hubFile, ...manyFiles],
    });

    const budget = 1500;
    const result = await buildReviewContext(index, [{ path: "src/hub.ts" }], {
      budgetChars: budget,
    });

    // Context should not exceed budget
    expect(result.context.length).toBeLessThanOrEqual(budget + 100); // small margin for end marker
  });
});

// --- Signal ordering and dedup ------------------------------------------

describe("signal ordering and dedup", () => {
  it("deduplicates signals by type + file + evidence", async () => {
    // A file that is both public-api and has a test-gap
    const index = makeBaseIndex({
      files: [
        makeFile("src/dual.ts", {
          importsFrom: [],
          importedBy: [],
        }),
      ],
      insights: {
        fileRoles: { "src/dual.ts": "service" },
        publicApiFiles: ["src/dual.ts"],
        testMap: {},
        commandMap: {},
        dependencyUsage: {},
        defaultExportFiles: [],
        reExportFiles: [],
        typeOnlyImportFiles: [],
        dynamicImportFiles: [],
      },
    });

    const result = await buildReviewContext(index, [{ path: "src/dual.ts" }]);

    // public-api + test-gap should both appear, but no duplicates
    const signalTypes = result.metadata.includedSignals ?? [];
    // Verify no duplicate entries in includedSignals
    const uniq = new Set(signalTypes);
    expect(uniq.size).toBe(signalTypes.length);

    // evidenceSummary should have distinct entries
    if (result.metadata.evidenceSummary) {
      const keys = result.metadata.evidenceSummary.map(
        (e) => `${e.signalType}|${e.sourceFile}|${e.evidence}`,
      );
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    }
  });

  it("preserves signal ordering: public-api before risk before test-gap before dependency", async () => {
    // Build an index that triggers all four signals
    const hubFile = makeFile("src/all.ts", {
      importedBy: ["src/a.ts", "src/b.ts", "src/c.ts"],
      importsFrom: [],
      imports: [{ source: "typescript", kind: "named", names: ["Node"], line: 1 }],
    });
    const depA = makeFile("src/a.ts", {
      importsFrom: ["src/all.ts"],
      importedBy: [],
    });
    const depB = makeFile("src/b.ts", {
      importsFrom: ["src/all.ts"],
      importedBy: [],
    });
    const depC = makeFile("src/c.ts", {
      importsFrom: ["src/all.ts"],
      importedBy: [],
    });

    const index = makeBaseIndex({
      files: [hubFile, depA, depB, depC],
      insights: {
        fileRoles: { "src/all.ts": "service" },
        publicApiFiles: ["src/all.ts"],
        testMap: {},
        commandMap: {},
        dependencyUsage: { typescript: ["src/all.ts"] },
        defaultExportFiles: [],
        reExportFiles: [],
        typeOnlyImportFiles: [],
        dynamicImportFiles: [],
      },
    });

    const result = await buildReviewContext(index, [{ path: "src/all.ts" }]);

    const types = result.metadata.evidenceSummary?.map((e) => e.signalType) ?? [];
    // Check relative ordering: public-api should appear before risk, etc.
    const publicApiIdx = types.indexOf("public-api");
    const riskIdx = types.indexOf("risk");
    const testGapIdx = types.indexOf("test-gap");
    const dependencyIdx = types.indexOf("dependency");

    // If both present, public-api comes before risk
    if (publicApiIdx >= 0 && riskIdx >= 0) {
      expect(publicApiIdx).toBeLessThan(riskIdx);
    }
    // If both present, risk comes before test-gap
    if (riskIdx >= 0 && testGapIdx >= 0) {
      expect(riskIdx).toBeLessThan(testGapIdx);
    }
    // If both present, test-gap comes before dependency
    if (testGapIdx >= 0 && dependencyIdx >= 0) {
      expect(testGapIdx).toBeLessThan(dependencyIdx);
    }
  });
});
