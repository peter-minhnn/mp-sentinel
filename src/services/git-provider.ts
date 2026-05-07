import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AuditIssue, FileAuditResult } from "../types/index.js";
import { log } from "../utils/logger.js";

interface GitProvider {
  postComment(filePath: string, line: number, issue: AuditIssue): Promise<void>;
}

interface GitHubEventContext {
  prNumber?: number;
  headSha?: string;
  isIssueComment?: boolean;
}

interface GitHubReviewComment {
  id: number;
  body: string;
}

const COMMENT_MARKER = "mp-sentinel-review-comment";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getRecord = (value: Record<string, unknown>, key: string): Record<string, unknown> | null => {
  const child = value[key];
  return isRecord(child) ? child : null;
};

const getString = (value: Record<string, unknown>, key: string): string | undefined => {
  const child = value[key];
  return typeof child === "string" && child.length > 0 ? child : undefined;
};

const getNumber = (value: Record<string, unknown>, key: string): number | undefined => {
  const child = value[key];
  return typeof child === "number" && Number.isInteger(child) && child > 0 ? child : undefined;
};

const normalizeForFingerprint = (value: string): string => value.trim().replace(/\s+/g, " ");

export const buildReviewCommentFingerprint = (
  filePath: string,
  line: number,
  issue: AuditIssue,
): string => {
  const source = [
    filePath,
    String(line),
    issue.severity,
    issue.category ?? "",
    normalizeForFingerprint(issue.message),
  ].join("\n");
  return createHash("sha256").update(source).digest("hex").slice(0, 16);
};

const EVIDENCE_MAX_LENGTH = 160;

const formatEvidence = (evidence: string): string => {
  const collapsed = evidence.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  if (collapsed.length <= EVIDENCE_MAX_LENGTH) return collapsed;
  return collapsed.slice(0, EVIDENCE_MAX_LENGTH - 3) + "...";
};

const buildCommentBody = (filePath: string, line: number, issue: AuditIssue): string => {
  const fingerprint = buildReviewCommentFingerprint(filePath, line, issue);
  const meta = issue.category && issue.confidence ? `[${issue.category}/${issue.confidence}] ` : "";
  const suggestion = issue.suggestion ? ` — _${issue.suggestion}_` : "";
  const finding = `- **${issue.severity}** (line ${line}): ${meta}${issue.message}${suggestion}`;
  const evidence = issue.evidence ? `\n    - _Evidence: ${formatEvidence(issue.evidence)}_` : "";

  return [
    `<!-- ${COMMENT_MARKER} fingerprint=${fingerprint} -->`,
    "**MP Sentinel Audit Issue**",
    "",
    `${finding}${evidence}`,
    "",
    "_Managed by mp-sentinel. Reruns update the same finding instead of posting duplicates._",
  ].join("\n");
};

const extractFingerprint = (body: string): string | null => {
  const match = body.match(/mp-sentinel-review-comment\s+fingerprint=([a-f0-9]{16})/);
  return match?.[1] ?? null;
};

const parseGitHubReviewComment = (value: unknown): GitHubReviewComment | null => {
  if (!isRecord(value)) return null;
  const id = getNumber(value, "id");
  const body = getString(value, "body");
  if (!id || !body) return null;
  return { id, body };
};

const parseGitHubEventPayload = (value: unknown): GitHubEventContext => {
  if (!isRecord(value)) return {};

  const context: GitHubEventContext = {};
  const pullRequest = getRecord(value, "pull_request");
  const issue = getRecord(value, "issue");
  const comment = getRecord(value, "comment");
  const issueIsPr = issue ? getRecord(issue, "pull_request") : null;

  // Detect issue_comment events on PRs (has comment + issue.pull_request)
  if (comment && issueIsPr) {
    context.isIssueComment = true;
  }

  const prNumber =
    (pullRequest ? getNumber(pullRequest, "number") : undefined) ??
    (issue ? getNumber(issue, "number") : undefined) ??
    getNumber(value, "number");
  if (prNumber) {
    context.prNumber = prNumber;
  }

  const head = pullRequest ? getRecord(pullRequest, "head") : null;
  const headSha = head ? getString(head, "sha") : undefined;
  if (headSha) {
    context.headSha = headSha;
  }

  return context;
};

const readGitHubEventContext = (): GitHubEventContext => {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return {};

  try {
    return parseGitHubEventPayload(JSON.parse(readFileSync(eventPath, "utf-8")));
  } catch {
    return {};
  }
};

