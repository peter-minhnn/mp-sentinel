import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import type { AuditIssue, FileAuditResult } from "../types/index.js";
import {
  buildReviewCommentFingerprint,
  postGitProviderComments,
} from "../services/git-provider.js";
import { setLogQuietMode } from "../utils/logger.js";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const tempDirs: string[] = [];

const makeResponse = (status: number, payload: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => (typeof payload === "string" ? payload : JSON.stringify(payload)),
  }) as Response;

const makeIssue = (overrides: Partial<AuditIssue> = {}): AuditIssue => ({
  line: 7,
  severity: "CRITICAL",
  category: "security",
  confidence: "high",
  message: "eval() executes arbitrary code.",
  suggestion: "Remove eval().",
  evidence: "pattern: eval",
  ...overrides,
});

const makeResults = (issue: AuditIssue): FileAuditResult[] => [
  {
    filePath: "src/a.ts",
    duration: 10,
    result: {
      status: "FAIL",
      issues: [issue],
    },
  },
];

const writeGitHubEvent = async (payload: unknown): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "mp-sentinel-github-event-"));
  tempDirs.push(dir);
  const eventPath = join(dir, "event.json");
  await writeFile(eventPath, JSON.stringify(payload), "utf-8");
  return eventPath;
};

const setupGitHubEnv = async (): Promise<void> => {
  process.env.GITHUB_ACTIONS = "true";
  process.env.GITHUB_TOKEN = "ghs_test";
  process.env.GITHUB_REPOSITORY = "owner/repo";
  process.env.GITHUB_SHA = "merge-sha";
  process.env.GITHUB_EVENT_PATH = await writeGitHubEvent({
    pull_request: {
      number: 42,
      head: {
        sha: "head-sha",
      },
    },
  });
};

beforeEach(() => {
  process.env = { ...originalEnv };
  setLogQuietMode(true);
});

