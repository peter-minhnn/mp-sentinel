/**
 * v1.3.0 Review Intelligence Fixture Tests
 *
 * Fixture-based evaluation of review intelligence signals
 * (public-api, risk, test-gap, dependency) across 4 project profiles.
 */

import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, afterEach, beforeAll, jest } from "@jest/globals";

import { buildReviewContext } from "../services/source-index/context-builder.js";
import { renderExplainContext } from "../cli/review.js";
import { clearConfigCache } from "../utils/config.js";
import { buildSourceIndex } from "../commands/indexing.js";
import {
  createCliToolingFixture,
  createLibraryFixture,
  createNodeServiceFixture,
  createReactNextFixture,
  type IndexedFixture,
} from "./helpers/fixture-builder.js";
import type { CLIValues, SkillProfile } from "../types/index.js";
import type { IndexingConfig, SourceIndex } from "../types/index.js";

// ── Setup ───────────────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "mp-sentinel-rif-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  clearConfigCache();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  process.exitCode = undefined;
});

const PROFILES: SkillProfile[] = ["cli-tooling", "library", "node-service", "react-next"];

const createFixtureMap = new Map<SkillProfile, (cwd: string) => Promise<IndexedFixture>>([
  ["cli-tooling", createCliToolingFixture],
  ["library", createLibraryFixture],
  ["node-service", createNodeServiceFixture],
  ["react-next", createReactNextFixture],
]);

// Rely on the real pipeline (no mocks). Fixtures build the index the same way
// users do — via buildSourceIndex + readIndex.

// ── Fixture Profiles: signal precision per profile ─────────────────────────────

describe("Review Intelligence Fixtures — profile coverage", () => {
  for (const profile of PROFILES) {
    describe(`${profile} fixture`, () => {
      let fixture: IndexedFixture;

      beforeAll(async () => {
        const cwd = await makeTempDir();
        const builder = createFixtureMap.get(profile)!;
        fixture = await builder(cwd);
      });

      it("builds a valid index", () => {
        expect(fixture.index).toBeDefined();
        expect(fixture.index.files.length).toBeGreaterThan(0);
      });

      it("detects the correct profile", () => {
        expect(fixture.profile).toBe(profile);
      });

      it("produces a non-empty context for changed files", async () => {
        const file = fixture.index.files[0];
        if (!file) return;
        const result = await buildReviewContext(fixture.index, [{ path: file.path }]);
        expect(result.context).toBeTruthy();
        expect(result.metadata.profile).toBe(profile);
      });

      it("metadata.relatedFileCount matches actual files in context", async () => {
        const file = fixture.index.files[0];
        if (!file) return;
        const result = await buildReviewContext(fixture.index, [{ path: file.path }]);
        const fileMatches = (result.context.match(/^File: /gm) ?? []).length;
        expect(fileMatches).toBe(result.metadata.relatedFileCount);
      });

      it("context never exceeds budget", async () => {
        const file = fixture.index.files[0];
        if (!file) return;
        const budget = 5000;
        const result = await buildReviewContext(fixture.index, [{ path: file.path }], {
          budgetChars: budget,
        });
        expect(result.context.length).toBeLessThanOrEqual(budget + 100); // allow tiny buffer for end marker
      });

      it("context starts with changed files before related files", async () => {
        // Pick a file that has imports
        const files = fixture.index.files;
        const fileWithImports = files.find((f) => (f.importsFrom?.length ?? 0) > 0);
        if (!fileWithImports) return;

        const result = await buildReviewContext(fixture.index, [{ path: fileWithImports.path }]);

        const context = result.context;
        const firstFileIdx = context.indexOf(`File: ${fileWithImports.path}`);
        // All other "File:" lines should appear after the changed file
        const otherMatches = [...context.matchAll(/^File: (?!.*\(changed\))/gm)];
        for (const match of otherMatches) {
          expect(match.index).toBeGreaterThan(firstFileIdx);
        }
      });
    });
  }
});

// ── Signal Precision Tests ─────────────────────────────────────────────────────

