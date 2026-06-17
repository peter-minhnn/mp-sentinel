/**
 * Builds `mp-sentinel` argument vectors from high-level, typed operations.
 *
 * The builder never embeds secrets — credentials flow through the environment
 * only (see env.ts / secrets.ts). All argv arrays produced here are safe to log.
 *
 * Flag names mirror `src/cli/args.ts` in the main package. JSON output is
 * requested where the operation is meant to be machine-parsed.
 */

/** Severity floor passed to `--severity-threshold`. */
export type SeverityThreshold = "CRITICAL" | "WARNING" | "INFO";

export type ReviewScope =
  | { kind: "staged" }
  | { kind: "files"; files: readonly string[] }
  | { kind: "range"; range: string }
  | { kind: "commit"; sha: string }
  | { kind: "local"; commits?: number; branchDiff?: boolean; compareBranch?: string };

export interface ReviewOptions {
  scope: ReviewScope;
  /** Output format. Defaults to "json" so the result can be parsed. */
  format?: "json" | "console" | "markdown" | "sarif";
  /** Force-enable AI (e.g. for --staged, which is non-AI by default). */
  forceAi?: boolean;
  /** Force-disable AI (deterministic review only). */
  noAi?: boolean;
  /** Bypass the AI response cache for this run. */
  noCache?: boolean;
  /** Target branch for range/default diff mode. */
  targetBranch?: string;
  /** Severity floor for FAIL (`--severity-threshold`). */
  severityThreshold?: SeverityThreshold;
  /** Write a markdown report to this path (`--output`). */
  output?: string;
}

export type IndexingOperation =
  | { kind: "rebuild"; force?: boolean }
  | { kind: "health" }
  | { kind: "recovered" }
  | { kind: "parse-errors" }
  | { kind: "stats" }
  | { kind: "explain-index"; file: string }
  | { kind: "agent-context"; file: string };

export type CreateSkillsOperation =
  | { kind: "doctor" }
  | { kind: "check" }
  | { kind: "dry-run" }
  | { kind: "explain-agents" }
  | { kind: "generate"; force?: boolean; skipIndexRefresh?: boolean };

export interface CreateSkillsOptions {
  operation: CreateSkillsOperation;
  /** Comma-joined agent ids, or "all" for --all-agents. */
  agents?: readonly string[] | "all";
  /** Request JSON output. Note: generate/dry-run/check JSON requires agents. */
  json?: boolean;
}

function agentArgs(agents: readonly string[] | "all" | undefined): string[] {
  if (agents === "all") return ["--all-agents"];
  if (Array.isArray(agents) && agents.length > 0) return ["--agent", agents.join(",")];
  return [];
}

/** Builds argv for a code review (root command, no subcommand). */
export function buildReviewArgs(options: ReviewOptions): string[] {
  const args: string[] = [];
  const { scope } = options;

  switch (scope.kind) {
    case "staged":
      args.push("--staged");
      break;
    case "files":
      args.push("--files", ...scope.files);
      break;
    case "range":
      args.push("--range", scope.range);
      break;
    case "commit":
      args.push("--commit", scope.sha);
      break;
    case "local":
      args.push("--local");
      if (typeof scope.commits === "number") args.push("--commits", String(scope.commits));
      if (scope.branchDiff) args.push("--branch-diff");
      if (scope.compareBranch) args.push("--compare-branch", scope.compareBranch);
      break;
  }

  if (options.targetBranch) args.push("--target-branch", options.targetBranch);
  if (options.forceAi) args.push("--ai");
  if (options.noAi) args.push("--no-ai");
  if (options.noCache) args.push("--no-cache");
  if (options.severityThreshold) args.push("--severity-threshold", options.severityThreshold);
  if (options.output) args.push("--output", options.output);

  args.push("--format", options.format ?? "json");
  return args;
}

/**
 * Builds argv for a context/token preview without calling the AI:
 * `--explain-context --format json --files <files...>`.
 */
export function buildExplainContextArgs(files: readonly string[]): string[] {
  const args = ["--explain-context", "--format", "json"];
  if (files.length > 0) args.push("--files", ...files);
  return args;
}

/** Builds argv for a security-only dry run (no AI): `--dry-run --format json`. */
export function buildDryRunArgs(scope?: ReviewScope): string[] {
  const args = buildReviewArgs({ scope: scope ?? { kind: "staged" }, format: "json" });
  // Insert --dry-run ahead of --format for readability; order is irrelevant to commander.
  return ["--dry-run", ...args];
}

/** Builds argv for the AI connectivity probe: `check-ai`. Output is JSON-only. */
export function buildCheckAiArgs(): string[] {
  return ["check-ai"];
}

/** Builds argv for indexing operations (always JSON for query modes). */
export function buildIndexingArgs(operation: IndexingOperation): string[] {
  const json = ["--index-format", "json"];
  switch (operation.kind) {
    case "rebuild":
      return operation.force ? ["indexing", "--force"] : ["indexing"];
    case "health":
      return ["indexing", "--health", ...json];
    case "recovered":
      return ["indexing", "--recovered", ...json];
    case "parse-errors":
      return ["indexing", "--parse-errors", ...json];
    case "stats":
      return ["indexing", "--stats", ...json];
    case "explain-index":
      return ["indexing", "--explain-index", operation.file, ...json];
    case "agent-context":
      return ["indexing", "--agent-context", operation.file, ...json];
  }
}

/** Builds argv for create-skills operations. */
export function buildCreateSkillsArgs(options: CreateSkillsOptions): string[] {
  const { operation } = options;
  const args = ["create-skills"];

  switch (operation.kind) {
    case "doctor":
      args.push("--doctor");
      break;
    case "check":
      args.push("--check");
      break;
    case "dry-run":
      args.push("--dry-run");
      break;
    case "explain-agents":
      args.push("--explain-agents");
      break;
    case "generate":
      if (operation.force) args.push("--force");
      if (operation.skipIndexRefresh) args.push("--skip-index-refresh");
      break;
  }

  args.push(...agentArgs(options.agents));
  if (options.json) args.push("--format", "json");
  return args;
}

/** Builds argv for scaffolding a config file: `init [--force] [--format json]`. */
export function buildInitArgs(options: { force?: boolean; json?: boolean } = {}): string[] {
  const args = ["init"];
  if (options.force) args.push("--force");
  if (options.json) args.push("--format", "json");
  return args;
}
