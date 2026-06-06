/**
 * Integration: runReview with machine-readable formats while GitLab MR
 * comment posting is active. stdout must stay pure JSON/SARIF — comment
 * posting progress/success logs are routed to stderr.
 *
 * The deterministic (non-AI) review flags a hardcoded secret as CRITICAL,
 * which makes the comment poster run. fetch is mocked so the GitLab API
 * calls succeed without network.
 */

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import { runReview } from "../cli/review.js";
import type { CLIValues } from "../cli/args.js";
import type { ProjectConfig } from "../types/index.js";
import { clearProviderCache } from "../services/ai/index.js";
import { setLogQuietMode } from "../utils/logger.js";

const tempDirs: string[] = [];
const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
let originalCwd = process.cwd();

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "mp-sentinel-review-gl-"));
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

const jsonResponse = (status: number, payload: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => (typeof payload === "string" ? payload : JSON.stringify(payload)),
  }) as Response;

/** GitLab posting always succeeds: discussions [], notes [], versions, post. */
const installGitLabFetchMock = (mode: "ok" | "fail" = "ok"): void => {
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = String(input);
    if (url.includes("/versions")) {
      return jsonResponse(200, [
        { head_commit_sha: "h", base_commit_sha: "b", start_commit_sha: "s" },
      ]);
    }
    // In fail mode, POSTs return 5xx so the GitLab API error path runs.
    if (mode === "fail" && init?.method === "POST") {
      return jsonResponse(500, "gitlab unavailable");
    }
    if (url.includes("/discussions") || url.includes("/notes")) {
      return jsonResponse(200, []);
    }
    return jsonResponse(200, {});
  }) as typeof globalThis.fetch;
};

function captureStreams() {
  let stdout = "";
  let stderr = "";
  const origLog = console.log;
  const origInfoErr = console.error;
  const origWarn = console.warn;
  const origStderrWrite = process.stderr.write;
  console.log = (d?: unknown) => {
    stdout += String(d ?? "") + "\n";
  };
  console.error = (d?: unknown) => {
    stderr += String(d ?? "") + "\n";
  };
  console.warn = (d?: unknown) => {
    stderr += String(d ?? "") + "\n";
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
      console.log = origLog;
      console.error = origInfoErr;
      console.warn = origWarn;
      process.stderr.write = origStderrWrite;
    },
  };
}

const setupGitLabEnv = (): void => {
  process.env.GITLAB_CI = "true";
  process.env.CI_PROJECT_ID = "555";
  process.env.CI_MERGE_REQUEST_IID = "12";
  process.env.CI_SERVER_URL = "https://gitlab.example.com";
  process.env.CI_COMMIT_SHA = "env-head-sha";
  process.env.CI_MERGE_REQUEST_DIFF_BASE_SHA = "env-base-sha";
  process.env.GITLAB_TOKEN = "glpat-test";
  delete process.env.CI_JOB_TOKEN;
  delete process.env.GITHUB_ACTIONS;
};

const baseConfig: ProjectConfig = {
  cacheEnabled: false,
  indexing: { enabled: false },
  ai: { maxFiles: 5, maxDiffLines: 200, maxCharsPerFile: 4000 },
};

// A hardcoded AWS-style key trips deterministic secret redaction → CRITICAL.
const SECRET_FILE = 'export const key = "AKIAIOSFODNN7EXAMPLE";\n';

const runReviewFor = (cwd: string, format: "json" | "sarif"): Promise<number> =>
  runReview({
    values: reviewValues({ files: ["src/secret.ts"], format }),
    commandPositionals: [],
    config: baseConfig,
    targetBranch: "origin/main",
    maxConcurrency: 1,
    startTime: performance.now(),
  });

beforeEach(() => {
  originalCwd = process.cwd();
  clearProviderCache();
  setLogQuietMode(false);
});

