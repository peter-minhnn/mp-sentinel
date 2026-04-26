/**
 * CLI Argument Parsing — powered by commander.js
 * Provides subcommands, auto-help, aliases, and rich examples.
 */

import { Command } from "commander";
import { UserError } from "../utils/errors.js";

export type CLICommand = "review" | "indexing" | "create-skills" | "default";

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
  /** UI commit picker */
  interactive: boolean;
  /** Number of recent commits to review in local mode (default: from config or 1) */
  commits?: string;
  /** Enable branch diff mode - get all commits that differ from compare-branch */
  "branch-diff": boolean;
  /** Target branch to compare against for branch-diff mode (default: origin/main) */
  "compare-branch"?: string;
  /** Auto-fetch origin branch before detecting merge base */
  fetch: boolean;
  /** Mixed uncommitted mode (include working tree changes in local review) */
  "include-uncommitted": boolean;
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
  /** Dry-run with forced per-file token breakdown */
  "verbose-dry-run": boolean;
  /** Override the provider context-window token limit */
  "token-limit"?: string;
  // ── Indexing command options ───────────────────────────────────────────────
  /** Indexing output format: console | json */
  "index-format"?: string;
  /** Force rebuild the source index cache */
  force?: boolean;
  /** Output index statistics only (with --index-format json) */
  stats?: boolean;
  /** Show dependency info for a specific file */
  explain?: string;
  // ── create-skills command options ─────────────────────────────────────────
  /** Comma-separated agent adapter ids (claude,cursor,codex,…) */
  agent?: string;
  /** Generate for all supported agents */
  "all-agents": boolean;
  /** Output format for create-skills: console | json */
  "create-skills-format"?: string;
  /** Overwrite existing skill files */
  "create-skills-force": boolean;
  /** Use existing cache only; fail if absent */
  "skip-index-refresh": boolean;
  /** Preview files that would be created/skipped without writing */
  "create-skills-dry-run": boolean;
  /** CI mode: verify generated skills are up-to-date; exit 1 if stale */
  "create-skills-check": boolean;
}