afterEach(async () => {
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
  setLogQuietMode(false);
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("git provider comments", () => {
  it("posts GitHub review comments on the PR head SHA", async () => {
    await setupGitHubEnv();
    const mockFetch =
      jest.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();
    globalThis.fetch = mockFetch;

    mockFetch.mockResolvedValueOnce(makeResponse(200, []));
    mockFetch.mockResolvedValueOnce(makeResponse(201, { id: 99, body: "created" }));

    await postGitProviderComments(makeResults(makeIssue()));

    expect(mockFetch).toHaveBeenCalledTimes(2);

    const postCall = mockFetch.mock.calls[1];
    expect(postCall).toBeDefined();
    if (!postCall) throw new Error("Expected a GitHub create-comment request");

    expect(String(postCall[0])).toBe("https://api.github.com/repos/owner/repo/pulls/42/comments");
    const init = postCall[1];
    expect(init?.method).toBe("POST");

    const body = init?.body;
    if (typeof body !== "string") throw new Error("Expected JSON request body");
    const payload = JSON.parse(body) as Record<string, unknown>;

    expect(payload.commit_id).toBe("head-sha");
    expect(payload.path).toBe("src/a.ts");
    expect(payload.line).toBe(7);
    expect(payload.side).toBe("RIGHT");

    const commentBody = String(payload.body);
    expect(commentBody).toContain("mp-sentinel-review-comment");
    expect(commentBody).toContain("eval() executes arbitrary code.");
    // Report-style format
    expect(commentBody).toContain(
      "- **CRITICAL** (line 7): [security/high] eval() executes arbitrary code. — _Remove eval()._",
    );
    expect(commentBody).toContain("    - _Evidence: pattern: eval_");
    // Old format must not appear (standalone Severity:/Category:/Evidence: lines)
    expect(commentBody).not.toMatch(/^Severity: /m);
    expect(commentBody).not.toMatch(/^Category: /m);
    expect(commentBody).not.toMatch(/^Evidence: /m);
  });

  it("updates an existing GitHub comment with the same finding fingerprint", async () => {
    await setupGitHubEnv();
    const mockFetch =
      jest.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();
    globalThis.fetch = mockFetch;

    const issue = makeIssue();
    const fingerprint = buildReviewCommentFingerprint("src/a.ts", issue.line, issue);
    mockFetch.mockResolvedValueOnce(
      makeResponse(200, [
        {
          id: 123,
          body: `<!-- mp-sentinel-review-comment fingerprint=${fingerprint} -->\nold body`,
        },
      ]),
    );
    mockFetch.mockResolvedValueOnce(makeResponse(200, { id: 123, body: "updated" }));

    await postGitProviderComments(makeResults(issue));

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const patchCall = mockFetch.mock.calls[1];
    expect(patchCall).toBeDefined();
    if (!patchCall) throw new Error("Expected a GitHub update-comment request");

    expect(String(patchCall[0])).toBe("https://api.github.com/repos/owner/repo/pulls/comments/123");
    expect(patchCall[1]?.method).toBe("PATCH");
  });

  it("fetches PR head SHA from REST API for issue_comment events", async () => {
    process.env.GITHUB_ACTIONS = "true";
    process.env.GITHUB_TOKEN = "ghs_test";
    process.env.GITHUB_REPOSITORY = "owner/repo";
    process.env.GITHUB_SHA = "default-branch-sha";
    process.env.GITHUB_EVENT_PATH = await writeGitHubEvent({
      action: "created",
      issue: {
        number: 42,
        pull_request: { url: "https://api.github.com/repos/owner/repo/pulls/42" },
      },
      comment: { body: "/mp-sentinel review" },
    });

    const mockFetch =
      jest.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();
    globalThis.fetch = mockFetch;

    // 1) resolveCommitId: fetch PR metadata to resolve head SHA
    mockFetch.mockResolvedValueOnce(makeResponse(200, { head: { sha: "pr-head-sha-from-api" } }));
    // 2) loadExistingComments: list comments (empty)
    mockFetch.mockResolvedValueOnce(makeResponse(200, []));
    // 3) post comment
    mockFetch.mockResolvedValueOnce(makeResponse(201, { id: 77, body: "created" }));

    await postGitProviderComments(makeResults(makeIssue()));

    expect(mockFetch).toHaveBeenCalledTimes(3);

    // Verify PR fetch was called (first call — resolveCommitId runs before loadExistingComments)
    const prFetchCall = mockFetch.mock.calls[0];
    expect(String(prFetchCall?.[0])).toBe("https://api.github.com/repos/owner/repo/pulls/42");
    expect(prFetchCall?.[1]?.method).toBe("GET");

    // Verify posted comment uses the fetched head SHA
    const postCall = mockFetch.mock.calls[2];
    const init = postCall?.[1];
    const body = init?.body;
    if (typeof body !== "string") throw new Error("Expected JSON request body");
    const payload = JSON.parse(body) as Record<string, unknown>;
    expect(payload.commit_id).toBe("pr-head-sha-from-api");
  });

  it("skips posting when PR metadata fetch fails for issue_comment events", async () => {
    process.env.GITHUB_ACTIONS = "true";
    process.env.GITHUB_TOKEN = "ghs_test";
    process.env.GITHUB_REPOSITORY = "owner/repo";
    process.env.GITHUB_SHA = "fallback-sha";
    process.env.GITHUB_EVENT_PATH = await writeGitHubEvent({
      action: "created",
      issue: {
        number: 42,
        pull_request: { url: "https://api.github.com/repos/owner/repo/pulls/42" },
      },
      comment: { body: "/mp-sentinel review" },
    });

    const mockFetch =
      jest.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();
    globalThis.fetch = mockFetch;

    // resolveCommitId: PR metadata fetch fails → returns "" for issue_comment
    mockFetch.mockResolvedValueOnce(makeResponse(404, { message: "Not Found" }));

    await postGitProviderComments(makeResults(makeIssue()));

    // Only the failed PR fetch — no fallback to env SHA, no comment posted
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("does not post inline comments for INFO-only findings", async () => {
    await setupGitHubEnv();
    const mockFetch =
      jest.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();
    globalThis.fetch = mockFetch;

    await postGitProviderComments(makeResults(makeIssue({ severity: "INFO" })));

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
