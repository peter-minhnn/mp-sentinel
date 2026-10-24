/**
 * Task-context capsule: turn a natural-language prompt into a short
 * ranked file list for agents. Does not compress the original prompt
 * already in the conversation -- it only replaces multi-tool search.
 */

import type { SourceIndex, SourceIndexFile } from "../../types/index.js";
import { querySymbols, queryImports, queryCodeStream } from "./query.js";
import { queryFiles } from "./agent-search.js";
import { packCapsule } from "./task-context-pack.js";

export const DEFAULT_TASK_MAX_FILES = 5;
export const MAX_TASK_FILES = 10;
export const DEFAULT_TASK_TOKEN_BUDGET = 800;
export const MAX_TASK_ANCHORS = 6;

const RRF_K = 60;
const PER_KIND_LIMIT = 120;
const EXACT_SCORE = 95;
const EXACT_BOOST = 1.5;
const GRAPH_SEED_LIMIT = 3;
const GRAPH_NEIGHBORS = 2;

const STOP = new Set([
  "the",
  "a",
  "an",
  "of",
  "for",
  "to",
  "in",
  "on",
  "and",
  "or",
  "from",
  "with",
  "how",
  "does",
  "what",
  "where",
  "when",
  "that",
  "this",
  "is",
  "are",
  "be",
  "by",
  "at",
  "as",
  "it",
  "into",
  "about",
  "using",
  "use",
  "please",
  "need",
  "want",
  "show",
  "find",
  "locate",
  "get",
  "make",
  "which",
  "should",
  "we",
  "i",
  "me",
  "my",
  "our",
  "you",
  "do",
  "not",
  "no",
  "và",
  "của",
  "cho",
  "không",
  "với",
  "là",
  "các",
  "một",
  "này",
  "đó",
  "khi",
  "từ",
  "trên",
  "trong",
  "để",
  "được",
  "có",
  "như",
  "về",
  "đến",
  "hay",
  "hoặc",
  "thì",
  "sẽ",
  "đã",
  "đang",
  "tại",
  "vào",
  "sau",
  "trước",
  "nếu",
  "vì",
  "do",
  "nên",
  "cũng",
  "hơn",
  "rất",
  "quá",
  "chỉ",
  "tìm",
  "cách",
  "làm",
  "giúp",
  "xem",
  "sửa",
  "thêm",
  "hàm",
  "ở",
  "đâu",
  "nào",
  "khiến",
  "muốn",
  "cần",
  "hiểu",
  "nguyên",
  "tử",
  "công",
  "cụ",
]);

export interface TaskContextOptions {
  maxFiles?: number;
  tokenBudget?: number;
  /** Extra fields on the emitted JSON (MCP `{ status: "ok" }`). Counted in the budget. */
  emitEnvelope?: Record<string, unknown>;
  /** CLI `--pretty`: the indentation is emitted, so the packer must measure it. */
  pretty?: boolean;
}

export interface TaskContextFile {
  file: string;
  rank: number;
  score: number;
  anchors: string[];
  graph?: { imports: string[]; dependents: string[] };
}

export interface TaskContextResult {
  files: TaskContextFile[];
  usedTokens: number;
  truncated: boolean;
  omittedFiles: string[];
  omittedCount: number;
  anchors: string[];
  warnings: string[];
}

interface KindHit {
  file: string;
  rank: number;
  score: number;
  kind: "symbol" | "file" | "import" | "code";
  anchor: string;
}

function clampMaxFiles(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) return DEFAULT_TASK_MAX_FILES;
  return Math.min(MAX_TASK_FILES, Math.floor(value));
}

function clampTokenBudget(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 100) {
    return DEFAULT_TASK_TOKEN_BUDGET;
  }
  return Math.min(4000, Math.floor(value));
}

function kindWeight(kind: KindHit["kind"]): number {
  if (kind === "file") return 1.3;
  if (kind === "import") return 1.15;
  if (kind === "code") return 0.5;
  return 1;
}

