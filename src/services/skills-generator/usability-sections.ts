/**
 * Agent-usability sections for generated SKILL.md files:
 *
 * - `## First Files To Read` — grounded by real entrypoints and hub files,
 *   so an agent can orient itself in the codebase in one pass.
 * - `## Common Change Paths` — where feature work, API/data work, UI work,
 *   and tests usually happen, derived from modules and conventions.
 *
 * Both sections are deterministic, compact (hard caps), and rendered only
 * by skill-folder adapters; rule-only outputs stay concise without them.
 */

import type { SkillKnowledgeBase, SourceIndex } from "../../types/index.js";
import type { DetectedConvention } from "./convention-detectors.js";
import { renderRunScript } from "./package-manager.js";

const MAX_FIRST_FILES = 6;
const MAX_CHANGE_PATH_TARGETS = 3;

// ── First Files To Read ─────────────────────────────────────────────────────

interface FirstFile {
  path: string;
  reason: string;
}

/** Build the `## First Files To Read` section ("" when nothing grounded). */
export function buildFirstFilesSection(
  kb: SkillKnowledgeBase | null,
  index: SourceIndex | null,
): string {
  if (!kb || !index) return "";

  const picks: FirstFile[] = [];
  const seen = new Set<string>();
  const add = (path: string, reason: string): void => {
    if (seen.has(path) || picks.length >= MAX_FIRST_FILES) return;
    seen.add(path);
    picks.push({ path, reason });
  };

  // 1) Application / CLI entrypoints — how the app starts
  for (const ep of kb.entrypoints.filter((e) => e.type === "cli" || e.type === "app")) {
    add(ep.path, ep.type === "cli" ? "CLI entrypoint" : "application entry");
  }

  // 2) Public API surface — what the package exports. Re-export specifiers
  // often carry published `.js` paths; "read this file" instructions must
  // point at the indexed SOURCE file, so resolve `.js` -> `.ts`/`.tsx` and
  // skip entries that map to no indexed file (published-only paths stay in
  // the public-api reference, not here).
  const indexedPaths = new Set(index.files.map((f) => f.path));
  const resolveToSource = (path: string): string | null => {
    if (indexedPaths.has(path)) return path;
    const candidates = [
      path.replace(/\.js$/, ".ts"),
      path.replace(/\.js$/, ".tsx"),
      path.replace(/\.mjs$/, ".mts"),
      path.replace(/\.cjs$/, ".cts"),
    ];
    return candidates.find((c) => c !== path && indexedPaths.has(c)) ?? null;
  };
  for (const ep of kb.entrypoints.filter((e) => e.type === "public-api").slice(0, 3)) {
    const sourcePath = resolveToSource(ep.path);
    if (sourcePath) add(sourcePath, "public API surface");
  }

  // 3) Top hub files — highest blast radius
  const hubs = kb.risks
    .filter((r) => r.type === "hub-file")
    .sort((a, b) => (b.importCount ?? 0) - (a.importCount ?? 0))
    .slice(0, 2);
  for (const hub of hubs) {
    add(hub.file, `hub file, imported by ${hub.importCount ?? 0} files`);
  }

  // 4) Root route/layout for App Router projects
  const rootLayout = index.files.find((f) =>
    /^(?:src\/)?app\/layout\.(tsx|jsx|ts|js)$/.test(f.path),
  );
  if (rootLayout) add(rootLayout.path, "root layout (App Router)");

  if (picks.length === 0) return "";

  const lines = [
    `## First Files To Read`,
    ``,
    `Read these before changing anything - they anchor how the codebase fits together:`,
    ``,
  ];
  for (const pick of picks) {
    lines.push(`- \`${pick.path}\` - ${pick.reason}`);
  }
  return lines.join("\n");
}

// ── Common Change Paths ─────────────────────────────────────────────────────

interface ChangePathRow {
  task: string;
  targets: string[];
  note?: string;
}

const formatTargets = (targets: string[]): string =>
  targets
    .slice(0, MAX_CHANGE_PATH_TARGETS)
    .map((t) => `\`${t}\``)
    .join(", ");

