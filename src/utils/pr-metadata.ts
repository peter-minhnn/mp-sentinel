/**
 * Extract structured PR/commit metadata from CI/CD environment variables.
 * Works for GitHub Actions, GitLab CI, and local (returns zero-values).
 *
 * Parses GITHUB_EVENT_PATH for richer metadata before falling back to
 * env-vars-only extraction. Supports pull_request and issue_comment
 * (PR comment) event payloads.
 */

import { readFile } from "node:fs/promises";

export interface PRMetadata {
  owner: string;
  name: string;
  fullName: string;
  prNumber: number;
  headSha: string;
  baseRef: string;
}

/** Shape of the relevant fields inside a GitHub event payload JSON file. */
interface GitHubEventPayload {
  action?: string;
  pull_request?: {
    number?: number;
    head?: { sha?: string; ref?: string };
    base?: { ref?: string; sha?: string };
  };
  issue?: {
    number?: number;
    pull_request?: unknown;
  };
  repository?: {
    owner?: { login?: string };
    name?: string;
    full_name?: string;
  };
}

const parseGitHubPrNumber = (ref: string): number => {
  const m = ref.match(/refs\/pull\/(\d+)\//);
  return m ? parseInt(m[1]!, 10) : 0;
};

/**
 * Try to load and parse the GitHub event payload from GITHUB_EVENT_PATH.
 * Returns null if the file is missing, unreadable, or not valid JSON.
 */
const readEventPayload = async (): Promise<GitHubEventPayload | null> => {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return null;

  try {
    const raw = await readFile(eventPath, "utf-8");
    const payload = JSON.parse(raw) as GitHubEventPayload;
    if (typeof payload !== "object" || payload === null) return null;
    return payload;
  } catch {
    return null;
  }
};

export const extractPRMetadata = async (
  changedFiles: string[],
): Promise<PRMetadata & { changedFilesCsv: string }> => {
  const eventPayload = await readEventPayload();

  // ── Try to extract from GITHUB_EVENT_PATH payload ──────────────────────

  if (eventPayload) {
    const pr = eventPayload.pull_request;
    const issue = eventPayload.issue;
    const repo = eventPayload.repository;

    const owner = repo?.owner?.login ?? "";
    const name = repo?.name ?? "";
    const fullName = repo?.full_name ?? (owner && name ? `${owner}/${name}` : "");

    // pull_request event: extract directly from the PR object
    if (pr) {
      const prNumber = pr.number ?? 0;
      const headSha = pr.head?.sha ?? "";
      const baseRef = pr.base?.ref ?? "";

      return {
        owner,
        name,
        fullName,
        prNumber,
        headSha,
        baseRef,
        changedFilesCsv: changedFiles.join(","),
      };
    }

    // issue_comment event with an associated PR: extract from the issue object
    if (issue && issue.pull_request) {
      const prNumber = issue.number ?? 0;
      // issue_comment payloads don't include head/base refs — fall back to env
      const headSha =
        process.env.GITHUB_HEAD_SHA || process.env.GITHUB_SHA || process.env.CI_COMMIT_SHA || "";
      const baseRef =
        process.env.GITHUB_BASE_REF ||
        process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME ||
        "origin/main";

      return {
        owner,
        name,
        fullName,
        prNumber,
        headSha,
        baseRef,
        changedFilesCsv: changedFiles.join(","),
      };
    }

    // Generic event with repo info but no PR — still capture repo metadata
    if (owner || name || fullName) {
      const full = fullName || process.env.GITHUB_REPOSITORY || process.env.CI_PROJECT_PATH || "";
      const [fOwner = "", fName = ""] = full.split("/");
      return {
        owner: fOwner,
        name: fName,
        fullName: full,
        prNumber: 0,
        headSha: process.env.GITHUB_SHA || process.env.CI_COMMIT_SHA || "",
        baseRef: "origin/main",
        changedFilesCsv: changedFiles.join(","),
      };
    }
  }

  // ── Fall back to env-var-only extraction ───────────────────────────────

  const fullName = process.env.GITHUB_REPOSITORY || process.env.CI_PROJECT_PATH || "";
  const [owner = "", name = ""] = fullName.split("/");

  const prNumber = (() => {
    const ghRef = process.env.GITHUB_REF;
    if (ghRef) {
      const n = parseGitHubPrNumber(ghRef);
      if (n > 0) return n;
    }
    const mrIid = process.env.CI_MERGE_REQUEST_IID;
    if (mrIid) return parseInt(mrIid, 10) || 0;
    return 0;
  })();

  const headSha =
    process.env.GITHUB_HEAD_SHA || process.env.GITHUB_SHA || process.env.CI_COMMIT_SHA || "";

  const baseRef =
    process.env.GITHUB_BASE_REF || process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME || "origin/main";

  const changedFilesCsv = changedFiles.join(",");

  return { owner, name, fullName, prNumber, headSha, baseRef, changedFilesCsv };
};
