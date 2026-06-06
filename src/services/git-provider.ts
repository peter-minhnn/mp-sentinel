import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AuditIssue, FileAuditResult } from "../types/index.js";
import { log } from "../utils/logger.js";

interface GitProvider {
  postComment(filePath: string, line: number, issue: AuditIssue): Promise<void>;
}

/**
 * Logging for comment posting. In console mode everything uses the normal
 * logger. For machine-readable formats (`--format json|sarif`) all of it —
 * progress, success, AND diagnostics — is routed to stderr (bypassing quiet
 * mode) so stdout stays a clean report while GitLab/GitHub API failures stay
 * visible to CI operators rather than being silently swallowed.
 */
interface CommentLog {
  info(msg: string): void;
  success(msg: string): void;
  warning(msg: string): void;
  error(msg: string): void;
}

const stdoutCommentLog: CommentLog = {
  info: log.info,
  success: log.success,
  warning: log.warning,
  error: log.error,
};
const stderrCommentLog: CommentLog = {
  info: log.infoStderr,
  success: log.successStderr,
  warning: log.warningStderr,
  error: log.errorStderr,
};

const selectCommentLog = (logToStderr: boolean): CommentLog =>
  logToStderr ? stderrCommentLog : stdoutCommentLog;

export interface PostCommentsOptions {
  /** Route info/success logs to stderr (keep stdout clean for JSON/SARIF). */
  logToStderr?: boolean;
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

/**
 * Internal safety cap on inline comments posted per run, to avoid flooding a
 * PR/MR. Findings beyond the cap are summarized on stderr. Not configurable
 * yet — promote to a flag/config only if a real need appears.
 */
const MAX_COMMENTS_PER_RUN = 50;

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

// ── Code suggestion safety (rendering gate) ─────────────────────────────────

const CODE_SUGGESTION_RENDER_MAX_LENGTH = 400;

/**
 * Final safety gate before a structured `codeSuggestion` is rendered as a
 * provider ```suggestion``` block. Returns the cleaned replacement, or null
 * when it must NOT be rendered.
 *
 * v1 scope: single-line replacements only. Rejects empty, multi-line,
 * oversized, nested-fence, or prose-like values. Re-applied at render time
 * (not just in the parser) to defend against older data or deterministic,
 * self-constructed issues. Conservative by design — when in doubt, drop the
 * block; the textual "Suggested fix" still carries the guidance.
 */
export const sanitizeCodeSuggestion = (raw: string | undefined): string | null => {
  if (typeof raw !== "string") return null;
  const trimmed = raw.replace(/\s+$/, "");
  if (trimmed.trim().length === 0) return null;
  // v1: single-line replacements only.
  if (trimmed.includes("\n")) return null;
  if (trimmed.length > CODE_SUGGESTION_RENDER_MAX_LENGTH) return null;
  // A nested triple-backtick fence would break the suggestion block.
  if (trimmed.includes("```")) return null;
  if (looksLikeProse(trimmed)) return null;
  return trimmed;
};

/**
 * Heuristic: treat a sentence-shaped string with no code punctuation as prose
 * (e.g. "Remove the eval call and validate input.").
 */
const looksLikeProse = (text: string): boolean => {
  const hasCodePunctuation = /[{}();=<>[\]]|=>|::|\+\+|--/.test(text);
  if (hasCodePunctuation) return false;
  // Sentence-like: starts uppercase, ends with terminal punctuation, has spaces.
  return /^[A-Z].*[.!?]$/.test(text.trim()) && text.trim().includes(" ");
};

const buildCommentBody = (filePath: string, line: number, issue: AuditIssue): string => {
  const fingerprint = buildReviewCommentFingerprint(filePath, line, issue);
  const metaParts: string[] = [];
  if (issue.category) metaParts.push(`\`${issue.category}\``);
  if (issue.confidence) metaParts.push(`confidence: ${issue.confidence}`);
  const meta = metaParts.length > 0 ? ` · ${metaParts.join(" · ")}` : "";

  const lines: string[] = [
    `<!-- ${COMMENT_MARKER} fingerprint=${fingerprint} -->`,
    `**MP Sentinel · ${issue.severity}** — line ${line}${meta}`,
    "",
    `**Why this matters**`,
    issue.message,
  ];

  if (issue.suggestion) {
    lines.push("", `**Suggested fix**`, issue.suggestion);
  }

  if (issue.evidence) {
    lines.push("", `**Evidence**`, `\`${formatEvidence(issue.evidence)}\``);
  }

  const safeSuggestion = sanitizeCodeSuggestion(issue.codeSuggestion);
  if (safeSuggestion) {
    lines.push("", "```suggestion", safeSuggestion, "```");
  }

  lines.push(
    "",
    "_Managed by mp-sentinel. Reruns update the same finding instead of posting duplicates._",
  );

  return lines.join("\n");
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
  private clog: CommentLog;

  constructor(clog: CommentLog = stdoutCommentLog) {
    this.clog = clog;
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
          this.clog.warning(`Could not list existing GitHub comments: ${await response.text()}`);
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
      this.clog.warning(
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
      this.clog.error(`GitHub API Error: ${await response.text()}`);
      return;
    }

    this.clog.success(`Updated existing GitHub comment ${commentId}`);
  }

  async postComment(filePath: string, line: number, issue: AuditIssue): Promise<void> {
    if (!this.token || !this.owner || !this.repo || !this.prNumber) {
      this.clog.warning("Skipping GitHub comment: Invalid context (Token/Repo/PR missing).");
      return;
    }

    const commitId = await this.resolveCommitId();
    if (!commitId) {
      this.clog.warning("Skipping GitHub comment: PR head SHA not found.");
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
        this.clog.error(`GitHub API Error: ${err}`);
      } else {
        const payload: unknown = await response.json();
        const postedComment = parseGitHubReviewComment(payload);
        if (postedComment) {
          this.existingComments?.set(fingerprint, postedComment);
        }
        this.clog.success(`Posted comment on ${filePath}:${line}`);
      }
    } catch (e) {
      this.clog.error(`Failed to post to GitHub: ${e}`);
    }
  }
}

