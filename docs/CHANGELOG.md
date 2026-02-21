# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Stable `review` command contract with explicit targets:
  - `--staged`
  - `--commit <sha>`
  - `--range <base>..<head>`
  - `--files <path...>`
- Multi-format output support: `console`, `json`, `markdown`.
- Exit-code contract: `0` (pass), `1` (findings), `2` (runtime/system/provider error).
- Diff-hunk review input pipeline and AI guardrails:
  - `ai.maxFiles`
  - `ai.maxDiffLines`
  - `ai.maxCharsPerFile`
- Persistent AI result cache in `.mp-sentinel-cache`.

### Changed
- Staged mode AI policy now defaults to off unless `--ai` or `MP_SENTINEL_AI=1`.
- Default `AI_MAX_TOKENS` lowered to `2048`.
- OpenAI and Anthropic providers now use request timeout (`AI_TIMEOUT_MS`).
- Security/file filtering layers are now used in the main review pipeline.

## [1.0.3] - 2026-02-22

### Fixed
- Internal improvements for build process.
- Synchronized version across all files.

## [1.0.2] - 2026-02-10

### Added
- **Skills.sh Integration**: Automatic enhancement of code review prompts based on technology stack
  - Fetches relevant best practices from [skills.sh](https://skills.sh/) API
  - Smart technology parsing from `techStack` configuration
  - 1-hour in-memory caching to minimize API calls
  - Configurable timeout (default: 3 seconds)
  - Fail-fast pattern: never blocks CI/CD if skills.sh is unavailable
- **Enhanced Parallel Processing**: 
  - File reading now uses `Promise.allSettled` for true parallel processing
  - File auditing uses `Promise.allSettled` to ensure all files are processed
  - Failed files are tracked and reported at the end (don't stop the process)
- **Configuration Options**:
  - `enableSkillsFetch`: Enable/disable skills.sh integration (default: `true`)
  - `skillsFetchTimeout`: Timeout for skills.sh API calls in milliseconds (default: `3000`)
- **Documentation**:
  - New comprehensive guide: `docs/SKILLS_INTEGRATION.md`
  - Example configuration: `.sentinelrc.example.json`
  - Skills demo script: `examples/skills-demo.ts`

### Improved
- **Error Handling**: All file operations now gracefully handle errors without stopping the entire process
- **Performance**: True parallel processing for both file reading and auditing
- **Logging**: Enhanced error reporting with clear indication of which files failed and why
- **Type Safety**: Improved TypeScript types for async prompt building

### Changed
- `buildSystemPrompt()` is now async to support skills fetching
- File audit results now include detailed error information for failed files

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
