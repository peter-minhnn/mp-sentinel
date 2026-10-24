/**
 * Compact, token-budgeted agent context.
 *
 * `queryAgentContext()` stays the legacy shape (fixed caps, suggested
 * commands, no budget). This module builds the same evidence, ranks it
 * against caller-supplied `focus` anchors *before* the caps, then packs
 * whole records under a hard token budget measured on the JSON that is
 * actually emitted (compact/pretty + optional MCP envelope).
 */

import type { SourceIndex, SourceIndexFile } from "../../types/index.js";
import { UserError } from "../../utils/errors.js";
import { estimateTokens } from "../../utils/tokens.js";
import { emitPolicyJson, resolveUsedTokens, type EmitPolicy } from "./emit-policy.js";
import { getParserTelemetry } from "./query.js";
import {
  AGENT_CONTEXT_CAPS,
  collectHubCandidates,
  collectIncomingCalls,
  findIndexedFile,
  mapCallRecord,
  mapExportRecord,
  mapImportRecord,
  mapSymbolRecord,
  type FileInfo,
  type HubFileEntry,
  type IncomingCallEntry,
} from "./agent-context-evidence.js";

export const MAX_FOCUS_ANCHORS = 6;
export const DEFAULT_AGENT_CONTEXT_TOKEN_BUDGET = 1200;
export const MIN_AGENT_CONTEXT_TOKEN_BUDGET = 100;
export const MAX_AGENT_CONTEXT_TOKEN_BUDGET = 4000;

export interface CompactAgentContextOptions {
  /** Task anchors that pull matching evidence to the front (max 6). */
  focus?: string[];
  tokenBudget?: number;
  /** Extra fields on the emitted JSON (MCP `{ status: "ok" }`). Counted in the budget. */
  emitEnvelope?: Record<string, unknown>;
  /** CLI `--pretty`: the indentation is emitted, so the packer must measure it. */
  pretty?: boolean;
}

export interface CompactAgentContextResult {
  file: FileInfo | null;
  directImports: string[];
  directImportsTruncated: number;
  directDependents: string[];
  directDependentsTruncated: number;
  hubFiles: HubFileEntry[];
  hubFilesTruncated: number;
  incomingCalls: IncomingCallEntry[];
  incomingCallsTruncated: number;
  usedTokens: number;
  truncated: boolean;
  error?: string;
}

/**
 * Trim, drop nothing silently, dedupe. An empty/blank anchor or more than
 * `MAX_FOCUS_ANCHORS` distinct anchors is a user error (CLI exit 2 /
 * MCP `isError: true`), never a silent truncation.
 */
export function normalizeFocus(raw: readonly string[] | undefined): string[] {
  if (raw === undefined) return [];
  const normalized: string[] = [];
  for (const entry of raw) {
    const trimmed = entry.trim();
    if (trimmed === "") {
      throw new UserError("--focus anchor must not be empty");
    }
    if (!normalized.includes(trimmed)) normalized.push(trimmed);
  }
  if (normalized.length > MAX_FOCUS_ANCHORS) {
    throw new UserError(
      `--focus accepts at most ${MAX_FOCUS_ANCHORS} anchors (got ${normalized.length})`,
    );
  }
  return normalized;
}

/** Validate then clamp a token budget into [min, max]. */
export function clampAgentContextBudget(value: number | undefined): number {
  if (value === undefined) return DEFAULT_AGENT_CONTEXT_TOKEN_BUDGET;
  if (!Number.isInteger(value) || value < 1) {
    throw new UserError(`--token-budget must be an integer >= 1 (got ${JSON.stringify(value)})`);
  }
  return Math.min(MAX_AGENT_CONTEXT_TOKEN_BUDGET, Math.max(MIN_AGENT_CONTEXT_TOKEN_BUDGET, value));
}

// ── Focus ranking ─────────────────────────────────────────────────────────────

const TIER_EXACT = 0;
const TIER_SUBSTRING = 1;
const TIER_NONE = 2;

interface RankedItem<T> {
  item: T;
  tier: number;
}