describe("Review Intelligence — signal precision", () => {
  let cwd: string;

  const makeIndexWithFiles = async (
    files: Record<string, string>,
    packageJsonExtras: Record<string, unknown> = {},
  ): Promise<SourceIndex> => {
    cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "signal-test", version: "1.0.0", ...packageJsonExtras }),
    );
    for (const [path, content] of Object.entries(files)) {
      const fullPath = join(cwd, path);
      await mkdir(join(fullPath, ".."), { recursive: true });
      await writeFile(fullPath, content);
    }
    const index = await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
        maxRelatedFiles: 3,
      } satisfies IndexingConfig,
      true,
    );
    if (!index) throw new Error("Failed to build index");
    return index;
  };

  // ── public-api signal ──────────────────────────────────────────────────

  it("includes public-api signal when changed file is re-exported from entrypoint", async () => {
    const index = await makeIndexWithFiles({
      "src/api.ts": `export function api() { return 1; }`,
      "src/lib.ts": `export { api } from "./api.js";`,
    });

    const result = await buildReviewContext(index, [{ path: "src/api.ts" }]);
    expect(result.metadata.includedSignals).toContain("public-api");
    expect(result.context).toContain("Public API Risk");
  });

  it("excludes public-api signal when changed file is not in public API surface", async () => {
    const index = await makeIndexWithFiles({
      "src/internal.ts": `export function internal() { return 1; }`,
      "src/lib.ts": `export { api } from "./api.js";`,
    });

    const result = await buildReviewContext(index, [{ path: "src/internal.ts" }]);
    if (result.metadata.includedSignals) {
      expect(result.metadata.includedSignals).not.toContain("public-api");
    }
    expect(result.context).not.toContain("Public API Risk");
  });

  // ── risk signal (hub-file) ─────────────────────────────────────────────

  it("includes risk signal when changed file is imported by many files", async () => {
    const index = await makeIndexWithFiles({
      "src/hub.ts": `export const hub = 1;`,
      "src/a.ts": `import { hub } from "./hub.js"; export const a = 1;`,
      "src/b.ts": `import { hub } from "./hub.js"; export const b = 1;`,
      "src/c.ts": `import { hub } from "./hub.js"; export const c = 1;`,
    });

    const result = await buildReviewContext(index, [{ path: "src/hub.ts" }]);
    expect(result.metadata.includedSignals).toContain("risk");
    expect(result.context).toContain("Hub File Blast Radius");
  });

  it("excludes risk signal when changed file is not a hub", async () => {
    const index = await makeIndexWithFiles({
      "src/leaf.ts": `import { hub } from "./hub.js"; export const leaf = 1;`,
      "src/hub.ts": `export const hub = 1;`,
    });

    const result = await buildReviewContext(index, [{ path: "src/leaf.ts" }]);
    if (result.metadata.includedSignals) {
      expect(result.metadata.includedSignals).not.toContain("risk");
    }
    expect(result.context).not.toContain("Hub File Blast Radius");
  });

  // ── test-gap signal ────────────────────────────────────────────────────

  it("includes test-gap signal when changed file has no associated tests", async () => {
    const index = await makeIndexWithFiles({
      "src/untested.ts": `export function untested() { return 1; }`,
    });

    const result = await buildReviewContext(index, [{ path: "src/untested.ts" }]);
    expect(result.metadata.includedSignals).toContain("test-gap");
    expect(result.context).toContain("Test Coverage Gap");
  });

  it("excludes test-gap signal when changed file has associated test", async () => {
    const index = await makeIndexWithFiles({
      "src/tested.ts": `export function tested() { return 1; }`,
      "src/tested.test.ts": `import { tested } from "./tested.js"; test('t', () => {});`,
    });

    const result = await buildReviewContext(index, [{ path: "src/tested.ts" }]);
    if (result.metadata.includedSignals) {
      expect(result.metadata.includedSignals).not.toContain("test-gap");
    }
    expect(result.context).not.toContain("Test Coverage Gap");
  });

  // ── dependency signal ──────────────────────────────────────────────────

  it("includes dependency signal when changed file uses external package", async () => {
    const index = await makeIndexWithFiles(
      {
        "src/scanner.ts": `import fg from "fast-glob"; export const scan = () => fg.sync("*.ts");`,
      },
      { dependencies: { "fast-glob": "3.3.3" } },
    );

    const result = await buildReviewContext(index, [{ path: "src/scanner.ts" }]);
    expect(result.metadata.includedSignals).toContain("dependency");
    expect(result.context).toContain("Key Dependencies Used");
    expect(result.context).toContain("fast-glob");
  });

  it("excludes dependency signal when changed file uses no external packages", async () => {
    const index = await makeIndexWithFiles({
      "src/plain.ts": `export const x = 1;`,
    });

    const result = await buildReviewContext(index, [{ path: "src/plain.ts" }]);
    if (result.metadata.includedSignals) {
      expect(result.metadata.includedSignals).not.toContain("dependency");
    }
    expect(result.context).not.toContain("Key Dependencies Used");
  });

  // ── Missing/disabled index → graceful unavailable, no throw ────────────

  it("returns empty context when index is null (no throw)", async () => {
    const result = await buildReviewContext(null, [{ path: "src/any.ts" }]);
    expect(result.context).toBe("");
    expect(result.metadata.relatedFileCount).toBe(0);
    expect(result.metadata.truncated).toBe(false);
  });

  it("returns empty context when >50% of files have parse errors (no throw)", async () => {
    const noIndex = await makeIndexWithFiles({
      "src/a.ts": `export const a = 1;`,
      "src/b.ts": `export const b = 1;`,
    });
    noIndex.files.forEach((f) => (f.parseErrors = ["synthetic error"]));

    const result = await buildReviewContext(noIndex, [{ path: "src/a.ts" }]);
    expect(result.context).toBe("");
  });

  // ── Multiple signals ───────────────────────────────────────────────────

  it("can produce multiple signals for a single changed file", async () => {
    const index = await makeIndexWithFiles(
      {
        "src/pivot.ts": `import _ from "lodash"; export function pivot() { return 1; }`,
        "src/lib.ts": `export { pivot } from "./pivot.js";`,
        "src/user1.ts": `import { pivot } from "./pivot.js"; export const x = 1;`,
        "src/user2.ts": `import { pivot } from "./pivot.js"; export const y = 1;`,
        "src/user3.ts": `import { pivot } from "./pivot.js"; export const z = 1;`,
      },
      { dependencies: { lodash: "4.0.0" } },
    );

    const result = await buildReviewContext(index, [{ path: "src/pivot.ts" }]);
    expect(result.metadata.includedSignals).toBeDefined();
    // pivot.ts is public API (re-exported from lib.ts), a hub (imported by 3 files),
    // untested, and uses lodash → all 4 signals
    expect(result.metadata.includedSignals).toContain("public-api");
    expect(result.metadata.includedSignals).toContain("risk");
    expect(result.metadata.includedSignals).toContain("test-gap");
    expect(result.metadata.includedSignals).toContain("dependency");
  });
});

