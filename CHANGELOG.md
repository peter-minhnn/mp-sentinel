# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-02-09

### Added
- **Branch Diff Mode**: Added `-d, --branch-diff` flag to review all commits that differ from a target branch.
- **Compare Branch**: Added `--compare-branch` option to specify the target branch for comparison in local review mode.
- **Pattern Match Mode**: Added `patternMatchMode` configuration (`any` or `all`) to control how commit patterns are validated.
- **Required Patterns**: Support for `required: true` in commit patterns when using `patternMatchMode: "all"`.
- **Verbose Pattern Matching**: Enhanced verbose output (`verbosePatternMatching`) to show exactly which patterns matched or failed for each commit.
- **CLI Subcommands**: Improved CLI argument parsing to handle edge cases in subcommand usage.

### Improved
- **Commit Message Validation**: Updated regex engine to provide more detailed feedback on why a commit message failed validation.
- **Performance**: Optimized git log retrieval for local review mode.
- **Documentation**: Comprehensive updates to `README.md`, `QUICK_START.md`, and `QUICK_REFERENCE.md` reflecting new features.

### Fixed
- Fixed an issue where commit message patterns with square brackets were incorrectly matched.
- Improved TypeScript type safety for pattern matching results.
- Fixed duplicate closing braces in `src/index.ts` utility functions.

## [1.0.0] - 2026-02-07

### Added
- Initial release of **MP Sentinel**.
- Multi-provider AI support (Google Gemini, OpenAI GPT, Anthropic Claude).
- CI/CD integration for GitHub Actions and GitLab CI.
- Local Review Mode for direct branch auditing.
- Concurrent file auditing for high performance.
- Configurable rules via `.sentinelrc.json`.
