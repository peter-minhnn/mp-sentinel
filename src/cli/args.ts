/**
 * CLI Argument Parsing — powered by commander.js
 * Provides subcommands, auto-help, aliases, and rich examples.
 */

import { Command } from "commander";
import { UserError } from "../utils/errors.js";

export type CLICommand = "review" | "default";

/**
 * Parsed CLI option values
 */
export interface CLIValues {
  help: boolean;
  version: boolean;
  "skip-commit": boolean;
  "skip-files": boolean;
  "target-branch"?: string;
  concurrency?: string;
  verbose: boolean;
  /** Suppress all non-error output */
  quiet: boolean;
  /** Enable local review mode - review commits directly on current branch */
  local: boolean;
  /** Number of recent commits to review in local mode (default: from config or 1) */
  commits: string;
  /** Enable branch diff mode - get all commits that differ from compare-branch */
  "branch-diff": boolean;
  /** Target branch to compare against for branch-diff mode (default: origin/main) */
  "compare-branch"?: string;
  /** Review target: staged files */
  staged: boolean;
  /** Review target: single commit SHA */
  commit?: string;
  /** Review target: git range base..head */
  range?: string;
  /** Review target: explicit file list */
  files: string[];
  /** Output format */
  format?: string;
  /** Explicit AI toggle (tri-state through env/config resolution) */
  ai?: boolean;
  /** Disable skills.sh fetch (useful in air-gapped environments) */
  "no-skills-fetch": boolean;
  /** Dry-run: security scan only, no AI calls */
  "dry-run": boolean;
}

const PACKAGE_VERSION = process.env.npm_package_version ?? "1.0.3";

/**
 * Build the commander program (exported for testing).
 */
export const buildProgram = (): Command => {
  const program = new Command();

  program
    .name("mp-sentinel")
    .description("AI-powered code review CLI — audits Git changes with Gemini, GPT-4, or Claude.")
    .version(PACKAGE_VERSION, "-v, --version", "Print version and exit")
    .helpOption("-h, --help", "Display help for command")
    // ── Global flags ──────────────────────────────────────────────────────────
    .option("--skip-commit", "Skip commit-message audit", false)
    .option("--skip-files", "Skip file-level audit", false)
    .option("-b, --target-branch <branch>", "Target branch for diff (default: origin/main)")
    .option("-c, --concurrency <n>", "Max parallel AI requests")
    .option("--verbose", "Enable verbose debug output", false)
    .option("-q, --quiet", "Suppress all non-error output", false)
    // ── Local review mode ─────────────────────────────────────────────────────
    .option("-l, --local", "Enable local review mode (branch-based)", false)
    .option("-n, --commits <n>", "Number of recent commits to review in local mode", "1")
    .option("-d, --branch-diff", "Enable branch-diff mode (all commits vs compare-branch)", false)
    .option("--compare-branch <branch>", "Branch to compare against in branch-diff mode")
    // ── CI/CD review targets ──────────────────────────────────────────────────
    .option("--staged", "Review staged files", false)
    .option("--commit <sha>", "Review a specific commit SHA")
    .option("--range <range>", "Review a git range (e.g. main..HEAD)")
    .option("--files [files...]", "Review explicit file paths", [])
    // ── Output & AI ───────────────────────────────────────────────────────────
    .option("--format <fmt>", "Output format: console | json | markdown (default: console)")
    .option("--ai", "Force-enable AI review")
    .option("--no-ai", "Force-disable AI review")
    .option("--no-skills-fetch", "Disable skills.sh API calls (air-gapped mode)", false)
    .option("--dry-run", "Security scan only — skip AI calls and preview results", false)
    // ── Examples ──────────────────────────────────────────────────────────────
    .addHelpText(
      "after",
      `
Examples:
  $ npx mp-sentinel                              # CI/CD diff review (default)
  $ npx mp-sentinel --local                      # Review last commit on current branch
  $ npx mp-sentinel --local --commits 5          # Review last 5 commits
  $ npx mp-sentinel --local --branch-diff        # Review all commits vs origin/main
  $ npx mp-sentinel --staged                     # Review staged files
  $ npx mp-sentinel --commit abc1234             # Review a specific commit
  $ npx mp-sentinel --range main..HEAD           # Review a commit range
  $ npx mp-sentinel --format json                # Output as JSON
  $ npx mp-sentinel --format markdown            # Output as Markdown
  $ npx mp-sentinel --no-skills-fetch            # Disable external skills.sh calls
  $ npx mp-sentinel --dry-run                    # Security-only preview (no AI)
  $ npx mp-sentinel --quiet --format json        # CI-friendly JSON output
`,
    );

  return program;
};

