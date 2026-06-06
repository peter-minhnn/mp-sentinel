/**
 * Package-manager-aware command rendering for generated skill content.
 *
 * Single source of truth for how generated docs invoke package scripts and
 * the mp-sentinel CLI under npm, pnpm, yarn, and bun. Detection itself lives
 * in the manifest readers (`packageManager` field first, then lockfiles);
 * this module only renders commands from the detected manager.
 */

export type KnownPackageManager = "npm" | "pnpm" | "yarn" | "bun";

/**
 * Normalize a raw package-manager string (e.g. `"bun@1.1.30"` from the
 * `packageManager` manifest field, or a lockfile-derived name) to a known
 * manager. Unknown values fall back to npm.
 */
export function normalizePackageManager(raw: string | undefined): KnownPackageManager {
  if (!raw) return "npm";
  const name = raw.split("@")[0]!.trim().toLowerCase();
  if (name === "pnpm" || name === "yarn" || name === "bun") return name;
  return "npm";
}

/**
 * Render a package.json script invocation for the given manager.
 * Bun requires `bun run <script>` (`bun test` would invoke Bun's own
 * test runner instead of the script). npm keeps its `npm test` shorthand.
 */
export function renderRunScript(packageManager: string | undefined, script: string): string {
  const pm = normalizePackageManager(packageManager);
  if (pm === "bun") return `bun run ${script}`;
  if (pm === "npm" && script === "test") return `npm test`;
  return `${pm} run ${script}`;
}

/**
 * Render the executor prefix used to invoke the mp-sentinel CLI (or any
 * package binary) for the given manager: `npx`, `pnpm exec`, `yarn dlx`,
 * or `bunx --bun`.
 */
export function renderExecPrefix(packageManager: string | undefined): string {
  const pm = normalizePackageManager(packageManager);
  if (pm === "bun") return "bunx --bun";
  if (pm === "pnpm") return "pnpm exec";
  if (pm === "yarn") return "yarn dlx";
  return "npx";
}

/** Render a full mp-sentinel CLI invocation for the given manager. */
export function renderToolCommand(packageManager: string | undefined, args: string): string {
  return `${renderExecPrefix(packageManager)} mp-sentinel ${args}`;
}

// ── Script-aware rendering ──────────────────────────────────────────────────
//
// Projects often wrap mp-sentinel behind their own package.json scripts
// (which may add env guards like `env -u npm_package_version`). Generated
// docs must prefer those scripts over raw CLI invocations.

/** Return the first script name from `candidates` that exists in `scripts`. */
export function resolveProjectScript(
  scripts: Record<string, string> | undefined,
  candidates: readonly string[],
): string | undefined {
  if (!scripts) return undefined;
  return candidates.find((name) => scripts[name] !== undefined);
}

/**
 * Render a package script invocation with extra CLI arguments.
 * npm/pnpm/yarn need a `--` separator before forwarded args; bun forwards
 * extra args directly.
 */
export function renderScriptWithArgs(
  packageManager: string | undefined,
  script: string,
  args: string,
): string {
  const base = renderRunScript(packageManager, script);
  const trimmed = args.trim();
  if (trimmed.length === 0) return base;
  const pm = normalizePackageManager(packageManager);
  return pm === "bun" ? `${base} ${trimmed}` : `${base} -- ${trimmed}`;
}

/** Known project script names that wrap specific mp-sentinel commands. */
export const SENTINEL_SCRIPT_CANDIDATES = {
  indexing: ["sentinel:index", "sentinel:indexing"],
  explainContext: ["sentinel:context"],
  createSkills: ["agent:skills:refresh", "sentinel:skills"],
  check: ["agent:skills:check"],
} as const;

/**
 * Render an mp-sentinel CLI invocation, preferring a project script when one
 * wraps the same command. `args` is the raw CLI argument string (e.g.
 * `indexing --health --index-format json`).
 */
export function renderScriptAwareToolCommand(
  packageManager: string | undefined,
  scripts: Record<string, string> | undefined,
  args: string,
): string {
  const indexingPrefix = "indexing ";
  if (args.startsWith(indexingPrefix)) {
    const script = resolveProjectScript(scripts, SENTINEL_SCRIPT_CANDIDATES.indexing);
    if (script) {
      return renderScriptWithArgs(packageManager, script, args.slice(indexingPrefix.length));
    }
  } else if (args.startsWith("--explain-context")) {
    const script = resolveProjectScript(scripts, SENTINEL_SCRIPT_CANDIDATES.explainContext);
    // Guard on the script BODY: some projects name an indexing wrapper
    // `sentinel:context` (e.g. `mp-sentinel indexing --agent-context`).
    // Only reuse the script when it actually wraps --explain-context.
    if (script && scripts?.[script]?.includes("--explain-context")) {
      return renderScriptWithArgs(
        packageManager,
        script,
        args.replace(/^--explain-context\s*/, ""),
      );
    }
  }
  return renderToolCommand(packageManager, args);
}

/**
 * Render a workspace-scoped script invocation for a monorepo package,
 * using the manager's own filter syntax.
 */
export function renderWorkspaceScript(
  packageManager: string | undefined,
  packageName: string,
  script: string,
): string {
  const pm = normalizePackageManager(packageManager);
  if (pm === "pnpm") return `pnpm --filter ${packageName} run ${script}`;
  if (pm === "yarn") return `yarn workspace ${packageName} run ${script}`;
  if (pm === "bun") return `bun run --filter ${packageName} ${script}`;
  return `npm run ${script} -w ${packageName}`;
}

/**
 * Render the regenerate command for generated skills: the project's refresh
 * script when present, otherwise the raw create-skills invocation.
 */
export function renderRegenerateCommand(
  packageManager: string | undefined,
  scripts: Record<string, string> | undefined,
): string {
  const script = resolveProjectScript(scripts, SENTINEL_SCRIPT_CANDIDATES.createSkills);
  if (script) return renderRunScript(packageManager, script);
  return renderToolCommand(packageManager, "create-skills --all-agents --force");
}
