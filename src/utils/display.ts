/**
 * Display utilities — ASCII banner and sort helpers for review output.
 */

import type { AuditIssue, FileAuditResult } from "../types/index.js";
import { getToolVersion } from "./version.js";

// ── Severity sort order ────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  WARNING: 1,
  INFO: 2,
};

/** Sort issues: CRITICAL → WARNING → INFO, then line, then message. */
export const sortIssues = (issues: AuditIssue[]): AuditIssue[] => {
  return [...issues].sort((a, b) => {
    const aOrder = SEVERITY_ORDER[a.severity] ?? 99;
    const bOrder = SEVERITY_ORDER[b.severity] ?? 99;
    if (aOrder !== bOrder) return aOrder - bOrder;
    if (a.line !== b.line) return a.line - b.line;
    return a.message.localeCompare(b.message);
  });
};

/** Get the worst severity among a file result's issues. */
const getWorstSeverity = (result: FileAuditResult): "CRITICAL" | "WARNING" | "INFO" | undefined => {
  if (!result.result.issues || result.result.issues.length === 0) return undefined;
  const order = result.result.issues.map((i) => SEVERITY_ORDER[i.severity] ?? 99);
  const min = Math.min(...order);
  const entry = Object.entries(SEVERITY_ORDER).find(([, v]) => v === min);
  return entry?.[0] as "CRITICAL" | "WARNING" | "INFO" | undefined;
};

/**
 * Sort file results: runtime ERROR first, then by worst severity
 * (CRITICAL → WARNING → INFO), then by file path.
 */
export const sortFileResults = (results: FileAuditResult[]): FileAuditResult[] => {
  return [...results].sort((a, b) => {
    // Runtime ERROR first
    if (a.result.status === "ERROR" && b.result.status !== "ERROR") return -1;
    if (b.result.status === "ERROR" && a.result.status !== "ERROR") return 1;
    // Then by worst severity
    const aWorst = getWorstSeverity(a);
    const bWorst = getWorstSeverity(b);
    const aOrder = aWorst !== undefined ? (SEVERITY_ORDER[aWorst] ?? 99) : 99;
    const bOrder = bWorst !== undefined ? (SEVERITY_ORDER[bWorst] ?? 99) : 99;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.filePath.localeCompare(b.filePath);
  });
};

// ── ASCII Brand Banner ─────────────────────────────────────────────────────

const BANNER_LINES = [
  "",
  "  __  __   ___   _ __   ___   _ __   ___    ___ ",
  " |  \\/  | / _ \\ | '_ \\ / __| | '_ \\ / __|  / __|",
  " | |\\/| || (_) || |_) |\\__ \\ | |_) |\\__ \\  \\__ \\",
  " |_|  |_| \\___/ | .__/ |___/ | .__/ |___/  |___/",
  "                |_|          |_|                 ",
  "              MP SENTINEL - Code Review          ",
  "",
];

/** Return the ASCII banner as a string (version line appended). Used by --help only. */
export const bannerText = (): string => {
  const version = getToolVersion();
  return [...BANNER_LINES, `  v${version} - AI-Powered Code Review`, ""].join("\n");
};
