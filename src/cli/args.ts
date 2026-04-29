import { Command } from "commander";
import { UserError } from "../utils/errors.js";
import { getToolVersion } from "../utils/version.js";

export type CLICommand = "review" | "indexing" | "create-skills" | "default";

export interface CLIValues {
  help: boolean;
  version: boolean;
  "skip-commit": boolean;
  "skip-files": boolean;
  "target-branch"?: string;
  concurrency?: string;
  verbose: boolean;
  quiet: boolean;
  local: boolean;
  interactive: boolean;
  commits?: string;
  "branch-diff": boolean;
  "compare-branch"?: string;
  fetch: boolean;
  "include-uncommitted": boolean;
  staged: boolean;
  commit?: string;
  range?: string;
  files: string[];
  format?: string;
  ai?: boolean;
  "no-skills-fetch": boolean;
  "dry-run": boolean;
  "verbose-dry-run": boolean;
  "token-limit"?: string;
  "explain-context"?: boolean;
  "index-format"?: string;
  force?: boolean;
  stats?: boolean;
  explainIndex?: string;
  findSymbol?: string;
  findImport?: string;
  agentContext?: string;
  agent?: string;
  "all-agents": boolean;
  "create-skills-format"?: string;
  "create-skills-force": boolean;
  "skip-index-refresh": boolean;
  "create-skills-dry-run": boolean;
  "create-skills-check": boolean;
  "create-skills-no-ai-enrich": boolean;
  "explain-agents"?: boolean;
  doctor?: boolean;
  health?: boolean;
}

const PACKAGE_VERSION = getToolVersion();

