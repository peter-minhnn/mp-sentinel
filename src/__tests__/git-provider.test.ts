import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import type { AuditIssue, FileAuditResult } from "../types/index.js";
import {
  buildReviewCommentFingerprint,
  getGitProvider,
  postGitProviderComments,
  sanitizeCodeSuggestion,
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
    // Rich renderer format
    expect(commentBody).toContain(
      "**MP Sentinel · CRITICAL** — line 7 · `security` · confidence: high",
    );
    expect(commentBody).toContain("**Why this matters**");
    expect(commentBody).toContain("eval() executes arbitrary code.");
    expect(commentBody).toContain("**Suggested fix**");
    expect(commentBody).toContain("Remove eval().");
    expect(commentBody).toContain("**Evidence**");
    expect(commentBody).toContain("`pattern: eval`");
    // Old single-line report format must not appear
    expect(commentBody).not.toMatch(/^- \*\*CRITICAL\*\* \(line 7\)/m);
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

// ── GitLab provider ─────────────────────────────────────────────────────────

const setupGitLabEnv = (tokenKind: "pat" | "job" = "pat"): void => {
  process.env.GITLAB_CI = "true";
  process.env.CI_PROJECT_ID = "555";
  process.env.CI_MERGE_REQUEST_IID = "12";
  process.env.CI_SERVER_URL = "https://gitlab.example.com";
  process.env.CI_COMMIT_SHA = "env-head-sha";
  process.env.CI_MERGE_REQUEST_DIFF_BASE_SHA = "env-base-sha";
  delete process.env.GITHUB_ACTIONS;
  if (tokenKind === "pat") {
    process.env.GITLAB_TOKEN = "glpat-test";
    delete process.env.CI_JOB_TOKEN;
  } else {
    delete process.env.GITLAB_TOKEN;
    process.env.CI_JOB_TOKEN = "job-token-test";
  }
};

const versionsResponse = () =>
  makeResponse(200, [
    { head_commit_sha: "ver-head", base_commit_sha: "ver-base", start_commit_sha: "ver-start" },
  ]);

/** loadExistingNotes makes two list calls: discussions then notes. */
const queueEmptyExisting = (
  mockFetch: ReturnType<
    typeof jest.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>
  >,
): void => {
  mockFetch.mockResolvedValueOnce(makeResponse(200, [])); // discussions
  mockFetch.mockResolvedValueOnce(makeResponse(200, [])); // notes
};

const urlOf = (
  mockFetch: ReturnType<
    typeof jest.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>
  >,
  i: number,
): string => String(mockFetch.mock.calls[i]![0]);

describe("GitLab provider comments", () => {
  it("posts an inline discussion with the version SHAs and text position", async () => {
    setupGitLabEnv("pat");
    const mockFetch =
      jest.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();
    globalThis.fetch = mockFetch;

    queueEmptyExisting(mockFetch); // discussions + notes
    mockFetch.mockResolvedValueOnce(versionsResponse()); // versions
    mockFetch.mockResolvedValueOnce(makeResponse(201, { id: "disc1" })); // post

    await postGitProviderComments(makeResults(makeIssue()));

    expect(mockFetch).toHaveBeenCalledTimes(4);

    const postCall = mockFetch.mock.calls[3]!;
    expect(String(postCall[0])).toBe(
      "https://gitlab.example.com/api/v4/projects/555/merge_requests/12/discussions",
    );
    expect(postCall[1]?.method).toBe("POST");
    const headers = postCall[1]?.headers as Record<string, string>;
    expect(headers["PRIVATE-TOKEN"]).toBe("glpat-test");
    expect(headers["JOB-TOKEN"]).toBeUndefined();

    const payload = JSON.parse(String(postCall[1]?.body)) as {
      body: string;
      position: Record<string, unknown>;
    };
    expect(payload.position.position_type).toBe("text");
    expect(payload.position.head_sha).toBe("ver-head");
    expect(payload.position.base_sha).toBe("ver-base");
    expect(payload.position.start_sha).toBe("ver-start");
    expect(payload.position.new_path).toBe("src/a.ts");
    expect(payload.position.new_line).toBe(7);
    expect(payload.body).toContain("mp-sentinel-review-comment");
  });

  it("requests the MR diff version with per_page=1", async () => {
    setupGitLabEnv("pat");
    const mockFetch =
      jest.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();
    globalThis.fetch = mockFetch;
    queueEmptyExisting(mockFetch);
    mockFetch.mockResolvedValueOnce(versionsResponse());
    mockFetch.mockResolvedValueOnce(makeResponse(201, { id: "disc1" }));

    await postGitProviderComments(makeResults(makeIssue()));

    expect(urlOf(mockFetch, 2)).toBe(
      "https://gitlab.example.com/api/v4/projects/555/merge_requests/12/versions?per_page=1",
    );
  });

  it("uses JOB-TOKEN header when only CI_JOB_TOKEN is set", async () => {
    setupGitLabEnv("job");
    const mockFetch =
      jest.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();
    globalThis.fetch = mockFetch;
    queueEmptyExisting(mockFetch);
    mockFetch.mockResolvedValueOnce(versionsResponse());
    mockFetch.mockResolvedValueOnce(makeResponse(201, { id: "disc1" }));

    await postGitProviderComments(makeResults(makeIssue()));

    const postCall = mockFetch.mock.calls[3]!;
    const headers = postCall[1]?.headers as Record<string, string>;
    expect(headers["JOB-TOKEN"]).toBe("job-token-test");
    expect(headers["PRIVATE-TOKEN"]).toBeUndefined();
  });

  it("falls back to CI env SHAs when the versions API fails", async () => {
    setupGitLabEnv("pat");
    const mockFetch =
      jest.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();
    globalThis.fetch = mockFetch;
    queueEmptyExisting(mockFetch);
    mockFetch.mockResolvedValueOnce(makeResponse(500, "boom")); // versions fail
    mockFetch.mockResolvedValueOnce(makeResponse(201, { id: "disc1" })); // post

    await postGitProviderComments(makeResults(makeIssue()));

    const postCall = mockFetch.mock.calls[3]!;
    const payload = JSON.parse(String(postCall[1]?.body)) as { position: Record<string, unknown> };
    expect(payload.position.head_sha).toBe("env-head-sha");
    expect(payload.position.base_sha).toBe("env-base-sha");
  });

  it("updates an existing inline discussion note with the same fingerprint", async () => {
    setupGitLabEnv("pat");
    const issue = makeIssue();
    const fingerprint = buildReviewCommentFingerprint("src/a.ts", issue.line, issue);
    const mockFetch =
      jest.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();
    globalThis.fetch = mockFetch;

    // discussions list contains a note with this fingerprint, notes list empty
    mockFetch.mockResolvedValueOnce(
      makeResponse(200, [
        {
          id: "disc-existing",
          notes: [
            {
              id: 9001,
              body: `<!-- mp-sentinel-review-comment fingerprint=${fingerprint} -->\nold body`,
            },
          ],
        },
      ]),
    );
    mockFetch.mockResolvedValueOnce(makeResponse(200, [])); // notes
    mockFetch.mockResolvedValueOnce(makeResponse(200, { id: 9001 })); // PUT update

    await postGitProviderComments(makeResults(issue));

    expect(mockFetch).toHaveBeenCalledTimes(3);
    const putCall = mockFetch.mock.calls[2]!;
    expect(String(putCall[0])).toBe(
      "https://gitlab.example.com/api/v4/projects/555/merge_requests/12/discussions/disc-existing/notes/9001",
    );
    expect(putCall[1]?.method).toBe("PUT");
  });

  it("posts an MR-level fallback note when the inline position is rejected", async () => {
    setupGitLabEnv("pat");
    const mockFetch =
      jest.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();
    globalThis.fetch = mockFetch;
    queueEmptyExisting(mockFetch);
    mockFetch.mockResolvedValueOnce(versionsResponse());
    mockFetch.mockResolvedValueOnce(makeResponse(400, "line not in diff")); // inline rejected
    mockFetch.mockResolvedValueOnce(makeResponse(201, { id: 1 })); // fallback note

    await postGitProviderComments(makeResults(makeIssue()));

    expect(mockFetch).toHaveBeenCalledTimes(5);
    const fallbackCall = mockFetch.mock.calls[4]!;
    expect(String(fallbackCall[0])).toBe(
      "https://gitlab.example.com/api/v4/projects/555/merge_requests/12/notes",
    );
    const payload = JSON.parse(String(fallbackCall[1]?.body)) as { body: string };
    expect(payload.body).toContain("`src/a.ts:7`");
    expect(payload.body).toContain("Inline position unavailable");
  });

  it("updates an existing MR-level fallback note (PUT /notes) on changed content", async () => {
    setupGitLabEnv("pat");
    const issue = makeIssue();
    const fingerprint = buildReviewCommentFingerprint("src/a.ts", issue.line, issue);
    const mockFetch =
      jest.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();
    globalThis.fetch = mockFetch;

    mockFetch.mockResolvedValueOnce(makeResponse(200, [])); // discussions
    mockFetch.mockResolvedValueOnce(
      makeResponse(200, [
        {
          id: 4242,
          system: false,
          body: `<!-- mp-sentinel-review-comment fingerprint=${fingerprint} -->\nstale fallback`,
        },
      ]),
    ); // notes carries a prior fallback note
    mockFetch.mockResolvedValueOnce(makeResponse(200, { id: 4242 })); // PUT

    await postGitProviderComments(makeResults(issue));

    expect(mockFetch).toHaveBeenCalledTimes(3);
    const putCall = mockFetch.mock.calls[2]!;
    expect(String(putCall[0])).toBe(
      "https://gitlab.example.com/api/v4/projects/555/merge_requests/12/notes/4242",
    );
    expect(putCall[1]?.method).toBe("PUT");
    const payload = JSON.parse(String(putCall[1]?.body)) as { body: string };
    // Updated note keeps the fallback footer (file:line)
    expect(payload.body).toContain("Inline position unavailable");
    expect(payload.body).toContain("`src/a.ts:7`");
  });

  it("does not duplicate when an identical MR-level fallback note already exists", async () => {
    setupGitLabEnv("pat");
    const issue = makeIssue();
    const mockFetch =
      jest.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();
    globalThis.fetch = mockFetch;

    // First run forces a fallback note and captures the exact body posted.
    queueEmptyExisting(mockFetch);
    mockFetch.mockResolvedValueOnce(versionsResponse());
    mockFetch.mockResolvedValueOnce(makeResponse(400, "line not in diff"));
    mockFetch.mockResolvedValueOnce(makeResponse(201, { id: 7 }));
    await postGitProviderComments(makeResults(issue));
    const postedFallbackBody = JSON.parse(String(mockFetch.mock.calls[4]![1]?.body)) as {
      body: string;
    };

    // Second run: the same fallback note is already present (identical body).
    const before = mockFetch.mock.calls.length;
    mockFetch.mockResolvedValueOnce(makeResponse(200, [])); // discussions
    mockFetch.mockResolvedValueOnce(
      makeResponse(200, [{ id: 7, system: false, body: postedFallbackBody.body }]),
    ); // notes carry the identical fallback
    await postGitProviderComments(makeResults(issue));

    // Only the two listing calls — no POST, no PUT.
    expect(mockFetch.mock.calls.length).toBe(before + 2);
  });

  it("does not post INFO-only findings to GitLab", async () => {
    setupGitLabEnv("pat");
    const mockFetch =
      jest.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();
    globalThis.fetch = mockFetch;

    await postGitProviderComments(makeResults(makeIssue({ severity: "INFO" })));

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("renders a GitLab-compatible suggestion block only for safe codeSuggestion", async () => {
    setupGitLabEnv("pat");
    const mockFetch =
      jest.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();
    globalThis.fetch = mockFetch;
    queueEmptyExisting(mockFetch);
    mockFetch.mockResolvedValueOnce(versionsResponse());
    mockFetch.mockResolvedValueOnce(makeResponse(201, { id: "disc1" }));

    await postGitProviderComments(
      makeResults(makeIssue({ codeSuggestion: "const safe = sanitize(input);" })),
    );

    const postCall = mockFetch.mock.calls[3]!;
    const payload = JSON.parse(String(postCall[1]?.body)) as { body: string };
    expect(payload.body).toContain("```suggestion\nconst safe = sanitize(input);\n```");
  });

  it("selects the GitLab provider in a GitLab CI environment", () => {
    setupGitLabEnv("pat");
    const provider = getGitProvider();
    expect(provider).not.toBeNull();
    expect(provider?.constructor.name).toBe("GitLabProvider");
  });

  it("does not post a duplicate inline discussion when reviewed twice", async () => {
    setupGitLabEnv("pat");
    const issue = makeIssue();
    const mockFetch =
      jest.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();
    globalThis.fetch = mockFetch;

    queueEmptyExisting(mockFetch);
    mockFetch.mockResolvedValueOnce(versionsResponse());
    mockFetch.mockResolvedValueOnce(makeResponse(201, { id: "disc1" }));
    await postGitProviderComments(makeResults(issue));
    const firstRunCalls = mockFetch.mock.calls.length;

    // Rerun: discussion already carries the identical body -> no create/update.
    const body = JSON.parse(String(mockFetch.mock.calls[3]![1]?.body)) as { body: string };
    mockFetch.mockResolvedValueOnce(
      makeResponse(200, [{ id: "disc1", notes: [{ id: 1, body: body.body }] }]),
    ); // discussions has the match
    mockFetch.mockResolvedValueOnce(makeResponse(200, [])); // notes
    await postGitProviderComments(makeResults(issue));

    // Only the two listing calls were made on rerun.
    expect(mockFetch.mock.calls.length).toBe(firstRunCalls + 2);
  });

  it("surfaces GitLab API warnings on stderr even when quiet mode is on", async () => {
    setupGitLabEnv("pat");
    const mockFetch =
      jest.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();
    globalThis.fetch = mockFetch;
    // discussions list fails -> warning; notes empty; versions; post ok
    mockFetch.mockResolvedValueOnce(makeResponse(500, "server error"));
    mockFetch.mockResolvedValueOnce(makeResponse(200, []));
    mockFetch.mockResolvedValueOnce(versionsResponse());
    mockFetch.mockResolvedValueOnce(makeResponse(201, { id: "disc1" }));

    const stderrLines: string[] = [];
    const stderrSpy = jest
      .spyOn(console, "error")
      .mockImplementation((...a: unknown[]) => void stderrLines.push(String(a[0])));
    setLogQuietMode(true); // machine-readable mode: stdout quiet, stderr visible
    try {
      await postGitProviderComments(makeResults(makeIssue()), { logToStderr: true });
    } finally {
      setLogQuietMode(true);
      stderrSpy.mockRestore();
    }

    const stderrText = stderrLines.join("\n");
    expect(stderrText).toContain("Could not list existing GitLab discussions");
  });

  it("surfaces a GitLab POST error on stderr under quiet mode", async () => {
    setupGitLabEnv("pat");
    const mockFetch =
      jest.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();
    globalThis.fetch = mockFetch;
    queueEmptyExisting(mockFetch);
    mockFetch.mockResolvedValueOnce(versionsResponse());
    mockFetch.mockResolvedValueOnce(makeResponse(400, "bad position")); // inline rejected
    mockFetch.mockResolvedValueOnce(makeResponse(500, "note failed")); // fallback note fails

    const stderrLines: string[] = [];
    const stderrSpy = jest
      .spyOn(console, "error")
      .mockImplementation((...a: unknown[]) => void stderrLines.push(String(a[0])));
    setLogQuietMode(true);
    try {
      await postGitProviderComments(makeResults(makeIssue()), { logToStderr: true });
    } finally {
      setLogQuietMode(true);
      stderrSpy.mockRestore();
    }

    const stderrText = stderrLines.join("\n");
    expect(stderrText).toContain("inline position rejected");
    expect(stderrText).toContain("GitLab API Error (fallback note)");
  });

  it("drops a multi-line codeSuggestion at render time (no suggestion block)", async () => {
    setupGitLabEnv("pat");
    const mockFetch =
      jest.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();
    globalThis.fetch = mockFetch;
    queueEmptyExisting(mockFetch);
    mockFetch.mockResolvedValueOnce(versionsResponse());
    mockFetch.mockResolvedValueOnce(makeResponse(201, { id: "disc1" }));

    // A multi-line codeSuggestion that bypassed the parser must still be
    // dropped by the renderer gate.
    await postGitProviderComments(
      makeResults(makeIssue({ codeSuggestion: "const a = 1;\nconst b = 2;" })),
    );

    const postCall = mockFetch.mock.calls[3]!;
    const payload = JSON.parse(String(postCall[1]?.body)) as { body: string };
    expect(payload.body).not.toContain("```suggestion");
  });

  it("caps inline comments at 50 per run and reports the skipped count", async () => {
    setupGitLabEnv("pat");
    // 51 actionable findings across one file.
    const issues = Array.from({ length: 51 }, (_, i) =>
      makeIssue({ line: i + 1, message: `finding ${i}` }),
    );
    const results: FileAuditResult[] = [
      { filePath: "src/a.ts", duration: 1, result: { status: "FAIL", issues } },
    ];

    const mockFetch = jest.fn<
      (input: string | URL | Request, init?: RequestInit) => Promise<Response>
    >(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/versions")) return versionsResponse();
      if (url.includes("/discussions") || url.includes("/notes")) return makeResponse(200, []);
      return makeResponse(201, { id: "d" });
    });
    globalThis.fetch = mockFetch;

    const stderrLines: string[] = [];
    const stderrSpy = jest
      .spyOn(console, "error")
      .mockImplementation((...a: unknown[]) => void stderrLines.push(String(a[0])));
    setLogQuietMode(true);
    try {
      await postGitProviderComments(results, { logToStderr: true });
    } finally {
      setLogQuietMode(true);
      stderrSpy.mockRestore();
    }

    // Posts to /discussions are capped at 50.
    const postCalls = mockFetch.mock.calls.filter(
      (c) => String(c[0]).endsWith("/discussions") && c[1]?.method === "POST",
    );
    expect(postCalls).toHaveLength(50);
    expect(stderrLines.join("\n")).toContain("1 more skipped");
  });

  it("routes comment logs to stderr (not stdout) when logToStderr is set", async () => {
    setupGitLabEnv("pat");
    const mockFetch =
      jest.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>();
    globalThis.fetch = mockFetch;
    queueEmptyExisting(mockFetch);
    mockFetch.mockResolvedValueOnce(versionsResponse());
    mockFetch.mockResolvedValueOnce(makeResponse(201, { id: "disc1" }));

    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const stdoutSpy = jest
      .spyOn(console, "log")
      .mockImplementation((...a: unknown[]) => void stdoutLines.push(String(a[0])));
    const stderrSpy = jest
      .spyOn(console, "error")
      .mockImplementation((...a: unknown[]) => void stderrLines.push(String(a[0])));
    setLogQuietMode(false); // allow log output so we can observe routing
    try {
      await postGitProviderComments(makeResults(makeIssue()), { logToStderr: true });
    } finally {
      setLogQuietMode(true);
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }

    expect(mockFetch).toHaveBeenCalledTimes(4);
    const stdoutText = stdoutLines.join("\n");
    const stderrText = stderrLines.join("\n");
    expect(stdoutText).not.toContain("Posted discussion");
    expect(stdoutText).not.toContain("Git Provider detected");
    expect(stderrText).toContain("Posted discussion on src/a.ts:7");
    expect(stderrText).toContain("Git Provider detected");
  });
});

// ── Code suggestion sanitization ────────────────────────────────────────────

describe("sanitizeCodeSuggestion", () => {
  it("accepts clean single-line code", () => {
    expect(sanitizeCodeSuggestion("const x = foo();")).toBe("const x = foo();");
  });

  it("rejects multi-line code (v1 single-line only)", () => {
    expect(sanitizeCodeSuggestion("if (x) {\n  return y;\n}")).toBeNull();
    expect(sanitizeCodeSuggestion("const a = 1;\nconst b = 2;")).toBeNull();
  });

  it("rejects empty / whitespace", () => {
    expect(sanitizeCodeSuggestion("")).toBeNull();
    expect(sanitizeCodeSuggestion("   \n  ")).toBeNull();
    expect(sanitizeCodeSuggestion(undefined)).toBeNull();
  });

  it("rejects nested code fences", () => {
    expect(sanitizeCodeSuggestion("```js const x = 1; ```")).toBeNull();
  });

  it("rejects prose that is not code", () => {
    expect(sanitizeCodeSuggestion("Remove the eval call and validate input instead.")).toBeNull();
  });

  it("rejects oversized suggestions", () => {
    expect(sanitizeCodeSuggestion("a".repeat(500))).toBeNull();
  });
});
