/**
 * Workspace-relative path helpers for building CLI `--files` arguments.
 *
 * `vscode.workspace.asRelativePath` is unreliable in multi-root workspaces: it
 * picks a root for us and may prepend the folder name, producing paths the CLI
 * (which runs with `cwd` set to one specific folder) cannot resolve. These
 * helpers compute the path relative to a *caller-chosen* folder and refuse any
 * file that lives outside it, so a multi-root or mixed selection can never send
 * a wrong path into the CLI.
 *
 * Pure (no `vscode` import) so it is unit-testable and works regardless of the
 * host platform's path separator.
 */

import path from "node:path";

/** Normalizes Windows separators to POSIX so comparisons are platform-stable. */
function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Returns `fileFsPath` expressed relative to `folderRoot`, using forward
 * slashes, or `null` when the file is the folder itself or lies outside it.
 *
 * Handles single-root and multi-root layouts, nested files, and Windows-style
 * input separators.
 */
export function workspaceRelativePath(folderRoot: string, fileFsPath: string): string | null {
  const root = path.posix.normalize(toPosix(folderRoot)).replace(/\/+$/, "");
  const file = path.posix.normalize(toPosix(fileFsPath));
  const rel = path.posix.relative(root, file);
  if (rel === "" || rel.startsWith("..") || path.posix.isAbsolute(rel)) {
    return null;
  }
  return rel;
}

export type WorkspaceFilesResult = { ok: true; files: string[] } | { ok: false; outside: string[] };

/**
 * Maps absolute file paths to folder-relative paths, failing if any path is
 * outside `folderRoot`. Used to reject a selection that spans multiple
 * workspace folders before anything is handed to the CLI.
 */
export function resolveWorkspaceFiles(
  folderRoot: string,
  fileFsPaths: readonly string[],
): WorkspaceFilesResult {
  const files: string[] = [];
  const outside: string[] = [];
  for (const fsPath of fileFsPaths) {
    const rel = workspaceRelativePath(folderRoot, fsPath);
    if (rel === null) {
      outside.push(fsPath);
    } else {
      files.push(rel);
    }
  }
  if (outside.length > 0) return { ok: false, outside };
  return { ok: true, files };
}