function matchTier(haystack: Array<string | undefined>, focus: string[]): number {
  const values = haystack.filter((v): v is string => typeof v === "string" && v.length > 0);
  if (values.some((v) => focus.includes(v))) return TIER_EXACT;
  const lowered = focus.map((f) => f.toLowerCase());
  if (values.some((v) => lowered.some((f) => v.toLowerCase().includes(f)))) return TIER_SUBSTRING;
  return TIER_NONE;
}

/**
 * Exact match first, case-insensitive substring next, source order last.
 * Stable: equal tiers keep the index's own deterministic order.
 */
function rankItems<T>(
  items: readonly T[],
  focus: string[],
  haystack: (item: T) => Array<string | undefined>,
  specificity?: (item: T) => number[],
): Array<RankedItem<T>> {
  const ranked = items.map((item, index) => ({
    item,
    index,
    tier: focus.length === 0 ? TIER_NONE : matchTier(haystack(item), focus),
  }));
  ranked.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.tier < TIER_NONE && specificity) {
      const left = specificity(a.item);
      const right = specificity(b.item);
      for (let i = 0; i < left.length; i++) {
        const difference = left[i]! - right[i]!;
        if (difference) return difference;
      }
    }
    return a.index - b.index;
  });
  return ranked.map(({ item, tier }) => ({ item, tier }));
}

// ── Packing ───────────────────────────────────────────────────────────────────

type Slot =
  | "symbols"
  | "exports"
  | "imports"
  | "calls"
  | "incomingCalls"
  | "directImports"
  | "directDependents"
  | "hubFiles";

interface Candidates {
  symbols: Array<RankedItem<FileInfo["symbols"][number]>>;
  exports: Array<RankedItem<FileInfo["exports"][number]>>;
  imports: Array<RankedItem<FileInfo["imports"][number]>>;
  calls: Array<RankedItem<NonNullable<FileInfo["calls"]>[number]>>;
  incomingCalls: Array<RankedItem<IncomingCallEntry>>;
  directImports: Array<RankedItem<string>>;
  directDependents: Array<RankedItem<string>>;
  hubFiles: Array<RankedItem<HubFileEntry>>;
}

type Totals = Record<Slot, number>;

/**
 * Records one slot may contribute to the focus stage before the later stages
 * get a turn. Call records are the priciest evidence per unit of information
 * (a callee, a line, and an enclosing symbol each), and every call inside a
 * focused function matches the anchor through `inSymbol` -- so they get a
 * tighter share than declarations do.
 */
const FOCUS_STAGE_SLOT_CAP = 8;
const FOCUS_STAGE_CALL_CAP = 4;

function focusStageCap(slot: Slot): number {
  return slot === "calls" || slot === "incomingCalls" ? FOCUS_STAGE_CALL_CAP : FOCUS_STAGE_SLOT_CAP;
}

/** Slot order inside each packing stage. Stable across runs. */
const FOCUS_ORDER: Slot[] = [
  "symbols",
  "exports",
  "imports",
  "calls",
  "incomingCalls",
  "directImports",
  "directDependents",
  "hubFiles",
];

/**
 * Packing stages, highest value first:
 * 1. file identity + parser telemetry (never dropped -- see the budget error)
 * 2. focus-matched evidence
 * 3. direct imports/dependents
 * 4. remaining symbols/exports/imports
 * 5. remaining outbound/incoming calls
 * 6. remaining hub files
 */
const REST_STAGES: Slot[][] = [
  ["directImports", "directDependents"],
  ["symbols", "exports", "imports"],
  ["calls", "incomingCalls"],
  ["hubFiles"],
];

interface QueueEntry {
  slot: Slot;
  item: unknown;
}

