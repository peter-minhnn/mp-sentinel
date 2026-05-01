import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach, beforeEach } from "@jest/globals";

import { buildSourceIndex } from "../commands/indexing.js";
import { clearConfigCache } from "../utils/config.js";
import { clearParserCache } from "../services/source-index/parser.js";
import { buildReviewContext } from "../services/source-index/context-builder.js";
import type { SourceIndex } from "../types/index.js";

const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "mp-sentinel-review-context-"));
  tempDirs.push(dir);
  return dir;
};

beforeEach(() => {
  clearParserCache();
  process.argv = ["node", "mp-sentinel"];
});

afterEach(async () => {
  clearConfigCache();
  clearParserCache();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("buildReviewContext", () => {
  const makeIndexWithFiles = async (
    cwd: string,
    files: Record<string, string>,
  ): Promise<SourceIndex> => {
    await mkdir(join(cwd, "src"), { recursive: true });
    for (const [path, content] of Object.entries(files)) {
      await writeFile(join(cwd, path), content);
    }
    const index = await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );
    expect(index).not.toBeNull();
    return index!;
  };

  it("returns empty context when index is null", async () => {
    const result = await buildReviewContext(null, [{ path: "src/index.ts" }]);
    expect(result.context).toBe("");
    expect(result.metadata.relatedFileCount).toBe(0);
    expect(result.metadata.truncated).toBe(false);
  });

  it("returns empty context when >50% of files have parse errors", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"));
    await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
    await writeFile(join(cwd, "src", "file1.ts"), `export const x = 1;`);
    await writeFile(join(cwd, "src", "file2.ts"), `export const y = 1;`);
    await writeFile(join(cwd, "src", "file3.ts"), `export const z = 1;`);

    const index = await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );

    expect(index).not.toBeNull();
    // Set parse errors on all files (100% error rate)
    index!.files.forEach((f) => (f.parseErrors = ["synthetic parse error"]));

    const result = await buildReviewContext(index!, [{ path: "src/file1.ts" }]);
    expect(result.context).toBe("");
    expect(result.metadata.relatedFileCount).toBe(0);
    expect(result.metadata.profile).toBe("library");
  });

  it("includes profile-specific review pitfalls in context", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"));
    await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
    await writeFile(join(cwd, "src", "index.ts"), `export const x = 1;`);

    const index = await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );

    const result = await buildReviewContext(index!, [{ path: "src/index.ts" }]);

    expect(result.context).toContain("**Profile Review Pitfalls:**");
    // Library profile (default) pitfalls should be present
    expect(result.context).toContain("Public API surface");
    expect(result.context).toContain("Type definitions");
    expect(result.context).toContain("Peer dependencies");
    expect(result.context).toContain("Tree-shakeability");
    expect(result.metadata.profile).toBe("library");
  });

  it("orders files: changed \u2192 imports \u2192 dependents \u2192 hub", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"));
    await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
    await writeFile(
      join(cwd, "src", "index.ts"),
      `import { lib } from "./lib.js"; export const main = 1;`,
    );
    await writeFile(
      join(cwd, "src", "lib.ts"),
      `export const lib = 1; import { util } from "./util.js";`,
    );
    await writeFile(join(cwd, "src", "util.ts"), `export const util = 1;`);
    await writeFile(join(cwd, "src", "consumer.ts"), `import { main } from "./index.js";`);

    const index = await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );

    const result = await buildReviewContext(index!, [{ path: "src/index.ts" }], {
      maxRelatedFiles: 1,
    });

    const context = result.context;
    const indexPos = context.indexOf("File: src/index.ts");
    const libPos = context.indexOf("File: src/lib.ts");
    const utilPos = context.indexOf("File: src/util.ts");
    const consumerPos = context.indexOf("File: src/consumer.ts");

    expect(indexPos).toBeGreaterThanOrEqual(0);
    expect(libPos).toBeGreaterThanOrEqual(0);
    // util is 2 levels away, should not appear with maxRelatedFiles=1
    expect(utilPos).toBe(-1);
    // consumer is a direct dependent of index
    expect(consumerPos).toBeGreaterThanOrEqual(0);

    // Verify ordering: changed first, then imports (lib), then dependents (consumer)
    expect(indexPos).toBeLessThan(libPos);
    expect(libPos).toBeLessThan(consumerPos);
  });

  it("caps imports at maxRelatedFiles per changed file", async () => {
    const cwd = await makeTempDir();
    await makeIndexWithFiles(cwd, {
      "src/a.ts": `import { b } from "./b.js"; import { c } from "./c.js"; import { d } from "./d.js"; export const a = 1;`,
      "src/b.ts": `export const b = 1;`,
      "src/c.ts": `export const c = 1;`,
      "src/d.ts": `export const d = 1;`,
    });

    const index = await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );

    // Test with maxRelatedFiles = 1
    const result = await buildReviewContext(index!, [{ path: "src/a.ts" }], { maxRelatedFiles: 1 });

    const context = result.context;
    const bPos = context.indexOf("File: src/b.ts");
    const cPos = context.indexOf("File: src/c.ts");
    const dPos = context.indexOf("File: src/d.ts");

    expect(bPos).toBeGreaterThanOrEqual(0);
    expect(cPos).toBe(-1);
    expect(dPos).toBe(-1);

    // With maxRelatedFiles = 2, we should see 2 imports
    const result2 = await buildReviewContext(index!, [{ path: "src/a.ts" }], {
      maxRelatedFiles: 2,
    });
    const context2 = result2.context;
    const bPos2 = context2.indexOf("File: src/b.ts");
    const cPos2 = context2.indexOf("File: src/c.ts");
    const dPos2 = context2.indexOf("File: src/d.ts");

    expect(bPos2).toBeGreaterThanOrEqual(0);
    expect(cPos2).toBeGreaterThanOrEqual(0);
    expect(dPos2).toBe(-1);
  });

  it("caps dependents at maxRelatedFiles per changed file", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"));
    await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
    await writeFile(join(cwd, "src", "index.ts"), `export const main = 1;`);
    await writeFile(join(cwd, "src", "consumer1.ts"), `import { main } from "./index.js";`);
    await writeFile(join(cwd, "src", "consumer2.ts"), `import { main } from "./index.js";`);
    await writeFile(join(cwd, "src", "consumer3.ts"), `import { main } from "./index.js";`);

    const index = await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );

    const result = await buildReviewContext(index!, [{ path: "src/index.ts" }], {
      maxRelatedFiles: 1,
    });

    const context = result.context;
    const consumer1Pos = context.indexOf("File: src/consumer1.ts");
    const consumer2Pos = context.indexOf("File: src/consumer2.ts");
    const consumer3Pos = context.indexOf("File: src/consumer3.ts");

    const dependentCount = [consumer1Pos, consumer2Pos, consumer3Pos].filter(
      (pos) => pos >= 0,
    ).length;
    expect(dependentCount).toBe(1);
  });

  it("adds hub files only after imports/dependents", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"));
    await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
    // Create a hub file that is imported by many
    await writeFile(join(cwd, "src", "hub.ts"), `export const hub = 1;`);
    // Create several files that import the hub
    for (let i = 0; i < 5; i++) {
      await writeFile(
        join(cwd, "src", `file${i}.ts`),
        `import { hub } from "./hub.js"; export const file${i} = ${i};`,
      );
    }
    // Create a changed file that imports one of these
    await writeFile(
      join(cwd, "src", "changed.ts"),
      `import { hub } from "./hub.js"; export const changed = 1;`,
    );

    const index = await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );

    // With maxRelatedFiles = 1, changed file imports hub, so hub appears as import (not yet as hub)
    const result = await buildReviewContext(index!, [{ path: "src/changed.ts" }], {
      maxRelatedFiles: 1,
    });
    expect(result.context).toContain("File: src/hub.ts");
    expect(result.metadata.includedFiles).toContain("src/hub.ts");
  });

  it("truncates context when exceeding budget and sets truncated: true", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"));
    await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
    // Create a file with substantial content to force truncation with small budget
    const bigContent = `export const data = {\n${"  key: 'value',\n".repeat(200)}};`;
    await writeFile(join(cwd, "src", "index.ts"), bigContent);

    const index = await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );

    // Use a tiny budget to force truncation
    const result = await buildReviewContext(index!, [{ path: "src/index.ts" }], {
      budgetChars: 300,
    });

    expect(result.metadata.truncated).toBe(true);
    expect(result.context).toContain("[Source index context truncated to budget]");
    expect(result.context.length).toBeLessThanOrEqual(350);
  });

  it("does not truncate when within budget", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"));
    await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
    await writeFile(join(cwd, "src", "small.ts"), `export const x = 1;`);

    const index = await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );

    const result = await buildReviewContext(index!, [{ path: "src/small.ts" }], {
      budgetChars: 10000,
    });

    expect(result.metadata.truncated).toBe(false);
    expect(result.context).not.toContain("[Source index context truncated to budget]");
  });

  it("metadata.includedFiles matches files actually in context after truncation", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"));
    await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
    await writeFile(join(cwd, "src", "index.ts"), `export const a = 1;`);
    await writeFile(join(cwd, "src", "dep.ts"), `export const b = 1; import { c } from "./c.js";`);
    await writeFile(join(cwd, "src", "c.ts"), `export const c = 1;`);

    const index = await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );

    // Small budget to truncate
    const result = await buildReviewContext(index!, [{ path: "src/index.ts" }], {
      budgetChars: 300,
    });

    // Verify that all files in metadata.includedFiles appear in context
    for (const file of result.metadata.includedFiles) {
      expect(result.context).toContain(file);
    }
    // Verify count matches
    const fileMatches = (result.context.match(/^File: src\/.*\.ts/gm) ?? []).length;
    expect(fileMatches).toBe(result.metadata.relatedFileCount);
  });

  it("includes review pitfalls section with bullet points", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"));
    await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
    await writeFile(join(cwd, "src", "index.ts"), `export const x = 1;`);

    const index = await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );

    const result = await buildReviewContext(index!, [{ path: "src/index.ts" }]);

    expect(result.context).toContain("**Profile Review Pitfalls:**");
    const lines = result.context.split("\n");
    const pitfallsSection = lines.findIndex((line) => line.includes("Profile Review Pitfalls"));
    expect(pitfallsSection).toBeGreaterThanOrEqual(0);
    // Next lines should be bullet points
    expect(lines[pitfallsSection + 1]).toMatch(/^- /);
    expect(lines[pitfallsSection + 2]).toMatch(/^- /);
  });

  it("relationTypes metadata contains correct types", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"));
    await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
    await writeFile(join(cwd, "src", "index.ts"), `export const main = 1;`);
    await writeFile(
      join(cwd, "src", "lib.ts"),
      `import { main } from "./index.js"; export const lib = 1;`,
    );

    const index = await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );

    const result = await buildReviewContext(index!, [{ path: "src/index.ts" }], {
      maxRelatedFiles: 2,
    });

    // index.ts should have "changed" type
    expect(result.metadata.relationTypes).toContain("changed");
    // lib.ts should be included and have "dependent" type
    const libFile = result.metadata.includedFiles.find((f) => f === "src/lib.ts");
    expect(libFile).toBeDefined();
    expect(result.metadata.relationTypes).toContain("dependent");
  });

  it("handles empty changed files list", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"));
    await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
    await writeFile(join(cwd, "src", "index.ts"), `export const x = 1;`);

    const index = await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );

    // No changed files passed
    const result = await buildReviewContext(index!, []);

    expect(result.context).toBe("");
    expect(result.metadata.relatedFileCount).toBe(0);
    expect(result.metadata.truncated).toBe(false);
  });

  it("includes public-api signal when changed file is re-exported from entrypoint", async () => {
    const cwd = await makeTempDir();
    await makeIndexWithFiles(cwd, {
      "src/api.ts": `export const api = 1;`,
      "src/lib.ts": `export { api } from "./api.js";`,
    });

    const index = await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );

    const result = await buildReviewContext(index!, [{ path: "src/api.ts" }]);
    expect(result.metadata.includedSignals).toContain("public-api");
    expect(result.context).toContain("Public API Risk");
    expect(result.context).toContain("src/api.ts");
  });

  it("includes risk signal when changed file is a hub file imported by multiple files", async () => {
    const cwd = await makeTempDir();
    await makeIndexWithFiles(cwd, {
      "src/hub.ts": `export const hub = 1;`,
      "src/user1.ts": `import { hub } from "./hub.js"; export const x = 1;`,
      "src/user2.ts": `import { hub } from "./hub.js"; export const y = 1;`,
      "src/user3.ts": `import { hub } from "./hub.js"; export const z = 1;`,
    });

    const index = await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );

    const result = await buildReviewContext(index!, [{ path: "src/hub.ts" }]);
    expect(result.metadata.includedSignals).toContain("risk");
    expect(result.context).toContain("Hub File Blast Radius");
    expect(result.context).toContain("src/hub.ts");
  });

  it("includes test-gap signal when changed file has no associated tests", async () => {
    const cwd = await makeTempDir();
    await makeIndexWithFiles(cwd, {
      "src/untested.ts": `export function untested() { return 1; }`,
    });

    const index = await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );

    const result = await buildReviewContext(index!, [{ path: "src/untested.ts" }]);
    expect(result.metadata.includedSignals).toContain("test-gap");
    expect(result.context).toContain("Test Coverage Gap");
    expect(result.context).toContain("src/untested.ts");
  });

  it("includes dependency signal when changed files use external packages", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "test", version: "1.0.0", dependencies: { "fast-glob": "3.3.3" } }),
    );
    await writeFile(
      join(cwd, "src", "scanner.ts"),
      `import fg from "fast-glob"; export const scan = () => fg.sync("*.ts");`,
    );

    const index = await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );

    const result = await buildReviewContext(index!, [{ path: "src/scanner.ts" }]);
    expect(result.metadata.includedSignals).toContain("dependency");
    expect(result.context).toContain("Key Dependencies Used");
    expect(result.context).toContain("fast-glob");
  });

  it("does not include test-gap signal when file has associated tests", async () => {
    const cwd = await makeTempDir();
    await makeIndexWithFiles(cwd, {
      "src/tested.ts": `export function tested() { return 1; }`,
      "src/tested.test.ts": `import { tested } from "./tested.js"; test('tested', () => {});`,
    });

    const index = await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );

    const result = await buildReviewContext(index!, [{ path: "src/tested.ts" }]);
    if (result.metadata.includedSignals) {
      expect(result.metadata.includedSignals).not.toContain("test-gap");
    }
    expect(result.context).not.toContain("Test Coverage Gap");
  });

  it("does not include intelligence signals when index has no insights", async () => {
    const cwd = await makeTempDir();
    await makeIndexWithFiles(cwd, {
      "src/plain.ts": `export const x = 1;`,
    });

    const index = await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );

    // Strip insights to simulate legacy index
    const { insights: _insights, ...strippedIndex } = index!;

    const result = await buildReviewContext(strippedIndex, [{ path: "src/plain.ts" }]);
    expect(result.metadata.includedSignals).toBeUndefined();
    expect(result.context).not.toContain("Review Intelligence");
  });

  it("orders equal-popularity hub candidates by path deterministically", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
    // Two hub files with equal popularity (each imported by 3 files)
    await writeFile(join(cwd, "src", "hub_a.ts"), `export const hubA = 1;`);
    await writeFile(join(cwd, "src", "hub_z.ts"), `export const hubZ = 1;`);
    // 3 files importing each hub (equal popularity = 3)
    for (const hub of ["hub_a", "hub_z"]) {
      for (let i = 0; i < 3; i++) {
        await writeFile(
          join(cwd, "src", `user_${hub}_${i}.ts`),
          `import { ${hub === "hub_a" ? "hubA" : "hubZ"} } from "./${hub}.js"; export const x = ${i};`,
        );
      }
    }
    // Changed file is unrelated (so hubs get added in Tier 4)
    await writeFile(join(cwd, "src", "changed.ts"), `export const c = 1;`);

    const index = await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );

    const result = await buildReviewContext(index!, [{ path: "src/changed.ts" }], {
      maxRelatedFiles: 0,
      budgetChars: 10000,
    });

    // Both hubs should appear in included files
    expect(result.metadata.includedFiles).toContain("src/hub_a.ts");
    expect(result.metadata.includedFiles).toContain("src/hub_z.ts");
    // hub_a should come before hub_z (path ascending tie-breaker)
    const hubAIdx = result.metadata.includedFiles.indexOf("src/hub_a.ts");
    const hubZIdx = result.metadata.includedFiles.indexOf("src/hub_z.ts");
    expect(hubAIdx).toBeLessThan(hubZIdx);
  });

  it("deduplicates risk signal when multiple changed files are hub files", async () => {
    const cwd = await makeTempDir();
    await makeIndexWithFiles(cwd, {
      "src/hub1.ts": `export const hub1 = 1;`,
      "src/hub2.ts": `export const hub2 = 1;`,
      "src/user1.ts": `import { hub1 } from "./hub1.js"; export const x = 1;`,
      "src/user2.ts": `import { hub1 } from "./hub1.js"; export const y = 1;`,
      "src/user3.ts": `import { hub1 } from "./hub1.js"; export const z = 1;`,
      "src/user4.ts": `import { hub2 } from "./hub2.js"; export const w = 1;`,
      "src/user5.ts": `import { hub2 } from "./hub2.js"; export const v = 1;`,
      "src/user6.ts": `import { hub2 } from "./hub2.js"; export const u = 1;`,
    });

    const index = await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );

    // Both hub1 and hub2 are changed \u2014 each triggers a "risk" push
    const result = await buildReviewContext(index!, [
      { path: "src/hub1.ts" },
      { path: "src/hub2.ts" },
    ]);

    expect(result.metadata.includedSignals).toBeDefined();
    expect(result.metadata.includedSignals).toContain("risk");
    // Should appear exactly once, not duplicated
    expect(result.metadata.includedSignals!.filter((s) => s === "risk").length).toBe(1);
    // Context should mention both hub files
    expect(result.context).toContain("src/hub1.ts");
    expect(result.context).toContain("src/hub2.ts");
  });

  it("deduplicates dependency signal when includedSignals already has it", async () => {
    // This test verifies the defensive dedup: even though the current code
    // pushes "dependency" only once, the spread-Set guard ensures it would
    // collapse duplicates if the signal-push logic later changes.
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "test", version: "1.0.0", dependencies: { lodash: "4.0.0" } }),
    );
    await writeFile(join(cwd, "src", "a.ts"), `import _ from "lodash"; export const a = 1;`);
    await writeFile(join(cwd, "src", "b.ts"), `import _ from "lodash"; export const b = 1;`);

    const index = await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
      },
      true,
    );

    const result = await buildReviewContext(index!, [{ path: "src/a.ts" }, { path: "src/b.ts" }]);

    expect(result.metadata.includedSignals).toBeDefined();
    expect(result.metadata.includedSignals).toContain("dependency");
    // Should appear exactly once
    expect(result.metadata.includedSignals!.filter((s) => s === "dependency").length).toBe(1);
  });
});