interface GitLabDiffRefs {
  baseSha: string;
  headSha: string;
  startSha: string;
}

interface GitLabExistingNote {
  /**
   * Whether the note belongs to an inline diff discussion (updated via the
   * Discussions API) or is a plain MR-level note (updated via the Notes API).
   */
  kind: "discussion" | "note";
  /** Present only for `kind: "discussion"`. */
  discussionId?: string;
  noteId: number;
  body: string;
}

class GitLabProvider implements GitProvider {
  private token: string;
  private projectId: string;
  private mrIid: number;
  private serverUrl: string;
  private useJobToken: boolean;
  private diffRefs: GitLabDiffRefs | null = null;
  private existingNotes: Map<string, GitLabExistingNote> | null = null;
  private clog: CommentLog;

  constructor(clog: CommentLog = stdoutCommentLog) {
    this.clog = clog;
    this.projectId = process.env.CI_PROJECT_ID || "";
    this.mrIid = parseInt(process.env.CI_MERGE_REQUEST_IID || "0");
    this.serverUrl = process.env.CI_SERVER_URL || "https://gitlab.com";

    // Prioritize GITLAB_TOKEN (PAT) if available, otherwise fall back to CI_JOB_TOKEN.
    if (process.env.GITLAB_TOKEN) {
      this.token = process.env.GITLAB_TOKEN;
      this.useJobToken = false;
    } else {
      this.token = process.env.CI_JOB_TOKEN || "";
      this.useJobToken = true;
    }
  }