const PACKAGE_VERSION = process.env.npm_package_version ?? "1.0.6";

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
    .option("-i, --interactive", "Interactive commit picker UI", false)
    .option("-n, --commits <n>", "Number of recent commits to review in local mode")
    .option("-d, --branch-diff", "Enable branch-diff mode (all commits vs compare-branch)", false)
    .option("--compare-branch <branch>", "Branch to compare against in branch-diff mode")
    .option("--fetch", "Auto-fetch remote branch before detecting merge-base", false)
    .option("--include-uncommitted", "Include staged/unstaged changes in the review scope", false)
    // ── CI/CD review targets ──────────────────────────────────────────────────
    .option("--staged", "Review staged files", false)
    .option("--commit <sha>", "Review a specific commit SHA")
    .option("--range <range>", "Review a git range (e.g. main..HEAD)")
    .option("--files [files...]", "Review explicit file paths", [])
    // ── Output & AI ───────────────────────────────────────────────────────────
    .option("--format <fmt>", "Output format: console | json | markdown (default: console)")
    .option("--ai", "Force-enable AI review")
    .option("--no-ai", "Force-disable AI review")
    .option("--no-skills-fetch", "Disable external skills.sh calls (air-gapped mode)", false)
    .option("--dry-run", "Security scan only — skip AI calls and preview results", false)
    .option("--verbose-dry-run", "Dry-run with forced per-file token breakdown", false)
    .option(
      "--token-limit <n>",
      "Override provider context-window token limit (e.g. 128000 for GPT-4o)",
    );

  // Indexing subcommand
  const indexingCmd = program
    .command("indexing")
    .description("Build source index cache for enhanced review context")
    .option("--force", "Force rebuild cache even if up-to-date", false)
    .option("--index-format <fmt>", "Output format: console | json (default: console)", "console")
    .option("--stats", "Output index statistics only (with --index-format json)", false)
    .option("--explain <file>", "Show dependency info for a specific file");

  // create-skills subcommand
  program
    .command("create-skills")
    .description("Generate agent/IDE skill files from the source index")
    .option(
      "--agent <agents>",
      "Comma-separated adapter ids: claude,cursor,codex,windsurf,antigravity,generic",
    )
    .option("--all-agents", "Generate for all supported agent adapters", false)
    .option(
      "--format <fmt>",
      "Output format: console | json (json requires --agent or --all-agents)",
    )
    .option("--force", "Overwrite existing skill files", false)
    .option("--skip-index-refresh", "Use existing index cache only; fail if absent", false)
    .option("--dry-run", "Preview files that would be created/skipped without writing", false)
    .option(
      "--check",
      "CI mode: verify generated skills are up-to-date with source index (exit 1 if stale)",
      false,
    );

  // ── Examples ──────────────────────────────────────────────────────────────
  program.addHelpText(
    "after",
    `
Examples:
  $ npx mp-sentinel                                       # CI/CD diff review (default)
  $ npx mp-sentinel --local                               # Review last commit on current branch
  $ npx mp-sentinel --local --commits 5                   # Review last 5 commits
  $ npx mp-sentinel --local --branch-diff                 # Review all commits vs origin/main
  $ npx mp-sentinel --staged                              # Review staged files
  $ npx mp-sentinel --commit abc1234                      # Review a specific commit
  $ npx mp-sentinel --range main..HEAD                    # Review a commit range
  $ npx mp-sentinel --format json                         # Output as JSON
  $ npx mp-sentinel --format markdown                     # Output as Markdown
  $ npx mp-sentinel --no-skills-fetch                     # Disable external skills.sh calls
  $ npx mp-sentinel --dry-run                             # Security-only preview (no AI)
  $ npx mp-sentinel --verbose-dry-run                     # Dry-run with forcing token breakdowns
  $ npx mp-sentinel --token-limit 128000                  # Override token limit for GPT-4o
  $ npx mp-sentinel --quiet --format json                 # CI-friendly JSON output
  $ npx mp-sentinel indexing                              # Build source index cache
  $ npx mp-sentinel indexing --index-format json          # Output index as JSON
  $ npx mp-sentinel indexing --force                      # Force rebuild cache
  $ npx mp-sentinel create-skills                         # Interactive agent picker
  $ npx mp-sentinel create-skills --agent claude,cursor   # Generate for specific agents
  $ npx mp-sentinel create-skills --all-agents            # Generate for all agents
  $ npx mp-sentinel create-skills --agent claude --format json  # JSON output
  $ npx mp-sentinel create-skills --agent claude --force  # Overwrite existing files
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
    const indexingOptions =
      program.commands
        .find((candidate) => candidate.name() === "indexing")
        ?.opts<Record<string, unknown>>() ?? {};
    const createSkillsOptions =
      program.commands
        .find((candidate) => candidate.name() === "create-skills")
        ?.opts<Record<string, unknown>>() ?? {};
    const rawPositionals = program.args;

    const command: CLICommand =
      rawPositionals[0] === "indexing"
        ? "indexing"
        : rawPositionals[0] === "create-skills"
          ? "create-skills"
          : "review";
    const commandPositionals =
      command === "indexing" || command === "create-skills"
        ? rawPositionals.slice(1)
        : rawPositionals;

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
      interactive: Boolean(opts["interactive"] ?? false),
      ...(typeof opts["commits"] === "string" && { commits: opts["commits"] }),
      "branch-diff": Boolean(opts["branchDiff"] ?? false),
      fetch: Boolean(opts["fetch"] ?? false),
      "include-uncommitted": Boolean(opts["includeUncommitted"] ?? false),
      staged: Boolean(opts["staged"] ?? false),
      files: Array.isArray(opts["files"]) ? (opts["files"] as string[]) : [],
      "no-skills-fetch": opts["skillsFetch"] === false,
      "dry-run": Boolean(opts["dryRun"] ?? false),
      "verbose-dry-run": Boolean(opts["verboseDryRun"] ?? false),
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
      ...(typeof opts["tokenLimit"] === "string" && {
        "token-limit": opts["tokenLimit"],
      }),
      // Indexing options
      ...(typeof indexingOptions["indexFormat"] === "string" && {
        "index-format": indexingOptions["indexFormat"],
      }),
      ...(typeof indexingOptions["stats"] === "boolean" && { stats: indexingOptions["stats"] }),
      ...(typeof indexingOptions["explain"] === "string" && {
        explain: indexingOptions["explain"],
      }),
      force: command === "indexing" ? Boolean(indexingOptions["force"] ?? false) : false,
      // create-skills options
      ...(typeof createSkillsOptions["agent"] === "string" && {
        agent: createSkillsOptions["agent"],
      }),
      "all-agents": Boolean(createSkillsOptions["allAgents"] ?? false),
      // Subcommand --format takes priority; fall back to global --format when command is create-skills
      ...(command === "create-skills" &&
        (typeof createSkillsOptions["format"] === "string" ||
          typeof opts["format"] === "string") && {
          "create-skills-format": (createSkillsOptions["format"] ?? opts["format"]) as string,
        }),
      "create-skills-force": Boolean(createSkillsOptions["force"] ?? false),
      "skip-index-refresh": Boolean(createSkillsOptions["skipIndexRefresh"] ?? false),
      // Parent --dry-run intercepts subcommand --dry-run (commander puts it in parent opts).
      // Use || not ?? because the default is false (not undefined).
      "create-skills-dry-run":
        command === "create-skills"
          ? Boolean(createSkillsOptions["dryRun"] || opts["dryRun"])
          : false,
      "create-skills-check": Boolean(createSkillsOptions["check"] ?? false),
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