function buildQueue(candidates: Candidates): QueueEntry[] {
  const queue: QueueEntry[] = [];
  const taken = new Set<string>();
  const push = (slot: Slot, index: number, item: unknown): void => {
    const key = `${slot}:${index}`;
    if (taken.has(key)) return;
    taken.add(key);
    queue.push({ slot, item });
  };

  // Stage 2 is interleaved and per-slot bounded: every call inside a focused
  // function matches the anchor via `inSymbol`, so an unbounded focus stage
  // would spend the whole budget on 30 call records and leave the file's own
  // imports out. The overflow keeps its rank inside the slot's later stage.
  const focusDepth = Math.min(
    FOCUS_STAGE_SLOT_CAP,
    Math.max(
      ...FOCUS_ORDER.map((slot) => candidates[slot].filter((e) => e.tier < TIER_NONE).length),
    ),
  );
  for (let i = 0; i < focusDepth; i++) {
    for (const slot of FOCUS_ORDER) {
      const entry = candidates[slot][i];
      if (entry && entry.tier < TIER_NONE && i < focusStageCap(slot)) push(slot, i, entry.item);
    }
  }
  // Within a stage the slots are interleaved round-robin: the 25th symbol
  // must not starve the file's imports when the budget runs out mid-stage.
  for (const stage of REST_STAGES) {
    const depth = Math.max(...stage.map((slot) => candidates[slot].length));
    for (let i = 0; i < depth; i++) {
      for (const slot of stage) {
        const entry = candidates[slot][i];
        if (entry) push(slot, i, entry.item);
      }
    }
  }
  return queue;
}

function makeCompactCapsule(
  identity: FileInfo,
  emitted: Record<Slot, unknown[]>,
  totals: Totals,
  hasCalls: boolean,
  usedTokens: number,
): CompactAgentContextResult {
  const truncatedFor = (slot: Slot): number => Math.max(0, totals[slot] - emitted[slot].length);
  const file: FileInfo = {
    ...identity,
    symbols: emitted.symbols as FileInfo["symbols"],
    symbolsTruncated: truncatedFor("symbols"),
    imports: emitted.imports as FileInfo["imports"],
    importsTruncated: truncatedFor("imports"),
    exports: emitted.exports as FileInfo["exports"],
    exportsTruncated: truncatedFor("exports"),
  };
  if (hasCalls) {
    file.calls = emitted.calls as NonNullable<FileInfo["calls"]>;
    file.callsTruncated = truncatedFor("calls");
  }

  const truncated = FOCUS_ORDER.some((slot) => truncatedFor(slot) > 0);
  return {
    file,
    directImports: emitted.directImports as string[],
    directImportsTruncated: truncatedFor("directImports"),
    directDependents: emitted.directDependents as string[],
    directDependentsTruncated: truncatedFor("directDependents"),
    hubFiles: emitted.hubFiles as HubFileEntry[],
    hubFilesTruncated: truncatedFor("hubFiles"),
    incomingCalls: emitted.incomingCalls as IncomingCallEntry[],
    incomingCallsTruncated: truncatedFor("incomingCalls"),
    usedTokens,
    truncated,
  };
}

function emptyError(message: string): CompactAgentContextResult {
  return {
    file: null,
    directImports: [],
    directImportsTruncated: 0,
    directDependents: [],
    directDependentsTruncated: 0,
    hubFiles: [],
    hubFilesTruncated: 0,
    incomingCalls: [],
    incomingCallsTruncated: 0,
    usedTokens: 0,
    truncated: false,
    error: message,
  };
}

function buildCandidates(
  index: SourceIndex,
  file: SourceIndexFile,
  focus: string[],
): { candidates: Candidates; totals: Totals } {
  const importsFrom = file.importsFrom ?? [];
  const importedBy = file.importedBy ?? [];
  const hubCandidates = collectHubCandidates(index, file);
  const incomingCandidates = collectIncomingCalls(index, file);
  const calls = file.calls ?? [];

  // Focus ranking runs on the full lists, so an anchored symbol beyond the
  // legacy cap (or late in source order) can still reach the capsule.
  const candidates: Candidates = {
    symbols: rankItems(
      file.symbols,
      focus,
      (s) => [s.name, s.parent],
      (s) => [
        matchTier([s.name], focus),
        ["function", "method", "arrow-function", "class"].includes(s.type) ? 0 : 1,
        -focus.filter((anchor) => s.name.toLowerCase().includes(anchor.toLowerCase())).length,
      ],
    )
      .slice(0, AGENT_CONTEXT_CAPS.symbols)
      .map(({ item, tier }) => ({ item: mapSymbolRecord(item), tier })),
    exports: rankItems(file.exports, focus, (e) => [...e.names, e.source])
      .slice(0, AGENT_CONTEXT_CAPS.exports)
      .map(({ item, tier }) => ({ item: mapExportRecord(item), tier })),
    imports: rankItems(file.imports, focus, (i) => [i.source, ...i.names])
      .slice(0, AGENT_CONTEXT_CAPS.imports)
      .map(({ item, tier }) => ({ item: mapImportRecord(item), tier })),
    calls: rankItems(calls, focus, (c) => [c.callee, c.inSymbol])
      .slice(0, AGENT_CONTEXT_CAPS.calls)
      .map(({ item, tier }) => ({ item: mapCallRecord(item), tier })),
    incomingCalls: rankItems(incomingCandidates, focus, (c) => [
      c.callee,
      c.inSymbol,
      c.fromFile,
    ]).slice(0, AGENT_CONTEXT_CAPS.incomingCalls),
    directImports: rankItems(importsFrom, focus, (p) => [p, basename(p)]).slice(
      0,
      AGENT_CONTEXT_CAPS.directImports,
    ),
    directDependents: rankItems(importedBy, focus, (p) => [p, basename(p)]).slice(
      0,
      AGENT_CONTEXT_CAPS.directDependents,
    ),
    hubFiles: rankItems(hubCandidates, focus, (h) => [h.path, basename(h.path)]).slice(
      0,
      AGENT_CONTEXT_CAPS.hubFiles,
    ),
  };

  const totals: Totals = {
    symbols: file.symbols.length,
    exports: file.exports.length,
    imports: file.imports.length,
    calls: calls.length,
    incomingCalls: incomingCandidates.length,
    directImports: importsFrom.length,
    directDependents: importedBy.length,
    hubFiles: hubCandidates.length,
  };

  return { candidates, totals };
}

