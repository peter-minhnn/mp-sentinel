/**
 * PR metadata extraction tests — GITHUB_EVENT_PATH payload parsing,
 * env-var fallback, GitLab CI, and issue_comment event handling.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setLogQuietMode } from "../utils/logger.js";

// The function is in a module with top-level env reads, so we import it fresh
// for each test by resetting modules and setting env vars beforehand.

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "mp-sentinel-prmeta-"));
  setLogQuietMode(true);
});

afterEach(async () => {
  setLogQuietMode(false);
  await rm(tempDir, { recursive: true, force: true });
  // Clean up test env vars
  delete process.env.GITHUB_EVENT_PATH;
  delete process.env.GITHUB_REPOSITORY;
  delete process.env.GITHUB_REF;
  delete process.env.GITHUB_HEAD_SHA;
  delete process.env.GITHUB_SHA;
  delete process.env.GITHUB_BASE_REF;
  delete process.env.CI_PROJECT_PATH;
  delete process.env.CI_MERGE_REQUEST_IID;
  delete process.env.CI_COMMIT_SHA;
  delete process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME;
});

describe("extractPRMetadata from pull_request event", () => {
  it("reads PR number, head sha, base ref from pull_request payload", async () => {
    const eventPath = join(tempDir, "event.json");
    const payload = {
      action: "opened",
      pull_request: {
        number: 99,
        head: { sha: "def456", ref: "feature/x" },
        base: { ref: "develop", sha: "abc123" },
      },
      repository: {
        owner: { login: "acme" },
        name: "widgets",
        full_name: "acme/widgets",
      },
    };
    await writeFile(eventPath, JSON.stringify(payload), "utf-8");
    process.env.GITHUB_EVENT_PATH = eventPath;

    // Import fresh so the module reads the env var
    const { extractPRMetadata } = await import("../utils/pr-metadata.js");
    const meta = await extractPRMetadata(["src/a.ts"]);
    expect(meta.owner).toBe("acme");
    expect(meta.name).toBe("widgets");
    expect(meta.fullName).toBe("acme/widgets");
    expect(meta.prNumber).toBe(99);
    expect(meta.headSha).toBe("def456");
    expect(meta.baseRef).toBe("develop");
  });

  it("reads PR number from pull_request payload with minimal fields", async () => {
    const eventPath = join(tempDir, "event.json");
    const payload = {
      pull_request: {
        number: 7,
      },
    };
    await writeFile(eventPath, JSON.stringify(payload), "utf-8");
    process.env.GITHUB_EVENT_PATH = eventPath;

    const { extractPRMetadata } = await import("../utils/pr-metadata.js");
    const meta = await extractPRMetadata(["src/a.ts"]);
    expect(meta.prNumber).toBe(7);
    expect(meta.owner).toBe("");
    expect(meta.headSha).toBe("");
    expect(meta.baseRef).toBe("");
  });
});

describe("extractPRMetadata from issue_comment event", () => {
  it("extracts PR number from issue_comment with pull_request link", async () => {
    const eventPath = join(tempDir, "event.json");
    const payload = {
      action: "created",
      issue: {
        number: 55,
        pull_request: { url: "https://api.github.com/repos/foo/bar/pulls/55" },
      },
      repository: {
        owner: { login: "foo" },
        name: "bar",
        full_name: "foo/bar",
      },
    };
    await writeFile(eventPath, JSON.stringify(payload), "utf-8");
    process.env.GITHUB_EVENT_PATH = eventPath;
    // Also set env vars for headSha/baseRef fallback in issue_comment
    process.env.GITHUB_HEAD_SHA = "shaFromEnv";
    process.env.GITHUB_BASE_REF = "baseFromEnv";

    const { extractPRMetadata } = await import("../utils/pr-metadata.js");
    const meta = await extractPRMetadata(["src/b.ts"]);
    expect(meta.prNumber).toBe(55);
    expect(meta.owner).toBe("foo");
    expect(meta.name).toBe("bar");
    expect(meta.fullName).toBe("foo/bar");
    // issue_comment falls back to env for head/base
    expect(meta.headSha).toBe("shaFromEnv");
    expect(meta.baseRef).toBe("baseFromEnv");
  });

  it("issue_comment without pull_request field falls through to env", async () => {
    const eventPath = join(tempDir, "event.json");
    const payload = {
      action: "created",
      issue: {
        number: 10,
      },
      repository: {
        full_name: "team/repo",
      },
    };
    await writeFile(eventPath, JSON.stringify(payload), "utf-8");
    process.env.GITHUB_EVENT_PATH = eventPath;
    process.env.GITHUB_REPOSITORY = "team/repo";
    process.env.GITHUB_SHA = "envsha";
    process.env.GITHUB_REF = "refs/pull/10/merge";

    const { extractPRMetadata } = await import("../utils/pr-metadata.js");
    const meta = await extractPRMetadata([]);
    // With issue but no pull_request, falls through to catch-all then env fallback
    // The eventPayload exists and has repository info, so it takes the generic event path
    expect(meta.owner).toBe("team");
    expect(meta.name).toBe("repo");
  });
});

describe("extractPRMetadata with missing GITHUB_EVENT_PATH", () => {
  it("falls back to GITHUB_REPOSITORY + GITHUB_REF", async () => {
    process.env.GITHUB_REPOSITORY = "org/repo";
    process.env.GITHUB_REF = "refs/pull/12/merge";
    process.env.GITHUB_HEAD_SHA = "headsha1";
    process.env.GITHUB_BASE_REF = "main";

    const { extractPRMetadata } = await import("../utils/pr-metadata.js");
    const meta = await extractPRMetadata(["x.ts", "y.ts"]);
    expect(meta.owner).toBe("org");
    expect(meta.name).toBe("repo");
    expect(meta.fullName).toBe("org/repo");
    expect(meta.prNumber).toBe(12);
    expect(meta.headSha).toBe("headsha1");
    expect(meta.baseRef).toBe("main");
    expect(meta.changedFilesCsv).toBe("x.ts,y.ts");
  });

  it("uses GITHUB_SHA when GITHUB_HEAD_SHA is absent", async () => {
    process.env.GITHUB_REPOSITORY = "a/b";
    process.env.GITHUB_SHA = "plainSha";

    const { extractPRMetadata } = await import("../utils/pr-metadata.js");
    const meta = await extractPRMetadata([]);
    expect(meta.headSha).toBe("plainSha");
  });
});

describe("extractPRMetadata with GitLab CI vars", () => {
  it("parses CI_PROJECT_PATH and CI_MERGE_REQUEST_IID", async () => {
    process.env.CI_PROJECT_PATH = "gitlab-org/gitlab-project";
    process.env.CI_MERGE_REQUEST_IID = "88";
    process.env.CI_COMMIT_SHA = "gitlabSha";
    process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME = "trunk";

    const { extractPRMetadata } = await import("../utils/pr-metadata.js");
    const meta = await extractPRMetadata([]);
    expect(meta.owner).toBe("gitlab-org");
    expect(meta.name).toBe("gitlab-project");
    expect(meta.prNumber).toBe(88);
    expect(meta.headSha).toBe("gitlabSha");
    expect(meta.baseRef).toBe("trunk");
  });
});

describe("extractPRMetadata with empty env", () => {
  it("returns zero-values when no env vars are set", async () => {
    const { extractPRMetadata } = await import("../utils/pr-metadata.js");
    const meta = await extractPRMetadata([]);
    expect(meta.owner).toBe("");
    expect(meta.name).toBe("");
    expect(meta.fullName).toBe("");
    expect(meta.prNumber).toBe(0);
    expect(meta.headSha).toBe("");
    expect(meta.baseRef).toBe("origin/main");
    expect(meta.changedFilesCsv).toBe("");
  });
});
