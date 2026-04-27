import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach, beforeEach } from "@jest/globals";

import { buildSourceIndex } from "../commands/indexing.js";
import { clearConfigCache } from "../utils/config.js";
import { buildReviewContext } from "../services/source-index/context-builder.js";
import type { SourceIndex } from "../types/index.js";

const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "mp-sentinel-review-context-"));
  tempDirs.push(dir);
  return dir;
};

beforeEach(() => {
  process.argv = ["node", "mp-sentinel"];
});

afterEach(async () => {
  clearConfigCache();
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

  it("orders files: changed → imports → dependents → hub", async () => {
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
});