// ── Quality Assertions ─────────────────────────────────────────────────────────

describe("Review Intelligence — quality assertions", () => {
  let cwd: string;
  let index: SourceIndex;

  beforeAll(async () => {
    cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        name: "quality-test",
        version: "1.0.0",
        dependencies: { lodash: "4.0.0" },
      }),
    );
    await writeFile(join(cwd, "src", "hub.ts"), `export const hub = 1;`);
    await writeFile(
      join(cwd, "src", "user1.ts"),
      `import { hub } from "./hub.js"; export const a = 1;`,
    );
    await writeFile(
      join(cwd, "src", "user2.ts"),
      `import { hub } from "./hub.js"; export const b = 1;`,
    );
    await writeFile(
      join(cwd, "src", "user3.ts"),
      `import { hub } from "./hub.js"; export const c = 1;`,
    );
    await writeFile(
      join(cwd, "src", "api.ts"),
      `import _ from "lodash"; import { hub } from "./hub.js"; export function api() { return hub; }`,
    );
    await writeFile(join(cwd, "src", "lib.ts"), `export { api } from "./api.js";`);
    await writeFile(
      join(cwd, "src", "api.test.ts"),
      `import { api } from "./api.js"; test('api', () => {});`,
    );
    await writeFile(join(cwd, "src", "untested.ts"), `export function untested() { return 1; }`);

    const built = await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
        maxRelatedFiles: 3,
      } satisfies IndexingConfig,
      true,
    );
    if (!built) throw new Error("Failed to build quality test index");
    index = built;
  });

  afterAll(async () => {
    clearConfigCache();
  });

  it("context always starts with changed files before related files", async () => {
    const result = await buildReviewContext(index, [{ path: "src/hub.ts" }]);
    const context = result.context;

    // Find first "File:" line — must be the changed file
    const firstFileMatch = context.match(/^File: /m);
    expect(firstFileMatch).not.toBeNull();
    const firstIdx = firstFileMatch!.index!;

    // The changed file should appear first
    const hubIdx = context.indexOf("File: src/hub.ts");
    expect(hubIdx).toBe(firstIdx);

    // All non-changed files should appear after
    const otherFiles = [...context.matchAll(/^File: (?!src\/hub\.ts)/gm)];
    for (const m of otherFiles) {
      expect(m.index).toBeGreaterThan(hubIdx);
    }
  });

  it("includedSignals has no duplicates", async () => {
    const result = await buildReviewContext(index, [
      { path: "src/hub.ts" },
      { path: "src/untested.ts" },
    ]);

    if (result.metadata.includedSignals) {
      const seen = new Set<string>();
      for (const sig of result.metadata.includedSignals) {
        expect(seen.has(sig)).toBe(false);
        seen.add(sig);
      }
    }
  });

  it("context length never exceeds budget", async () => {
    const budget = 500;
    const result = await buildReviewContext(index, [{ path: "src/api.ts" }], {
      budgetChars: budget,
    });
    // Allow small buffer for truncation marker
    expect(result.context.length).toBeLessThanOrEqual(budget + 60);
  });

  it("truncation marker is present when truncated", async () => {
    const budget = 250;
    const result = await buildReviewContext(index, [{ path: "src/api.ts" }], {
      budgetChars: budget,
    });

    if (result.metadata.truncated) {
      expect(result.context).toContain("[Source index context truncated to budget]");
    }
  });
});