afterEach(async () => {
  process.chdir(originalCwd);
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
  clearProviderCache();
  setLogQuietMode(false);
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("runReview GitLab comment posting keeps machine-readable stdout clean", () => {
  it("--format json: stdout is parseable JSON, comment logs go to stderr", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "secret.ts"), SECRET_FILE);
    process.chdir(cwd);

    // Force deterministic (non-AI) review with a CRITICAL secret finding.
    process.env.AI_PROVIDER = "anthropic";
    process.env.AI_MODEL = "not-a-real-model";
    process.env.ANTHROPIC_API_KEY = "test-key";
    setupGitLabEnv();
    installGitLabFetchMock();

    // Production sets quiet for machine formats; report is emitted via direct
    // console.log, comment posting logs are routed to stderr (bypassing quiet).
    setLogQuietMode(true);
    const cap = captureStreams();
    let exitCode = -1;
    try {
      exitCode = await runReviewFor(cwd, "json");
    } finally {
      cap.restore();
    }

    // stdout is a single JSON document
    const report = JSON.parse(cap.stdout);
    expect(report.status).toBeDefined();
    expect(report.results).toBeDefined();
    // Comment-posting logs must NOT be in stdout
    expect(cap.stdout).not.toContain("Posted discussion");
    expect(cap.stdout).not.toContain("Git Provider detected");
    expect(cap.stdout).not.toContain("Updated existing");
    // They belong on stderr
    expect(cap.stderr).toContain("Git Provider detected");
    expect(exitCode).toBeGreaterThanOrEqual(0);
  });

  it("--format sarif: stdout is parseable SARIF JSON while posting is active", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "secret.ts"), SECRET_FILE);
    process.chdir(cwd);

    process.env.AI_PROVIDER = "anthropic";
    process.env.AI_MODEL = "not-a-real-model";
    process.env.ANTHROPIC_API_KEY = "test-key";
    setupGitLabEnv();
    installGitLabFetchMock();

    // Production sets quiet for machine formats; report is emitted via direct
    // console.log, comment posting logs are routed to stderr (bypassing quiet).
    setLogQuietMode(true);
    const cap = captureStreams();
    try {
      await runReviewFor(cwd, "sarif");
    } finally {
      cap.restore();
    }

    const sarif = JSON.parse(cap.stdout);
    expect(sarif.$schema ?? sarif.version ?? sarif.runs).toBeDefined();
    expect(Array.isArray(sarif.runs)).toBe(true);
    expect(cap.stdout).not.toContain("Posted discussion");
    expect(cap.stdout).not.toContain("Git Provider detected");
  });

  it("--format json with a GitLab API failure: stdout stays JSON, stderr has the diagnostic", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "secret.ts"), SECRET_FILE);
    process.chdir(cwd);

    process.env.AI_PROVIDER = "anthropic";
    process.env.AI_MODEL = "not-a-real-model";
    process.env.ANTHROPIC_API_KEY = "test-key";
    setupGitLabEnv();
    installGitLabFetchMock("fail");

    setLogQuietMode(true);
    const cap = captureStreams();
    try {
      await runReviewFor(cwd, "json");
    } finally {
      cap.restore();
    }

    // stdout is still a single valid JSON document despite the API failure.
    const report = JSON.parse(cap.stdout);
    expect(report.results).toBeDefined();
    // The GitLab error surfaces on stderr, not stdout.
    expect(cap.stdout).not.toContain("GitLab API Error");
    expect(cap.stderr).toContain("GitLab API Error");
  });

  it("--format sarif with a GitLab API failure: stdout stays SARIF JSON", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src", "secret.ts"), SECRET_FILE);
    process.chdir(cwd);

    process.env.AI_PROVIDER = "anthropic";
    process.env.AI_MODEL = "not-a-real-model";
    process.env.ANTHROPIC_API_KEY = "test-key";
    setupGitLabEnv();
    installGitLabFetchMock("fail");

    setLogQuietMode(true);
    const cap = captureStreams();
    try {
      await runReviewFor(cwd, "sarif");
    } finally {
      cap.restore();
    }

    const sarif = JSON.parse(cap.stdout);
    expect(Array.isArray(sarif.runs)).toBe(true);
    expect(cap.stderr).toContain("GitLab API Error");
  });
});
