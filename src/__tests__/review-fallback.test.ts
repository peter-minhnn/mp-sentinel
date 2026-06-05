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

      // JSON stdout must not contain header/banner text or ANSI color codes
      expect(cap.stdout).not.toContain("MP SENTINEL");
      expect(cap.stdout).not.toContain("MP Sentinel ");
      expect(cap.stdout).not.toContain("__  __");
      expect(cap.stdout).not.toContain("AI-Powered Code Review");
      expect(cap.stdout).not.toContain("\x1b[");

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

  it("catches deterministic CRITICAL findings in AI fallback and exits 1", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "c.ts"), 'eval("dangerous code");\n');
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
        values: reviewValues({ files: ["src/c.ts"], format: "json" }),
        commandPositionals: [],
        config,
        targetBranch: "origin/main",
        maxConcurrency: 1,
        startTime: performance.now(),
      });

      const report = JSON.parse(cap.stdout);
      expect(exitCode).toBe(1);
      expect(report.status).toBe("FAIL");
      expect(report.aiEnabled).toBe(false);
      expect(report.summary.criticalIssues).toBeGreaterThanOrEqual(1);
      const evalFile = report.results.find((r: { filePath: string }) => r.filePath === "src/c.ts");
      expect(evalFile).toBeDefined();
      expect(evalFile.result.status).toBe("FAIL");
      expect(
        evalFile.result.issues.some(
          (i: { severity: string; message: string }) =>
            i.severity === "CRITICAL" && i.message.includes("eval"),
        ),
      ).toBe(true);
    } finally {
      cap.restore();
    }
  });

  it("catches deterministic WARNING findings in AI fallback and exits 1", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "src", "d.ts"),
      'import { execSync } from "node:child_process";\nexecSync("ls -la");\n',
    );
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
        values: reviewValues({ files: ["src/d.ts"], format: "json" }),
        commandPositionals: [],
        config,
        targetBranch: "origin/main",
        maxConcurrency: 1,
        startTime: performance.now(),
      });

      const report = JSON.parse(cap.stdout);
      expect(exitCode).toBe(1);
      expect(report.status).toBe("FAIL");
      expect(report.aiEnabled).toBe(false);
      expect(report.summary.warningIssues).toBeGreaterThanOrEqual(1);
      const execFile = report.results.find((r: { filePath: string }) => r.filePath === "src/d.ts");
      expect(execFile).toBeDefined();
      expect(execFile.result.status).toBe("FAIL");
      expect(
        execFile.result.issues.some(
          (i: { severity: string; message: string }) =>
            i.severity === "WARNING" && i.message.includes("child_process"),
        ),
      ).toBe(true);
    } finally {
      cap.restore();
    }
  });

  it("returns PASS in AI fallback when only INFO-level findings exist", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "e.ts"), 'const url = "http://localhost:3000/api";\n');
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
        values: reviewValues({ files: ["src/e.ts"], format: "json" }),
        commandPositionals: [],
        config,
        targetBranch: "origin/main",
        maxConcurrency: 1,
        startTime: performance.now(),
      });

      const report = JSON.parse(cap.stdout);
      expect(exitCode).toBe(0);
      expect(report.status).toBe("PASS");
    } finally {
      cap.restore();
    }
  });

  it("renders markdown output without banner contamination", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "f.ts"), "export const v = 1;\n");
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
        values: reviewValues({ files: ["src/f.ts"], format: "markdown" }),
        commandPositionals: [],
        config,
        targetBranch: "origin/main",
        maxConcurrency: 1,
        startTime: performance.now(),
      });

      // Markdown output must start with the report header, not the console header
      expect(cap.stdout.trimStart().startsWith("# MP Sentinel Review Report")).toBe(true);
      expect(cap.stdout).not.toContain("MP SENTINEL - Code Review");
      expect(cap.stdout).not.toContain("\x1b[");
      expect(exitCode).toBe(0);
    } finally {
      cap.restore();
    }
  });

  it("renders the console header once in dry-run output", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "g.ts"), "export const v = 1;\n");
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

    // NOT quiet mode — we want console output
    const cap = captureOutput();
    try {
      const exitCode = await runReview({
        values: reviewValues({ files: ["src/g.ts"] }),
        commandPositionals: [],
        config,
        targetBranch: "origin/main",
        maxConcurrency: 1,
        startTime: performance.now(),
        dryRun: true,
      });

      // Compact header should appear exactly once in console output
      const headerMatches = cap.stdout.match(/MP Sentinel.*v\d/g);
      expect(headerMatches).not.toBeNull();
      expect(headerMatches).toHaveLength(1);
      expect(cap.stdout).not.toContain("MP SENTINEL - Code Review");
      expect(exitCode).toBe(0);
    } finally {
      cap.restore();
    }
  });

  it("emits no ANSI escapes anywhere in console output when NO_COLOR is set", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "h.ts"), 'export const risky = eval("1+1");\n');
    process.chdir(cwd);

    process.env.NO_COLOR = "1";

    const config: ProjectConfig = {
      cacheEnabled: false,
      indexing: { enabled: false },
      ai: {
        maxFiles: 5,
        maxDiffLines: 200,
        maxCharsPerFile: 4000,
      },
    };

    // NOT quiet mode — we want the full console UI, including warnings
    const originalWarn = console.warn;
    const originalError = console.error;
    let extra = "";
    console.warn = (data?: unknown) => {
      extra += `${String(data ?? "")}\n`;
    };
    console.error = (data?: unknown) => {
      extra += `${String(data ?? "")}\n`;
    };
    const cap = captureOutput();
    try {
      const exitCode = await runReview({
        values: reviewValues({ files: ["src/h.ts"] }),
        commandPositionals: [],
        config,
        targetBranch: "origin/main",
        maxConcurrency: 1,
        startTime: performance.now(),
        dryRun: true,
      });

      const combined = cap.stdout + cap.stderr + extra;
      expect(combined).not.toContain("\x1b[");
      // The report still rendered (header + findings content present)
      expect(combined).toContain("MP Sentinel");
      expect(combined).toContain("Findings");
      expect(exitCode).toBe(1);
    } finally {
      cap.restore();
      console.warn = originalWarn;
      console.error = originalError;
    }
  });
});
