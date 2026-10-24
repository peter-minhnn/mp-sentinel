/**
 * Token-budget packing for the task-context capsule.
 * Measures the JSON that will actually be emitted (pretty/compact + optional
 * MCP envelope) via the shared emission policy.
 */

import { emitPolicyJson, resolveUsedTokens, type EmitPolicy } from "./emit-policy.js";
import type { TaskContextFile, TaskContextResult } from "./task-context.js";

export interface PackCapsuleOptions {
  maxFiles: number;
  tokenBudget: number;
  anchors: string[];
  warnings: string[];
  emitEnvelope?: Record<string, unknown>;
  /** CLI `--pretty`: whitespace ships to the consumer, so it counts. */
  pretty?: boolean;
}

export function makeCapsule(
  files: TaskContextFile[],
  omittedFiles: string[],
  omittedCount: number,
  anchors: string[],
  warnings: string[],
  usedTokens: number,
): TaskContextResult {
  return {
    files: files.map((file, i) => ({ ...file, rank: i + 1 })),
    usedTokens,
    truncated: omittedCount > 0,
    omittedFiles,
    omittedCount,
    anchors,
    warnings,
  };
}

export async function assignUsedTokens(
  capsule: TaskContextResult,
  policy: EmitPolicy,
): Promise<TaskContextResult> {
  return resolveUsedTokens(capsule, policy);
}

/** Drop the record's optional metadata so a single file can still fit a tight budget. */
function slimFile(file: TaskContextFile, level: number): TaskContextFile {
  const { graph: _graph, ...rest } = file;
  if (level === 1) return { ...rest };
  return { ...rest, anchors: [] };
}

/**
 * Re-add the top-ranked file after the shrink loop emptied the capsule.
 * Tries richest to leanest so "at least one file" holds whenever any
 * single-file envelope fits, not only when the full record fits.
 */
async function restoreOneFile(
  first: TaskContextFile,
  totalRecords: number,
  tokenBudget: number,
  policy: EmitPolicy,
  anchors: string[],
  warnings: string[],
): Promise<TaskContextResult | null> {
  const omittedCount = Math.max(0, totalRecords - 1);
  const candidates: Array<{ file: TaskContextFile; anchors: string[]; warnings: string[] }> = [
    { file: first, anchors, warnings },
    { file: first, anchors, warnings: [] },
    { file: first, anchors: [], warnings: [] },
    { file: slimFile(first, 1), anchors: [], warnings: [] },
    { file: slimFile(first, 2), anchors: [], warnings: [] },
  ];

  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = emitPolicyJson(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    const one = await assignUsedTokens(
      makeCapsule([candidate.file], [], omittedCount, candidate.anchors, candidate.warnings, 0),
      policy,
    );
    if (one.usedTokens <= tokenBudget) return one;
  }
  return null;
}

async function shrinkToBudget(
  packed: TaskContextResult,
  records: TaskContextFile[],
  tokenBudget: number,
  policy: EmitPolicy,
  anchors: string[],
  warnings: string[],
): Promise<TaskContextResult> {
  let current = packed;
  const omittedCount = Math.max(current.omittedCount, records.length - current.files.length);

  while (current.usedTokens > tokenBudget) {
    if (current.omittedFiles.length > 0) {
      current = await assignUsedTokens(
        makeCapsule(
          current.files,
          current.omittedFiles.slice(0, -1),
          omittedCount,
          current.anchors,
          current.warnings,
          0,
        ),
        policy,
      );
      continue;
    }
    if (current.files.length > 1) {
      current = await assignUsedTokens(
        makeCapsule(
          current.files.slice(0, -1),
          [],
          omittedCount,
          current.anchors,
          current.warnings,
          0,
        ),
        policy,
      );
      continue;
    }
    if (current.warnings.length > 0) {
      current = await assignUsedTokens(
        makeCapsule(current.files, [], omittedCount, current.anchors, [], 0),
        policy,
      );
      continue;
    }
    if (current.anchors.length > 0) {
      current = await assignUsedTokens(
        makeCapsule(current.files, [], omittedCount, [], [], 0),
        policy,
      );
      continue;
    }
    if (current.files.length === 1) {
      current = await assignUsedTokens(makeCapsule([], [], records.length, [], [], 0), policy);
      continue;
    }
    if (current.omittedCount > 0) {
      current = await assignUsedTokens(makeCapsule([], [], 0, [], [], 0), policy);
      continue;
    }
    break;
  }

  const first = records[0];
  if (current.files.length === 0 && first) {
    const restored = await restoreOneFile(
      first,
      records.length,
      tokenBudget,
      policy,
      anchors,
      warnings,
    );
    if (restored) return restored;
  }

  return current;
}

export async function packCapsule(
  records: TaskContextFile[],
  options: PackCapsuleOptions,
): Promise<TaskContextResult> {
  const { maxFiles, tokenBudget, anchors, warnings } = options;
  const policy: EmitPolicy = {
    ...(options.pretty ? { pretty: true } : {}),
    ...(options.emitEnvelope ? { envelope: options.emitEnvelope } : {}),
  };

  const selected: TaskContextFile[] = [];
  for (const rec of records) {
    if (selected.length >= maxFiles) break;
    const omittedCount = records.length - (selected.length + 1);
    const trial = await assignUsedTokens(
      makeCapsule([...selected, rec], [], omittedCount, anchors, warnings, 0),
      policy,
    );
    if (trial.usedTokens > tokenBudget) break;
    selected.push(rec);
  }

  const rest = records.slice(selected.length).map((r) => r.file);
  const omittedCount = rest.length;
  let omitted: string[] = [];
  let packed = await assignUsedTokens(
    makeCapsule(selected, omitted, omittedCount, anchors, warnings, 0),
    policy,
  );

  for (const path of rest) {
    const trial = await assignUsedTokens(
      makeCapsule(selected, [...omitted, path], omittedCount, anchors, warnings, 0),
      policy,
    );
    if (trial.usedTokens > tokenBudget) break;
    omitted = [...omitted, path];
    packed = trial;
  }

  packed = await shrinkToBudget(packed, records, tokenBudget, policy, anchors, warnings);
  return packed;
}
