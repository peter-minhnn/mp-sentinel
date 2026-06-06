/**
 * Deterministic project-convention detectors.
 *
 * Derives internal conventions from the source index — tsconfig path
 * aliases, feature-folder layouts, central HTTP clients, React Query key
 * constants, and shared UI system roots. Pure functions, no AI, no I/O:
 * the same index always yields the same conventions.
 *
 * Detected conventions are advisory descriptions of what the repo already
 * does; they never invent practices the codebase does not show.
 */

import type { SourceIndex, SourceIndexFile } from "../../types/index.js";
import { moduleKeyForPath } from "./module-grouping.js";

export interface DetectedConvention {
  /** Stable id, e.g. "alias", "feature-structure", "http-client" */
  id: string;
  /** One-line convention statement rendered into generated docs */
  text: string;
}

const MAX_CONVENTIONS = 8;

// ── Alias style ─────────────────────────────────────────────────────────────

function detectAliasConvention(index: SourceIndex): DetectedConvention | null {
  const paths = index.project.tsConfig?.compilerOptions?.paths as
    | Record<string, unknown>
    | undefined;
  const configuredAliases = paths ? Object.keys(paths) : [];
  if (configuredAliases.length === 0) return null;

  // Confirm at least one alias is actually used in imports (or trust config
  // alone when the import graph carries no external-style imports).
  const aliasPrefixes = configuredAliases.map((a) => a.replace(/\*$/, ""));
  const used = index.files.some((f) =>
    f.imports.some((imp) => aliasPrefixes.some((p) => p.length > 0 && imp.source.startsWith(p))),
  );

  const display = configuredAliases.map((a) => `\`${a}\``).join(", ");
  if (used) {
    return {
      id: "alias",
      text: `Use the configured tsconfig path alias(es) ${display} for internal imports - do not replace them with deep relative paths.`,
    };
  }
  return {
    id: "alias",
    text: `tsconfig defines path alias(es) ${display}; prefer them over deep relative imports when touching import-heavy files.`,
  };
}

// ── Feature-folder structure ────────────────────────────────────────────────

interface FeatureShape {
  constants: number;
  types: number;
  hooks: number;
  api: number;
  total: number;
}

function collectFeatureShape(index: SourceIndex): FeatureShape {
  const featureRoots = new Map<string, Set<string>>();
  for (const file of index.files) {
    const match = file.path.match(/^(?:src\/)?features\/([^/]+)\/(.+)$/);
    if (!match) continue;
    const feature = match[1]!;
    const rest = match[2]!;
    const bucket = featureRoots.get(feature) ?? new Set<string>();
    bucket.add(rest);
    featureRoots.set(feature, bucket);
  }

  const shape: FeatureShape = { constants: 0, types: 0, hooks: 0, api: 0, total: 0 };
  for (const [, children] of featureRoots) {
    shape.total++;
    const childList = [...children];
    if (childList.some((c) => /^constants\.(ts|tsx)$/.test(c))) shape.constants++;
    if (childList.some((c) => /^types\.(ts|tsx)$/.test(c))) shape.types++;
    if (childList.some((c) => c.startsWith("hooks/") || /^use[A-Z][^/]*\.(ts|tsx)$/.test(c)))
      shape.hooks++;
    if (childList.some((c) => c.startsWith("api/") || /^api\.(ts|tsx)$/.test(c))) shape.api++;
  }
  return shape;
}

function detectFeatureStructureConvention(index: SourceIndex): DetectedConvention | null {
  const shape = collectFeatureShape(index);
  if (shape.total < 2) return null;

  const majority = (n: number): boolean => n * 2 >= shape.total;
  const parts: string[] = [];
  if (majority(shape.types)) parts.push("`types.ts`");
  if (majority(shape.constants)) parts.push("`constants.ts`");
  if (majority(shape.hooks)) parts.push("feature hooks (`hooks/` or `use*.ts`)");
  if (majority(shape.api)) parts.push("a feature-local `api/` layer");
  if (parts.length === 0) return null;

  return {
    id: "feature-structure",
    text: `Feature-first layout: each \`features/<feature>/\` folder owns ${parts.join(", ")} - add new feature code inside its feature folder, not in shared dirs.`,
  };
}

// ── Central HTTP client ─────────────────────────────────────────────────────

const HTTP_CLIENT_PATH_RE = /^(?:src\/)?(?:lib|shared|services|core)\/(api|http)[^/]*(?:\/|\.)/;
const HTTP_CLIENT_SYMBOL_RE = /^(api|http)Client$|^(apiClient|httpClient|api|http)$/i;

function detectHttpClientConvention(index: SourceIndex): DetectedConvention | null {
  let best: { file: SourceIndexFile; importers: number; symbol: string | undefined } | null = null;
  for (const file of index.files) {
    if (!HTTP_CLIENT_PATH_RE.test(file.path)) continue;
    const importers = file.importedBy?.length ?? 0;
    if (importers < 3) continue;
    const symbol = file.symbols.find((s) => HTTP_CLIENT_SYMBOL_RE.test(s.name))?.name;
    if (!best || importers > best.importers) {
      best = { file, importers, symbol };
    }
  }
  if (!best) return null;

  const via = best.symbol ? ` (\`${best.symbol}\`)` : "";
  return {
    id: "http-client",
    text: `HTTP calls go through the central client in \`${best.file.path}\`${via} (imported by ${best.importers} files) - do not create ad-hoc fetch/axios wrappers.`,
  };
}