export function extractTaskAnchors(prompt: string): string[] {
  const tokens = prompt.split(/[\s,;:!?()[\]{}"'`]+/).filter((t) => t.length > 0);
  const ranked: Array<{ token: string; pri: number }> = [];
  const seen = new Set<string>();

  for (const raw of tokens) {
    const token = raw.replace(/^[^@A-Za-z0-9./_-]+|[^A-Za-z0-9./_-]+$/g, "");
    if (token.length < 2) continue;
    const lower = token.toLowerCase();
    if (STOP.has(lower)) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);

    let pri = 0;
    if (token.startsWith("--") && token.length > 3) pri = 4;
    else if (token.includes("/") || /\.\w{1,5}$/.test(token)) pri = 4;
    else if (token.startsWith("@")) pri = 3;
    else if (/[A-Z]/.test(token) || token.includes("_") || token.includes("-")) pri = 3;
    else if (token.length >= 4) pri = 2;
    else pri = 1;

    ranked.push({ token, pri });
  }

  ranked.sort((a, b) => b.pri - a.pri);
  return ranked.slice(0, MAX_TASK_ANCHORS).map((r) => r.token);
}

function toKindHits(
  rows: Array<{ file: string; score: number }>,
  kind: KindHit["kind"],
  anchor: string,
): KindHit[] {
  const seen = new Set<string>();
  const hits: KindHit[] = [];
  // Fusion's retrieval unit is a file. Repeated matches inside a barrel or
  // overload-heavy module are not independent ranked-list votes.
  for (const row of rows) {
    if (seen.has(row.file)) continue;
    seen.add(row.file);
    hits.push({ file: row.file, rank: hits.length + 1, score: row.score, kind, anchor });
    if (hits.length >= PER_KIND_LIMIT) break;
  }
  return hits;
}

async function collectKindHits(
  index: SourceIndex,
  anchors: string[],
  cachePath: string | undefined,
): Promise<{ hits: KindHit[]; warnings: string[] }> {
  const hits: KindHit[] = [];
  const warnings: string[] = [];
  let structured = 0;

  for (const anchor of anchors) {
    const symbols = toKindHits(querySymbols(index, anchor, Infinity), "symbol", anchor);
    const files = toKindHits(queryFiles(index, anchor, PER_KIND_LIMIT), "file", anchor);
    const imports = toKindHits(queryImports(index, anchor, Infinity), "import", anchor);
    hits.push(...symbols, ...files, ...imports);
    structured += symbols.length + files.length + imports.length;
  }

  if (structured === 0 && cachePath !== undefined) {
    try {
      for (const anchor of anchors.slice(0, 3)) {
        const code = await queryCodeStream(index, cachePath, anchor, PER_KIND_LIMIT);
        hits.push(...toKindHits(code, "code", anchor));
      }
      if (hits.some((h) => h.kind === "code")) {
        warnings.push("code search fallback used (no structured seed)");
      }
    } catch {
      warnings.push("code sidecar unavailable; skipped snippet fallback");
    }
  }

  return { hits, warnings };
}

/** Build output and generated declarations mirror source without being it. */
const ARTIFACT_PATH = /(^|\/)(dist|dist-test|build|coverage|out|node_modules)\//;
const TEST_PATH = /(^|\/)(__tests__|tests)\/|\.(test|spec)\.[cm]?[jt]sx?$/;

function pathWeight(file: string): number {
  // A compiled copy of a file is never the answer to a task prompt, and it
  // otherwise outranks the source it was built from.
  if (ARTIFACT_PATH.test(file) || file.endsWith(".d.ts")) return 0.2;
  if (TEST_PATH.test(file) || file.startsWith("examples/") || file.startsWith("scripts/")) {
    return 0.35;
  }
  return 1;
}

/**
 * Basenames that say nothing about what a file contains. "source index",
 * "index-cache" and "MCP index search" all contain "index", which used to hand
 * every `index.ts` -- including a 2,000-line type barrel -- a 2.2x boost and a
 * slot in the top 3.
 */
const GENERIC_BASENAMES = new Set([
  "index",
  "main",
  "types",
  "utils",
  "constants",
  "helpers",
  "common",
]);

function basenameWeight(file: string, anchor: string): number {
  const slash = file.lastIndexOf("/");
  const base = (slash === -1 ? file : file.slice(slash + 1)).replace(/\.[^.]+$/, "");
  const lowerBase = base.toLowerCase();
  const lowerAnchor = anchor.toLowerCase();
  if (GENERIC_BASENAMES.has(lowerBase)) return 1;
  if (lowerBase === lowerAnchor) return 2.2;
  if (lowerAnchor.length >= 4 && lowerBase.includes(lowerAnchor)) return 1.5;
  return 1;
}

/**
 * A declaration barrel is where a name is written down, not where the
 * behaviour lives. `src/types/index.ts` matches almost every anchor in this
 * repo and used to hold a top-3 slot that an implementation file needed.
 */
function roleWeight(role: string | undefined): number {
  if (role === "type") return 0.5;
  if (role === "test") return 0.35;
  return 1;
}

function fuseByFile(
  hits: KindHit[],
  roles: Map<string, string | undefined>,
): Map<string, { rrf: number; exact: boolean; anchors: Set<string> }> {
  const fused = new Map<string, { rrf: number; exact: boolean; anchors: Set<string> }>();
  for (const hit of hits) {
    const cur = fused.get(hit.file) ?? { rrf: 0, exact: false, anchors: new Set<string>() };
    const weightForPath = pathWeight(hit.file) * roleWeight(roles.get(hit.file));
    const weight = kindWeight(hit.kind) * weightForPath * basenameWeight(hit.file, hit.anchor);
    cur.rrf += weight / (RRF_K + hit.rank);
    // The exact tier is a fast lane past every weight, so a compiled copy or a
    // test fixture with the same name must not enter it -- it used to take the
    // top slot from the source it mirrors.
    if (hit.score >= EXACT_SCORE && weightForPath === 1) cur.exact = true;
    cur.anchors.add(hit.anchor);
    fused.set(hit.file, cur);
  }
  return fused;
}

function rankedSeedPaths(
  fused: Map<string, { rrf: number; exact: boolean; anchors: Set<string> }>,
): string[] {
  return [...fused.entries()]
    .sort((a, b) => {
      const scoreA = a[1].rrf * (a[1].exact ? EXACT_BOOST : 1);
      const scoreB = b[1].rrf * (b[1].exact ? EXACT_BOOST : 1);
      return scoreB - scoreA || a[0].localeCompare(b[0]);
    })
    .map(([file]) => file);
}

function expandGraph(
  index: SourceIndex,
  seeds: string[],
  fused: Map<string, { rrf: number; exact: boolean; anchors: Set<string> }>,
): void {
  const byPath = new Map(index.files.map((f: SourceIndexFile) => [f.path, f]));
  for (const seed of seeds.slice(0, GRAPH_SEED_LIMIT)) {
    const file = byPath.get(seed);
    if (!file) continue;
    const seedScore = fused.get(seed)?.rrf ?? 0;
    const neighbors = [
      ...(file.importsFrom ?? []).slice(0, GRAPH_NEIGHBORS),
      ...(file.importedBy ?? []).slice(0, GRAPH_NEIGHBORS),
    ].filter((path) => pathWeight(path) === 1);
    for (const path of neighbors) {
      if (fused.has(path)) continue;
      fused.set(path, {
        rrf: seedScore * 0.25,
        exact: false,
        anchors: new Set([`graph:${seed}`]),
      });
    }
  }
}

function graphFor(index: SourceIndex, path: string): TaskContextFile["graph"] {
  const file = index.files.find((f) => f.path === path);
  if (!file) return undefined;
  const imports = (file.importsFrom ?? []).slice(0, 3);
  const dependents = (file.importedBy ?? []).slice(0, 3);
  if (imports.length === 0 && dependents.length === 0) return undefined;
  return { imports, dependents };
}

/**
 * The ranked candidate list *before* capping and packing.
 *
 * Packing only ever sees this list, so a diagnostic that wants to say why a
 * file is missing from a capsule has to compare against it: absent here means
 * retrieval never produced the file, present but low means ranking, present
 * and high but missing from the capsule means the token budget.
 */
export async function rankTaskCandidates(
  index: SourceIndex | null,
  prompt: string,
  cachePath?: string,
): Promise<{ anchors: string[]; warnings: string[]; records: TaskContextFile[] }> {
  const trimmed = prompt.trim();
  if (!index || !trimmed) return { anchors: [], warnings: [], records: [] };

  const anchors = extractTaskAnchors(trimmed);
  const { hits, warnings } = await collectKindHits(index, anchors, cachePath);
  const roles = new Map(index.files.map((f: SourceIndexFile) => [f.path, f.role]));
  const fused = fuseByFile(hits, roles);
  const seedOrder = rankedSeedPaths(fused);
  expandGraph(index, seedOrder.slice(0, GRAPH_SEED_LIMIT), fused);

  const ranked = rankedSeedPaths(fused);
  const records: TaskContextFile[] = ranked.map((file, i) => {
    const info = fused.get(file);
    const rec: TaskContextFile = {
      file,
      rank: i + 1,
      score: Math.round((info?.rrf ?? 0) * 10000) / 10000,
      anchors: [...(info?.anchors ?? [])].slice(0, 4),
    };
    const graph = graphFor(index, file);
    if (graph) rec.graph = graph;
    return rec;
  });

  return { anchors, warnings, records };
}

export async function buildTaskContext(
  index: SourceIndex | null,
  prompt: string,
  options: TaskContextOptions = {},
  cachePath?: string,
): Promise<TaskContextResult> {
  const maxFiles = clampMaxFiles(options.maxFiles);
  const tokenBudget = clampTokenBudget(options.tokenBudget);
  const empty: TaskContextResult = {
    files: [],
    usedTokens: 0,
    truncated: false,
    omittedFiles: [],
    omittedCount: 0,
    anchors: [],
    warnings: [],
  };
  if (!index || !prompt.trim()) return empty;

  const { anchors, warnings, records } = await rankTaskCandidates(index, prompt, cachePath);

  return packCapsule(records, {
    maxFiles,
    tokenBudget,
    anchors,
    warnings,
    ...(options.emitEnvelope ? { emitEnvelope: options.emitEnvelope } : {}),
    ...(options.pretty ? { pretty: true } : {}),
  });
}
