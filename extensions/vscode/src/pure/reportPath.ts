/**
 * Builds the workspace-relative path for a branch-diff markdown report.
 *
 * Pure (no `vscode`) so the date/format logic is unit-testable. Uses the local
 * date in `MMDD` form: `reports/review-0617.md`.
 */

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** `<directory>/review-MMDD.md` using `date`'s local month/day. */
export function branchReportPath(directory: string, date: Date): string {
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  const dir = directory.replace(/[/\\]+$/, "");
  const prefix = dir.length > 0 ? `${dir}/` : "";
  return `${prefix}review-${mm}${dd}.md`;
}
