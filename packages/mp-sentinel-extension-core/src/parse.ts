/**
 * Tolerant JSON parsing for `mp-sentinel` stdout.
 *
 * Query/JSON modes write valid JSON to stdout and logs to stderr, but to be
 * defensive against a stray banner line we locate the first balanced JSON value
 * rather than assuming the entire stdout is parseable.
 */

import type {
  CreateSkillsCheckOutput,
  CreateSkillsDryRunOutput,
  ExplainContextOutput,
  IndexHealthOutput,
  ReviewReport,
} from "./types.js";

export class CliJsonParseError extends Error {
  readonly raw: string;
  constructor(message: string, raw: string) {
    super(message);
    this.name = "CliJsonParseError";
    this.raw = raw;
  }
}

/** Finds the first balanced JSON object/array in `text` and parses it. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new CliJsonParseError("Empty CLI output — expected JSON.", text);
  }

  // Fast path: the whole output is JSON.
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // Fall through to scanning.
  }

  const start = firstJsonStart(trimmed);
  if (start === -1) {
    throw new CliJsonParseError("No JSON object or array found in CLI output.", text);
  }

  const slice = balancedSlice(trimmed, start);
  if (slice === null) {
    throw new CliJsonParseError("Unbalanced JSON in CLI output.", text);
  }

  try {
    return JSON.parse(slice) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CliJsonParseError(`Failed to parse CLI JSON: ${detail}`, text);
  }
}

function firstJsonStart(text: string): number {
  const obj = text.indexOf("{");
  const arr = text.indexOf("[");
  if (obj === -1) return arr;
  if (arr === -1) return obj;
  return Math.min(obj, arr);
}

/** Returns the substring from `start` to the matching close brace/bracket. */
function balancedSlice(text: string, start: number): string | null {
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseReviewReport(stdout: string): ReviewReport {
  const json = extractJson(stdout);
  if (!isRecord(json) || typeof json["status"] !== "string" || !Array.isArray(json["results"])) {
    throw new CliJsonParseError("Output is not a ReviewReport.", stdout);
  }
  return json as unknown as ReviewReport;
}

export function parseExplainContext(stdout: string): ExplainContextOutput {
  const json = extractJson(stdout);
  if (!isRecord(json) || typeof json["status"] !== "string") {
    throw new CliJsonParseError("Output is not an ExplainContextOutput.", stdout);
  }
  return json as unknown as ExplainContextOutput;
}

export function parseIndexHealth(stdout: string): IndexHealthOutput {
  const json = extractJson(stdout);
  if (!isRecord(json) || typeof json["status"] !== "string") {
    throw new CliJsonParseError("Output is not an IndexHealthOutput.", stdout);
  }
  return json as unknown as IndexHealthOutput;
}

export function parseCreateSkillsCheck(stdout: string): CreateSkillsCheckOutput {
  const json = extractJson(stdout);
  if (!isRecord(json) || !Array.isArray(json["check"])) {
    throw new CliJsonParseError("Output is not a create-skills --check result.", stdout);
  }
  return json as unknown as CreateSkillsCheckOutput;
}

export function parseCreateSkillsDryRun(stdout: string): CreateSkillsDryRunOutput {
  const json = extractJson(stdout);
  if (!isRecord(json) || !Array.isArray(json["dryRun"])) {
    throw new CliJsonParseError("Output is not a create-skills --dry-run result.", stdout);
  }
  return json as unknown as CreateSkillsDryRunOutput;
}