function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

/**
 * Build the compact capsule for one file.
 *
 * Throws `UserError` when the budget cannot even hold the file identity, so
 * the caller can fail loudly (CLI exit 2 / MCP `isError: true`) instead of
 * silently emitting a payload above the cap.
 */
export async function buildCompactAgentContext(
  index: SourceIndex | null,
  filePath: string,
  options: CompactAgentContextOptions = {},
  projectRoot?: string,
): Promise<CompactAgentContextResult> {
  if (!index) return emptyError("No index available");

  const focus = normalizeFocus(options.focus);
  const tokenBudget = clampAgentContextBudget(options.tokenBudget);
  const policy: EmitPolicy = {
    ...(options.pretty ? { pretty: true } : {}),
    ...(options.emitEnvelope ? { envelope: options.emitEnvelope } : {}),
  };

  const file = findIndexedFile(index, filePath, projectRoot);
  if (!file) return emptyError(`File not found in index: ${filePath}`);

  const identity: FileInfo = {
    path: file.path,
    language: file.language,
    ...(file.role && { role: file.role }),
    symbols: [],
    symbolsTruncated: 0,
    imports: [],
    importsTruncated: 0,
    exports: [],
    exportsTruncated: 0,
    ...getParserTelemetry(file, { agentContext: true }),
  };

  const { candidates, totals } = buildCandidates(index, file, focus);
  const hasCalls = file.calls !== undefined;
  const emitted: Record<Slot, unknown[]> = {
    symbols: [],
    exports: [],
    imports: [],
    calls: [],
    incomingCalls: [],
    directImports: [],
    directDependents: [],
    hubFiles: [],
  };

  // Trial measurements use the budget itself as the `usedTokens` placeholder:
  // the final value can never exceed it, so its digit count is an upper bound
  // and a trial never under-estimates the emitted size.
  const trialTokens = async (): Promise<number> => {
    const capsule = makeCompactCapsule(identity, emitted, totals, hasCalls, tokenBudget);
    return estimateTokens(emitPolicyJson(capsule, policy));
  };

  const identityTokens = await trialTokens();
  if (identityTokens > tokenBudget) {
    throw new UserError(
      `Token budget ${tokenBudget} is too small for ${file.path}: file identity alone needs ~${identityTokens} tokens. Raise --token-budget (max ${MAX_AGENT_CONTEXT_TOKEN_BUDGET}).`,
    );
  }

  // One oversized record must not end the pack: drop it and keep trying the
  // rest, so a small relevant import still lands when a long symbol does not.
  for (const entry of buildQueue(candidates)) {
    emitted[entry.slot].push(entry.item);
    if ((await trialTokens()) > tokenBudget) emitted[entry.slot].pop();
  }

  return resolveUsedTokens(makeCompactCapsule(identity, emitted, totals, hasCalls, 0), policy);
}
