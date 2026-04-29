/**
 * Unit tests for --explain-context mode
 */

import { mkdir, writeFile, rm, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

import { parseCliArgs } from "../cli/args.js";
import { renderExplainContext } from "../cli/review.js";
import { buildSourceIndex } from "../commands/indexing.js";
import { clearConfigCache } from "../utils/config.js";
import type { ProjectConfig, IndexingConfig } from "../types/index.js";
import type { CLIValues } from "../cli/args.js";

const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "mp-sentinel-explain-"));
  tempDirs.push(dir);
  return dir;
};

beforeEach(() => {
  process.argv = ["node", "mp-sentinel"];
  process.exitCode = undefined;
});

afterEach(async () => {
  clearConfigCache();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  process.exitCode = undefined;
});

describe("parseCliArgs — explain-context", () => {
  it("parses --explain-context flag", () => {
    process.argv = ["node", "mp-sentinel", "--explain-context"];
    const { values, command } = parseCliArgs();
    expect(command).toBe("review");
    expect(values["explain-context"]).toBe(true);
  });

  it("parses --explain-context with --format json", () => {
    process.argv = ["node", "mp-sentinel", "--explain-context", "--format", "json"];
    const { values } = parseCliArgs();
    expect(values["explain-context"]).toBe(true);
    expect(values.format).toBe("json");
  });

  it("parses --explain-context with --files (safe order: options before --files)", () => {
    // Safe order: --format BEFORE --files
    process.argv = [
      "node",
      "mp-sentinel",
      "--explain-context",
      "--format",
      "json",
      "--files",
      "src/index.ts",
      "src/lib.ts",
    ];
    const { values } = parseCliArgs();
    expect(values["explain-context"]).toBe(true);
    expect(values.format).toBe("json");
    expect(values.files).toEqual(["src/index.ts", "src/lib.ts"]);
  });
});

