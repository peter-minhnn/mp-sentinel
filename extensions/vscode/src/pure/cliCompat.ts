/**
 * Small compatibility probes for the child CLI.
 *
 * Branch review needs the local `--format json` support added in CLI 3.2.5.
 * Older CLIs print a console report plus a "not supported in local mode"
 * warning, which surfaces to the extension as an opaque JSON parse failure.
 * Detecting that marker lets us show an actionable upgrade hint instead.
 */

/** True when CLI output indicates local `--format json` is unsupported (pre-3.2.5). */
export function looksLikeUnsupportedLocalJson(text: string): boolean {
  return /not supported in local mode/i.test(text);
}

/** User-facing hint shown when the child CLI is too old for branch review. */
export const OLD_CLI_BRANCH_REVIEW_HINT =
  "MP Sentinel CLI is too old for branch review — local '--format json' is unsupported before 3.2.5. " +
  "Upgrade the CLI, or point mpSentinel.cli.command at a local dist build.";