// ── React Query key conventions ─────────────────────────────────────────────

const QUERY_KEY_FILE_RE = /(query-?keys?|keys)\.(ts|tsx)$/i;
const QUERY_KEY_SYMBOL_RE = /^[A-Z0-9_]*QUERY_KEYS?[A-Z0-9_]*$|^queryKeys?$/;

function detectQueryKeyConvention(index: SourceIndex): DetectedConvention | null {
  const allDeps = { ...index.project.dependencies, ...index.project.devDependencies };
  const hasQuery =
    allDeps["@tanstack/react-query"] !== undefined || allDeps["react-query"] !== undefined;
  if (!hasQuery) return null;

  const keyFiles: string[] = [];
  for (const file of index.files) {
    const fileNameHit = QUERY_KEY_FILE_RE.test(file.path);
    const symbolHit =
      /constants\.(ts|tsx)$/.test(file.path) &&
      file.symbols.some((s) => QUERY_KEY_SYMBOL_RE.test(s.name));
    if (fileNameHit || symbolHit) keyFiles.push(file.path);
  }
  if (keyFiles.length === 0) return null;

  const display = keyFiles
    .sort()
    .slice(0, 3)
    .map((f) => `\`${f}\``)
    .join(", ");
  return {
    id: "query-keys",
    text: `React Query keys are defined as constants (${display}) - reuse those keys for caching/invalidation instead of inlining string arrays.`,
  };
}

// ── UI system roots ─────────────────────────────────────────────────────────

const UI_ROOT_RE = /^(?:src\/)?(components\/ui|shared\/[^/]*ui[^/]*|ui)\//;

function detectUiSystemConvention(index: SourceIndex): DetectedConvention | null {
  const rootCounts = new Map<string, number>();
  for (const file of index.files) {
    const match = file.path.match(UI_ROOT_RE);
    if (!match) continue;
    const root = moduleKeyForPath(file.path);
    rootCounts.set(root, (rootCounts.get(root) ?? 0) + 1);
  }

  const best = [...rootCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (!best || best[1] < 3) return null;

  const allDeps = { ...index.project.dependencies, ...index.project.devDependencies };
  const systems: string[] = [];
  if (allDeps["antd"]) systems.push("Ant Design");
  if (allDeps["@radix-ui/react-slot"] || allDeps["class-variance-authority"])
    systems.push("shadcn/ui-style primitives");
  const hasStorybook = index.files.some((f) => /\.stories\.(ts|tsx|js|jsx)$/.test(f.path));
  if (hasStorybook) systems.push("Storybook");

  const suffix = systems.length > 0 ? ` (built on ${systems.join(", ")})` : "";
  return {
    id: "ui-system",
    text: `Reusable UI primitives live under \`${best[0]}/\`${suffix} - extend the shared component there instead of duplicating one-off components.`,
  };
}

// ── Monorepo / workspaces ───────────────────────────────────────────────────

function detectWorkspacesConvention(index: SourceIndex): DetectedConvention | null {
  const workspaces = index.project.workspaces;
  if (!workspaces || workspaces.length === 0) return null;

  const pm = (index.project.packageManager ?? "npm").toLowerCase();
  const filterHint =
    pm === "pnpm"
      ? "`pnpm --filter <package> run <script>`"
      : pm === "yarn"
        ? "`yarn workspace <package> run <script>`"
        : pm === "bun"
          ? "`bun run --filter <package> <script>`"
          : "`npm run <script> -w <package>`";
  const globs = workspaces
    .filter((w) => !w.startsWith("("))
    .slice(0, 4)
    .map((w) => `\`${w}\``)
    .join(", ");
  const layout = globs ? ` (${globs})` : "";
  const packages = index.project.workspacePackages ?? [];
  const packageList =
    packages.length > 0
      ? ` Packages: ${packages
          .slice(0, 4)
          .map((p) => `\`${p.name}\``)
          .join(", ")}${packages.length > 4 ? ` (+${packages.length - 4} more)` : ""}.`
      : "";
  return {
    id: "workspaces",
    text: `Monorepo workspace root${layout} - run package-local scripts with ${filterHint} instead of cd'ing into packages.${packageList}`,
  };
}

// ── Test framework + placement ─────────────────────────────────────────────

const TEST_FRAMEWORKS: ReadonlyArray<readonly [dep: string, label: string]> = [
  ["vitest", "Vitest"],
  ["jest", "Jest"],
  ["mocha", "Mocha"],
  ["@playwright/test", "Playwright"],
  ["playwright", "Playwright"],
];