// ── explain-context JSON Output Shape ──────────────────────────────────────────

describe("Review Intelligence — explain-context JSON output shape", () => {
  const baseIndexingConfig: IndexingConfig = {
    enabled: true,
    languages: ["typescript", "tsx", "javascript", "jsx"],
    cachePath: ".mp-sentinel-cache/source-index.json",
    maxFileSize: 512000,
    maxRelatedFiles: 3,
  };

  const makeCLIValues = (overrides: Partial<CLIValues> = {}): CLIValues => ({
    help: false,
    version: false,
    "skip-commit": false,
    "skip-files": false,
    verbose: false,
    quiet: false,
    local: false,
    interactive: false,
    "target-branch": "origin/main",
    concurrency: undefined,
    "branch-diff": false,
    fetch: false,
    "include-uncommitted": false,
    staged: false,
    commit: undefined,
    range: undefined,
    files: [],
    "no-skills-fetch": false,
    "dry-run": false,
    "verbose-dry-run": false,
    "token-limit": undefined,
    "explain-context": true,
    "index-format": undefined,
    stats: false,
    explainIndex: undefined,
    agent: undefined,
    "all-agents": false,
    "create-skills-format": undefined,
    "create-skills-force": false,
    "skip-index-refresh": false,
    "create-skills-dry-run": false,
    "create-skills-check": false,
    ...overrides,
  });

  it("JSON output is parseable and includes indexUsed, includedFiles, relationTypes, includedSignals", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "json-test", version: "1.0.0" }),
    );
    await writeFile(join(cwd, "src", "index.ts"), `export const main = 1;`);
    await writeFile(join(cwd, "src", "lib.ts"), `export { main } from "./index.js";`);
    await buildSourceIndex(cwd, baseIndexingConfig, true);

    const originalCwd = process.cwd();
    process.chdir(cwd);

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      await renderExplainContext({
        values: makeCLIValues({ format: "json", files: ["src/index.ts"] }),
        config: {
          enableSkillsFetch: false,
          maxConcurrency: 5,
          cacheEnabled: true,
          indexing: baseIndexingConfig,
          ai: {
            maxFiles: 15,
            maxDiffLines: 1200,
            maxCharsPerFile: 12000,
            promptVersion: "2026-02-16",
          },
          localReview: {
            enabled: false,
            commitCount: 1,
            commitPatterns: [],
            filterByPattern: false,
            skipPatterns: [],
            includeMergeCommits: false,
            branchDiffMode: false,
            compareBranch: "origin/main",
            patternMatchMode: "any",
            verbosePatternMatching: false,
          },
        },
        targetBranch: "origin/main",
        maxConcurrency: 5,
        startTime: performance.now(),
      });

      const jsonOutput = JSON.parse(logSpy.mock.calls[0][0]);
      expect(jsonOutput.status).toBe("available");
      expect(jsonOutput.indexUsed).toBe(true);
      expect(jsonOutput.includedFiles).toBeDefined();
      expect(Array.isArray(jsonOutput.includedFiles)).toBe(true);
      expect(jsonOutput.relationTypes).toBeDefined();
      expect(Array.isArray(jsonOutput.relationTypes)).toBe(true);
      expect(jsonOutput.relationTypes).toContain("changed");
      // Since index.ts is re-exported from lib.ts it should be public-api
      expect(jsonOutput.includedSignals).toBeDefined();
      expect(jsonOutput.includedSignals).toContain("public-api");
      expect(jsonOutput.contextPreview).toBeDefined();
      expect(jsonOutput.profile).toBeDefined();
      expect(jsonOutput.budgetChars).toBe(12000);
    } finally {
      logSpy.mockRestore();
      process.chdir(originalCwd);
    }
  });

  it("explain-context with disabled indexing reports explicit reason", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "disabled-test", version: "1.0.0" }),
    );

    const originalCwd = process.cwd();
    process.chdir(cwd);

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      await renderExplainContext({
        values: makeCLIValues({ format: "json", files: ["src/index.ts"] }),
        config: {
          enableSkillsFetch: false,
          maxConcurrency: 5,
          cacheEnabled: true,
          indexing: { enabled: false },
          ai: {
            maxFiles: 15,
            maxDiffLines: 1200,
            maxCharsPerFile: 12000,
            promptVersion: "2026-02-16",
          },
          localReview: {
            enabled: false,
            commitCount: 1,
            commitPatterns: [],
            filterByPattern: false,
            skipPatterns: [],
            includeMergeCommits: false,
            branchDiffMode: false,
            compareBranch: "origin/main",
            patternMatchMode: "any",
            verbosePatternMatching: false,
          },
        },
        targetBranch: "origin/main",
        maxConcurrency: 5,
        startTime: performance.now(),
      });

      const jsonOutput = JSON.parse(logSpy.mock.calls[0][0]);
      expect(jsonOutput.status).toBe("unavailable");
      expect(jsonOutput.reason).toContain("Indexing disabled");
      expect(jsonOutput.reason).toContain("indexing.enabled");
    } finally {
      logSpy.mockRestore();
      process.chdir(originalCwd);
    }
  });

  it("explain-context with missing index reports clear reason", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "no-index-test", version: "1.0.0" }),
    );

    const originalCwd = process.cwd();
    process.chdir(cwd);

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      await renderExplainContext({
        values: makeCLIValues({ format: "json", files: ["src/index.ts"] }),
        config: {
          enableSkillsFetch: false,
          maxConcurrency: 5,
          cacheEnabled: true,
          indexing: {
            enabled: true,
            languages: ["typescript"],
            cachePath: ".mp-sentinel-cache/source-index.json",
            maxFileSize: 512000,
            maxRelatedFiles: 3,
          },
          ai: {
            maxFiles: 15,
            maxDiffLines: 1200,
            maxCharsPerFile: 12000,
            promptVersion: "2026-02-16",
          },
          localReview: {
            enabled: false,
            commitCount: 1,
            commitPatterns: [],
            filterByPattern: false,
            skipPatterns: [],
            includeMergeCommits: false,
            branchDiffMode: false,
            compareBranch: "origin/main",
            patternMatchMode: "any",
            verbosePatternMatching: false,
          },
        },
        targetBranch: "origin/main",
        maxConcurrency: 5,
        startTime: performance.now(),
      });

      const jsonOutput = JSON.parse(logSpy.mock.calls[0][0]);
      expect(jsonOutput.status).toBe("unavailable");
      expect(jsonOutput.reason).toContain("No source index found");
    } finally {
      logSpy.mockRestore();
      process.chdir(originalCwd);
    }
  });
});

