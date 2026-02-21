import type { AuditIssue } from '../types/index.js';
import { log } from '../utils/logger.js';

interface GitProvider {
  postComment(filePath: string, line: number, issue: AuditIssue): Promise<void>;
}

class GitHubProvider implements GitProvider {
  private token: string;
  private owner: string;
  private repo: string;
  private prNumber: number;

  constructor() {
    this.token = process.env.GITHUB_TOKEN || '';
    
    // GitHub Actions environment variables
    const repoSlug = process.env.GITHUB_REPOSITORY || '';
    const [owner, repo] = repoSlug.split('/');
    this.owner = owner || '';
    this.repo = repo || '';
    
    // Get PR number from GITHUB_REF (refs/pull/:prNumber/merge) or event payload
    const ref = String(process.env.GITHUB_REF || '');
    const match = ref.match(/refs\/pull\/(\d+)\/merge/);
    this.prNumber = match && match[1] ? parseInt(match[1]) : 0;
    
    if (!this.token || !this.owner || !this.repo || !this.prNumber) {
        // Silent warning, we'll check again in postComment
    }
  }

  async postComment(filePath: string, line: number, issue: AuditIssue): Promise<void> {
    if (!this.token || !this.owner || !this.repo || !this.prNumber) {
        log.warning('Skipping GitHub comment: Invalid context (Token/Repo/PR missing).');
        return;
    }

    const body = `**MP Sentinel Audit Issue**\n\nSeverity: ${issue.severity}\nMessage: ${issue.message}\nSuggestion: ${issue.suggestion || 'None'}`;
    
    const commitId = process.env.GITHUB_SHA;
    if (!commitId) {
      log.warning("Skipping GitHub comment: GITHUB_SHA not set.");
      return;
    }

    try {
      const url = `https://api.github.com/repos/${this.owner}/${this.repo}/pulls/${this.prNumber}/comments`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'mp-sentinel'
        },
        body: JSON.stringify({
            body,
            commit_id: commitId,
            path: filePath, 
            line: line,
            side: 'RIGHT'
        })
      });

      if (!response.ok) {
          const err = await response.text();
          log.error(`GitHub API Error: ${err}`);
      } else {
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
    this.projectId = process.env.CI_PROJECT_ID || '';
    this.mrIid = parseInt(process.env.CI_MERGE_REQUEST_IID || '0');
    this.serverUrl = process.env.CI_SERVER_URL || 'https://gitlab.com';
    
    // Prioritize GITLAB_TOKEN (PAT) if available, otherwise fall back to CI_JOB_TOKEN
    if (process.env.GITLAB_TOKEN) {
        this.token = process.env.GITLAB_TOKEN;
        this.useJobToken = false;
    } else {
        this.token = process.env.CI_JOB_TOKEN || '';
        this.useJobToken = true;
    }
  }

  async postComment(filePath: string, line: number, issue: AuditIssue): Promise<void> {
    if (!this.token || !this.projectId || !this.mrIid) {
        log.warning('Skipping GitLab comment: Invalid context (Token/Project/MR missing).');
        return;
    }

    const body = `**MP Sentinel Audit Issue**\n\nSeverity: ${issue.severity}\nMessage: ${issue.message}\nSuggestion: ${issue.suggestion || 'None'}`;
    
    try {
        const url = `${this.serverUrl}/api/v4/projects/${this.projectId}/merge_requests/${this.mrIid}/discussions`;
        
        const headSha = process.env.CI_COMMIT_SHA;
        const baseSha = process.env.CI_MERGE_REQUEST_DIFF_BASE_SHA || headSha;

        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };

        if (this.useJobToken) {
            headers['JOB-TOKEN'] = this.token;
        } else {
            headers['PRIVATE-TOKEN'] = this.token;
        }

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                body,
                position: {
                    position_type: 'text',
                    base_sha: baseSha,
                    head_sha: headSha,
                    start_sha: baseSha,
                    new_path: filePath,
                    new_line: line
                }
            })
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

export const getGitProvider = (): GitProvider | null => {
  if (process.env.GITHUB_ACTIONS && process.env.GITHUB_TOKEN) {
      return new GitHubProvider();
  } else if (process.env.GITLAB_CI && (process.env.GITLAB_TOKEN || process.env.CI_JOB_TOKEN)) {
      return new GitLabProvider();
  }
  return null;
};
