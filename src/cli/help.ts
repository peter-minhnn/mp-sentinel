/**
 * CLI Help & Version Display
 * Handles --help and --version output for mp-sentinel
 */

const VERSION = "1.1.0";

/**
 * Show CLI help message with all available options and examples
 */
export const showHelp = (): void => {
  console.log(`
🏗️  MP Sentinel - AI-powered Code Guardian

Usage: mp-sentinel [options] [files...]

CI/CD Mode (Default):
  Runs in CI/CD pipelines (GitHub Actions, GitLab CI) using git diff.

Local Review Mode:
  Run directly on your branch using commit-based review.
  Configure via .sentinelrc.json for commit patterns.

Options:
  -h, --help             Show this help message
  -v, --version          Show version number
  --skip-commit          Skip commit message validation
  --skip-files           Skip file auditing
  -b, --target-branch    Target branch for diff (default: origin/main)
  -c, --concurrency      Max concurrent file audits (default: 5)
  --verbose              Enable verbose output

Local Review Options:
  -l, --local            Enable local review mode (review commits directly)
  -n, --commits <N>      Number of recent commits to review (default: 1)
  -d, --branch-diff      Enable branch diff mode (get all commits since branching)
  --compare-branch <BR>  Target branch to compare (default: origin/main)

Examples:
  # CI/CD Mode (default)
  mp-sentinel                          # Audit commit + changed files
  mp-sentinel --skip-commit            # Audit only changed files
  mp-sentinel src/file.ts              # Audit specific file(s)
  mp-sentinel -b develop               # Diff against 'develop' branch

  # Local Review Mode
  npx mp-sentinel --local              # Review last commit on current branch
  npx mp-sentinel -l -n 5              # Review last 5 commits
  npx mp-sentinel --local --verbose    # Verbose local review

  # Branch Diff Mode (compare against target branch)
  npx mp-sentinel -l -d                # Review all commits since branching from origin/main
  npx mp-sentinel -l -d --compare-branch origin/develop  # Compare against develop

Configuration (.sentinelrc.json):
  {
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
