import { describe, expect, it } from "@jest/globals";
import { buildCompactAgentContext } from "../services/source-index/agent-context-pack.js";
import { estimateTokens } from "../utils/tokens.js";
import type { SourceIndex, SourceIndexFile } from "../types/index.js";

function fixture(): SourceIndex {
  const symbols = Array.from({ length: 24 }, (_, i) => ({
    name: `findBatchPermissionRecordWithLongDescriptiveName${i}`,
    type: "method" as const,
    line: i + 2,
    column: 2,
    parent: "BatchService",
  }));
  symbols.push({
    name: "findBatchItemsByOwnerIds",
    type: "method",
    line: 30,
    column: 2,
    parent: "BatchService",
  });
  const file: SourceIndexFile = {
    path: "src/batch-service.ts",
    language: "typescript",
    sha256: "fixture",
    sizeBytes: 100,
    mtimeMs: 0,
    imports: [],
    exports: [],
    symbols,
    calls: Array.from({ length: 30 }, (_, i) => ({
      callee: `repository.findPermissionRecord${i}`,
      line: i + 2,
      column: 2,
      inSymbol: symbols[i % 24]!.name,
    })),
  };
  return {
    schemaVersion: "1.5",
    generatedAt: "2026-10-24",
    toolVersion: "test",
    project: { ecosystem: "node", dependencies: {}, devDependencies: {}, detectedFrameworks: [] },
    files: [file],
    stats: { totalFiles: 1, indexedFiles: 1, skippedFiles: 0, parseErrors: 0 },
  };
}

describe("focus specificity", () => {
  it("keeps callable evidence ahead of broad matching type declarations", async () => {
    const index = fixture();
    index.files[0]!.symbols = [
      ...Array.from({ length: 25 }, (_, i) => ({
        name: `RetryOptionsForScenario${i}`,
        type: "interface" as const,
        line: i + 1,
        column: 0,
      })),
      { name: "shouldRetry", type: "function", line: 30, column: 0 },
    ];
    const result = await buildCompactAgentContext(index, "src/batch-service.ts", {
      tokenBudget: 1200,
      focus: ["retry"],
    });
    expect(result.file?.symbols[0]?.name).toBe("shouldRetry");
    expect(result.usedTokens).toBeLessThanOrEqual(1200);
  });
  it("retains a method matching the task's own anchors despite many parent-only matches", async () => {
    const result = await buildCompactAgentContext(fixture(), "src/batch-service.ts", {
      tokenBudget: 1200,
      focus: ["BatchService", "items", "owner"],
    });
    expect(result.file?.symbols.some((symbol) => symbol.name === "findBatchItemsByOwnerIds")).toBe(
      true,
    );
    expect(result.file?.symbols[0]?.name).toBe("findBatchItemsByOwnerIds");
    expect(result.usedTokens).toBe(await estimateTokens(JSON.stringify(result)));
    expect(result.usedTokens).toBeLessThanOrEqual(1200);
  });
});
