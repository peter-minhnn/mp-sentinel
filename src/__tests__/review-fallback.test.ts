import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach, beforeEach } from "@jest/globals";

import { runReview } from "../cli/review.js";
import type { CLIValues } from "../cli/args.js";
import type { ProjectConfig } from "../types/index.js";
import { clearProviderCache } from "../services/ai/index.js";
import { setLogQuietMode } from "../utils/logger.js";

const tempDirs: string[] = [];
const originalEnv = { ...process.env };
let originalCwd = process.cwd();

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "mp-sentinel-review-fallback-"));
  tempDirs.push(dir);
  return dir;
};

const reviewValues = (overrides: Partial<CLIValues> = {}): CLIValues => ({
  help: false,
  version: false,
  "skip-commit": false,
  "skip-files": false,
  verbose: false,
  quiet: false,
  local: false,
  interactive: false,
  "branch-diff": false,
  fetch: false,
  "include-uncommitted": false,
  staged: false,
  files: [],
  "no-skills-fetch": false,
  "dry-run": false,
  "verbose-dry-run": false,
  "all-agents": false,
  "create-skills-force": false,
  "skip-index-refresh": false,
  "create-skills-dry-run": false,
  "create-skills-check": false,
  "create-skills-no-ai-enrich": false,
  ...overrides,
});

function captureOutput() {
  let stdout = "";
  let stderr = "";
  const originalLog = console.log;
  const originalWrite = process.stderr.write;

  console.log = (data?: unknown) => {
    stdout += String(data ?? "");
  };
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += chunk.toString();
    return true;
  }) as typeof process.stderr.write;

  return {
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    restore() {
      console.log = originalLog;
      process.stderr.write = originalWrite;
    },
  };
}

beforeEach(() => {
  originalCwd = process.cwd();
  clearProviderCache();
  setLogQuietMode(false);
});

afterEach(async () => {
  process.chdir(originalCwd);
  process.env = { ...originalEnv };
  clearProviderCache();
  setLogQuietMode(false);
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("runReview AI environment fallback", () => {
  it("renders a deterministic non-AI report when AI_MODEL is unsupported", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "a.ts"), "export const value = 1;\n");
    process.chdir(cwd);

    process.env.AI_PROVIDER = "anthropic";
    process.env.AI_MODEL = "not-a-real-model";
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    delete process.env.ANTHROPIC_BASE_URL;

    const config: ProjectConfig = {
      cacheEnabled: false,
      indexing: { enabled: false },
      ai: {
        maxFiles: 5,
        maxDiffLines: 200,
        maxCharsPerFile: 4000,
      },
    };

    setLogQuietMode(true);
    const cap = captureOutput();
    try {
      const exitCode = await runReview({
        values: reviewValues({ files: ["src/a.ts"], format: "json" }),
        commandPositionals: [],
        config,
        targetBranch: "origin/main",
        maxConcurrency: 1,
        startTime: performance.now(),
      });

      const report = JSON.parse(cap.stdout);
      expect(exitCode).toBe(0);
      expect(report.status).toBe("PASS");
      expect(report.aiEnabled).toBe(false);
      expect(report.errors).toEqual([]);
      expect(report.results[0].result.message).toBe("AI disabled");
      expect(cap.stderr).toContain("AI review unavailable");
      expect(cap.stderr).toContain("Unsupported AI model");
    } finally {
      cap.restore();
    }
  });

  it("renders a deterministic non-AI report when API key is missing", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "b.ts"), "export const x = 2;\n");
    process.chdir(cwd);

    process.env.AI_PROVIDER = "gemini";
    process.env.AI_MODEL = "gemini-2.5-flash";
    delete process.env.GEMINI_API_KEY;

    const config: ProjectConfig = {
      cacheEnabled: false,
      indexing: { enabled: false },
      ai: {
        maxFiles: 5,
        maxDiffLines: 200,
        maxCharsPerFile: 4000,
      },
    };

    setLogQuietMode(true);
    const cap = captureOutput();
    try {
      const exitCode = await runReview({
        values: reviewValues({ files: ["src/b.ts"], format: "json" }),
        commandPositionals: [],
        config,
        targetBranch: "origin/main",
        maxConcurrency: 1,
        startTime: performance.now(),
      });

      const report = JSON.parse(cap.stdout);
      expect(exitCode).toBe(0);
      expect(report.status).toBe("PASS");
      expect(report.aiEnabled).toBe(false);
      expect(report.results[0].result.message).toBe("AI disabled");
      expect(cap.stderr).toContain("AI review unavailable");
      expect(cap.stderr).toContain("API key not found");
    } finally {
      cap.restore();
    }
  });
});
