import { describe, expect, it } from "@jest/globals";
import { rankTaskCandidates } from "../services/source-index/task-context.js";
import type { SourceIndex, SourceIndexFile } from "../types/index.js";

function fixture(): SourceIndex {
  const base = (path: string): SourceIndexFile => ({
    path,
    language: "typescript",
    sha256: "fixture",
    sizeBytes: 10,
    mtimeMs: 0,
    symbols: [],
    imports: [],
    exports: [],
  });
  const target = base("src/invoice-controller.ts");
  target.symbols.push({ name: "processInvoice", type: "function", line: 1, column: 0 });
  const barrel = base("src/shared/index.ts");
  barrel.imports.push({
    source: "./process-invoice-helper",
    names: ["helper"],
    kind: "namespace",
    line: 1,
  });
  return {
    schemaVersion: "1.5",
    generatedAt: "fixture",
    toolVersion: "test",
    project: { ecosystem: "node", dependencies: {}, devDependencies: {}, detectedFrameworks: [] },
    files: [target, barrel],
    stats: { totalFiles: 2, indexedFiles: 2, skippedFiles: 0, parseErrors: 0 },
  };
}

describe("file-level reciprocal rank fusion", () => {
  it("does not give an import barrel extra votes for repeating the same task terms", async () => {
    const index = fixture();
    const before = await rankTaskCandidates(index, "process invoice");
    for (let i = 0; i < 150; i++)
      index.files[1]!.imports.push({
        source: `./process-invoice-extra-${i}`,
        names: ["helper"],
        kind: "namespace",
        line: i + 2,
      });
    const after = await rankTaskCandidates(index, "process invoice");
    expect(after.records.map(({ file, score }) => ({ file, score }))).toEqual(
      before.records.map(({ file, score }) => ({ file, score })),
    );
    expect(after.records[0]?.file).toBe("src/invoice-controller.ts");
  });

  it("does not multiply symbol votes or hide other files behind a single file's overloads", async () => {
    const index = fixture();
    index.files[1]!.symbols = [
      { name: "processInvoiceHelper", type: "function", line: 1, column: 0 },
    ];
    const before = await rankTaskCandidates(index, "process invoice");
    for (let i = 0; i < 150; i++)
      index.files[1]!.symbols.push({
        name: `processInvoiceHelper${i}`,
        type: "function",
        line: i + 2,
        column: 0,
      });
    const after = await rankTaskCandidates(index, "process invoice");
    expect(after.records.map(({ file, score }) => ({ file, score }))).toEqual(
      before.records.map(({ file, score }) => ({ file, score })),
    );
  });
});
