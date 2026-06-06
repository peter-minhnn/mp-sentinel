/**
 * Framework-aware module grouping for generated skill docs.
 *
 * The old behavior grouped files by top-level directory only, which collapsed
 * entire apps into one `src/` module. This helper produces real bounded
 * contexts instead:
 *
 * - `src/<dir>`                      — default for files under `src/`
 * - `src/features/<feature>`        — feature-first SPA layouts
 * - `src/shared/<package>`          — shared UI/util packages
 * - `src/app/(group)` / `src/app/api` — Next.js App Router groups
 * - `src/components/<domain>`, `src/lib/<domain>` — domain folders
 * - `app/<segment>`, `features/<feature>` — same conventions without `src/`
 *
 * Deterministic: same path always maps to the same group key.
 */

/**
 * Directory names whose children are bounded contexts of their own
 * (feature folders, shared packages, App Router segments, domain folders).
 */
const NESTED_GROUP_PARENTS = new Set([
  "features",
  "feature",
  "modules",
  "domains",
  "shared",
  "app",
  "components",
  "lib",
  "pages",
  "routes",
  "views",
  "layouts",
  // Workspace monorepo roots: each package is its own bounded context
  "packages",
  "apps",
]);

const FILE_SEGMENT_RE =
  /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|json|yaml|yml|md|css|scss|html|vue|svelte)$/i;

const isFileSegment = (segment: string): boolean => FILE_SEGMENT_RE.test(segment);

/**
 * Compute the module group key for a file path.
 * Returns "(root)" for files at the repository root.
 */
export function moduleKeyForPath(path: string): string {
  const parts = path.split("/");
  if (parts.length < 2) return "(root)";

  const top = parts[0]!;
  if (top === "src") {
    const second = parts[1]!;
    if (parts.length === 2 || isFileSegment(second)) return "src";
    if (parts.length >= 4 && NESTED_GROUP_PARENTS.has(second) && !isFileSegment(parts[2]!)) {
      return `src/${second}/${parts[2]}`;
    }
    return `src/${second}`;
  }

  if (parts.length >= 3 && NESTED_GROUP_PARENTS.has(top) && !isFileSegment(parts[1]!)) {
    return `${top}/${parts[1]}`;
  }
  return top;
}

/** Well-known application entry files for SPA / framework projects. */
const APP_ENTRY_FILES = new Set([
  "src/main.tsx",
  "src/main.ts",
  "src/main.jsx",
  "src/main.js",
  "src/App.tsx",
  "src/App.jsx",
  "src/app/router.tsx",
  "src/app/router.ts",
  "src/router.tsx",
  "src/router.ts",
  "src/index.tsx",
]);

/** True when the path is a well-known SPA/application entry file. */
export function isAppEntryFile(path: string): boolean {
  return APP_ENTRY_FILES.has(path);
}

const NEXT_ROUTE_FILE_RE =
  /^(?:src\/)?app\/(?:.*\/)?(page|layout|route|template|loading|error|not-found|actions?)\.(ts|tsx|js|jsx)$/;

/**
 * True when the path is a Next.js App Router route file
 * (page/layout/route/template/loading/error/not-found/actions under app/).
 */
export function isNextRouteFile(path: string): boolean {
  return NEXT_ROUTE_FILE_RE.test(path);
}