export const buildProgram = (): Command => {
  const program = new Command();

  program
    .name("mp-sentinel")
    .description("AI-powered code review CLI — audits Git changes with Gemini, GPT-4, or Claude.")
    .version(PACKAGE_VERSION, "-v, --version", "Print version and exit")
    .helpOption("-h, --help", "Display help for command")
    .option("--skip-commit", "Skip commit-message audit", false)
    .option("--skip-files", "Skip file-level audit", false)
    .option("-b, --target-branch <branch>", "Target branch for diff (default: origin/main)")
    .option("-c, --concurrency <n>", "Max parallel AI requests")
    .option("--verbose", "Enable verbose debug output", false)
    .option("-q, --quiet", "Suppress all non-error output", false)
    .option("-l, --local", "Enable local review mode (branch-based)", false)
    .option("-i, --interactive", "Interactive commit picker UI", false)
    .option("-n, --commits <n>", "Number of recent commits to review in local mode")
    .option("-d, --branch-diff", "Enable branch-diff mode (all commits vs compare-branch)", false)
    .option("--compare-branch <branch>", "Branch to compare against in branch-diff mode")
    .option("--fetch", "Auto-fetch remote branch before detecting merge-base", false)
    .option("--include-uncommitted", "Include staged/unstaged changes in the review scope", false)
    .option("--staged", "Review staged files", false)
    .option("--commit <sha>", "Review a specific commit SHA")
    .option("--range <range>", "Review a git range (e.g. main..HEAD)")
    .option("--format <fmt>", "Output format: console | json | markdown (default: console)")
    .option("--ai", "Force-enable AI review")
    .option("--no-ai", "Force-disable AI review")
    .option("--no-skills-fetch", "Disable external skills.sh calls (air-gapped mode)", false)
    .option("--dry-run", "Security scan only — skip AI calls and preview results", false)
    .option("--verbose-dry-run", "Dry-run with forced per-file token breakdown", false)
    .option(
      "--token-limit <n>",
      "Override provider context-window token limit (e.g. 128000 for GPT-4o)",
    )
    .option(
      "--explain-context",
      "Diagnostic mode: show context building details without AI calls",
      false,
    )
    .option("--files [files...]", "Review explicit file paths", [])
    .action(() => {
      // Intentionally empty: signals to Commander that the root command is valid
      // without a subcommand (review mode). Without this, Commander 14 auto-shows
      // help when subcommands are registered but none is provided.
    });

  const indexingCmd = program
    .command("indexing")
    .description("Build source index cache for enhanced review context")
    .option("--force", "Force rebuild cache even if up-to-date", false)
    .option("--index-format <fmt>", "Output format: console | json (default: console)", "console")
    .option("--stats", "Output index statistics only (with --index-format json)", false)
    .option("--explain-index <file>", "Show dependency info for a specific file")
    .option("--explain <file>", "Alias for --explain-index")
    .option(
      "--find-symbol <query>",
      "Search index for symbols (functions, classes, interfaces, etc.)",
    )
    .option("--find-import <query>", "Search index for files importing a package or path")
    .option(
      "--agent-context <file>",
      "AI-agent-friendly context pack: symbols, imports, dependents, hub files, suggested next commands",
    )
    .option(
      "--health",
      "Read-only index health check: status, staleness, file integrity (no build, no AI)",
      false,
    );

  program
    .command("create-skills")
    .description("Generate agent/IDE skill files from the source index")
    .option(
      "--agent <agents>",
      "Comma-separated adapter ids: claude,cursor,codex,windsurf,antigravity,cline,generic",
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
    )
    .option("--no-ai-enrich", "Disable AI enrichment even if enabled in config", false)
    .option(
      "--explain-agents",
      "Diagnostic mode: show which agents/IDEs are detected and why (no file writes)",
      false,
    )
    .option(
      "--doctor",
      "Diagnostic mode: comprehensive setup health check (read-only, no writes, no AI)",
      false,
    );

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
  $ npx mp-sentinel --explain-context                     # Show context diagnostics (no AI)
  $ npx mp-sentinel --quiet --format json                 # CI-friendly JSON output
  $ npx mp-sentinel indexing                              # Build source index cache
  $ npx mp-sentinel indexing --index-format json          # Output index as JSON
  $ npx mp-sentinel indexing --health --index-format json  # Index health check (read-only)
  $ npx mp-sentinel indexing --force                      # Force rebuild cache
  $ npx mp-sentinel create-skills                         # Interactive agent picker
  $ npx mp-sentinel create-skills --agent claude,cursor   # Generate for specific agents
  $ npx mp-sentinel create-skills --all-agents            # Generate for all agents
  $ npx mp-sentinel create-skills --agent claude --format json  # JSON output
  $ npx mp-sentinel create-skills --agent claude --force  # Overwrite existing files
  $ npx mp-sentinel create-skills --explain-agents        # Show detection diagnostics
  $ npx mp-sentinel create-skills --explain-agents --format json  # JSON detection output
  $ npx mp-sentinel create-skills --doctor                # Health check (console)
  $ npx mp-sentinel create-skills --doctor --format json   # Health check (JSON)
  $ npx mp-sentinel create-skills --doctor --agent claude  # Scoped to Claude
`,
  );

  return program;
};

export const parseCliArgs = (): {
  command: CLICommand;
  values: CLIValues;
  positionals: string[];
  commandPositionals: string[];
} => {
  try {
    const program = buildProgram();

    program.allowUnknownOption(false);
    program.allowExcessArguments(true);
    program.exitOverride();

    try {
      program.parse(process.argv);
    } catch (err: unknown) {
      if (err instanceof Error && "code" in err) {
        const code = (err as { code: string }).code;
        // Commander 14 uses commander.helpDisplayed / commander.versionDisplayed.
        // Older versions may use commander.help / commander.version.
        // Defensive: treat any help/version related code as success.
        if (
          code === "commander.helpDisplayed" ||
          code === "commander.help" ||
          code === "commander.versionDisplayed" ||
          code === "commander.version"
        ) {
          process.exit(0);
        }
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

    const aiValue: boolean | undefined =
      opts["ai"] === false ? false : opts["ai"] === true ? true : undefined;

    const values = {
      help: false,
      version: false,
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
      ...(opts["explainContext"] === true && {
        "explain-context": true,
      }),
      ...(typeof indexingOptions["indexFormat"] === "string" && {
        "index-format": indexingOptions["indexFormat"],
      }),
      ...(typeof indexingOptions["stats"] === "boolean" && { stats: indexingOptions["stats"] }),
      ...(typeof indexingOptions["explainIndex"] === "string" && {
        explainIndex: indexingOptions["explainIndex"] as string,
      }),
      // Support --explain <file> as alias for --explain-index <file>
      ...(typeof indexingOptions["explainIndex"] !== "string" &&
        typeof indexingOptions["explain"] === "string" && {
          explainIndex: indexingOptions["explain"] as string,
        }),
      ...(typeof indexingOptions["findSymbol"] === "string" && {
        findSymbol: indexingOptions["findSymbol"] as string,
      }),
      ...(typeof indexingOptions["findImport"] === "string" && {
        findImport: indexingOptions["findImport"] as string,
      }),
      ...(typeof indexingOptions["agentContext"] === "string" && {
        agentContext: indexingOptions["agentContext"] as string,
      }),
      force: command === "indexing" ? Boolean(indexingOptions["force"] ?? false) : false,
      health: command === "indexing" ? Boolean(indexingOptions["health"] ?? false) : false,
      ...(typeof createSkillsOptions["agent"] === "string" && {
        agent: createSkillsOptions["agent"],
      }),
      "all-agents": Boolean(createSkillsOptions["allAgents"] ?? false),
      ...(command === "create-skills" &&
        (typeof createSkillsOptions["format"] === "string" ||
          typeof opts["format"] === "string") && {
          "create-skills-format": (createSkillsOptions["format"] ?? opts["format"]) as string,
        }),
      "create-skills-force": Boolean(createSkillsOptions["force"] ?? false),
      "skip-index-refresh": Boolean(createSkillsOptions["skipIndexRefresh"] ?? false),
      "create-skills-dry-run":
        command === "create-skills"
          ? Boolean(createSkillsOptions["dryRun"] || opts["dryRun"])
          : false,
      "create-skills-check": Boolean(createSkillsOptions["check"] ?? false),
      "create-skills-no-ai-enrich": createSkillsOptions["aiEnrich"] === false,
      ...(command === "create-skills" &&
        createSkillsOptions["explainAgents"] === true && {
          "explain-agents": true,
        }),
      ...(command === "create-skills" &&
        createSkillsOptions["doctor"] === true && { doctor: true }),
    } as CLIValues;

    return {
      command,
      values,
      positionals: rawPositionals,
      commandPositionals,
    };
  } catch (error) {
    if (error instanceof Error && "code" in error) {
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