  private mrUrl(path: string): string {
    return `${this.serverUrl}/api/v4/projects/${encodeURIComponent(this.projectId)}/merge_requests/${this.mrIid}${path}`;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.useJobToken) headers["JOB-TOKEN"] = this.token;
    else headers["PRIVATE-TOKEN"] = this.token;
    return headers;
  }

  /**
   * Resolve the diff version SHAs needed for an inline discussion position.
   * The GitLab MR Versions API (https://docs.gitlab.com/api/merge_requests/#get-mr-diff-versions)
   * is authoritative — its latest version (index 0) carries the base/head/start
   * SHAs that the Discussions API `position` requires. CI env vars are the
   * fallback. Only the first version is needed, so the request uses per_page=1.
   */
  private async resolveDiffRefs(): Promise<GitLabDiffRefs> {
    if (this.diffRefs) return this.diffRefs;

    try {
      const response = await fetch(this.mrUrl(`/versions?per_page=1`), {
        method: "GET",
        headers: this.headers(),
      });
      if (response.ok) {
        const payload: unknown = await response.json();
        if (Array.isArray(payload) && payload.length > 0 && isRecord(payload[0])) {
          const v = payload[0];
          const headSha = getString(v, "head_commit_sha");
          const baseSha = getString(v, "base_commit_sha");
          const startSha = getString(v, "start_commit_sha");
          if (headSha && baseSha && startSha) {
            this.diffRefs = { headSha, baseSha, startSha };
            return this.diffRefs;
          }
        }
      }
    } catch {
      // Fall through to CI env vars.
    }

    const headSha = process.env.CI_COMMIT_SHA || "";
    const baseSha = process.env.CI_MERGE_REQUEST_DIFF_BASE_SHA || headSha;
    const startSha = process.env.CI_MERGE_REQUEST_DIFF_START_SHA || baseSha;
    this.diffRefs = { headSha, baseSha, startSha };
    return this.diffRefs;
  }

  /**
   * Load existing mp-sentinel notes keyed by fingerprint, covering BOTH
   * inline diff discussions (Discussions API) and MR-level notes (Notes API).
   * Reruns then update the matching note in place — whether the finding was
   * originally posted inline or via the MR-level fallback — instead of
   * creating duplicates. Inline discussions win when both exist.
   */
  private async loadExistingNotes(): Promise<Map<string, GitLabExistingNote>> {
    if (this.existingNotes) return this.existingNotes;

    const byFingerprint = new Map<string, GitLabExistingNote>();
    const perPage = 100;

    // 1) Inline diff discussions.
    try {
      for (let page = 1; page <= 10; page++) {
        const response = await fetch(this.mrUrl(`/discussions?per_page=${perPage}&page=${page}`), {
          method: "GET",
          headers: this.headers(),
        });
        if (!response.ok) {
          this.clog.warning(`Could not list existing GitLab discussions: ${await response.text()}`);
          break;
        }
        const payload: unknown = await response.json();
        if (!Array.isArray(payload)) break;

        for (const discussion of payload) {
          if (!isRecord(discussion)) continue;
          const discussionId = getString(discussion, "id");
          const notes = discussion["notes"];
          if (!discussionId || !Array.isArray(notes)) continue;
          for (const note of notes) {
            if (!isRecord(note)) continue;
            const noteId = getNumber(note, "id");
            const noteBody = getString(note, "body");
            if (!noteId || !noteBody) continue;
            const fingerprint = extractFingerprint(noteBody);
            if (fingerprint && !byFingerprint.has(fingerprint)) {
              byFingerprint.set(fingerprint, {
                kind: "discussion",
                discussionId,
                noteId,
                body: noteBody,
              });
            }
          }
        }
        if (payload.length < perPage) break;
      }
    } catch (error) {
      this.clog.warning(
        `Could not list existing GitLab discussions: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // 2) MR-level notes (fallback notes from prior runs). Skip system notes.
    try {
      for (let page = 1; page <= 10; page++) {
        const response = await fetch(this.mrUrl(`/notes?per_page=${perPage}&page=${page}`), {
          method: "GET",
          headers: this.headers(),
        });
        if (!response.ok) {
          this.clog.warning(`Could not list existing GitLab notes: ${await response.text()}`);
          break;
        }
        const payload: unknown = await response.json();
        if (!Array.isArray(payload)) break;

        for (const note of payload) {
          if (!isRecord(note)) continue;
          if (note["system"] === true) continue;
          const noteId = getNumber(note, "id");
          const noteBody = getString(note, "body");
          if (!noteId || !noteBody) continue;
          const fingerprint = extractFingerprint(noteBody);
          if (fingerprint && !byFingerprint.has(fingerprint)) {
            byFingerprint.set(fingerprint, { kind: "note", noteId, body: noteBody });
          }
        }
        if (payload.length < perPage) break;
      }
    } catch (error) {
      this.clog.warning(
        `Could not list existing GitLab notes: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    this.existingNotes = byFingerprint;
    return byFingerprint;
  }

  /** Update an existing note via the endpoint matching its kind. */
  private async updateExisting(existing: GitLabExistingNote, body: string): Promise<void> {
    const url =
      existing.kind === "discussion"
        ? this.mrUrl(`/discussions/${existing.discussionId}/notes/${existing.noteId}`)
        : this.mrUrl(`/notes/${existing.noteId}`);
    const response = await fetch(url, {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify({ body }),
    });
    if (!response.ok) {
      this.clog.error(`GitLab API Error: ${await response.text()}`);
      return;
    }
    this.clog.success(`Updated existing GitLab ${existing.kind} note ${existing.noteId}`);
  }

  /** Body for an MR-level fallback note (inline body + explicit file:line). */
  private fallbackBody(filePath: string, line: number, body: string): string {
    return `${body}\n\n> Inline position unavailable — finding at \`${filePath}:${line}\`.`;
  }

  /** Post an MR-level fallback note when an inline position is rejected. */
  private async postFallbackNote(filePath: string, line: number, body: string): Promise<void> {
    const response = await fetch(this.mrUrl(`/notes`), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ body: this.fallbackBody(filePath, line, body) }),
    });
    if (!response.ok) {
      this.clog.error(`GitLab API Error (fallback note): ${await response.text()}`);
    } else {
      this.clog.success(`Posted MR-level fallback note for ${filePath}:${line}`);
    }
  }

  async postComment(filePath: string, line: number, issue: AuditIssue): Promise<void> {
    if (!this.token || !this.projectId || !this.mrIid) {
      this.clog.warning("Skipping GitLab comment: Invalid context (Token/Project/MR missing).");
      return;
    }

    const body = buildCommentBody(filePath, line, issue);
    const fingerprint = buildReviewCommentFingerprint(filePath, line, issue);

    try {
      const existing = (await this.loadExistingNotes()).get(fingerprint);
      if (existing) {
        // Update in place using the same shape the note already has, so a
        // prior fallback note keeps its file:line footer on rerun.
        const desired = existing.kind === "note" ? this.fallbackBody(filePath, line, body) : body;
        if (existing.body !== desired) await this.updateExisting(existing, desired);
        return;
      }

      const refs = await this.resolveDiffRefs();
      if (!refs.headSha) {
        this.clog.warning("Skipping GitLab comment: MR diff head SHA not found.");
        return;
      }

      // GitLab renders ```suggestion``` blocks as one-click "Suggest changes"
      // in the MR diff thread when posted as an inline text-position discussion.
      const response = await fetch(this.mrUrl(`/discussions`), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          body,
          position: {
            position_type: "text",
            base_sha: refs.baseSha,
            head_sha: refs.headSha,
            start_sha: refs.startSha,
            new_path: filePath,
            new_line: line,
          },
        }),
      });

      if (response.ok) {
        this.clog.success(`Posted discussion on ${filePath}:${line}`);
        return;
      }

      // Inline position rejected (e.g. line not part of the diff): fall back
      // to an MR-level note so the finding is never silently dropped.
      this.clog.warning(
        `GitLab inline position rejected for ${filePath}:${line}; posting MR-level note. ${await response.text()}`,
      );
      await this.postFallbackNote(filePath, line, body);
    } catch (e) {
      this.clog.error(`Failed to post to GitLab: ${e}`);
    }
  }
}