function collectFeatureTargets(kb: SkillKnowledgeBase): string[] {
  return kb.modules
    .filter((m) => /(^|\/)(features?|modules|domains)\//.test(m.directory + "/"))
    .map((m) => m.directory + "/");
}

function collectApiTargets(kb: SkillKnowledgeBase): string[] {
  return kb.modules
    .filter((m) => /(^|\/)(api|routes?|server|services)(\/|$)/.test(m.directory))
    .map((m) => m.directory + "/");
}

function collectUiTargets(kb: SkillKnowledgeBase): string[] {
  return kb.modules
    .filter((m) => /(^|\/)(components?|ui|shared|layouts?|views?|pages?)(\/|$)/.test(m.directory))
    .map((m) => m.directory + "/");
}

const DEDICATED_TEST_DIR_RE = /^(.*?(?:__tests__|(?:^|\/)tests?))\//;

/**
 * Collect test locations with the DOMINANT placement first. Colocated
 * `*.test.*` files are mentioned only when no dedicated test dir exists or
 * colocated tests are a meaningful share (>= 30%) — a couple of stray
 * colocated files must not dilute a dedicated-dir convention.
 */
function collectTestTargets(index: SourceIndex): string[] {
  const dirCounts = new Map<string, number>();
  let colocatedCount = 0;

  for (const file of index.files) {
    const isTest =
      file.path.includes(".test.") ||
      file.path.includes(".spec.") ||
      file.path.includes("__tests__");
    if (!isTest) continue;
    const match = file.path.match(DEDICATED_TEST_DIR_RE);
    if (match) {
      const dir = `${match[1]}/`;
      dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
    } else {
      colocatedCount++;
    }
  }

  const total = [...dirCounts.values()].reduce((a, b) => a + b, 0) + colocatedCount;
  const targets = [...dirCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([dir]) => dir);

  if (colocatedCount > 0 && (targets.length === 0 || colocatedCount * 10 >= total * 3)) {
    targets.push("(colocated *.test.* next to source)");
  }

  return targets.slice(0, MAX_CHANGE_PATH_TARGETS);
}

/** Build the `## Common Change Paths` section ("" when nothing grounded). */
export function buildCommonChangePathsSection(
  kb: SkillKnowledgeBase | null,
  index: SourceIndex | null,
  conventions: DetectedConvention[],
): string {
  if (!kb || !index) return "";

  const rows: ChangePathRow[] = [];

  const featureTargets = collectFeatureTargets(kb);
  if (featureTargets.length > 0) {
    const row: ChangePathRow = { task: "New feature", targets: featureTargets };
    if (conventions.some((c) => c.id === "feature-structure")) {
      row.note = "follow the feature-folder shape from Detected Conventions";
    }
    rows.push(row);
  }

  const apiTargets = collectApiTargets(kb);
  if (apiTargets.length > 0) {
    const row: ChangePathRow = { task: "API / data work", targets: apiTargets };
    const dataConv = conventions.find((c) => c.id === "http-client" || c.id === "data-layer");
    if (dataConv) row.note = "go through the detected data/HTTP layer";
    rows.push(row);
  }

  const uiTargets = collectUiTargets(kb);
  if (uiTargets.length > 0) {
    const row: ChangePathRow = { task: "UI work", targets: uiTargets };
    if (conventions.some((c) => c.id === "ui-system")) {
      row.note = "extend the shared UI system instead of one-off components";
    }
    rows.push(row);
  }

  const testTargets = collectTestTargets(index);
  if (testTargets.length > 0) {
    const row: ChangePathRow = { task: "Tests", targets: testTargets };
    const scripts = index.project.scripts ?? {};
    if (scripts["test"] !== undefined) {
      row.note = `run \`${renderRunScript(index.project.packageManager, "test")}\``;
    }
    rows.push(row);
  }

  if (rows.length === 0) return "";

  const lines = [`## Common Change Paths`, ``, `| Task | Where | Notes |`, `|---|---|---|`];
  for (const row of rows) {
    lines.push(`| ${row.task} | ${formatTargets(row.targets)} | ${row.note ?? "-"} |`);
  }
  return lines.join("\n");
}
