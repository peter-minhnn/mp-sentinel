/**
 * CLI Help & Version Display
 * Handles --help and --version output for mp-sentinel
 */

const VERSION = process.env["npm_package_version"] ?? "1.0.3";

/**
 * Show CLI help message with all available options and examples
 */
export const showHelp = (): void => {
  console.log(`
🏗️  MP Sentinel - AI-powered Code Guardian

Usage:
  mp-sentinel review [target] [options]
  mp-sentinel [options]                      # shortcut for review

Targets (choose one):
  --staged                    Review staged changes (git diff --cached)
  --commit <sha>              Review a single commit (git show <sha>)
  --range <base>..<head>      Review a commit range (git diff base..head)
  --files <path...>           Review explicit file list (power-user mode)

Default target when omitted:
  <target-branch>...HEAD      (target branch default: origin/main)

Options:
  -h, --help             Show this help message
  -v, --version          Show version number
  --format <type>        Output format: console | json | markdown (default: console)
  --ai                   Force-enable AI review (useful for --staged)
  -b, --target-branch    Target branch for default range mode (default: origin/main)
  -c, --concurrency      Max concurrent file audits (default: 5, or config)
  --verbose              Enable verbose output and detailed skip reasons

Legacy options (still supported):
  --skip-commit          Skip commit message validation
  --skip-files           Skip file auditing
  -l, --local            Enable local review mode (review commits directly)
  -n, --commits <N>      Number of recent commits to review (default: 1)
  -d, --branch-diff      Enable branch diff mode (legacy local mode)
  --compare-branch <BR>  Target branch to compare (default: origin/main)

Examples:
  mp-sentinel review --staged
  mp-sentinel review --commit 9f31a4c
  mp-sentinel review --range origin/main..HEAD --format markdown
  mp-sentinel review --files src/index.ts src/utils/git.ts --ai
  mp-sentinel review --format json

  # AI policy:
  # - staged mode defaults to AI OFF unless --ai or MP_SENTINEL_AI=1
  # - other modes default to AI ON

Configuration (.mp-sentinelrc.json or .sentinelrc.json):
  {
    "ai": {
      "enabled": true,
      "maxFiles": 15,
      "maxDiffLines": 1200,
      "maxCharsPerFile": 12000,
      "promptVersion": "2026-02-16"
    },
    "localReview": {
      "enabled": true,
      "commitCount": 10,
      "branchDiffMode": true,
      "compareBranch": "origin/main",
      "commitPatterns": [
        { "type": "feat", "pattern": "^TICKET-\\\\d+", "description": "Feature commits" },
        { "type": "fix", "pattern": "^fix/TICKET-\\\\d+", "description": "Fix commits" }
      ],
      "filterByPattern": true,
      "patternMatchMode": "any",
      "skipPatterns": ["skip:", "wip:", "draft:"]
    }
  }
`);
};

/**
 * Show version number
 */
export const showVersion = (): void => {
  console.log(VERSION);
};