export const postGitProviderComments = async (
  auditResults: FileAuditResult[],
  options: PostCommentsOptions = {},
): Promise<void> => {
  const logToStderr = options.logToStderr ?? false;
  const clog = selectCommentLog(logToStderr);
  try {
    const gitProvider = getGitProvider({ logToStderr });
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

    // Volume guard: never spam a PR/MR. Post the first MAX_COMMENTS_PER_RUN
    // actionable findings in report order; summarize the rest on stderr.
    const planned = Math.min(issueCount, MAX_COMMENTS_PER_RUN);
    clog.info(
      `Git Provider detected. Posting ${planned} inline comment(s)` +
        (issueCount > planned ? ` (of ${issueCount} actionable)` : "") +
        "...",
    );

    let posted = 0;
    outer: for (const audit of failedAudits) {
      for (const issue of audit.result.issues ?? []) {
        if (!isActionableIssue(issue)) continue;
        if (posted >= MAX_COMMENTS_PER_RUN) break outer;
        await gitProvider.postComment(audit.filePath, issue.line, issue);
        posted++;
      }
    }

    const skipped = issueCount - posted;
    if (skipped > 0) {
      clog.warning(
        `Comment cap reached: posted ${posted} comment(s); ${skipped} more skipped this run.`,
      );
    }
  } catch (error) {
    clog.warning(
      `Git provider comments skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

export const getGitProvider = (options: PostCommentsOptions = {}): GitProvider | null => {
  const clog = selectCommentLog(options.logToStderr ?? false);
  if (process.env.GITHUB_ACTIONS && process.env.GITHUB_TOKEN) {
    return new GitHubProvider(clog);
  } else if (process.env.GITLAB_CI && (process.env.GITLAB_TOKEN || process.env.CI_JOB_TOKEN)) {
    return new GitLabProvider(clog);
  }
  return null;
};