const parseGitHubPrFromRef = (ref: string): number => {
  const match = ref.match(/refs\/pull\/(\d+)\//);
  return match?.[1] ? parseInt(match[1], 10) : 0;
};

const isActionableIssue = (issue: AuditIssue): boolean =>
  issue.severity === "CRITICAL" || issue.severity === "WARNING";

class GitHubProvider implements GitProvider {
  private token: string;
  private owner: string;
  private repo: string;
  private prNumber: number;
  private commitId: string;
  private eventHeadSha: string | undefined;
  private isIssueComment: boolean;
  private fetchedCommitId: string | undefined;
  private existingComments: Map<string, GitHubReviewComment> | null = null;

  constructor() {
    this.token = process.env.GITHUB_TOKEN || "";

    // GitHub Actions environment variables
    const repoSlug = process.env.GITHUB_REPOSITORY || "";
    const [owner, repo] = repoSlug.split("/");
    this.owner = owner || "";
    this.repo = repo || "";

    const eventContext = readGitHubEventContext();

    // Get PR number from event payload or GITHUB_REF (refs/pull/:prNumber/merge)
    const ref = String(process.env.GITHUB_REF || "");
    this.prNumber = eventContext.prNumber ?? parseGitHubPrFromRef(ref);
    this.eventHeadSha = eventContext.headSha;
    this.isIssueComment = eventContext.isIssueComment ?? false;
    this.commitId =
      eventContext.headSha ?? process.env.GITHUB_HEAD_SHA ?? process.env.GITHUB_SHA ?? "";

    if (!this.token || !this.owner || !this.repo || !this.prNumber) {
      // Silent warning, we'll check again in postComment
    }
  }

  private apiUrl(path: string): string {
    return `https://api.github.com/repos/${this.owner}/${this.repo}${path}`;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "mp-sentinel",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  private async loadExistingComments(): Promise<Map<string, GitHubReviewComment>> {
    if (this.existingComments) {
      return this.existingComments;
    }

    const commentsByFingerprint = new Map<string, GitHubReviewComment>();
    const perPage = 100;

    try {
      for (let page = 1; page <= 10; page++) {
        const response = await fetch(
          this.apiUrl(`/pulls/${this.prNumber}/comments?per_page=${perPage}&page=${page}`),
          {
            method: "GET",
            headers: this.headers(),
          },
        );

        if (!response.ok) {
          log.warning(`Could not list existing GitHub comments: ${await response.text()}`);
          break;
        }

        const payload: unknown = await response.json();
        if (!Array.isArray(payload)) break;

        for (const item of payload) {
          const comment = parseGitHubReviewComment(item);
          if (!comment) continue;

          const fingerprint = extractFingerprint(comment.body);
          if (fingerprint) {
            commentsByFingerprint.set(fingerprint, comment);
          }
        }

        if (payload.length < perPage) break;
      }
    } catch (error) {
      log.warning(
        `Could not list existing GitHub comments: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    this.existingComments = commentsByFingerprint;
    return commentsByFingerprint;
  }

  private async resolveCommitId(): Promise<string> {
    // Event payload head SHA is authoritative (pull_request / push events)
    if (this.eventHeadSha) return this.eventHeadSha;
    // Reuse previously fetched SHA from REST API
    if (this.fetchedCommitId) return this.fetchedCommitId;
    // For issue_comment events, the env-based SHA is not the PR head — fetch it
    if (this.token && this.owner && this.repo && this.prNumber) {
      try {
        const response = await fetch(this.apiUrl(`/pulls/${this.prNumber}`), {
          method: "GET",
          headers: this.headers(),
        });
        if (response.ok) {
          const pr: unknown = await response.json();
          if (isRecord(pr)) {
            const head = getRecord(pr, "head");
            const sha = head ? getString(head, "sha") : undefined;
            if (sha) {
              this.fetchedCommitId = sha;
              return sha;
            }
          }
        }
      } catch {
        // Fall through
      }
    }
    // For issue_comment events, env-based SHA is unreliable — skip posting
    if (this.isIssueComment) return "";
    // Last resort: env-based commitId (may be merge SHA or push SHA)
    return this.commitId;
  }

  private async updateComment(commentId: number, body: string): Promise<void> {
    const response = await fetch(this.apiUrl(`/pulls/comments/${commentId}`), {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify({ body }),
    });

    if (!response.ok) {
      log.error(`GitHub API Error: ${await response.text()}`);
      return;
    }

    log.success(`Updated existing GitHub comment ${commentId}`);
  }

  async postComment(filePath: string, line: number, issue: AuditIssue): Promise<void> {
    if (!this.token || !this.owner || !this.repo || !this.prNumber) {
      log.warning("Skipping GitHub comment: Invalid context (Token/Repo/PR missing).");
      return;
    }

    const commitId = await this.resolveCommitId();
    if (!commitId) {
      log.warning("Skipping GitHub comment: PR head SHA not found.");
      return;
    }

    const body = buildCommentBody(filePath, line, issue);
    const fingerprint = buildReviewCommentFingerprint(filePath, line, issue);

    try {
      const existing = (await this.loadExistingComments()).get(fingerprint);
      if (existing) {
        if (existing.body !== body) {
          await this.updateComment(existing.id, body);
        }
        return;
      }

      const response = await fetch(this.apiUrl(`/pulls/${this.prNumber}/comments`), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          body,
          commit_id: commitId,
          path: filePath,
          line,
          side: "RIGHT",
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        log.error(`GitHub API Error: ${err}`);
      } else {
        const payload: unknown = await response.json();
        const postedComment = parseGitHubReviewComment(payload);
        if (postedComment) {
          this.existingComments?.set(fingerprint, postedComment);
        }
        log.success(`Posted comment on ${filePath}:${line}`);
      }
    } catch (e) {
      log.error(`Failed to post to GitHub: ${e}`);
    }
  }
}

class GitLabProvider implements GitProvider {
  private token: string;
  private projectId: string;
  private mrIid: number;
  private serverUrl: string;
  private useJobToken: boolean = false;

  constructor() {
    this.projectId = process.env.CI_PROJECT_ID || "";
    this.mrIid = parseInt(process.env.CI_MERGE_REQUEST_IID || "0");
    this.serverUrl = process.env.CI_SERVER_URL || "https://gitlab.com";

    // Prioritize GITLAB_TOKEN (PAT) if available, otherwise fall back to CI_JOB_TOKEN
    if (process.env.GITLAB_TOKEN) {
      this.token = process.env.GITLAB_TOKEN;
      this.useJobToken = false;
    } else {
      this.token = process.env.CI_JOB_TOKEN || "";
      this.useJobToken = true;
    }
  }

  async postComment(filePath: string, line: number, issue: AuditIssue): Promise<void> {
    if (!this.token || !this.projectId || !this.mrIid) {
      log.warning("Skipping GitLab comment: Invalid context (Token/Project/MR missing).");
      return;
    }

    const body = buildCommentBody(filePath, line, issue);

    try {
      const url = `${this.serverUrl}/api/v4/projects/${this.projectId}/merge_requests/${this.mrIid}/discussions`;

      const headSha = process.env.CI_COMMIT_SHA;
      const baseSha = process.env.CI_MERGE_REQUEST_DIFF_BASE_SHA || headSha;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (this.useJobToken) {
        headers["JOB-TOKEN"] = this.token;
      } else {
        headers["PRIVATE-TOKEN"] = this.token;
      }

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          body,
          position: {
            position_type: "text",
            base_sha: baseSha,
            head_sha: headSha,
            start_sha: baseSha,
            new_path: filePath,
            new_line: line,
          },
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        log.error(`GitLab API Error: ${err}`);
      } else {
        log.success(`Posted discussion on ${filePath}:${line}`);
      }
    } catch (e) {
      log.error(`Failed to post to GitLab: ${e}`);
    }
  }
}

export const postGitProviderComments = async (auditResults: FileAuditResult[]): Promise<void> => {
  try {
    const gitProvider = getGitProvider();
    if (!gitProvider) return;

    const failedAudits = auditResults.filter(
      (r) =>
        r.result.status === "FAIL" &&
        r.result.issues?.some((issue) => isActionableIssue(issue)) === true,
    );

    const issueCount = failedAudits.reduce(
      (count, audit) =>
        count + (audit.result.issues?.filter((issue) => isActionableIssue(issue)).length ?? 0),
      0,
    );

    if (issueCount === 0) return;

    log.info(`Git Provider detected. Posting ${issueCount} inline comment(s)...`);

    for (const audit of failedAudits) {
      for (const issue of audit.result.issues ?? []) {
        if (isActionableIssue(issue)) {
          await gitProvider.postComment(audit.filePath, issue.line, issue);
        }
      }
    }
  } catch (error) {
    log.warning(
      `Git provider comments skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

export const getGitProvider = (): GitProvider | null => {
  if (process.env.GITHUB_ACTIONS && process.env.GITHUB_TOKEN) {
    return new GitHubProvider();
  } else if (process.env.GITLAB_CI && (process.env.GITLAB_TOKEN || process.env.CI_JOB_TOKEN)) {
    return new GitLabProvider();
  }
  return null;
};