/**
 * Parse CLI arguments using commander.js.
 */
export const parseCliArgs = (): {
  command: CLICommand;
  values: CLIValues;
  positionals: string[];
  commandPositionals: string[];
} => {
  try {
    const program = buildProgram();

    // Allow unknown options so we can detect the "review" subcommand positional
    program.allowUnknownOption(false);
    program.allowExcessArguments(true);

    // Parse without exiting on --help / --version (we handle those ourselves)
    program.exitOverride();

    try {
      program.parse(process.argv);
    } catch (err: unknown) {
      // commander throws CommanderError for --help / --version
      if (
        err instanceof Error &&
        "code" in err &&
        (err as { code: string }).code === "commander.helpDisplayed"
      ) {
        process.exit(0);
      }
      if (
        err instanceof Error &&
        "code" in err &&
        (err as { code: string }).code === "commander.version"
      ) {
        process.exit(0);
      }
      throw err;
    }

    const opts = program.opts<Record<string, unknown>>();
    const rawPositionals = program.args;

    const command: CLICommand = rawPositionals[0] === "review" ? "review" : "default";
    const commandPositionals = command === "review" ? rawPositionals.slice(1) : rawPositionals;

    // Normalise the "no-ai" flag: commander sets `ai: false` when --no-ai is passed
    const aiValue: boolean | undefined =
      opts["ai"] === false ? false : opts["ai"] === true ? true : undefined;

    // Build values object — use type assertion to satisfy exactOptionalPropertyTypes
    // (optional fields are only set when they have a real value)
    const values = {
      help: false, // handled by commander
      version: false, // handled by commander
      "skip-commit": Boolean(opts["skipCommit"] ?? false),
      "skip-files": Boolean(opts["skipFiles"] ?? false),
      verbose: Boolean(opts["verbose"] ?? false),
      quiet: Boolean(opts["quiet"] ?? false),
      local: Boolean(opts["local"] ?? false),
      commits: typeof opts["commits"] === "string" ? opts["commits"] : "1",
      "branch-diff": Boolean(opts["branchDiff"] ?? false),
      staged: Boolean(opts["staged"] ?? false),
      files: Array.isArray(opts["files"]) ? (opts["files"] as string[]) : [],
      "no-skills-fetch": opts["skillsFetch"] === false,
      "dry-run": Boolean(opts["dryRun"] ?? false),
      ...(typeof opts["targetBranch"] === "string" && {
        "target-branch": opts["targetBranch"],
      }),
      ...(typeof opts["concurrency"] === "string" && {
        concurrency: opts["concurrency"],
      }),
      ...(typeof opts["compareBranch"] === "string" && {
        "compare-branch": opts["compareBranch"],
      }),
      ...(typeof opts["commit"] === "string" && { commit: opts["commit"] }),
      ...(typeof opts["range"] === "string" && { range: opts["range"] }),
      ...(typeof opts["format"] === "string" && { format: opts["format"] }),
      ...(aiValue !== undefined && { ai: aiValue }),
    } as CLIValues;

    return {
      command,
      values,
      positionals: rawPositionals,
      commandPositionals,
    };
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      // Re-throw commander's own errors as UserError
      throw new UserError(
        `Invalid arguments: ${error.message}. Run "mp-sentinel --help" for usage.`,
      );
    }
    const fallbackMessage = error instanceof Error ? error.message : "Invalid arguments";
    throw new UserError(
      `Invalid arguments: ${fallbackMessage}. Run "mp-sentinel --help" for usage.`,
    );
  }
};