// ── Edge Cases ─────────────────────────────────────────────────────────────────

describe("Review Intelligence — edge cases", () => {
  const makeIndexWithFiles = async (
    files: Record<string, string>,
    packageJsonExtras: Record<string, unknown> = {},
  ): Promise<SourceIndex> => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "edge-test", version: "1.0.0", ...packageJsonExtras }),
    );
    for (const [path, content] of Object.entries(files)) {
      const fullPath = join(cwd, path);
      await mkdir(join(fullPath, ".."), { recursive: true });
      await writeFile(fullPath, content);
    }
    const index = await buildSourceIndex(
      cwd,
      {
        enabled: true,
        languages: ["typescript", "tsx", "javascript", "jsx"],
        cachePath: ".mp-sentinel-cache/source-index.json",
        maxFileSize: 512000,
        maxRelatedFiles: 3,
      } satisfies IndexingConfig,
      true,
    );
    if (!index) throw new Error("Failed to build edge test index");
    return index;
  };

  it("handles changed files not found in index gracefully", async () => {
    const index = await makeIndexWithFiles({
      "src/real.ts": `export const real = 1;`,
    });

    const result = await buildReviewContext(index, [{ path: "src/nonexistent.ts" }]);
    expect(result.context).toBe("");
    expect(result.metadata.relatedFileCount).toBe(0);
  });

  it("deduplicates changed files passed multiple times", async () => {
    const index = await makeIndexWithFiles({
      "src/dup.ts": `export const dup = 1;`,
    });

    const result = await buildReviewContext(index, [
      { path: "src/dup.ts" },
      { path: "src/dup.ts" },
    ]);

    // Should appear once
    const matches = [...result.context.matchAll(/File: src\/dup\.ts/g)];
    expect(matches.length).toBe(1);
  });

  it("returns empty context when changed files list is empty", async () => {
    const index = await makeIndexWithFiles({
      "src/file.ts": `export const f = 1;`,
    });

    const result = await buildReviewContext(index, []);
    expect(result.context).toBe("");
  });

  it("does not include intelligence signals when index has no insights", async () => {
    const index = await makeIndexWithFiles({
      "src/plain.ts": `export const x = 1;`,
    });

    const stripped = { ...index, insights: undefined };
    const result = await buildReviewContext(stripped, [{ path: "src/plain.ts" }]);
    if (result.metadata.includedSignals) {
      // Even when no insights, signals should be undefined, not an empty array
      // with signals (signal logic requires insights to build KB)
    }
    expect(result.context).not.toContain("Review Intelligence");
  });

  it("metadata.relationTypes contains correct types for mixed relations", async () => {
    const index = await makeIndexWithFiles({
      "src/main.ts": `import { dep } from "./dep.js"; export const main = 1;`,
      "src/dep.ts": `export const dep = 1;`,
      "src/consumer.ts": `import { main } from "./main.js";`,
      "src/consumer_unused.ts": `import { main } from "./main.js";`,
      "src/consumer_another.ts": `import { main } from "./main.js";`,
    });

    const result = await buildReviewContext(index, [{ path: "src/main.ts" }], {
      maxRelatedFiles: 2,
    });

    expect(result.metadata.relationTypes).toContain("changed");
    expect(result.metadata.relationTypes).toContain("import");
    expect(result.metadata.relationTypes).toContain("dependent");
    // main.ts has many consumers, may also be a hub
  });
});