describe("renderExplainContext", () => {
  const baseIndexingConfig: IndexingConfig = {
    enabled: true,
    languages: ["typescript", "tsx", "javascript", "jsx"],
    cachePath: ".mp-sentinel-cache/source-index.json",
    maxFileSize: 512000,
    maxRelatedFiles: 3,
  };

  const makeConfig = async (cwd: string, indexingEnabled: boolean): Promise<ProjectConfig> => {
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "test-project", version: "1.0.0" }),
    );
    return {
      enableSkillsFetch: false,
      maxConcurrency: 5,
      cacheEnabled: true,
      indexing: indexingEnabled ? baseIndexingConfig : { enabled: false },
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
    };
  };

  const makeIndex = async (cwd: string): Promise<void> => {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "index.ts"), `export const main = 1;`);
    await writeFile(join(cwd, "src", "lib.ts"), `export const lib = 1;`);
    await buildSourceIndex(cwd, baseIndexingConfig, true);
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

  it("returns JSON with status 'unavailable' when indexing is disabled", async () => {
    const cwd = await makeTempDir();
    const config = await makeConfig(cwd, false);

    const originalCwd = process.cwd();
    process.chdir(cwd);

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      await renderExplainContext({
        values: makeCLIValues({ format: "json" }),
        config,
        targetBranch: "origin/main",
        maxConcurrency: 5,
        startTime: performance.now(),
      });

      const jsonOutput = JSON.parse(logSpy.mock.calls[0][0]);
      expect(jsonOutput.status).toBe("unavailable");
      expect(jsonOutput.reason).toContain("disabled");
    } finally {
      logSpy.mockRestore();
      process.chdir(originalCwd);
    }
  });

  it("returns JSON with status 'unavailable' when index is missing", async () => {
    const cwd = await makeTempDir();
    const config = await makeConfig(cwd, true);

    const originalCwd = process.cwd();
    process.chdir(cwd);

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      await renderExplainContext({
        values: makeCLIValues({ format: "json" }),
        config,
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

  it("returns JSON with status 'available' when index exists and context builds", async () => {
    const cwd = await makeTempDir();
    const config = await makeConfig(cwd, true);
    await makeIndex(cwd);

    const originalCwd = process.cwd();
    process.chdir(cwd);

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      await renderExplainContext({
        values: makeCLIValues({ format: "json", files: ["src/index.ts", "src/lib.ts"] }),
        config,
        targetBranch: "origin/main",
        maxConcurrency: 5,
        startTime: performance.now(),
      });

      const jsonOutput = JSON.parse(logSpy.mock.calls[0][0]);
      expect(jsonOutput.status).toBe("available");
      expect(jsonOutput.profile).toBe("library");
      expect(jsonOutput.budgetChars).toBe(12000);
      expect(jsonOutput.truncated).toBe(false);
      expect(jsonOutput.relatedFileCount).toBeGreaterThan(0);
      expect(jsonOutput.relationTypes).toContain("changed");
      expect(jsonOutput.includedFiles).toContain("src/index.ts");
      expect(jsonOutput.contextPreview).toBeDefined();
      expect(jsonOutput.contextPreview.length).toBeLessThanOrEqual(500);
      expect(jsonOutput.indexUsed).toBe(true);
    } finally {
      logSpy.mockRestore();
      process.chdir(originalCwd);
    }
  });

  it("sets exit code to 0 on success", async () => {
    const cwd = await makeTempDir();
    const config = await makeConfig(cwd, false);

    const originalCwd = process.cwd();
    process.chdir(cwd);

    try {
      await renderExplainContext({
        values: makeCLIValues({ format: "json" }),
        config,
        targetBranch: "origin/main",
        maxConcurrency: 5,
        startTime: performance.now(),
      });

      expect(process.exitCode).toBe(0);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("console output shows human-readable format when format is not json", async () => {
    const cwd = await makeTempDir();
    const config = await makeConfig(cwd, false);

    const originalCwd = process.cwd();
    process.chdir(cwd);

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      await renderExplainContext({
        values: makeCLIValues({ format: "console" }),
        config,
        targetBranch: "origin/main",
        maxConcurrency: 5,
        startTime: performance.now(),
      });

      const calls = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(calls).toContain("Explain Context Mode");
      expect(calls).toContain("Status:");
      expect(calls).toContain("Reason:");
    } finally {
      logSpy.mockRestore();
      process.chdir(originalCwd);
    }
  });

  it("console output with signals is ASCII-safe (no em dash, no risky Unicode)", async () => {
    const cwd = await makeTempDir();
    const config = await makeConfig(cwd, true);
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "api.ts"), `export const api = 1;`);
    await writeFile(join(cwd, "src", "lib.ts"), `export { api } from "./api.js";`);
    await buildSourceIndex(cwd, baseIndexingConfig, true);

    const originalCwd = process.cwd();
    process.chdir(cwd);

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      await renderExplainContext({
        values: makeCLIValues({ format: "console", files: ["src/api.ts"] }),
        config,
        targetBranch: "origin/main",
        maxConcurrency: 5,
        startTime: performance.now(),
      });

      const calls = logSpy.mock.calls.map((c) => c[0]).join("\n");
      const riskyUnicode = ["—", "→", "←", "…", "✓", "✗"];
      for (const r of riskyUnicode) {
        expect(calls).not.toContain(r);
      }
    } finally {
      logSpy.mockRestore();
      process.chdir(originalCwd);
    }
  });

  it("returns JSON with includedSignals when intelligence signals are present", async () => {
    const cwd = await makeTempDir();
    const config = await makeConfig(cwd, true);
    // Set up a project where a changed file is in the public API surface and has no tests
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "api.ts"), `export const api = 1;`);
    await writeFile(join(cwd, "src", "lib.ts"), `export { api } from "./api.js";`);
    await buildSourceIndex(cwd, baseIndexingConfig, true);

    const originalCwd = process.cwd();
    process.chdir(cwd);

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      await renderExplainContext({
        values: makeCLIValues({ format: "json", files: ["src/api.ts"] }),
        config,
        targetBranch: "origin/main",
        maxConcurrency: 5,
        startTime: performance.now(),
      });

      const jsonOutput = JSON.parse(logSpy.mock.calls[0][0]);
      expect(jsonOutput.status).toBe("available");
      expect(jsonOutput.indexUsed).toBe(true);
      expect(jsonOutput.includedSignals).toBeDefined();
      expect(jsonOutput.includedSignals).toContain("public-api");
      // v1.4.0: intelligenceSignals should be present with structured metadata
      expect(jsonOutput.intelligenceSignals).toBeDefined();
      expect(Array.isArray(jsonOutput.intelligenceSignals)).toBe(true);
      expect(jsonOutput.intelligenceSignals.length).toBeGreaterThan(0);
      const publicApiSignal = jsonOutput.intelligenceSignals.find(
        (s: { type: string }) => s.type === "public-api",
      );
      expect(publicApiSignal).toBeDefined();
      expect(publicApiSignal.file).toBe("src/api.ts");
    } finally {
      logSpy.mockRestore();
      process.chdir(originalCwd);
    }
  });

  it("JSON output with disabled indexing reports expected reason", async () => {
    const cwd = await makeTempDir();
    const config = await makeConfig(cwd, false);

    const originalCwd = process.cwd();
    process.chdir(cwd);

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      await renderExplainContext({
        values: makeCLIValues({ format: "json", files: ["src/index.ts"] }),
        config,
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

  it("console output includes intelligence signals line when present", async () => {
    const cwd = await makeTempDir();
    const config = await makeConfig(cwd, true);
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "api.ts"), `export const api = 1;`);
    await writeFile(join(cwd, "src", "lib.ts"), `export { api } from "./api.js";`);
    await buildSourceIndex(cwd, baseIndexingConfig, true);

    const originalCwd = process.cwd();
    process.chdir(cwd);

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      await renderExplainContext({
        values: makeCLIValues({ format: "console", files: ["src/api.ts"] }),
        config,
        targetBranch: "origin/main",
        maxConcurrency: 5,
        startTime: performance.now(),
      });

      const calls = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(calls).toContain("Intelligence signals:");
      expect(calls).toContain("public-api");
      // v1.4.0: console output includes signal details summary (count/type)
      expect(calls).toContain("Signal details:");
    } finally {
      logSpy.mockRestore();
      process.chdir(originalCwd);
    }
  });
});