function detectTestConvention(index: SourceIndex): DetectedConvention | null {
  const allDeps = { ...index.project.dependencies, ...index.project.devDependencies };
  const framework = TEST_FRAMEWORKS.find(([dep]) => allDeps[dep] !== undefined)?.[1];

  const testFiles = index.files.filter(
    (f) => f.path.includes(".test.") || f.path.includes(".spec.") || f.path.includes("__tests__"),
  );
  if (testFiles.length === 0) return null;

  const inTestsDirs = testFiles.filter(
    (f) => f.path.includes("__tests__") || /^tests?\//.test(f.path),
  ).length;
  const placement =
    inTestsDirs * 2 >= testFiles.length
      ? "in dedicated test directories (`__tests__/` / `tests/`)"
      : "colocated next to the source files they cover";

  const fwPrefix = framework ? `${framework} tests` : "Tests";
  return {
    id: "test-placement",
    text: `${fwPrefix} live ${placement} (${testFiles.length} test file(s)) - follow the same placement for new tests.`,
  };
}

// ── Data layer beyond the HTTP client ───────────────────────────────────────

const DATA_LAYER_DEPS: ReadonlyArray<readonly [dep: string, label: string]> = [
  ["@prisma/client", "Prisma"],
  ["prisma", "Prisma"],
  ["drizzle-orm", "Drizzle"],
  ["@trpc/server", "tRPC"],
  ["@trpc/client", "tRPC"],
  ["graphql", "GraphQL"],
  ["@supabase/supabase-js", "Supabase"],
];

function detectDataLayerConvention(index: SourceIndex): DetectedConvention | null {
  const allDeps = { ...index.project.dependencies, ...index.project.devDependencies };
  const tech = DATA_LAYER_DEPS.find(([dep]) => allDeps[dep] !== undefined)?.[1];
  if (!tech) return null;

  // Find the directory that concentrates the data-access code for this tech
  const techLower = tech.toLowerCase();
  const dirCounts = new Map<string, number>();
  for (const file of index.files) {
    const lower = file.path.toLowerCase();
    if (!lower.includes(techLower) && !/(^|\/)(db|data|repositor)/.test(lower)) continue;
    const key = moduleKeyForPath(file.path);
    dirCounts.set(key, (dirCounts.get(key) ?? 0) + 1);
  }
  const best = [...dirCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (!best || best[1] < 2) return null;

  return {
    id: "data-layer",
    text: `${tech} data access is concentrated in \`${best[0]}/\` - go through that layer instead of querying from UI/route code directly.`,
  };
}

// ── State management / form libraries ──────────────────────────────────────

const STATE_LIBS: ReadonlyArray<readonly [dep: string, label: string]> = [
  ["zustand", "Zustand"],
  ["@reduxjs/toolkit", "Redux Toolkit"],
  ["redux", "Redux"],
  ["jotai", "Jotai"],
  ["recoil", "Recoil"],
  ["mobx", "MobX"],
];

const FORM_LIBS: ReadonlyArray<readonly [dep: string, label: string]> = [
  ["react-hook-form", "React Hook Form"],
  ["formik", "Formik"],
];

function detectStateAndFormsConvention(index: SourceIndex): DetectedConvention | null {
  const allDeps = { ...index.project.dependencies, ...index.project.devDependencies };
  const state = STATE_LIBS.find(([dep]) => allDeps[dep] !== undefined)?.[1];
  const form = FORM_LIBS.find(([dep]) => allDeps[dep] !== undefined)?.[1];
  if (!state && !form) return null;

  const parts: string[] = [];
  if (state)
    parts.push(`client state lives in ${state} stores - do not add a second state library`);
  if (form) {
    const withZod = allDeps["zod"] !== undefined ? ` with zod schemas` : "";
    parts.push(`forms use ${form}${withZod} - keep new forms on the same stack`);
  }
  return {
    id: "state-forms",
    text: `${parts.join("; ")}.`,
  };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Run all convention detectors against the index.
 * Returns a deterministic, capped list (stable order by detector).
 */
export function detectProjectConventions(index: SourceIndex | null): DetectedConvention[] {
  if (!index || index.files.length === 0) return [];
  const detected = [
    detectWorkspacesConvention(index),
    detectAliasConvention(index),
    detectFeatureStructureConvention(index),
    detectHttpClientConvention(index),
    detectDataLayerConvention(index),
    detectQueryKeyConvention(index),
    detectUiSystemConvention(index),
    detectStateAndFormsConvention(index),
    detectTestConvention(index),
  ].filter((c): c is DetectedConvention => c !== null);
  return detected.slice(0, MAX_CONVENTIONS);
}

/** Render the `## Detected Conventions` section ("" when none detected). */
export function buildDetectedConventionsSection(conventions: DetectedConvention[]): string {
  if (conventions.length === 0) return "";
  const lines = [
    `## Detected Conventions`,
    ``,
    `Conventions observed in this codebase (from config and the import graph). Follow them unless project-authored rules say otherwise:`,
    ``,
  ];
  for (const conv of conventions) {
    lines.push(`- ${conv.text}`);
  }
  return lines.join("\n");
}
